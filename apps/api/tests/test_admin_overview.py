import datetime as dt
import uuid

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.admin_auth import create_admin_token
from app.core.database import Base, get_db
from app.core.security import pwd_context
from app.main import app
from app.models.admin_user import AdminUser, AdminRole, AdminRoleAssignment
from app.models.organization import Organization
from app.models.user import User
from app.models.usage_daily import UsageDaily

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

ORG_ID = uuid.uuid4()
ADMIN_ID: uuid.UUID | None = None

TODAY = dt.date.today()

USAGE_ROWS = [
    dict(day=TODAY, requests=10, input_tokens=1000, output_tokens=500,
         cache_read_tokens=0, seo_count=2, cost_micros=150_000),
    dict(day=TODAY - dt.timedelta(days=1), requests=5, input_tokens=200,
         output_tokens=100, cache_read_tokens=0, seo_count=1, cost_micros=50_000),
]


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

        org = Organization(id=ORG_ID, slug="acme", name="Acme Co")
        db.add(org); await db.flush()

        user = User(org_id=ORG_ID, email="u1@acme.io", hashed_password="x",
                    full_name="U One")
        db.add(user)

        for row in USAGE_ROWS:
            db.add(UsageDaily(org_id=ORG_ID, provider="anthropic", model="claude",
                              unit="llm", **row))
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


async def test_kpis_ok_with_admin_bearer():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/overview/kpis",
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        total_cost_micros = sum(row["cost_micros"] for row in USAGE_ROWS)
        total_requests = sum(row["requests"] for row in USAGE_ROWS)
        assert body["cost_micros"] == total_cost_micros
        assert body["cost_usd"] == pytest.approx(total_cost_micros / 1_000_000)
        assert body["total_orgs"] == 1
        assert body["total_users"] == 1
        assert body["ai_requests"] == total_requests
        assert body["mrr_usd"] == 0
        assert body["margin_pct"] is None


async def test_kpis_without_token_401():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/overview/kpis")
        assert r.status_code == 401


async def test_series_cost_ok():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/overview/series",
                         params={"metric": "cost", "range": "30d"},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert len(body["points"]) > 0
