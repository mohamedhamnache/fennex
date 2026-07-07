"""
Tests for the persona-shaped home dashboard service.

Strategy (mirrors test_recommendations.py):
- Override `get_db` with an in-memory SQLite async session (aiosqlite)
- Override `get_current_user` with a fake user
- Test the `get_persona_home` service directly against real GSC-derived data
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
from app.models.analytics import AnalyticsSnapshot, GscQueryStat  # noqa: F401

# ── Test DB (SQLite in-memory) ────────────────────────────────────────────────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

SQLITE_COMPATIBLE_TABLES = [
    "organizations", "users", "projects",
    "analytics_snapshots", "gsc_query_stats",
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


# ── Service: get_persona_home ─────────────────────────────────────────────────

from datetime import date, timedelta

import pytest


@pytest.mark.asyncio
async def test_creator_north_star_is_clicks(db_session, org_and_project):
    from app.services.analytics_service import get_persona_home
    db_session.add(AnalyticsSnapshot(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID,
                                     date=date.today(), clicks=40, impressions=800, ctr=0.05, avg_position=6.0))
    db_session.add(AnalyticsSnapshot(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID,
                                     date=date.today() - timedelta(days=1),
                                     clicks=30, impressions=600, ctr=0.05, avg_position=6.0))
    await db_session.commit()
    home = await get_persona_home(FAKE_PROJECT_ID, FAKE_ORG_ID, "creator", db_session)
    assert home.persona == "creator"
    assert home.north_star.key == "clicks"
    assert home.north_star.value == 70.0
    assert len(home.secondary) == 3


@pytest.mark.asyncio
async def test_ecommerce_north_star_is_buyer_intent(db_session, org_and_project):
    from app.services.analytics_service import get_persona_home
    db_session.add(GscQueryStat(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID,
                                query="buy running shoes", clicks=50, impressions=800, ctr=0.06, position=4.0))
    db_session.add(GscQueryStat(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID,
                                query="chocolate cake recipe", clicks=20, impressions=300, ctr=0.06, position=5.0))
    await db_session.commit()
    home = await get_persona_home(FAKE_PROJECT_ID, FAKE_ORG_ID, "ecommerce", db_session)
    assert home.north_star.key == "buyer_intent_clicks"
    assert home.north_star.value == 50.0            # only the commercial query counts
    assert home.north_star.context is not None      # "X% of your clicks"


@pytest.mark.asyncio
async def test_freelancer_north_star_is_niche_visibility(db_session, org_and_project):
    from app.services.analytics_service import get_persona_home
    db_session.add(GscQueryStat(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID,
                                query="wedding photography paris", clicks=10, impressions=500, ctr=0.02, position=7.0))
    db_session.add(GscQueryStat(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID,
                                query="event photographer rates", clicks=5, impressions=250, ctr=0.02, position=9.0))
    await db_session.commit()
    home = await get_persona_home(FAKE_PROJECT_ID, FAKE_ORG_ID, "freelancer", db_session)
    assert home.north_star.key == "niche_visibility"
    assert home.north_star.value == 750.0           # total impressions across queries/clusters
    assert home.north_star.context is not None


@pytest.mark.asyncio
async def test_unknown_persona_defaults_creator(db_session, org_and_project):
    from app.services.analytics_service import get_persona_home
    home = await get_persona_home(FAKE_PROJECT_ID, FAKE_ORG_ID, "banana", db_session)
    assert home.persona == "creator"
    assert home.north_star.key == "clicks"


# ── Endpoint: GET /analytics/persona-home ─────────────────────────────────────

@pytest.mark.asyncio
async def test_persona_home_endpoint(client, org_and_project):
    r = await client.get(f"/api/v1/analytics/persona-home?project_id={FAKE_PROJECT_ID}&persona=ecommerce")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["persona"] == "ecommerce"
    assert body["north_star"]["key"] == "buyer_intent_clicks"


@pytest.mark.asyncio
async def test_persona_home_endpoint_defaults_creator(client, org_and_project):
    r = await client.get(f"/api/v1/analytics/persona-home?project_id={FAKE_PROJECT_ID}")
    assert r.status_code == 200
    assert r.json()["persona"] == "creator"


@pytest.mark.asyncio
async def test_persona_home_zero_data_is_safe(db_session, org_and_project):
    from app.services.analytics_service import get_persona_home
    for persona in ("creator", "ecommerce", "freelancer"):
        home = await get_persona_home(FAKE_PROJECT_ID, FAKE_ORG_ID, persona, db_session)
        assert home.north_star.value == 0.0
        assert home.focus.items == []
