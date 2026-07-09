"""
Tests for orchestrated multi-agent campaigns.

Strategy (mirrors test_recommendations.py):
- Override `get_db` with an in-memory SQLite async session (aiosqlite)
- Override `get_current_user` with a fake user
- Test the model
"""
import uuid
from contextlib import asynccontextmanager

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
from app.models.image import GeneratedImage  # noqa: F401
from app.models.social import SocialPost  # noqa: F401
from app.models.analytics import GscQueryStat, AnalyticsSnapshot  # noqa: F401
from app.models.campaign import Campaign, CampaignStep  # noqa: F401
from app.models.api_key import APIKey  # noqa: F401
from app.models.recommendation import Recommendation  # noqa: F401

# ── Test DB (SQLite in-memory) ────────────────────────────────────────────────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

SQLITE_COMPATIBLE_TABLES = [
    "organizations", "users", "projects",
    "articles", "generated_images", "social_posts", "gsc_query_stats", "analytics_snapshots",
    "campaigns", "campaign_steps", "api_keys", "recommendations",
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


@asynccontextmanager
async def _single_session(session):
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
async def test_campaign_persists(db_session, org_and_project):
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="Get clients", persona="freelancer", status="planned")
    db_session.add(c)
    await db_session.commit()
    step = CampaignStep(campaign_id=c.id, order=0, agent="zerda", action="zerda.pick_angle", status="pending")
    db_session.add(step)
    await db_session.commit()
    await db_session.refresh(c); await db_session.refresh(step)
    assert c.status == "planned" and step.order == 0


# ── Action catalog + executors ────────────────────────────────────────────────

from unittest.mock import AsyncMock, patch
from app.models.analytics import GscQueryStat
from app.core.security import encrypt_value


def _ctx():
    from app.services.campaign_catalog import CampaignContext
    return CampaignContext(goal="grow", persona="creator", project_profile="", prior=[])


@pytest.mark.asyncio
async def test_oasis_executor_returns_report(db_session, org_and_project):
    from app.services.campaign_executors import exec_oasis_market_report
    from app.models.campaign import Campaign, CampaignStep
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="g", persona="creator", status="running")
    db_session.add(c); await db_session.commit()
    step = CampaignStep(campaign_id=c.id, order=0, agent="oasis", action="oasis.market_report")
    with patch("app.services.campaign_executors.generate_market_report",
               new=AsyncMock(return_value={"ok": True, "title": "T", "markdown": "# Report"})):
        res = await exec_oasis_market_report(c, step, _ctx(), db_session)
    assert res.artifact_type == "report"
    assert "Report" in res.summary


@pytest.mark.asyncio
async def test_zerda_executor_picks_angle(db_session, org_and_project):
    from app.services.campaign_executors import exec_zerda_pick_angle
    from app.models.campaign import Campaign, CampaignStep
    db_session.add(GscQueryStat(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, query="olive oil benefits",
                                clicks=5, impressions=900, ctr=0.005, position=7.0))
    db_session.add(APIKey(org_id=FAKE_ORG_ID, provider="anthropic", encrypted_value=encrypt_value("test-key")))
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="g", persona="creator", status="running")
    db_session.add(c); await db_session.commit()
    step = CampaignStep(campaign_id=c.id, order=0, agent="zerda", action="zerda.pick_angle")
    with patch("app.services.campaign_executors.call_llm",
               new=AsyncMock(return_value='{"topic":"Olive oil health","keyword":"olive oil benefits","rationale":"striking distance"}')):
        res = await exec_zerda_pick_angle(c, step, _ctx(), db_session)
    assert res.structured.get("keyword") == "olive oil benefits"
    assert res.summary


