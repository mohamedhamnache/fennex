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
from app.models.organization import Organization
from app.models.usage_daily import UsageDaily
from app.models.usage_event import UsageEvent

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

ORG_A = uuid.uuid4()
ORG_B = uuid.uuid4()
ADMIN_ID: uuid.UUID | None = None

TODAY = dt.date.today()
YESTERDAY = TODAY - dt.timedelta(days=1)
NOW = dt.datetime.now(dt.timezone.utc)
OUT_OF_RANGE = NOW - dt.timedelta(days=40)


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

        db.add_all([
            Organization(id=ORG_A, slug="org-a", name="Org A"),
            Organization(id=ORG_B, slug="org-b", name="Org B"),
        ])

        # usage_events: seo kind rows across 2 orgs and 2 seo_units. Org B is
        # deliberately the bigger spender so top_consumers ordering is
        # verifiable. One row sits outside the 30d range and must be excluded.
        db.add_all([
            UsageEvent(org_id=ORG_A, ts=NOW, kind="seo", provider="dataforseo",
                       seo_unit="serp", seo_count=10, cost_micros=50_000),
            UsageEvent(org_id=ORG_A, ts=NOW, kind="seo", provider="dataforseo",
                       seo_unit="keyword_ideas", seo_count=5, cost_micros=20_000),
            UsageEvent(org_id=ORG_B, ts=NOW, kind="seo", provider="dataforseo",
                       seo_unit="serp", seo_count=100, cost_micros=500_000),
            UsageEvent(org_id=ORG_A, ts=OUT_OF_RANGE, kind="seo", provider="dataforseo",
                       seo_unit="serp", seo_count=999, cost_micros=999_000),
        ])

        # usage_daily: varied provider/model/day/unit for the usage explorer.
        db.add_all([
            UsageDaily(day=TODAY, org_id=ORG_A, provider="openai", model="gpt-4o",
                       unit="llm", requests=10, input_tokens=1000, output_tokens=500,
                       cost_micros=100_000),
            UsageDaily(day=YESTERDAY, org_id=ORG_A, provider="openai", model="gpt-4o-mini",
                       unit="llm", requests=8, input_tokens=200, output_tokens=100,
                       cost_micros=20_000),
            UsageDaily(day=TODAY, org_id=ORG_B, provider="anthropic", model="claude-opus",
                       unit="llm", requests=5, input_tokens=500, output_tokens=200,
                       cost_micros=50_000),
            UsageDaily(day=TODAY, org_id=ORG_A, provider="dataforseo", model="",
                       unit="seo", requests=2, seo_count=15, cost_micros=70_000),
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


async def test_seo_analytics_ok():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/analytics/seo", params={"range": "30d"},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()

        # OUT_OF_RANGE row (999 seo_count / 999_000 micros) must be excluded.
        assert body["total_requests"] == 3
        assert body["total_seo_count"] == 10 + 5 + 100
        assert body["cost_micros"] == 50_000 + 20_000 + 500_000
        assert body["cost_usd"] == pytest.approx(0.57)

        by_unit = {row["unit"]: row for row in body["by_unit"]}
        assert by_unit["serp"]["count"] == 10 + 100
        assert by_unit["serp"]["cost_usd"] == pytest.approx(0.55)
        assert by_unit["keyword_ideas"]["count"] == 5
        assert by_unit["keyword_ideas"]["cost_usd"] == pytest.approx(0.02)

        top = body["top_consumers"]
        assert len(top) == 2
        assert top[0]["org_id"] == str(ORG_B)
        assert top[0]["org_name"] == "Org B"
        assert top[0]["seo_count"] == 100
        assert top[0]["cost_usd"] == pytest.approx(0.5)
        assert top[1]["org_id"] == str(ORG_A)
        assert top[1]["org_name"] == "Org A"
        assert top[1]["cost_usd"] == pytest.approx(0.07)


async def test_usage_explorer_cost_by_provider():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/analytics/usage",
                         params={"metric": "cost", "group_by": "provider", "range": "30d"},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()

        groups = {row["key"]: row for row in body["groups"]}
        assert groups["openai"]["value"] == pytest.approx(0.12)
        assert groups["anthropic"]["value"] == pytest.approx(0.05)
        assert groups["dataforseo"]["value"] == pytest.approx(0.07)
        # sorted desc by value
        values = [row["value"] for row in body["groups"]]
        assert values == sorted(values, reverse=True)

        assert len(body["series"]) > 0
        assert sum(pt["value"] for pt in body["series"]) == pytest.approx(0.22 + 0.02)


async def test_usage_explorer_seo_by_unit():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/analytics/usage",
                         params={"metric": "seo", "group_by": "unit", "range": "30d"},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        groups = {row["key"]: row for row in body["groups"]}
        assert groups["seo"]["value"] == pytest.approx(15)


async def test_usage_explorer_invalid_metric_422():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/analytics/usage", params={"metric": "bogus"},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 422


async def test_usage_explorer_invalid_group_by_422():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/analytics/usage", params={"group_by": "bogus"},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 422


async def test_seo_analytics_without_token_401():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/analytics/seo")
        assert r.status_code == 401


async def test_usage_explorer_without_token_401():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/analytics/usage")
        assert r.status_code == 401
