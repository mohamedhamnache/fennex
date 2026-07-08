"""
Tests for the unified content calendar.

Strategy (mirrors test_recommendations.py):
- Override `get_db` with an in-memory SQLite async session (aiosqlite)
- Override `get_current_user` with a fake user
- Test the model
"""
import uuid

import pytest
from httpx import AsyncClient, ASGITransport
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
from app.models.image import GeneratedImage  # noqa: F401
from app.models.calendar_entry import CalendarEntry  # noqa: F401

# ── Test DB (SQLite in-memory) ────────────────────────────────────────────────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

SQLITE_COMPATIBLE_TABLES = [
    "organizations", "users", "projects",
    "articles", "social_posts", "generated_images", "calendar_entries",
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
async def test_calendar_entry_persists(db_session, org_and_project):
    rec = CalendarEntry(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID,
        content_type="article", content_id=uuid.uuid4(), title="Hello",
        scheduled_at="2026-08-01T09:00:00+00:00", timezone="Europe/Paris", state="planned",
    )
    db_session.add(rec)
    await db_session.commit()
    await db_session.refresh(rec)
    assert rec.id is not None
    assert rec.state == "planned"


# ── calendar_service ──────────────────────────────────────────────────────────

from app.models.article import Article, ArticleStatus


@pytest.mark.asyncio
async def test_create_entry_snapshots_article_title(db_session, org_and_project):
    from app.services.calendar_service import create_entry
    art = Article(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, title="My SEO Guide", status=ArticleStatus.ready)
    db_session.add(art)
    await db_session.commit()
    entry = await create_entry(FAKE_PROJECT_ID, FAKE_ORG_ID,
        {"content_type": "article", "content_id": str(art.id), "scheduled_at": "2026-08-01T09:00:00+00:00"}, db_session)
    assert entry.title == "My SEO Guide"
    assert entry.state == "planned"


@pytest.mark.asyncio
async def test_create_entry_unknown_content_raises(db_session, org_and_project):
    from app.services.calendar_service import create_entry, CalendarError
    with pytest.raises(CalendarError):
        await create_entry(FAKE_PROJECT_ID, FAKE_ORG_ID,
            {"content_type": "article", "content_id": str(uuid.uuid4()), "scheduled_at": "2026-08-01T09:00:00+00:00"}, db_session)


@pytest.mark.asyncio
async def test_schedule_requires_valid_target(db_session, org_and_project):
    from app.services.calendar_service import create_entry, update_entry, CalendarError
    art = Article(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, title="A", status=ArticleStatus.ready)
    db_session.add(art)
    await db_session.commit()
    entry = await create_entry(FAKE_PROJECT_ID, FAKE_ORG_ID,
        {"content_type": "article", "content_id": str(art.id), "scheduled_at": "2026-08-01T09:00:00+00:00"}, db_session)
    with pytest.raises(CalendarError):
        await update_entry(entry.id, FAKE_ORG_ID, {"state": "scheduled"}, db_session)
    ok = await update_entry(entry.id, FAKE_ORG_ID, {"target_kind": "linkedin", "state": "scheduled"}, db_session)
    assert ok.state == "scheduled"


@pytest.mark.asyncio
async def test_list_entries_in_range(db_session, org_and_project):
    from app.services.calendar_service import create_entry, list_entries
    art = Article(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, title="A", status=ArticleStatus.ready)
    db_session.add(art)
    await db_session.commit()
    await create_entry(FAKE_PROJECT_ID, FAKE_ORG_ID,
        {"content_type": "article", "content_id": str(art.id), "scheduled_at": "2026-08-15T09:00:00+00:00"}, db_session)
    inside = await list_entries(FAKE_PROJECT_ID, FAKE_ORG_ID, "2026-08-01T00:00:00+00:00", "2026-08-31T23:59:59+00:00", db_session)
    outside = await list_entries(FAKE_PROJECT_ID, FAKE_ORG_ID, "2026-09-01T00:00:00+00:00", "2026-09-30T23:59:59+00:00", db_session)
    assert len(inside) == 1 and len(outside) == 0


# ── calendar_publish ──────────────────────────────────────────────────────────

from unittest.mock import AsyncMock, patch
from app.models.social import SocialPost, SocialPlatform, SocialPostStatus
from app.models.calendar_entry import CalendarEntry


@pytest.mark.asyncio
async def test_publish_entry_social_success(db_session, org_and_project):
    from app.services.calendar_publish import publish_entry
    post = SocialPost(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, platform=SocialPlatform.linkedin,
                      content="hello world", status=SocialPostStatus.draft, char_count=11)
    db_session.add(post)
    await db_session.commit()
    entry = CalendarEntry(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, content_type="social",
                          content_id=post.id, title="hello", scheduled_at="2026-01-01T00:00:00+00:00",
                          target_kind="linkedin", state="scheduled")
    db_session.add(entry)
    await db_session.commit()
    with patch("app.services.calendar_publish._publish_social", new=AsyncMock(return_value={"ok": True, "url": None})):
        out = await publish_entry(entry, db_session)
    assert out.state == "published"
    assert out.published_at is not None


@pytest.mark.asyncio
async def test_publish_entry_failure_sets_failed(db_session, org_and_project):
    from app.services.calendar_publish import publish_entry
    post = SocialPost(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, platform=SocialPlatform.linkedin,
                      content="x", status=SocialPostStatus.draft, char_count=1)
    db_session.add(post)
    await db_session.commit()
    entry = CalendarEntry(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, content_type="social",
                          content_id=post.id, title="x", scheduled_at="2026-01-01T00:00:00+00:00",
                          target_kind="linkedin", state="scheduled")
    db_session.add(entry)
    await db_session.commit()
    with patch("app.services.calendar_publish._publish_social", new=AsyncMock(side_effect=RuntimeError("boom"))):
        out = await publish_entry(entry, db_session)
    assert out.state == "failed"
    assert "boom" in (out.error or "")


@pytest.mark.asyncio
async def test_publish_entry_skips_non_armed(db_session, org_and_project):
    from app.services.calendar_publish import publish_entry
    entry = CalendarEntry(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, content_type="social",
                          content_id=uuid.uuid4(), title="x", scheduled_at="2026-01-01T00:00:00+00:00",
                          target_kind="linkedin", state="published")
    db_session.add(entry)
    await db_session.commit()
    out = await publish_entry(entry, db_session)
    assert out.state == "published"  # unchanged; not re-dispatched


# ── /calendar REST endpoints ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_calendar_endpoints_crud(client, org_and_project, db_session):
    art = Article(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, title="Endpoint", status=ArticleStatus.ready)
    db_session.add(art)
    await db_session.commit()
    r = await client.post(f"/api/v1/calendar?project_id={FAKE_PROJECT_ID}",
        json={"content_type": "article", "content_id": str(art.id), "scheduled_at": "2026-08-01T09:00:00+00:00"})
    assert r.status_code == 201, r.text
    eid = r.json()["id"]
    lst = await client.get(f"/api/v1/calendar?project_id={FAKE_PROJECT_ID}&start=2026-08-01T00:00:00+00:00&end=2026-08-31T23:59:59+00:00")
    assert lst.status_code == 200 and len(lst.json()) == 1
    patched = await client.patch(f"/api/v1/calendar/{eid}", json={"target_kind": "linkedin", "state": "scheduled"})
    assert patched.status_code == 200 and patched.json()["state"] == "scheduled"
    dele = await client.delete(f"/api/v1/calendar/{eid}")
    assert dele.status_code == 204


@pytest.mark.asyncio
async def test_patch_schedule_without_target_400(client, org_and_project, db_session):
    art = Article(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, title="NT", status=ArticleStatus.ready)
    db_session.add(art)
    await db_session.commit()
    eid = (await client.post(f"/api/v1/calendar?project_id={FAKE_PROJECT_ID}",
        json={"content_type": "article", "content_id": str(art.id), "scheduled_at": "2026-08-01T09:00:00+00:00"})).json()["id"]
    r = await client.patch(f"/api/v1/calendar/{eid}", json={"state": "scheduled"})
    assert r.status_code == 400


# ── auto-publish scheduler ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_publish_due_selects_only_scheduled_and_due(db_session, org_and_project):
    from unittest.mock import AsyncMock, patch
    from app.workers.tasks.calendar_tasks import publish_due
    post = SocialPost(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, platform=SocialPlatform.linkedin,
                      content="x", status=SocialPostStatus.draft, char_count=1)
    db_session.add(post)
    await db_session.commit()
    db_session.add(CalendarEntry(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, content_type="social",
        content_id=post.id, title="due", scheduled_at="2020-01-01T00:00:00+00:00", target_kind="linkedin", state="scheduled"))
    db_session.add(CalendarEntry(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, content_type="social",
        content_id=post.id, title="future", scheduled_at="2099-01-01T00:00:00+00:00", target_kind="linkedin", state="scheduled"))
    db_session.add(CalendarEntry(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, content_type="social",
        content_id=post.id, title="planned", scheduled_at="2020-01-01T00:00:00+00:00", target_kind="linkedin", state="planned"))
    await db_session.commit()
    with patch("app.services.calendar_publish._publish_social", new=AsyncMock(return_value={"ok": True, "url": None})):
        n = await publish_due(db_session, "2026-01-01T00:00:00+00:00")
    assert n == 1
