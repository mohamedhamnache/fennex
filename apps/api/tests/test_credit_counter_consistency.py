"""Min-credits floor (2026-07-28): the three AI-credit readers --
current_credits(), GET /usage/summary, and the admin org list/detail --
must all report the SAME ai_credits_used counter for the same org, or
enforcement and the two dashboards would silently disagree.

ai_cost_micros is deliberately seeded to a value whose credits_from_micros()
does NOT equal ai_credits_used -- if any reader still derived credits from
cost instead of reading the counter, these assertions would catch it.
"""
import datetime as dt
import uuid

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.admin_auth import create_admin_token
from app.core.billing import current_billing_period_start, current_credits
from app.core.credits import credit_allowance
from app.core.database import Base, get_db
from app.core.dependencies import get_current_user
from app.core.security import pwd_context
from app.main import app
from app.models.admin_user import AdminRole, AdminRoleAssignment, AdminUser
from app.models.billing import OrgUsage
from app.models.organization import Organization, PlanTier
from app.models.user import User, UserRole

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

ORG_ID = uuid.uuid4()
USER_ID = uuid.uuid4()
ADMIN_ID: uuid.UUID | None = None

AI_CREDITS_USED = 123
# Not credits_from_micros(AI_COST_MICROS) -- see module docstring.
AI_COST_MICROS = 999_999
SEO_CREDITS_USED = 45

fake_user = User(
    id=USER_ID, org_id=ORG_ID, email="counter-consistency@fennex.ai",
    hashed_password="hashed", full_name="Counter Consistency", role=UserRole.OWNER, is_active=True,
)


@pytest.fixture(autouse=True)
async def setup_db():
    global ADMIN_ID
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as db:
        role = AdminRole(key="super_admin", name="Super Admin", description="")
        admin = AdminUser(email="owner@fennex.io", name="Owner",
                          password_hash=pwd_context.hash("secret"), is_active=True)
        db.add_all([role, admin])
        await db.flush()
        db.add(AdminRoleAssignment(admin_user_id=admin.id, role_id=role.id))
        ADMIN_ID = admin.id

        org = Organization(id=ORG_ID, slug="counter-org", name="Counter Org", plan_tier=PlanTier.STARTER)
        db.add(org)
        await db.flush()
        db.add(OrgUsage(
            org_id=ORG_ID, period_start=current_billing_period_start(),
            ai_cost_micros=AI_COST_MICROS, ai_credits_used=AI_CREDITS_USED,
            seo_credits_used=SEO_CREDITS_USED,
        ))
        await db.commit()

    async def _override_db():
        async with Session() as s:
            yield s
    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: fake_user
    yield
    app.dependency_overrides.clear()
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


def _admin_bearer():
    return create_admin_token(str(ADMIN_ID), ["super_admin"])


async def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def test_current_credits_reads_the_counter_not_derived_cost():
    async with Session() as db:
        org = (await db.execute(select(Organization).where(Organization.id == ORG_ID))).scalar_one()
        used, allowance = await current_credits(db, org, "ai")
    assert used == AI_CREDITS_USED
    assert allowance == credit_allowance("starter")


async def test_usage_summary_reads_the_counter_not_derived_cost():
    async with await _client() as ac:
        body = (await ac.get(
            "/api/v1/usage/summary", headers={"Authorization": "Bearer x"}
        )).json()
    assert body["credits_used"] == AI_CREDITS_USED


async def test_admin_org_list_reads_the_counter_not_derived_cost():
    async with await _client() as ac:
        body = (await ac.get(
            "/api/v1/admin/orgs", headers={"Authorization": f"Bearer {_admin_bearer()}"}
        )).json()
    row = next(x for x in body["items"] if x["slug"] == "counter-org")
    assert row["ai_credits_used"] == AI_CREDITS_USED


async def test_admin_org_detail_reads_the_counter_not_derived_cost():
    async with await _client() as ac:
        body = (await ac.get(
            f"/api/v1/admin/orgs/{ORG_ID}", headers={"Authorization": f"Bearer {_admin_bearer()}"}
        )).json()
    assert body["ai_credits_used"] == AI_CREDITS_USED


async def test_all_three_readers_agree():
    async with Session() as db:
        org = (await db.execute(select(Organization).where(Organization.id == ORG_ID))).scalar_one()
        enforcement_used, _ = await current_credits(db, org, "ai")

    async with await _client() as ac:
        usage_body = (await ac.get(
            "/api/v1/usage/summary", headers={"Authorization": "Bearer x"}
        )).json()
        admin_body = (await ac.get(
            "/api/v1/admin/orgs", headers={"Authorization": f"Bearer {_admin_bearer()}"}
        )).json()

    admin_row = next(x for x in admin_body["items"] if x["slug"] == "counter-org")
    assert enforcement_used == usage_body["credits_used"] == admin_row["ai_credits_used"]