@pytest.mark.asyncio
async def test_dune_executor_creates_article(db_session, org_and_project):
    from app.services.campaign_executors import exec_dune_write_article
    from app.services.campaign_catalog import CampaignContext
    from app.models.article import Article
    db_session.add(APIKey(org_id=FAKE_ORG_ID, provider="anthropic", encrypted_value=encrypt_value("test-key")))
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="g", persona="creator", status="running")
    db_session.add(c); await db_session.commit()
    step = CampaignStep(campaign_id=c.id, order=0, agent="dune", action="dune.write_article", brief={})
    ctx = CampaignContext(goal="g", persona="creator", project_profile="",
                          prior=[{"agent": "zerda", "action": "zerda.pick_angle", "summary": "",
                                  "structured": {"topic": "Olive oil", "keyword": "olive oil benefits"}}])
    with patch("app.services.campaign_executors.call_llm", new=AsyncMock(return_value="# Olive oil benefits\n\nBody text here.")):
        res = await exec_dune_write_article(c, step, ctx, db_session)
    assert res.artifact_type == "article" and res.artifact_ids
    art = (await db_session.execute(select(Article))).scalars().first()
    assert art is not None and art.body_markdown


@pytest.mark.asyncio
async def test_dune_executor_writes_full_article_fields(db_session, org_and_project):
    """Campaign-generated articles must render in the reader, which uses body_html."""
    from app.services.campaign_executors import exec_dune_write_article
    from app.services.campaign_catalog import CampaignContext
    from app.models.article import Article
    db_session.add(APIKey(org_id=FAKE_ORG_ID, provider="anthropic", encrypted_value=encrypt_value("test-key")))
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="g", persona="creator", status="running")
    db_session.add(c); await db_session.commit()
    step = CampaignStep(campaign_id=c.id, order=0, agent="dune", action="dune.write_article", brief={})
    ctx = CampaignContext(goal="g", persona="creator", project_profile="",
                          prior=[{"agent": "zerda", "action": "zerda.pick_angle", "summary": "",
                                  "structured": {"topic": "Olive oil", "keyword": "olive oil benefits"}}])
    markdown = "# Olive oil benefits\n\nThis is a full paragraph about olive oil benefits for health."
    with patch("app.services.campaign_executors.call_llm", new=AsyncMock(return_value=markdown)):
        await exec_dune_write_article(c, step, ctx, db_session)
    art = (await db_session.execute(select(Article))).scalars().first()
    assert art is not None
    assert art.body_html  # must be non-empty so the reader can render it
    assert "<h1" in art.body_html or "<h2" in art.body_html or "<p" in art.body_html
    assert art.body_markdown == markdown
    assert art.word_count > 0
    assert art.seo_score is not None


@pytest.mark.asyncio
async def test_sirocco_executor_creates_image(db_session, org_and_project):
    from app.services.campaign_executors import exec_sirocco_generate_visual
    from app.models.image import GeneratedImage
    db_session.add(APIKey(org_id=FAKE_ORG_ID, provider="openai", encrypted_value=encrypt_value("test-key")))
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="g", persona="creator", status="running")
    db_session.add(c); await db_session.commit()
    step = CampaignStep(campaign_id=c.id, order=0, agent="sirocco", action="sirocco.generate_visual", brief={})
    fake_result = {"ok": True, "image_url": "data:image/png;base64,xyz", "revised_prompt": "p",
                   "width": 1024, "height": 1024, "cost_usd": 0.04}
    with patch("app.services.campaign_executors.generate_image_dalle", new=AsyncMock(return_value=fake_result)):
        res = await exec_sirocco_generate_visual(c, step, _ctx(), db_session)
    assert res.artifact_type == "image" and res.artifact_ids
    img = (await db_session.execute(select(GeneratedImage))).scalars().first()
    assert img is not None and img.image_url == "data:image/png;base64,xyz"


@pytest.mark.asyncio
async def test_nomad_executor_creates_social_drafts(db_session, org_and_project):
    from app.services.campaign_executors import exec_nomad_social_posts
    from app.models.campaign import Campaign, CampaignStep
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="g", persona="creator", status="running")
    db_session.add(c); await db_session.commit()
    step = CampaignStep(campaign_id=c.id, order=0, agent="nomad", action="nomad.social_posts", brief={})
    fake_result = {"ok": True, "posts": [{"day": "Monday", "type": "tip", "content": "c", "hashtags": []}],
                   "messages": [], "tips": [], "drafts_saved": 3}
    with patch("app.services.campaign_executors.generate_outreach_plan", new=AsyncMock(return_value=fake_result)):
        res = await exec_nomad_social_posts(c, step, _ctx(), db_session)
    assert res.artifact_type == "social"
    assert "3" in res.summary and "draft" in res.summary.lower()


