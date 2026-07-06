"""
Tests for closed-loop recommendation tracking.

Strategy (mirrors test_articles.py):
- Override `get_db` with an in-memory SQLite async session (aiosqlite)
- Override `get_current_user` with a fake user
- Test the model, service (create/baseline/measure/match/summarize) and endpoints
"""
import uuid

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.organization import Organization
from app.models.project import Project
from app.models.user import User, UserRole

# Register tables with Base.metadata
from app.models.article import Article  # noqa: F401
from app.models.social import SocialPost  # noqa: F401
from app.models.analytics import GscQueryStat  # noqa: F401
from app.models.recommendation import Recommendation  # noqa: F401

# ── Test DB (SQLite in-memory) ────────────────────────────────────────────────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

SQLITE_COMPATIBLE_TABLES = [
    "organizations", "users", "projects",
    "articles", "social_posts", "gsc_query_stats", "analytics_snapshots", "recommendations",
]


async def override_get_db():
    async with TestSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ── Fake user fixture ─────────────────────────────────────────────────────────

FAKE_ORG_ID = uuid.uuid4()
FAKE_USER_ID = uuid.uuid4()
FAKE_PROJECT_ID = uuid.uuid4()

fake_user = User(
    id=FAKE_USER_ID,
    org_id=FAKE_ORG_ID,
    email="test@fennex.ai",
    hashed_password="hashed",
    full_name="Test User",
    role=UserRole.OWNER,
    is_active=True,
)


async def override_get_current_user():
    return fake_user


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
async def setup_db():
    tables = [
        Base.metadata.tables[name]
        for name in SQLITE_COMPATIBLE_TABLES
        if name in Base.metadata.tables
    ]
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=tables)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all, tables=tables)


@pytest.fixture
async def db_session():
    async with TestSessionLocal() as session:
        yield session


@pytest.fixture
async def org_and_project(db_session):
    org = Organization(id=FAKE_ORG_ID, slug="test-org", name="Test Org")
    db_session.add(org)
    await db_session.flush()
    project = Project(id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, name="Test Project", domain="example.com")
    db_session.add(project)
    await db_session.commit()
    return org, project


@pytest.fixture
async def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ── Model ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_recommendation_row_persists(db_session, org_and_project):
    rec = Recommendation(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID,
        source="opportunity", kind="striking_distance",
        title="Target 'olive oil'", anchor_query="olive oil", status="tracking",
    )
    db_session.add(rec)
    await db_session.commit()
    await db_session.refresh(rec)
    assert rec.id is not None
    assert rec.status == "tracking"
    assert rec.baseline is None


# ── Service: create / list / transition ───────────────────────────────────────

@pytest.mark.asyncio
async def test_create_snapshots_baseline_from_gsc(db_session, org_and_project):
    from app.services.recommendation_service import create_recommendation
    db_session.add(GscQueryStat(
        project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, query="olive oil",
        clicks=40, impressions=1000, ctr=0.04, position=8.0, top_url="https://x/olive",
    ))
    await db_session.commit()
    rec = await create_recommendation(
        FAKE_PROJECT_ID, FAKE_ORG_ID,
        {"source": "opportunity", "kind": "striking_distance", "title": "Target olive oil",
         "anchor_query": "olive oil"}, db_session,
    )
    assert rec.status == "tracking"
    assert rec.baseline["clicks"] == 40
    assert rec.baseline["position"] == 8.0
    assert "captured_at" in rec.baseline


@pytest.mark.asyncio
async def test_create_without_anchor_has_null_baseline(db_session, org_and_project):
    from app.services.recommendation_service import create_recommendation
    rec = await create_recommendation(
        FAKE_PROJECT_ID, FAKE_ORG_ID,
        {"source": "agent", "source_agent": "zerda", "title": "Publish more how-to content"},
        db_session,
    )
    assert rec.baseline is None
    assert rec.anchor_query is None


