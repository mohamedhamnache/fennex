"""Task 8: GET /usage/summary serves both the AI and SEO credit buckets.

Mirrors the router-test harness used by test_credit_enforcement.py (in-memory
SQLite, ASGITransport, get_db/get_current_user overrides). AI credits are a
COUNTER (ai_credits_used) accumulated per operation at meter time -- not
derived from ai_cost_micros. ai_cost_micros stays the true, unfloored
supplier cost and is seeded here only to prove the endpoint does NOT
re-derive credits from it.
"""
import uuid
from types import SimpleNamespace

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.billing import current_billing_period_start
from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.billing import OrgUsage
from app.models.organization import Organization, PlanTier
from app.models.user import User, UserRole

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

SQLITE_COMPATIBLE_TABLES = ["organizations", "users", "org_usage"]

FAKE_ORG_ID = uuid.uuid4()
FAKE_USER_ID = uuid.uuid4()

fake_user = User(
    id=FAKE_USER_ID, org_id=FAKE_ORG_ID, email="usage-summary@fennex.ai",
    hashed_password="hashed", full_name="Usage Summary Test", role=UserRole.OWNER, is_active=True,
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


@pytest.fixture(autouse=True)
async def setup_db():
    tables = [Base.metadata.tables[name] for name in SQLITE_COMPATIBLE_TABLES if name in Base.metadata.tables]
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=tables)
    async with TestSessionLocal() as session:
        # Starter: 5_000 AI credits, 300 SEO credits (see app/core/credits.py).
        session.add(Organization(
            id=FAKE_ORG_ID, slug="usage-summary-org", name="Usage Summary Org",
            plan_tier=PlanTier.STARTER,
        ))
        await session.commit()
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all, tables=tables)


@pytest.fixture
async def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
async def db():
    async with TestSessionLocal() as session:
        yield session


@pytest.fixture
def org():
    return SimpleNamespace(id=FAKE_ORG_ID)


@pytest.fixture
def auth_headers():
    return {"Authorization": "Bearer fake-token"}


async def test_usage_summary_reports_both_buckets(client, db, org, auth_headers):
    # org is on starter: 5_000 AI credits, 300 SEO credits
    db.add(OrgUsage(
        org_id=org.id,
        period_start=current_billing_period_start(),
        cost_micros=1_155_000,     # total, incl. SEO
        # Deliberately NOT ai_credits_used's credits_from_micros() value --
        # if the endpoint re-derived from cost instead of reading the
        # counter, this assertion would catch it.
        ai_cost_micros=1_050_000,
        ai_credits_used=1_000,
        seo_credits_used=90,
    ))
    await db.commit()

    body = (await client.get("/api/v1/usage/summary", headers=auth_headers)).json()

    # AI credits come from the ai_credits_used counter, NOT derived from cost
    assert body["credits_used"] == 1_000
    assert body["credits_allowance"] == 3_000   # starter, repriced 2026-08-06
    assert body["credits_remaining"] == 2_000   # 3,000 allowance - 1,000 used

    assert body["seo_credits_used"] == 90
    assert body["seo_credits_allowance"] == 1_000  # SEO_PLAN_CREDITS["starter"]
    assert body["seo_credits_remaining"] == 910