@pytest.mark.asyncio
async def test_sable_executor_scans_competitor(db_session, org_and_project):
    from app.services.campaign_executors import exec_sable_competitor_scan
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="g", persona="creator", status="running")
    db_session.add(c); await db_session.commit()
    step = CampaignStep(campaign_id=c.id, order=0, agent="sable", action="sable.competitor_scan",
                        brief={"competitor_url": "https://x"})
    fake_result = {"ok": True, "score": 80}
    with patch("app.services.campaign_executors.analyze_competitor", new=AsyncMock(return_value=fake_result)):
        res = await exec_sable_competitor_scan(c, step, _ctx(), db_session)
    assert res.artifact_type == "analysis"
    assert res.structured.get("analysis") == fake_result


@pytest.mark.asyncio
async def test_sable_executor_skips_without_url(db_session, org_and_project):
    from app.services.campaign_executors import exec_sable_competitor_scan
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="g", persona="creator", status="running")
    db_session.add(c); await db_session.commit()
    step = CampaignStep(campaign_id=c.id, order=0, agent="sable", action="sable.competitor_scan", brief={})
    res = await exec_sable_competitor_scan(c, step, _ctx(), db_session)
    assert res.structured.get("skipped") is True


# ── Campaign director (LLM planner) ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_director_parses_and_sanitizes(db_session, org_and_project):
    from app.services.campaign_director import draft_plan
    db_session.add(APIKey(org_id=FAKE_ORG_ID, provider="openai", encrypted_value=encrypt_value("k")))
    await db_session.commit()
    raw = '{"summary":"plan","steps":[{"agent":"zerda","action":"zerda.pick_angle","brief":{},"why":"focus"},{"agent":"x","action":"bogus.action","brief":{},"why":"drop me"}]}'
    with patch("app.services.campaign_director.call_llm", new=AsyncMock(return_value=raw)):
        plan = await draft_plan(FAKE_PROJECT_ID, FAKE_ORG_ID, "grow", "creator", db_session)
    actions = [s["action"] for s in plan["steps"]]
    assert "zerda.pick_angle" in actions
    assert "bogus.action" not in actions   # unknown dropped


@pytest.mark.asyncio
async def test_director_fallback_on_bad_json(db_session, org_and_project):
    from app.services.campaign_director import draft_plan
    db_session.add(APIKey(org_id=FAKE_ORG_ID, provider="openai", encrypted_value=encrypt_value("k")))
    await db_session.commit()
    with patch("app.services.campaign_director.call_llm", new=AsyncMock(return_value="not json at all")):
        plan = await draft_plan(FAKE_PROJECT_ID, FAKE_ORG_ID, "grow", "creator", db_session)
    assert [s["action"] for s in plan["steps"]] == ["zerda.pick_angle", "dune.write_article"]


# ── Orchestrator (execute_campaign / run_campaign) ────────────────────────────

