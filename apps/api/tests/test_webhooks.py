"""Tests for Stripe webhook handler."""
import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dependencies import get_db
from app.main import app
from app.models.organization import Organization, PlanTier
from app.models.project import Project
from app.models.brand_voice import BrandVoice
from app.models.user import User, UserRole

# Patch target for the idempotency helper — avoids JSONB (SQLite-incompatible) table
_RECORD_EVENT_PATH = "app.api.v1.routers.webhooks._record_event"

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

# Tables compatible with SQLite — excludes subscription_events (uses JSONB)
SQLITE_COMPATIBLE_TABLES = [
    "organizations",
    "users",
    "projects",
    "brand_voices",
    "brand_voice_sources",
    "org_usage",
]


async def override_get_db():
    async with TestSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


@pytest.fixture(autouse=True)
async def setup_db():
    tables = [
        Base.metadata.tables[name]
        for name in SQLITE_COMPATIBLE_TABLES
        if name in Base.metadata.tables
    ]
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=tables)
    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all, tables=tables)


@pytest.fixture
async def db_session():
    async with TestSessionLocal() as session:
        yield session


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _make_stripe_event(event_type: str, data: dict, event_id: str = "evt_test") -> MagicMock:
    """Build a MagicMock that looks like a stripe.Event object."""
    mock_event = MagicMock()
    mock_event.id = event_id
    mock_event.type = event_type
    mock_event.data.object = data
    return mock_event


def _make_raw_body(event_type: str, data: dict, event_id: str = "evt_test") -> bytes:
    payload = {"id": event_id, "type": event_type, "data": {"object": data}}
    return json.dumps(payload).encode()


async def test_webhook_invalid_signature_returns_400(client):
    """Missing or invalid Stripe-Signature header → 400."""
    with patch(
        "app.api.v1.routers.webhooks.stripe.Webhook.construct_event",
        side_effect=Exception("invalid"),
    ):
        resp = await client.post(
            "/api/v1/webhooks/stripe",
            content=b'{"id":"evt_test"}',
            headers={"stripe-signature": "bad"},
        )
    assert resp.status_code == 400


async def test_webhook_subscription_deleted_reverts_to_free(client, db_session):
    """subscription.deleted event sets plan_tier back to FREE."""
    org = Organization(
        slug="was-pro", name="Test", plan_tier=PlanTier.PRO,
        stripe_customer_id="cus_pro",
    )
    db_session.add(org)
    await db_session.commit()

    data = {
        "customer": "cus_pro",
        "status": "canceled",
        "trial_end": None,
        "items": {"data": [{"price": {"lookup_key": "pro_monthly"}}]},
    }
    mock_event = _make_stripe_event("customer.subscription.deleted", data, "evt_del_001")

    with (
        patch(
            "app.api.v1.routers.webhooks.stripe.Webhook.construct_event",
            return_value=mock_event,
        ),
        patch(_RECORD_EVENT_PATH, new=AsyncMock(return_value=True)),
    ):
        resp = await client.post(
            "/api/v1/webhooks/stripe",
            content=_make_raw_body("customer.subscription.deleted", data, "evt_del_001"),
            headers={"stripe-signature": "t=1,v1=sig"},
        )

    assert resp.status_code == 200
    await db_session.refresh(org)
    assert org.plan_tier == PlanTier.FREE


async def test_webhook_subscription_updated_upgrades_plan(client, db_session):
    """subscription.updated event upgrades plan_tier and unlocks downgraded rows."""
    org = Organization(
        slug="upgrading-org", name="Test", plan_tier=PlanTier.FREE,
        stripe_customer_id="cus_upgrade",
    )
    db_session.add(org)
    await db_session.commit()

    data = {
        "customer": "cus_upgrade",
        "status": "active",
        "trial_end": None,
        "items": {"data": [{"price": {"lookup_key": "pro_monthly"}}]},
    }
    mock_event = _make_stripe_event("customer.subscription.updated", data, "evt_upg_001")

    with (
        patch(
            "app.api.v1.routers.webhooks.stripe.Webhook.construct_event",
            return_value=mock_event,
        ),
        patch(_RECORD_EVENT_PATH, new=AsyncMock(return_value=True)),
    ):
        resp = await client.post(
            "/api/v1/webhooks/stripe",
            content=_make_raw_body("customer.subscription.updated", data, "evt_upg_001"),
            headers={"stripe-signature": "t=1,v1=sig"},
        )

    assert resp.status_code == 200
    await db_session.refresh(org)
    assert org.plan_tier == PlanTier.PRO


