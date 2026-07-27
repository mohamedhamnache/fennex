import uuid
import datetime as dt

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.admin_auth import create_admin_token
from app.core.credits import credits_from_micros, credit_allowance, seo_credit_allowance
from app.core.database import Base, get_db
from app.core.security import pwd_context
from app.main import app
from app.models.admin_user import AdminUser, AdminRole, AdminRoleAssignment
from app.models.organization import Organization, PlanTier
from app.models.billing import OrgUsage

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

ORG_ACME = uuid.uuid4()
ADMIN_ID: uuid.UUID | None = None

TODAY = dt.date.today()

# Split across two periods to prove summing across history, matching the
# pattern used in test_admin_orgs.py.
AI_COST_MICROS_1 = 3_000_000
AI_COST_MICROS_2 = 1_500_000
SEO_CREDITS_1 = 12
SEO_CREDITS_2 = 4


@pytest.fixture(autouse=True)
async def setup_db():
    global ADMIN_ID
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as db:
        role = AdminRole(key="super_admin", name="Super Admin", description="")
        admin = AdminUser(email="owner@fennex.io", name="Owner",
                          password_hash=pwd_context.hash("secret"), is_active=True)
        db.add_all([role, admin]); await db.flush()
        db.add(AdminRoleAssignment(admin_user_id=admin.id, role_id=role.id))
        ADMIN_ID = admin.id

        acme = Organization(id=ORG_ACME, slug="acme", name="Acme Co",
                            plan_tier=PlanTier.PRO, byok_enabled=True,
                            stripe_customer_id="cus_ABCDEF1234")
        db.add(acme); await db.flush()

        db.add_all([
            OrgUsage(org_id=ORG_ACME, period_start=TODAY.replace(day=1),
                    ai_cost_micros=AI_COST_MICROS_1, seo_credits_used=SEO_CREDITS_1,
                    cost_micros=AI_COST_MICROS_1),
            OrgUsage(org_id=ORG_ACME, period_start=TODAY.replace(day=1) - dt.timedelta(days=31),
                    ai_cost_micros=AI_COST_MICROS_2, seo_credits_used=SEO_CREDITS_2,
                    cost_micros=AI_COST_MICROS_2),
        ])
        await db.commit()

    async def _override():
        async with Session() as s:
            yield s
    app.dependency_overrides[get_db] = _override
    yield
    app.dependency_overrides.clear()
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


def _bearer():
    return create_admin_token(str(ADMIN_ID), ["super_admin"])


def _expected_ai_credits() -> int:
    return credits_from_micros(AI_COST_MICROS_1 + AI_COST_MICROS_2)


def _expected_seo_credits() -> int:
    return SEO_CREDITS_1 + SEO_CREDITS_2


async def test_list_orgs_includes_credit_fields():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/orgs",
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        acme = next(row for row in body["items"] if row["slug"] == "acme")
        assert acme["ai_credits_used"] == _expected_ai_credits()
        assert acme["ai_credits_allowance"] == credit_allowance("pro")
        assert acme["seo_credits_used"] == _expected_seo_credits()
        assert acme["seo_credits_allowance"] == seo_credit_allowance("pro")


async def test_get_org_detail_includes_credit_fields():
    async with await _client() as ac:
        r = await ac.get(f"/api/v1/admin/orgs/{ORG_ACME}",
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert body["ai_credits_used"] == _expected_ai_credits()
        assert body["ai_credits_allowance"] == credit_allowance("pro")
        assert body["seo_credits_used"] == _expected_seo_credits()
        assert body["seo_credits_allowance"] == seo_credit_allowance("pro")


async def test_list_orgs_credit_fields_without_token_401():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/orgs")
        assert r.status_code == 401