@pytest.mark.asyncio
async def test_execute_campaign_runs_steps_and_chains(db_session, org_and_project):
    from app.services.campaign_catalog import StepResult
    from app.workers.tasks.campaign_tasks import execute_campaign
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="g", persona="creator", status="running")
    db_session.add(c); await db_session.commit()
    db_session.add(CampaignStep(campaign_id=c.id, order=0, agent="zerda", action="zerda.pick_angle"))
    db_session.add(CampaignStep(campaign_id=c.id, order=1, agent="oasis", action="oasis.market_report"))
    await db_session.commit()
    calls = []
    async def fake_zerda(campaign, step, context, db):
        calls.append(("zerda", len(context.prior)))
        return StepResult(summary="angle", structured={"keyword": "k"})
    async def fake_oasis(campaign, step, context, db):
        calls.append(("oasis", len(context.prior)))
        return StepResult(summary="report", artifact_type="report")
    from app.services import campaign_catalog
    with patch.dict(campaign_catalog.ACTIONS["zerda.pick_angle"].__dict__, {"executor": fake_zerda}), \
         patch.dict(campaign_catalog.ACTIONS["oasis.market_report"].__dict__, {"executor": fake_oasis}):
        await execute_campaign(c.id, db_factory=lambda: _single_session(db_session))
    await db_session.refresh(c)
    steps = (await db_session.execute(select(CampaignStep).where(CampaignStep.campaign_id == c.id).order_by(CampaignStep.order))).scalars().all()
    assert c.status == "completed"
    assert [s.status for s in steps] == ["completed", "completed"]
    assert calls == [("zerda", 0), ("oasis", 1)]   # context grew between steps


@pytest.mark.asyncio
async def test_execute_campaign_resume_skips_completed_steps(db_session, org_and_project):
    """An arq retry / resumed run must never re-execute an already-completed (possibly paid) step."""
    from app.services.campaign_catalog import StepResult
    from app.workers.tasks.campaign_tasks import execute_campaign
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="g", persona="creator", status="running")
    db_session.add(c); await db_session.commit()
    db_session.add(CampaignStep(campaign_id=c.id, order=0, agent="zerda", action="zerda.pick_angle",
                                status="completed", summary="angle picked",
                                structured={"keyword": "k", "topic": "t"}))
    db_session.add(CampaignStep(campaign_id=c.id, order=1, agent="oasis", action="oasis.market_report",
                                status="pending"))
    await db_session.commit()

    async def exploding_zerda(campaign, step, context, db):
        raise AssertionError("completed step's executor must not be called on resume")

    calls = []
    async def fake_oasis(campaign, step, context, db):
        calls.append(("oasis", len(context.prior)))
        return StepResult(summary="report", artifact_type="report")

    from app.services import campaign_catalog
    with patch.dict(campaign_catalog.ACTIONS["zerda.pick_angle"].__dict__, {"executor": exploding_zerda}), \
         patch.dict(campaign_catalog.ACTIONS["oasis.market_report"].__dict__, {"executor": fake_oasis}):
        await execute_campaign(c.id, db_factory=lambda: _single_session(db_session))

    await db_session.refresh(c)
    steps = (await db_session.execute(select(CampaignStep).where(
        CampaignStep.campaign_id == c.id).order_by(CampaignStep.order))).scalars().all()
    assert c.status == "completed"
    assert [s.status for s in steps] == ["completed", "completed"]
    assert calls == [("oasis", 1)]   # zerda's stored output was re-chained into context