async def test_webhook_subscription_updated_downgrades_locks_excess_projects(client, db_session):
    """subscription.updated to free locks all but 1 project (free limit)."""
    org = Organization(
        slug="downgrading-org", name="Test", plan_tier=PlanTier.PRO,
        stripe_customer_id="cus_downgrade",
    )
    db_session.add(org)
    await db_session.flush()

    # Add 3 projects — free tier only allows 1
    for i in range(3):
        db_session.add(Project(
            org_id=org.id, name=f"Project {i}", domain=f"proj{i}.com",
        ))
    await db_session.commit()

    data = {
        "customer": "cus_downgrade",
        "status": "active",
        "trial_end": None,
        "items": {"data": [{"price": {"lookup_key": "starter_monthly"}}]},
    }
    mock_event = _make_stripe_event("customer.subscription.updated", data, "evt_down_001")

    with (
        patch(
            "app.api.v1.routers.webhooks.stripe.Webhook.construct_event",
            return_value=mock_event,
        ),
        patch(_RECORD_EVENT_PATH, new=AsyncMock(return_value=True)),
    ):
        resp = await client.post(
            "/api/v1/webhooks/stripe",
            content=_make_raw_body("customer.subscription.updated", data, "evt_down_001"),
            headers={"stripe-signature": "t=1,v1=sig"},
        )

    assert resp.status_code == 200
    await db_session.refresh(org)
    assert org.plan_tier == PlanTier.STARTER

    # starter allows 5 projects — all 3 should remain unlocked
    from sqlalchemy import select
    result = await db_session.execute(
        select(Project).where(Project.org_id == org.id, Project.locked == True)  # noqa: E712
    )
    locked_projects = result.scalars().all()
    assert len(locked_projects) == 0  # starter allows 5, we only have 3


async def test_webhook_subscription_deleted_locks_excess_projects(client, db_session):
    """subscription.deleted with excess projects → excess locked with 'downgrade' reason."""
    org = Organization(
        slug="cancel-org", name="Test", plan_tier=PlanTier.PRO,
        stripe_customer_id="cus_cancel",
    )
    db_session.add(org)
    await db_session.flush()

    # Add 3 projects — free tier only allows 1
    for i in range(3):
        db_session.add(Project(
            org_id=org.id, name=f"Project {i}", domain=f"cancel{i}.com",
        ))
    await db_session.commit()

    data = {
        "customer": "cus_cancel",
        "status": "canceled",
        "trial_end": None,
        "items": {"data": [{"price": {"lookup_key": "pro_monthly"}}]},
    }
    mock_event = _make_stripe_event("customer.subscription.deleted", data, "evt_cancel_001")

    with (
        patch(
            "app.api.v1.routers.webhooks.stripe.Webhook.construct_event",
            return_value=mock_event,
        ),
        patch(_RECORD_EVENT_PATH, new=AsyncMock(return_value=True)),
    ):
        resp = await client.post(
            "/api/v1/webhooks/stripe",
            content=_make_raw_body("customer.subscription.deleted", data, "evt_cancel_001"),
            headers={"stripe-signature": "t=1,v1=sig"},
        )

    assert resp.status_code == 200
    await db_session.refresh(org)
    assert org.plan_tier == PlanTier.FREE

    from sqlalchemy import select
    result = await db_session.execute(
        select(Project).where(Project.org_id == org.id, Project.locked == True)  # noqa: E712
    )
    locked_projects = result.scalars().all()
    # free allows 1, we have 3 → 2 should be locked
    assert len(locked_projects) == 2
    for p in locked_projects:
        assert p.locked_reason == "downgrade"


async def test_webhook_invoice_payment_failed_locks_projects(client, db_session):
    """invoice.payment_failed locks all projects with 'payment_failed' reason."""
    org = Organization(
        slug="payment-fail-org", name="Test", plan_tier=PlanTier.PRO,
        stripe_customer_id="cus_payfail",
    )
    db_session.add(org)
    await db_session.flush()

    db_session.add(Project(org_id=org.id, name="P1", domain="p1.com"))
    db_session.add(Project(org_id=org.id, name="P2", domain="p2.com"))
    await db_session.commit()

    data = {"customer": "cus_payfail", "invoice": "inv_123"}
    mock_event = _make_stripe_event("invoice.payment_failed", data, "evt_pay_001")

    with (
        patch(
            "app.api.v1.routers.webhooks.stripe.Webhook.construct_event",
            return_value=mock_event,
        ),
        patch(_RECORD_EVENT_PATH, new=AsyncMock(return_value=True)),
    ):
        resp = await client.post(
            "/api/v1/webhooks/stripe",
            content=_make_raw_body("invoice.payment_failed", data, "evt_pay_001"),
            headers={"stripe-signature": "t=1,v1=sig"},
        )

    assert resp.status_code == 200
    await db_session.refresh(org)
    assert org.plan_locked_at is not None

    from sqlalchemy import select
    result = await db_session.execute(
        select(Project).where(Project.org_id == org.id)
    )
    projects = result.scalars().all()
    assert all(p.locked for p in projects)
    assert all(p.locked_reason == "payment_failed" for p in projects)


