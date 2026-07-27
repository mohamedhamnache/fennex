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
from app.models.model_catalog import ModelCatalog
from app.models.provider_account import ProviderAccount
from app.models.usage_daily import UsageDaily

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

ORG_ID = uuid.uuid4()
ADMIN_ID: uuid.UUID | None = None

TODAY = dt.date.today()
MONTH_START = TODAY.replace(day=1)
BEFORE_MONTH = MONTH_START - dt.timedelta(days=5)


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

        # provider_accounts: openai configured w/ a budget, anthropic
        # configured w/o one. dataforseo is deliberately NOT configured here
        # even though it has usage below -- proves the LEFT-combine.
        db.add_all([
            ProviderAccount(kind="llm", provider="openai", label="OpenAI",
                            encrypted_credentials="x", is_active=True,
                            monthly_budget_cents=5000),
            ProviderAccount(kind="llm", provider="anthropic", label="Anthropic",
                            encrypted_credentials="x", is_active=True,
                            monthly_budget_cents=None),
        ])

        # model_catalog: openai has two models (cheap + standard), anthropic
        # has one (premium). model_count should reflect this per provider.
        db.add_all([
            ModelCatalog(band="cheap", provider="openai", model="gpt-4o-mini",
                        priority=1, supports={}, is_active=True),
            ModelCatalog(band="standard", provider="openai", model="gpt-4o",
                        priority=2, supports={}, is_active=True),
            ModelCatalog(band="premium", provider="anthropic", model="claude-opus",
                        priority=1, supports={}, is_active=True),
        ])

        # usage_daily: a row on BEFORE_MONTH (older, only inside a wide range,
        # NOT month-to-date) and rows on TODAY (inside both range and mtd).
        db.add_all([
            UsageDaily(day=BEFORE_MONTH, org_id=ORG_ID, provider="openai",
                       model="gpt-4o", unit="llm", requests=5,
                       input_tokens=2000, output_tokens=1000, cost_micros=300_000),
            UsageDaily(day=TODAY, org_id=ORG_ID, provider="openai",
                       model="gpt-4o-mini", unit="llm", requests=10,
                       input_tokens=1000, output_tokens=500, cost_micros=100_000),
            UsageDaily(day=TODAY, org_id=ORG_ID, provider="anthropic",
                       model="claude-opus", unit="llm", requests=3,
                       input_tokens=500, output_tokens=200, cost_micros=50_000),
            # Unconfigured provider, present only via usage.
            UsageDaily(day=TODAY, org_id=ORG_ID, provider="dataforseo",
                       model="", unit="seo", requests=1, seo_count=5,
                       cost_micros=20_000),
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


async def test_providers_analytics_ok():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/analytics/providers", params={"range": "90d"},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        by_provider = {row["provider"]: row for row in body["items"]}

        openai = by_provider["openai"]
        assert openai["kind"] == "llm"
        assert openai["is_configured"] is True
        assert openai["is_active"] is True
        assert openai["requests"] == 15  # 5 (before month) + 10 (today)
        assert openai["input_tokens"] == 3000
        assert openai["output_tokens"] == 1500
        assert openai["cost_micros"] == 400_000
        assert openai["cost_usd"] == pytest.approx(0.4)
        assert openai["model_count"] == 2
        assert openai["monthly_budget_usd"] == pytest.approx(50.0)
        # mtd excludes the BEFORE_MONTH row -- only today's 100_000 micros.
        assert openai["mtd_cost_usd"] == pytest.approx(0.1)

        anthropic = by_provider["anthropic"]
        assert anthropic["is_configured"] is True
        assert anthropic["requests"] == 3
        assert anthropic["cost_usd"] == pytest.approx(0.05)
        assert anthropic["model_count"] == 1
        assert anthropic["monthly_budget_usd"] is None
        assert anthropic["mtd_cost_usd"] == pytest.approx(0.05)

        # LEFT-combine: dataforseo has usage but no provider_account row.
        dataforseo = by_provider["dataforseo"]
        assert dataforseo["is_configured"] is False
        assert dataforseo["is_active"] is False
        assert dataforseo["model_count"] == 0
        assert dataforseo["monthly_budget_usd"] is None
        assert dataforseo["requests"] == 1
        assert dataforseo["cost_usd"] == pytest.approx(0.02)

        assert body["totals"]["requests"] == 15 + 3 + 1
        assert body["totals"]["cost_usd"] == pytest.approx(0.4 + 0.05 + 0.02)


async def test_models_analytics_ok():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/analytics/models", params={"range": "90d"},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        by_key = {(row["provider"], row["model"]): row for row in body["items"]}

        # The seo/dataforseo row must be excluded (unit != 'llm').
        assert ("dataforseo", "") not in by_key
        assert len(body["items"]) == 3

        mini = by_key[("openai", "gpt-4o-mini")]
        assert mini["band"] == "cheap"
        assert mini["requests"] == 10
        assert mini["cost_usd"] == pytest.approx(0.1)
        assert mini["cost_per_1k_tokens"] == pytest.approx(0.1 / 1.5)

        full = by_key[("openai", "gpt-4o")]
        assert full["band"] == "standard"
        assert full["cost_usd"] == pytest.approx(0.3)
        assert full["cost_per_1k_tokens"] == pytest.approx(0.3 / 3)

        opus = by_key[("anthropic", "claude-opus")]
        assert opus["band"] == "premium"
        assert opus["cost_usd"] == pytest.approx(0.05)
        assert opus["cost_per_1k_tokens"] == pytest.approx(0.05 / 0.7)

        assert body["cheapest"] == {"provider": "openai", "model": "gpt-4o-mini"}


async def test_models_analytics_zero_tokens_guarded():
    # A row with zero tokens must not raise ZeroDivisionError -- cost_per_1k
    # falls back to 0 instead.
    async with Session() as db:
        db.add(UsageDaily(day=TODAY, org_id=ORG_ID, provider="anthropic",
                          model="claude-haiku", unit="llm", requests=1,
                          input_tokens=0, output_tokens=0, cost_micros=0))
        await db.commit()

    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/analytics/models", params={"range": "90d"},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        by_key = {(row["provider"], row["model"]): row for row in body["items"]}
        haiku = by_key[("anthropic", "claude-haiku")]
        assert haiku["cost_per_1k_tokens"] == 0


async def test_providers_analytics_without_token_401():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/analytics/providers")
        assert r.status_code == 401


async def test_models_analytics_without_token_401():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/analytics/models")
        assert r.status_code == 401