# ── API router ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_campaign_persists_plan(client, org_and_project):
    plan = {"summary": "s", "steps": [{"agent": "zerda", "action": "zerda.pick_angle", "brief": {}, "why": "w"},
                                       {"agent": "oasis", "action": "oasis.market_report", "brief": {}, "why": "w2"}]}
    with patch("app.api.v1.routers.campaigns.draft_plan", new=AsyncMock(return_value=plan)):
        r = await client.post(f"/api/v1/campaigns?project_id={FAKE_PROJECT_ID}", json={"goal": "grow"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "planned" and len(body["steps"]) == 2
    assert "started_at" in body["steps"][0]


@pytest.mark.asyncio
async def test_plan_edit_and_run(client, org_and_project):
    plan = {"summary": "s", "steps": [{"agent": "zerda", "action": "zerda.pick_angle", "brief": {}, "why": "w"},
                                       {"agent": "oasis", "action": "oasis.market_report", "brief": {}, "why": "w2"}]}
    with patch("app.api.v1.routers.campaigns.draft_plan", new=AsyncMock(return_value=plan)):
        cid = (await client.post(f"/api/v1/campaigns?project_id={FAKE_PROJECT_ID}", json={"goal": "grow"})).json()["id"]
    got = (await client.get(f"/api/v1/campaigns/{cid}")).json()
    keep = [got["steps"][1]["id"]]   # keep only the 2nd step
    pr = await client.patch(f"/api/v1/campaigns/{cid}/plan", json={"step_ids": keep})
    assert pr.status_code == 200 and len(pr.json()["steps"]) == 1
    with patch("app.api.v1.routers.campaigns.enqueue_campaign", new=AsyncMock(return_value=None)):
        run = await client.post(f"/api/v1/campaigns/{cid}/run")
    assert run.status_code == 200 and run.json()["status"] == "running"


# ── Zerda auto-track hook ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_completed_campaign_autotracks_angle(db_session, org_and_project):
    from app.services.campaign_catalog import StepResult
    from app.workers.tasks.campaign_tasks import execute_campaign
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="Win clients", persona="freelancer", status="running")
    db_session.add(c); await db_session.commit()
    db_session.add(CampaignStep(campaign_id=c.id, order=0, agent="zerda", action="zerda.pick_angle"))
    await db_session.commit()
    async def fake_zerda(campaign, step, context, db):
        return StepResult(summary="angle", structured={"topic": "T", "keyword": "menu digital", "rationale": "striking"})
    from app.services import campaign_catalog
    with patch.dict(campaign_catalog.ACTIONS["zerda.pick_angle"].__dict__, {"executor": fake_zerda}):
        await execute_campaign(c.id, db_factory=lambda: _single_session(db_session))
    rec = (await db_session.execute(select(Recommendation))).scalars().first()
    assert rec is not None
    assert rec.anchor_query == "menu digital"
    assert rec.title.startswith("Campaign:")
    # duplicate guard: re-running (resume path re-chains completed steps) must not create a second one
    c.status = "running"; c.cancel_requested = False
    await db_session.commit()
    with patch.dict(campaign_catalog.ACTIONS["zerda.pick_angle"].__dict__, {"executor": fake_zerda}):
        await execute_campaign(c.id, db_factory=lambda: _single_session(db_session))
    recs = (await db_session.execute(select(Recommendation))).scalars().all()
    assert len(recs) == 1


@pytest.mark.asyncio
async def test_campaign_without_angle_creates_no_recommendation(db_session, org_and_project):
    from app.services.campaign_catalog import StepResult
    from app.workers.tasks.campaign_tasks import execute_campaign
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="g", persona="creator", status="running")
    db_session.add(c); await db_session.commit()
    db_session.add(CampaignStep(campaign_id=c.id, order=0, agent="oasis", action="oasis.market_report"))
    await db_session.commit()
    async def fake_oasis(campaign, step, context, db):
        return StepResult(summary="report", artifact_type="report")
    from app.services import campaign_catalog
    with patch.dict(campaign_catalog.ACTIONS["oasis.market_report"].__dict__, {"executor": fake_oasis}):
        await execute_campaign(c.id, db_factory=lambda: _single_session(db_session))
    recs = (await db_session.execute(select(Recommendation))).scalars().all()
    assert recs == []


@pytest.mark.asyncio
async def test_autotrack_failure_does_not_change_campaign_status(db_session, org_and_project):
    from app.services.campaign_catalog import StepResult
    from app.workers.tasks.campaign_tasks import execute_campaign
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="g", persona="creator", status="running")
    db_session.add(c); await db_session.commit()
    db_session.add(CampaignStep(campaign_id=c.id, order=0, agent="zerda", action="zerda.pick_angle"))
    await db_session.commit()
    async def fake_zerda(campaign, step, context, db):
        return StepResult(summary="angle", structured={"keyword": "k"})
    from app.services import campaign_catalog
    with patch.dict(campaign_catalog.ACTIONS["zerda.pick_angle"].__dict__, {"executor": fake_zerda}), \
         patch("app.workers.tasks.campaign_tasks.create_recommendation", new=AsyncMock(side_effect=RuntimeError("boom"))):
        await execute_campaign(c.id, db_factory=lambda: _single_session(db_session))
    await db_session.refresh(c)
    assert c.status == "completed"
