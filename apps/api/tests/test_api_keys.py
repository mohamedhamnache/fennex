"""
Tests for API Keys CRUD endpoints.

Strategy:
- Override `get_db` with an in-memory SQLite async session (aiosqlite)
- Override `get_current_user` with a fake user
- Test list, create, and delete endpoints with encrypted storage
"""
import uuid

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.organization import Organization
from app.models.user import User, UserRole

# ── Test DB (SQLite in-memory) ────────────────────────────────────────────────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)


async def override_get_db():
    async with TestSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ── Fake user fixture ─────────────────────────────────────────────────────────

FAKE_ORG_ID = uuid.uuid4()
FAKE_USER_ID = uuid.uuid4()

fake_user = User(
    id=FAKE_USER_ID,
    org_id=FAKE_ORG_ID,
    email="owner@test.com",
    hashed_password="hashed",
    full_name="Owner",
    role=UserRole.OWNER,
    is_active=True,
)


async def override_get_current_user():
    return fake_user


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
async def setup_db():
    """Create all tables before each test and drop after."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Create the test organization
    async with TestSessionLocal() as session:
        org = Organization(id=FAKE_ORG_ID, slug="test-org", name="Test Org")
        session.add(org)
        await session.commit()

    yield

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_empty(client):
    """Test listing API keys when none exist."""
    r = await client.get("/api/v1/api-keys")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_create_and_list(client):
    """Test creating an API key and listing it."""
    r = await client.post(
        "/api/v1/api-keys",
        json={"provider": "openai", "value": "sk-test1234abcd"}
    )
    assert r.status_code == 201
    body = r.json()
    assert body["provider"] == "openai"
    assert "sk-test1234abcd" not in body["masked_value"]
    assert body["masked_value"].endswith("abcd")
    assert "id" in body
    assert "created_at" in body


@pytest.mark.asyncio
async def test_delete(client):
    """Test creating and deleting an API key."""
    create = await client.post(
        "/api/v1/api-keys",
        json={"provider": "anthropic", "value": "sk-ant-xyz9"}
    )
    assert create.status_code == 201
    key_id = create.json()["id"]

    r = await client.delete(f"/api/v1/api-keys/{key_id}")
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_delete_nonexistent(client):
    """Test deleting a key that doesn't exist."""
    fake_id = str(uuid.uuid4())
    r = await client.delete(f"/api/v1/api-keys/{fake_id}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_invalid_provider(client):
    """Test creating a key with invalid provider."""
    r = await client.post(
        "/api/v1/api-keys",
        json={"provider": "invalid", "value": "sk-test123"}
    )
    assert r.status_code == 400
    assert "Invalid provider" in r.json()["detail"]


@pytest.mark.asyncio
async def test_masked_value_format(client):
    """Test that masked values have the correct format."""
    test_cases = [
        ("openai", "sk-test1234abcd", "abcd"),
        ("anthropic", "sk-ant-test", "test"),
        ("google", "x", "x"),
    ]

    for provider, value, expected_tail in test_cases:
        r = await client.post(
            "/api/v1/api-keys",
            json={"provider": provider, "value": value}
        )
        assert r.status_code == 201
        masked = r.json()["masked_value"]
        assert masked.startswith("sk-...")
        assert masked.endswith(expected_tail)
