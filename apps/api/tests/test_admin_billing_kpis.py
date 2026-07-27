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
from app.models.billing import SubscriptionEvent
from app.models.usage_daily import UsageDaily

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

ADMIN_ID: uuid.UUID | None = None

# Organization.trial_ends_at and SubscriptionEvent.processed_at are stored as
# naive UTC datetimes throughout this codebase (see app/core/entitlements.py
# and app/api/v1/routers/webhooks.py's `datetime.utcfromtimestamp`) -- match
# that convention here rather than seeding tz-aware values.
NOW = dt.datetime.utcnow()
TODAY = NOW.date()

ORG_STARTER = uuid.uuid4()
ORG_PRO_1 = uuid.uuid4()
ORG_PRO_2 = uuid.uuid4()
ORG_ENTERPRISE = uuid.uuid4()
ORG_TRIALING = uuid.uuid4()
ORG_FREE = uuid.uuid4()
ORG_SUSPENDED_PAID = uuid.uuid4()

# Expected math, spelled out so assertions double as documentation:
# paying: starter(29) + pro(99) + pro(99) + enterprise(0, custom) = 227
EXPECTED_MRR = 29 + 99 + 99 + 0
EXPECTED_PAYING_ORGS = 4
EXPECTED_TRIALING_ORGS = 1
EXPECTED_ENTERPRISE_ORGS = 1


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
            Organization(id=ORG_STARTER, slug="starter-co", name="Starter Co",
                        plan_tier=PlanTier.STARTER, stripe_subscription_id="sub_starter"),
            Organization(id=ORG_PRO_1, slug="pro-one", name="Pro One",
                        plan_tier=PlanTier.PRO, stripe_subscription_id="sub_pro1"),
            Organization(id=ORG_PRO_2, slug="pro-two", name="Pro Two",
                        plan_tier=PlanTier.PRO, stripe_subscription_id="sub_pro2"),
            Organization(id=ORG_ENTERPRISE, slug="big-co", name="Big Co",
                        plan_tier=PlanTier.ENTERPRISE, stripe_subscription_id="sub_ent"),
            Organization(id=ORG_TRIALING, slug="trialer", name="Trialer Inc",
                        plan_tier=PlanTier.FREE,
                        trial_ends_at=NOW + dt.timedelta(days=5)),
            Organization(id=ORG_FREE, slug="freeloader", name="Freeloader Inc",
                        plan_tier=PlanTier.FREE),
            Organization(id=ORG_SUSPENDED_PAID, slug="deadbeat", name="Deadbeat Co",
                        plan_tier=PlanTier.PRO, stripe_subscription_id="sub_dead",
                        # suspended_at is DateTime(timezone=True) -- aware, unlike
                        # trial_ends_at/processed_at above.
                        suspended_at=dt.datetime.now(dt.timezone.utc)),
        ])

        # Current-month COGS: 50 + 10 = 60 USD.
        db.add_all([
            UsageDaily(day=TODAY, org_id=ORG_PRO_1, provider="anthropic", model="claude",
                      unit="llm", cost_micros=50_000_000),
            UsageDaily(day=TODAY, org_id=ORG_PRO_2, provider="anthropic", model="claude",
                      unit="llm", cost_micros=10_000_000),
        ])
        # Prior-month cost must NOT be counted in mtd_cost_usd.
        prior_month_day = TODAY.replace(day=1) - dt.timedelta(days=1)
        db.add(UsageDaily(day=prior_month_day, org_id=ORG_PRO_1, provider="anthropic",
                          model="claude", unit="llm", cost_micros=999_000_000))

        db.add_all([
            SubscriptionEvent(org_id=ORG_PRO_1, stripe_event_id="evt_fail_1",
                              event_type="invoice.payment_failed",
                              payload={"data": {"object": {}}},
                              processed_at=NOW - dt.timedelta(days=2)),
            SubscriptionEvent(org_id=ORG_STARTER, stripe_event_id="evt_paid_1",
                              event_type="invoice.paid",
                              payload={"data": {"object": {"amount_paid": 2900}}},
                              processed_at=NOW - dt.timedelta(days=1)),
            # Older than 30 days -- must NOT count toward failed_payments_30d.
            SubscriptionEvent(org_id=ORG_PRO_2, stripe_event_id="evt_fail_old",
                              event_type="invoice.payment_failed",
                              payload={"data": {"object": {}}},
                              processed_at=NOW - dt.timedelta(days=45)),
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


async def test_billing_kpis_ok_with_admin_bearer():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/billing/kpis",
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()

        assert body["mrr_usd"] == pytest.approx(float(EXPECTED_MRR))
        assert body["arr_usd"] == pytest.approx(float(EXPECTED_MRR) * 12)
        assert body["paying_orgs"] == EXPECTED_PAYING_ORGS
        assert body["trialing_orgs"] == EXPECTED_TRIALING_ORGS
        assert body["enterprise_orgs"] == EXPECTED_ENTERPRISE_ORGS

        assert body["mtd_cost_usd"] == pytest.approx(60.0)
        expected_margin = (EXPECTED_MRR - 60.0) / EXPECTED_MRR
        assert body["gross_margin_pct"] == pytest.approx(expected_margin)
        assert body["arpu_usd"] == pytest.approx(EXPECTED_MRR / EXPECTED_PAYING_ORGS)

        assert body["failed_payments_30d"] >= 1
        # The 45-day-old failure must be excluded from the 30d window.
        assert body["failed_payments_30d"] == 1

        by_plan = {row["plan"]: row for row in body["by_plan"]}
        assert by_plan["starter"]["orgs"] == 1
        assert by_plan["starter"]["mrr_usd"] == pytest.approx(29.0)
        assert by_plan["pro"]["orgs"] == 2
        assert by_plan["pro"]["mrr_usd"] == pytest.approx(198.0)
        assert by_plan["enterprise"]["orgs"] == 1
        assert by_plan["enterprise"]["mrr_usd"] == pytest.approx(0.0)
        # Suspended org's tier must not leak in as an extra paying row, and
        # free/trialing orgs never appear in by_plan at all.
        assert "free" not in by_plan


async def test_billing_kpis_without_token_401():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/billing/kpis")
        assert r.status_code == 401
