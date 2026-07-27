import uuid
import datetime as dt

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.admin_auth import create_admin_token
from app.core.database import Base, get_db
from app.core.security import pwd_context
from app.main import app
from app.models.admin_user import AdminUser, AdminRole, AdminRoleAssignment
from app.models.organization import Organization, PlanTier
from app.models.user import User
from app.models.project import Project
from app.models.billing import OrgUsage

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

ORG_ACME = uuid.uuid4()
ORG_QUIET = uuid.uuid4()
ADMIN_ID: uuid.UUID | None = None

TODAY = dt.date.today()


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
        quiet = Organization(id=ORG_QUIET, slug="quiet", name="Quiet Inc",
                            plan_tier=PlanTier.FREE,
                            suspended_at=dt.datetime.now(dt.timezone.utc),
                            suspended_reason="non-payment")
        db.add_all([acme, quiet]); await db.flush()

        db.add_all([
            User(org_id=ORG_ACME, email="u1@acme.io", hashed_password="x", full_name="U One"),
            User(org_id=ORG_ACME, email="u2@acme.io", hashed_password="x", full_name="U Two"),
            User(org_id=ORG_QUIET, email="u3@quiet.io", hashed_password="x", full_name="U Three"),
        ])
        db.add_all([
            Project(org_id=ORG_ACME, name="Acme Blog", domain="acme.com"),
        ])

        # Acme has usage split across TWO periods -- proves summing, not just
        # "current row".
        db.add_all([
            OrgUsage(org_id=ORG_ACME, period_start=TODAY.replace(day=1),
                    ai_requests=100, seo_serp=10, cost_micros=500_000),
            OrgUsage(org_id=ORG_ACME, period_start=TODAY.replace(day=1) - dt.timedelta(days=31),
                    ai_requests=50, seo_serp=5, cost_micros=250_000),
        ])
        # Quiet Inc has no usage rows at all -- must roll up to 0, not error.
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


async def test_list_orgs_ok_with_aggregates():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/orgs",
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 2
        by_slug = {row["slug"]: row for row in body["items"]}
        acme = by_slug["acme"]
        assert acme["user_count"] == 2
        assert acme["project_count"] == 1
        assert acme["ai_requests"] == 150
        assert acme["seo_count"] == 15
        assert acme["cost_micros"] == 750_000
        assert acme["cost_usd"] == pytest.approx(0.75)
        assert acme["plan_tier"] == "pro"
        assert acme["byok_enabled"] is True
        assert acme["suspended"] is False

        quiet = by_slug["quiet"]
        assert quiet["user_count"] == 1
        assert quiet["project_count"] == 0
        assert quiet["ai_requests"] == 0
        assert quiet["seo_count"] == 0
        assert quiet["cost_micros"] == 0
        assert quiet["cost_usd"] == 0
        assert quiet["suspended"] is True


async def test_list_orgs_filters_by_q():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/orgs", params={"q": "acme"},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        assert body["items"][0]["slug"] == "acme"


async def test_list_orgs_filters_by_suspended():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/orgs", params={"suspended": "true"},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        assert body["items"][0]["slug"] == "quiet"


async def test_list_orgs_without_token_401():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/orgs")
        assert r.status_code == 401


async def test_get_org_detail_ok():
    async with await _client() as ac:
        r = await ac.get(f"/api/v1/admin/orgs/{ORG_ACME}",
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert body["slug"] == "acme"
        assert body["user_count"] == 2
        assert body["ai_requests"] == 150
        assert body["cost_usd"] == pytest.approx(0.75)
        assert len(body["projects"]) == 1
        assert body["projects"][0]["name"] == "Acme Blog"
        assert body["stripe_customer_id"] == "…1234"
        assert body["suspended"] is False
        assert body["suspended_reason"] is None


async def test_get_org_detail_masks_null_stripe_id():
    async with await _client() as ac:
        r = await ac.get(f"/api/v1/admin/orgs/{ORG_QUIET}",
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert body["stripe_customer_id"] is None
        assert body["suspended"] is True
        assert body["suspended_reason"] == "non-payment"


async def test_get_org_detail_404():
    async with await _client() as ac:
        r = await ac.get(f"/api/v1/admin/orgs/{uuid.uuid4()}",
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 404
