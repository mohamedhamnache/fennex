"""
Tests for orchestrated multi-agent campaigns.

Strategy (mirrors test_recommendations.py):
- Override `get_db` with an in-memory SQLite async session (aiosqlite)
- Override `get_current_user` with a fake user
- Test the model
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
from app.models.image import GeneratedImage  # noqa: F401
from app.models.social import SocialPost  # noqa: F401
from app.models.analytics import GscQueryStat, AnalyticsSnapshot  # noqa: F401
from app.models.campaign import Campaign, CampaignStep  # noqa: F401
from app.models.api_key import APIKey  # noqa: F401

# ── Test DB (SQLite in-memory) ────────────────────────────────────────────────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

SQLITE_COMPATIBLE_TABLES = [
    "organizations", "users", "projects",
    "articles", "generated_images", "social_posts", "gsc_query_stats", "analytics_snapshots",
    "campaigns", "campaign_steps", "api_keys",
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