@pytest.mark.asyncio
async def test_transition_to_done_sets_pending_outcome(db_session, org_and_project):
    from app.services.recommendation_service import create_recommendation, transition
    db_session.add(GscQueryStat(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, query="olive oil",
                                clicks=40, impressions=1000, ctr=0.04, position=8.0))
    await db_session.commit()
    rec = await create_recommendation(FAKE_PROJECT_ID, FAKE_ORG_ID,
        {"source": "opportunity", "title": "t", "anchor_query": "olive oil"}, db_session)
    updated = await transition(rec.id, FAKE_ORG_ID, "done", db_session)
    assert updated.status == "done"
    assert updated.outcome == "pending"
    assert updated.done_at is not None


@pytest.mark.asyncio
async def test_list_filters_by_status(db_session, org_and_project):
    from app.services.recommendation_service import create_recommendation, transition, list_recommendations
    a = await create_recommendation(FAKE_PROJECT_ID, FAKE_ORG_ID, {"source": "agent", "title": "a"}, db_session)
    await create_recommendation(FAKE_PROJECT_ID, FAKE_ORG_ID, {"source": "agent", "title": "b"}, db_session)
    await transition(a.id, FAKE_ORG_ID, "done", db_session)
    tracking = await list_recommendations(FAKE_PROJECT_ID, FAKE_ORG_ID, db_session, status="tracking")
    assert len(tracking) == 1 and tracking[0].title == "b"


# ── Service: measure ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_measure_scores_done_items_past_window(db_session, org_and_project):
    from datetime import date, timedelta
    from app.services.recommendation_service import measure
    db_session.add(GscQueryStat(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, query="olive oil",
                                clicks=182, impressions=2200, ctr=0.083, position=4.0))
    done = (date.today() - timedelta(days=30)).isoformat()
    db_session.add(Recommendation(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, source="opportunity",
        title="t", anchor_query="olive oil", status="done", outcome="pending", done_at=done,
        baseline={"clicks": 40, "impressions": 1000, "ctr": 0.04, "position": 8.0, "captured_at": done},
    ))
    await db_session.commit()
    n = await measure(FAKE_PROJECT_ID, FAKE_ORG_ID, db_session)
    assert n == 1
    rec = (await db_session.execute(select(Recommendation))).scalars().first()
    assert rec.outcome == "won"
    assert rec.latest["clicks"] == 182
    assert rec.impact_score > 10
    assert rec.measured_at is not None


@pytest.mark.asyncio
async def test_measure_skips_items_inside_window(db_session, org_and_project):
    from datetime import date, timedelta
    from app.services.recommendation_service import measure
    db_session.add(GscQueryStat(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, query="olive oil",
                                clicks=100, impressions=2000, ctr=0.05, position=5.0))
    done = (date.today() - timedelta(days=3)).isoformat()
    db_session.add(Recommendation(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, source="opportunity",
        title="t", anchor_query="olive oil", status="done", outcome="pending", done_at=done,
        baseline={"clicks": 40, "impressions": 1000, "ctr": 0.04, "position": 8.0},
    ))
    await db_session.commit()
    n = await measure(FAKE_PROJECT_ID, FAKE_ORG_ID, db_session)
    assert n == 0
    rec = (await db_session.execute(select(Recommendation))).scalars().first()
    assert rec.outcome == "pending"


# ── Service: matching ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_matching_detects_published_article(db_session, org_and_project):
    from app.models.article import ArticleStatus
    from app.services.recommendation_service import run_matching
    db_session.add(Article(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID,
        title="10 Olive Oil Benefits You Should Know",
        target_keyword="olive oil benefits", status=ArticleStatus.published,
    ))
    db_session.add(Recommendation(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, source="opportunity",
        title="Target olive oil benefits", anchor_query="olive oil benefits", status="tracking",
    ))
    await db_session.commit()
    n = await run_matching(FAKE_PROJECT_ID, FAKE_ORG_ID, db_session)
    assert n == 1
    rec = (await db_session.execute(select(Recommendation))).scalars().first()
    assert rec.detected_content and rec.detected_content[0]["type"] == "article"