async def test_webhook_upgrade_unlocks_downgraded_rows(client, db_session):
    """Upgrading org unlocks rows previously locked with 'downgrade' reason."""
    org = Organization(
        slug="unlock-org", name="Test", plan_tier=PlanTier.FREE,
        stripe_customer_id="cus_unlock",
    )
    db_session.add(org)
    await db_session.flush()

    # Add a project pre-locked from a previous downgrade
    locked_proj = Project(
        org_id=org.id, name="Locked Project", domain="locked.com",
        locked=True, locked_reason="downgrade",
    )
    db_session.add(locked_proj)
    await db_session.commit()

    data = {
        "customer": "cus_unlock",
        "status": "active",
        "trial_end": None,
        "items": {"data": [{"price": {"lookup_key": "pro_monthly"}}]},
    }
    mock_event = _make_stripe_event("customer.subscription.updated", data, "evt_unlock_001")

    with (
        patch(
            "app.api.v1.routers.webhooks.stripe.Webhook.construct_event",
            return_value=mock_event,
        ),
        patch(_RECORD_EVENT_PATH, new=AsyncMock(return_value=True)),
    ):
        resp = await client.post(
            "/api/v1/webhooks/stripe",
            content=_make_raw_body("customer.subscription.updated", data, "evt_unlock_001"),
            headers={"stripe-signature": "t=1,v1=sig"},
        )

    assert resp.status_code == 200
    await db_session.refresh(locked_proj)
    assert locked_proj.locked is False
    assert locked_proj.locked_reason is None


async def test_webhook_checkout_session_completed_saves_customer_id(client, db_session):
    """checkout.session.completed saves stripe_customer_id when not yet set."""
    org = Organization(
        slug="new-org", name="Test", plan_tier=PlanTier.FREE,
        stripe_customer_id="cus_checkout",
    )
    db_session.add(org)
    await db_session.commit()

    data = {"customer": "cus_checkout", "payment_status": "paid"}
    mock_event = _make_stripe_event("checkout.session.completed", data, "evt_checkout_001")

    with (
        patch(
            "app.api.v1.routers.webhooks.stripe.Webhook.construct_event",
            return_value=mock_event,
        ),
        patch(_RECORD_EVENT_PATH, new=AsyncMock(return_value=True)),
    ):
        resp = await client.post(
            "/api/v1/webhooks/stripe",
            content=_make_raw_body("checkout.session.completed", data, "evt_checkout_001"),
            headers={"stripe-signature": "t=1,v1=sig"},
        )

    assert resp.status_code == 200


async def test_webhook_unknown_customer_is_ignored(client):
    """Event for unknown customer_id → 200, no error."""
    data = {
        "customer": "cus_unknown_xyz",
        "status": "active",
        "trial_end": None,
        "items": {"data": [{"price": {"lookup_key": "pro_monthly"}}]},
    }
    mock_event = _make_stripe_event("customer.subscription.updated", data, "evt_unknown_001")

    with (
        patch(
            "app.api.v1.routers.webhooks.stripe.Webhook.construct_event",
            return_value=mock_event,
        ),
        patch(_RECORD_EVENT_PATH, new=AsyncMock(return_value=True)),
    ):
        resp = await client.post(
            "/api/v1/webhooks/stripe",
            content=_make_raw_body("customer.subscription.updated", data, "evt_unknown_001"),
            headers={"stripe-signature": "t=1,v1=sig"},
        )

    assert resp.status_code == 200


async def test_webhook_trial_end_saved_on_subscription_created(client, db_session):
    """subscription.created with trial_end timestamp saves trial_ends_at."""
    org = Organization(
        slug="trial-org", name="Test", plan_tier=PlanTier.FREE,
        stripe_customer_id="cus_trial",
    )
    db_session.add(org)
    await db_session.commit()

    trial_end_ts = 1800000000  # some future unix timestamp
    data = {
        "customer": "cus_trial",
        "status": "trialing",
        "trial_end": trial_end_ts,
        "items": {"data": [{"price": {"lookup_key": "starter_monthly"}}]},
    }
    mock_event = _make_stripe_event("customer.subscription.created", data, "evt_trial_001")

    with (
        patch(
            "app.api.v1.routers.webhooks.stripe.Webhook.construct_event",
            return_value=mock_event,
        ),
        patch(_RECORD_EVENT_PATH, new=AsyncMock(return_value=True)),
    ):
        resp = await client.post(
            "/api/v1/webhooks/stripe",
            content=_make_raw_body("customer.subscription.created", data, "evt_trial_001"),
            headers={"stripe-signature": "t=1,v1=sig"},
        )

    assert resp.status_code == 200
    await db_session.refresh(org)
    assert org.trial_ends_at is not None
    assert org.plan_tier == PlanTier.STARTER
