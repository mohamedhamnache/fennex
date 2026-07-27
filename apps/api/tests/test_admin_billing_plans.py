import uuid
import datetime as dt

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.admin_auth import create_admin_token
from app.core.billing import PLAN_LIMITS, PLAN_PRICE_USD
from app.core.database import Base, get_db
from app.core.security import pwd_context
from app.main import app
from app.models.admin_user import AdminUser, AdminRole, AdminRoleAssignment
from app.models.organization import Organization, PlanTier
from app.models.billing import SubscriptionEvent

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

ADMIN_ID: uuid.UUID | None = None

# See test_admin_billing_kpis.py: trial_ends_at/processed_at are naive UTC
# throughout this codebase -- match that convention here.
NOW = dt.datetime.utcnow()

ORG_FREE = uuid.uuid4()
ORG_STARTER_PAYING = uuid.uuid4()
ORG_STARTER_NONPAYING = uuid.uuid4()
ORG_PRO_PAYING_1 = uuid.uuid4()
ORG_PRO_PAYING_2 = uuid.uuid4()
ORG_AGENCY_NONPAYING = uuid.uuid4()

EVT_PAID = uuid.uuid4()
EVT_FAILED = uuid.uuid4()


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
            Organization(id=ORG_FREE, slug="freeloader", name="Freeloader Inc",
                        plan_tier=PlanTier.FREE),
            Organization(id=ORG_STARTER_PAYING, slug="starter-pay", name="Starter Pay",
                        plan_tier=PlanTier.STARTER, stripe_subscription_id="sub_starter"),
            Organization(id=ORG_STARTER_NONPAYING, slug="starter-nopay", name="Starter No Pay",
                        plan_tier=PlanTier.STARTER),
            Organization(id=ORG_PRO_PAYING_1, slug="pro-one", name="Pro One",
                        plan_tier=PlanTier.PRO, stripe_subscription_id="sub_pro1"),
            Organization(id=ORG_PRO_PAYING_2, slug="pro-two", name="Pro Two",
                        plan_tier=PlanTier.PRO, stripe_subscription_id="sub_pro2"),
            Organization(id=ORG_AGENCY_NONPAYING, slug="agency-nopay", name="Agency No Pay",
                        plan_tier=PlanTier.AGENCY),
        ])

        db.add_all([
            SubscriptionEvent(id=EVT_PAID, org_id=ORG_STARTER_PAYING, stripe_event_id="evt_paid_1",
                              event_type="invoice.paid",
                              payload={"data": {"object": {"amount_paid": 9900}}},
                              processed_at=NOW - dt.timedelta(days=1)),
            SubscriptionEvent(id=EVT_FAILED, org_id=ORG_PRO_PAYING_1, stripe_event_id="evt_fail_1",
                              event_type="invoice.payment_failed",
                              payload={"data": {"object": {}}},
                              processed_at=NOW - dt.timedelta(days=2)),
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


async def test_billing_plans_ok_with_admin_bearer():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/billing/plans",
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()

        by_plan = {row["plan"]: row for row in body["items"]}
        # Every plan in PLAN_PRICE_USD must be represented, even with 0 orgs.
        assert set(by_plan.keys()) == set(PLAN_PRICE_USD.keys())

        assert by_plan["free"]["price_usd"] == 0
        assert by_plan["free"]["org_count"] == 1
        assert by_plan["free"]["mrr_usd"] == pytest.approx(0.0)

        assert by_plan["starter"]["price_usd"] == 29
        assert by_plan["starter"]["org_count"] == 2
        # Only the paying starter org counts toward mrr.
        assert by_plan["starter"]["mrr_usd"] == pytest.approx(29.0)

        assert by_plan["pro"]["price_usd"] == 99
        assert by_plan["pro"]["org_count"] == 2
        assert by_plan["pro"]["mrr_usd"] == pytest.approx(198.0)

        # Agency org has no stripe_subscription_id -- not paying, $0 mrr.
        assert by_plan["agency"]["org_count"] == 1
        assert by_plan["agency"]["mrr_usd"] == pytest.approx(0.0)
        # -1 (unlimited) must be preserved, not coerced to something else.
        assert by_plan["agency"]["limits"]["social"] == -1

        assert by_plan["scale"]["org_count"] == 0
        assert by_plan["scale"]["mrr_usd"] == pytest.approx(0.0)

        # limits is the projects/articles/images/social subset only.
        assert set(by_plan["starter"]["limits"].keys()) == {
            "projects", "articles", "images", "social",
        }
        assert by_plan["starter"]["limits"]["projects"] == PLAN_LIMITS["starter"]["projects"]
        assert by_plan["starter"]["limits"]["articles"] == PLAN_LIMITS["starter"]["articles"]
        assert by_plan["starter"]["limits"]["images"] == PLAN_LIMITS["starter"]["images"]
        assert by_plan["starter"]["limits"]["social"] == PLAN_LIMITS["starter"]["social"]


async def test_billing_plans_without_token_401():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/billing/plans")
        assert r.status_code == 401


async def test_billing_events_newest_first_with_parsed_amount():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/billing/events",
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()

        assert body["total"] == 2
        assert body["page"] == 1
        assert body["page_size"] >= 2
        # Newest (processed 1 day ago) first, then the 2-day-old failure.
        items = body["items"]
        assert items[0]["id"] == str(EVT_PAID)
        assert items[0]["event_type"] == "invoice.paid"
        assert items[0]["amount_usd"] == pytest.approx(99.0)
        assert items[0]["org_id"] == str(ORG_STARTER_PAYING)

        assert items[1]["id"] == str(EVT_FAILED)
        assert items[1]["event_type"] == "invoice.payment_failed"
        assert items[1]["amount_usd"] is None


async def test_billing_events_type_filter_narrows():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/billing/events?type=invoice.paid",
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        assert len(body["items"]) == 1
        assert body["items"][0]["event_type"] == "invoice.paid"


async def test_billing_events_pagination():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/billing/events?page=1&page_size=1",
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 2
        assert body["page"] == 1
        assert body["page_size"] == 1
        assert len(body["items"]) == 1
        assert body["items"][0]["id"] == str(EVT_PAID)


async def test_billing_events_without_token_401():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/billing/events")
        assert r.status_code == 401
