"""Tests for /billing endpoints."""
import uuid
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app as fastapi_app
from app.models.billing import OrgUsage, SubscriptionEvent  # noqa: F401 — register with Base.metadata
from app.models.organization import Organization, PlanTier
from app.models.user import User, UserRole

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

FAKE_ORG_ID = uuid.uuid4()
FAKE_USER_ID = uuid.uuid4()

# Tables needed for billing tests (excludes subscription_events which uses JSONB)
SQLITE_COMPATIBLE_TABLES = [
    "organizations",
    "users",
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


async def override_get_current_user():
    return User(
        id=FAKE_USER_ID, org_id=FAKE_ORG_ID, email="test@test.com",
        hashed_password="x", full_name="Test User", role=UserRole.OWNER, is_active=True,
    )


@pytest.fixture(autouse=True)
async def setup_db():
    # Only create SQLite-compatible tables (subscription_events uses JSONB which SQLite can't handle)
    tables = [
        Base.metadata.tables[name]
        for name in SQLITE_COMPATIBLE_TABLES
        if name in Base.metadata.tables
    ]
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=tables)
    # Seed org and user so _get_org resolves — create fresh instances each test
    async with TestSessionLocal() as session:
        session.add(Organization(
            id=FAKE_ORG_ID, slug="test", name="Test Org", plan_tier=PlanTier.FREE,
        ))
        session.add(User(
            id=FAKE_USER_ID, org_id=FAKE_ORG_ID, email="test@test.com",
            hashed_password="x", full_name="Test User", role=UserRole.OWNER, is_active=True,
        ))
        await session.commit()
    fastapi_app.dependency_overrides[get_db] = override_get_db
    fastapi_app.dependency_overrides[get_current_user] = override_get_current_user
    yield
    fastapi_app.dependency_overrides.clear()
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all, tables=tables)


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as ac:
        yield ac


async def test_create_checkout_session(client):
    """POST /billing/checkout returns checkout_url."""
    mock_session = MagicMock()
    mock_session.url = "https://checkout.stripe.com/test"

    mock_customer = MagicMock()
    mock_customer.id = "cus_test123"

    with (
        patch("app.api.v1.routers.billing.stripe.Customer.create", return_value=mock_customer),
        patch("app.api.v1.routers.billing.stripe.checkout.Session.create", return_value=mock_session),
        patch("app.api.v1.routers.billing._PRICE_MAP", {("starter", False): "price_test"}),
    ):
        resp = await client.post(
            "/api/v1/billing/checkout",
            json={
                "tier": "starter",
                "annual": False,
                "success_url": "http://localhost:3001/settings?billing=success",
                "cancel_url": "http://localhost:3001/settings",
            },
            headers={"Authorization": "Bearer fake"},
        )
    assert resp.status_code == 200
    assert resp.json()["checkout_url"] == "https://checkout.stripe.com/test"


async def test_create_portal_session(client):
    """POST /billing/portal returns portal_url."""
    mock_session = MagicMock()
    mock_session.url = "https://billing.stripe.com/portal/test"

    # Ensure org has a stripe_customer_id via a direct DB update
    async with TestSessionLocal() as session:
        org = await session.get(Organization, FAKE_ORG_ID)
        org.stripe_customer_id = "cus_existing"
        await session.commit()

    with patch("app.api.v1.routers.billing.stripe.billing_portal.Session.create", return_value=mock_session):
        resp = await client.post(
            "/api/v1/billing/portal",
            json={"return_url": "http://localhost:3001/settings"},
            headers={"Authorization": "Bearer fake"},
        )
    assert resp.status_code == 200
    assert resp.json()["portal_url"] == "https://billing.stripe.com/portal/test"


async def test_get_billing_usage(client):
    """GET /billing/usage returns usage data."""
    resp = await client.get(
        "/api/v1/billing/usage",
        headers={"Authorization": "Bearer fake"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "plan_tier" in data
    assert "usage" in data
    assert "articles" in data["usage"]
    assert data["usage"]["articles"]["limit"] == 4  # free tier
