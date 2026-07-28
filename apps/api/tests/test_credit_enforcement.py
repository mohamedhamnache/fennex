"""Task 6: reduced PLAN_LIMITS + require_credits hard-stop enforcement.

PLAN_LIMITS assertions pin the approved plan table (structural + fair-use
caps). The router tests exercise require_credits end-to-end: a Starter org
with its AI (or SEO) credit bucket exactly full gets a 429 on a guarded
endpoint; one at ~85% succeeds but carries X-Usage-Warning.
"""
import uuid
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.billing import PLAN_LIMITS, current_billing_period_start
from app.core.credits import PLAN_CREDITS, SEO_PLAN_CREDITS
from app.core.database import Base, get_db
from app.core.dependencies import get_current_user
from app.main import app
from app.models.billing import OrgUsage
from app.models.organization import Organization, PlanTier
from app.models.project import Project
from app.models.user import User, UserRole


# ── PLAN_LIMITS: approved table ─────────────────────────────────────────────

def test_starter_is_one_project_one_seat():
    assert PLAN_LIMITS["starter"]["projects"] == 1
    assert PLAN_LIMITS["starter"]["seats"] == 1


def test_structural_caps_match_approved_table():
    assert PLAN_LIMITS["free"]["projects"] == 1
    assert PLAN_LIMITS["pro"]["projects"] == 5
    assert PLAN_LIMITS["pro"]["seats"] == 3
    assert PLAN_LIMITS["agency"]["projects"] == 15
    assert PLAN_LIMITS["scale"]["projects"] == 50


def test_fair_use_caps_match_approved_table():
    assert [PLAN_LIMITS[t]["articles"] for t in ("free", "starter", "pro", "agency", "scale")] \
        == [4, 25, 120, 500, -1]
    assert [PLAN_LIMITS[t]["images"] for t in ("free", "starter", "pro", "agency", "scale")] \
        == [5, 40, 200, 800, -1]


# ── Router-level enforcement (ASGITransport + get_db override) ─────────────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

SQLITE_COMPATIBLE_TABLES = [
    "organizations", "users", "projects", "generated_images", "keyword_research_jobs", "org_usage",
    "api_keys",
]

FAKE_ORG_ID = uuid.uuid4()
FAKE_USER_ID = uuid.uuid4()
FAKE_PROJECT_ID = uuid.uuid4()

fake_user = User(
    id=FAKE_USER_ID, org_id=FAKE_ORG_ID, email="credit-test@fennex.ai",
    hashed_password="hashed", full_name="Credit Test", role=UserRole.OWNER, is_active=True,
)


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


async def override_get_current_user():
    return fake_user


async def _seed(ai_credits_used: int = 0, seo_credits_used: int = 0):
    tables = [Base.metadata.tables[name] for name in SQLITE_COMPATIBLE_TABLES if name in Base.metadata.tables]
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=tables)
    async with TestSessionLocal() as session:
        session.add(Organization(id=FAKE_ORG_ID, slug="credit-org", name="Credit Org", plan_tier=PlanTier.STARTER))
        session.add(Project(id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, name="Site", domain="site.example"))
        session.add(OrgUsage(
            org_id=FAKE_ORG_ID, period_start=current_billing_period_start(),
            ai_credits_used=ai_credits_used, seo_credits_used=seo_credits_used,
        ))
        await session.commit()


async def _teardown():
    tables = [Base.metadata.tables[name] for name in SQLITE_COMPATIBLE_TABLES if name in Base.metadata.tables]
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all, tables=tables)


def _mock_arq_pool():
    pool = AsyncMock()
    pool.enqueue_job = AsyncMock(return_value=MagicMock(job_id="job-1"))
    pool.aclose = AsyncMock()
    return pool


@pytest.fixture
async def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_ai_bucket_full_returns_429(client):
    """Starter org whose ai_credits_used counter exactly fills the AI credit
    bucket gets a 429 credit_limit_reached on an endpoint guarded by
    require_credits("ai") -- here, image generation."""
    await _seed(ai_credits_used=PLAN_CREDITS["starter"])
    try:
        resp = await client.post(
            "/api/v1/images/generate",
            json={"project_id": str(FAKE_PROJECT_ID), "prompt": "a red fox"},
        )
        assert resp.status_code == 429
        detail = resp.json()["detail"]
        # Same envelope as check_usage_limit: the web client's global 429
        # handler keys on code/resource to raise the upgrade modal.
        assert detail["code"] == "LIMIT_REACHED"
        assert detail["resource"] == "ai_credits"
        assert detail["bucket"] == "ai"
        assert detail["tier"] == "starter"
    finally:
        await _teardown()


@pytest.mark.asyncio
async def test_ai_bucket_at_85_pct_succeeds_with_warning_header(client):
    """At ~85% of the AI bucket, the request still succeeds but carries
    X-Usage-Warning."""
    near_full = int(PLAN_CREDITS["starter"] * 0.85)
    await _seed(ai_credits_used=near_full)
    try:
        resp = await client.post(
            "/api/v1/images/generate",
            json={"project_id": str(FAKE_PROJECT_ID), "prompt": "a red fox"},
        )
        assert resp.status_code == 200
        assert "x-usage-warning" in {k.lower() for k in resp.headers.keys()}
    finally:
        await _teardown()


@pytest.mark.asyncio
async def test_seo_bucket_full_returns_429(client):
    """Starter org whose seo_credits_used exactly fills the SEO credit bucket
    gets a 429 credit_limit_reached on an endpoint guarded by
    require_credits("seo") -- here, keyword research."""
    await _seed(seo_credits_used=SEO_PLAN_CREDITS["starter"])
    try:
        resp = await client.post(
            "/api/v1/keywords/research",
            json={"project_id": str(FAKE_PROJECT_ID), "seed_keyword": "fox facts"},
        )
        assert resp.status_code == 429
        detail = resp.json()["detail"]
        assert detail["code"] == "LIMIT_REACHED"
        assert detail["resource"] == "seo_credits"
        assert detail["bucket"] == "seo"
        assert detail["tier"] == "starter"
    finally:
        await _teardown()


@pytest.mark.asyncio
async def test_seo_bucket_at_85_pct_succeeds_with_warning_header(client):
    """At ~85% of the SEO bucket, keyword research still succeeds but carries
    X-Usage-Warning."""
    near_full = int(SEO_PLAN_CREDITS["starter"] * 0.85)
    await _seed(seo_credits_used=near_full)
    try:
        with patch("app.api.v1.routers.keywords.arq.create_pool", AsyncMock(return_value=_mock_arq_pool())):
            resp = await client.post(
                "/api/v1/keywords/research",
                json={"project_id": str(FAKE_PROJECT_ID), "seed_keyword": "fox facts"},
            )
        assert resp.status_code == 202
        assert "x-usage-warning" in {k.lower() for k in resp.headers.keys()}
    finally:
        await _teardown()