@pytest.mark.asyncio
async def test_matching_ignores_unrelated_content(db_session, org_and_project):
    from app.models.article import ArticleStatus
    from app.services.recommendation_service import run_matching
    db_session.add(Article(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID,
        title="Sourdough bread guide", target_keyword="sourdough", status=ArticleStatus.published,
    ))
    db_session.add(Recommendation(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, source="opportunity",
        title="Target olive oil", anchor_query="olive oil", status="tracking",
    ))
    await db_session.commit()
    n = await run_matching(FAKE_PROJECT_ID, FAKE_ORG_ID, db_session)
    assert n == 0


# ── Service: summarize ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_summarize_counts_and_won_clicks(db_session, org_and_project):
    from app.services.recommendation_service import summarize
    db_session.add(Recommendation(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, source="opportunity", title="w",
        status="done", outcome="won",
        baseline={"clicks": 40, "impressions": 1, "ctr": 0.0, "position": 8.0},
        latest={"clicks": 182, "impressions": 1, "ctr": 0.0, "position": 4.0},
    ))
    db_session.add(Recommendation(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, source="opportunity", title="m",
        status="done", outcome="pending",
    ))
    await db_session.commit()
    s = await summarize(FAKE_PROJECT_ID, FAKE_ORG_ID, db_session)
    assert s["acted"] == 2
    assert s["won"] == 1
    assert s["measuring"] == 1
    assert s["won_clicks"] == 142


# ── Combined pass (cron behavior) ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_measure_then_match_pass(db_session, org_and_project):
    from datetime import date, timedelta
    from app.models.article import ArticleStatus
    from app.services.recommendation_service import measure, run_matching
    db_session.add(GscQueryStat(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, query="olive oil",
                                clicks=182, impressions=2200, ctr=0.083, position=4.0))
    db_session.add(Article(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID,
                           title="Olive oil guide", target_keyword="olive oil",
                           status=ArticleStatus.published))
    done = (date.today() - timedelta(days=30)).isoformat()
    db_session.add(Recommendation(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, source="opportunity",
        title="a", anchor_query="olive oil", status="done", outcome="pending", done_at=done,
        baseline={"clicks": 40, "impressions": 1000, "ctr": 0.04, "position": 8.0}))
    db_session.add(Recommendation(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, source="opportunity",
        title="b", anchor_query="olive oil", status="tracking"))
    await db_session.commit()
    assert await measure(FAKE_PROJECT_ID, FAKE_ORG_ID, db_session) == 1
    assert await run_matching(FAKE_PROJECT_ID, FAKE_ORG_ID, db_session) == 1


# ── Endpoints ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_post_and_list_endpoint(client, org_and_project):
    r = await client.post(
        f"/api/v1/recommendations?project_id={FAKE_PROJECT_ID}",
        json={"source": "agent", "source_agent": "zerda", "title": "Publish weekly"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "tracking"
    lst = await client.get(f"/api/v1/recommendations?project_id={FAKE_PROJECT_ID}")
    assert lst.status_code == 200
    assert len(lst.json()) == 1


@pytest.mark.asyncio
async def test_patch_marks_done(client, org_and_project):
    created = (await client.post(
        f"/api/v1/recommendations?project_id={FAKE_PROJECT_ID}",
        json={"source": "opportunity", "title": "t"},
    )).json()
    r = await client.patch(f"/api/v1/recommendations/{created['id']}", json={"status": "done"})
    assert r.status_code == 200
    assert r.json()["status"] == "done"


@pytest.mark.asyncio
async def test_summary_endpoint(client, org_and_project):
    r = await client.get(f"/api/v1/recommendations/summary?project_id={FAKE_PROJECT_ID}")
    assert r.status_code == 200
    assert r.json()["acted"] == 0


# ── Digest standup line ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_digest_includes_standup_when_acted(db_session, org_and_project):
    from app.services.digest_service import compose_digest
    db_session.add(Recommendation(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, source="opportunity",
        title="w", status="done", outcome="won",
        baseline={"clicks": 40, "impressions": 1, "ctr": 0.0, "position": 8.0},
        latest={"clicks": 182, "impressions": 1, "ctr": 0.0, "position": 4.0}))
    await db_session.commit()
    project = await db_session.get(Project, FAKE_PROJECT_ID)
    subject, html = await compose_digest(project, db_session)
    assert "Zerda" in html
    assert "acted on" in html
