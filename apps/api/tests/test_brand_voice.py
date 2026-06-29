"""
Tests for brand voice endpoints.

Strategy:
- Override `get_db` with an in-memory SQLite async session (aiosqlite)
- Override `get_current_user` with a fake user
- Test CRUD, source ingestion, prompt generation, and set-default
"""
import uuid
from datetime import datetime
from unittest.mock import AsyncMock, patch

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
    email="test@fennex.ai",
    hashed_password="hashed",
    full_name="Test User",
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
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def db_session():
    """Direct DB session for setting up test data."""
    async with TestSessionLocal() as session:
        yield session


@pytest.fixture
async def org(db_session):
    """Create an org in the test DB."""
    org = Organization(id=FAKE_ORG_ID, slug="test-org", name="Test Org")
    db_session.add(org)
    await db_session.commit()
    return org


@pytest.fixture
async def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    with patch("app.api.v1.routers.brand_voice.increment_usage", new=AsyncMock()):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac
    app.dependency_overrides.clear()


# ── Endpoint Tests ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_brand_voice_first_is_default(client, org):
    """POST /brand-voice creates a voice; first voice gets is_default=True."""
    response = await client.post(
        "/api/v1/brand-voice",
        json={"name": "Corporate Voice", "tone": "professional"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Corporate Voice"
    assert data["tone"] == "professional"
    assert data["is_default"] is True
    assert data["org_id"] == str(FAKE_ORG_ID)
    assert "id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_create_second_brand_voice_not_default(client, org):
    """POST /brand-voice — second voice does not get is_default."""
    await client.post("/api/v1/brand-voice", json={"name": "First Voice"})
    response = await client.post("/api/v1/brand-voice", json={"name": "Second Voice"})
    assert response.status_code == 201
    data = response.json()
    assert data["is_default"] is False


@pytest.mark.asyncio
async def test_list_brand_voices(client, org):
    """GET /brand-voice returns all voices for the org."""
    await client.post("/api/v1/brand-voice", json={"name": "Voice A"})
    await client.post("/api/v1/brand-voice", json={"name": "Voice B"})

    response = await client.get("/api/v1/brand-voice")
    assert response.status_code == 200
    voices = response.json()
    assert len(voices) == 2
    names = {v["name"] for v in voices}
    assert names == {"Voice A", "Voice B"}


@pytest.mark.asyncio
async def test_patch_brand_voice_tone(client, org):
    """PATCH /brand-voice/{id} updates tone."""
    create_resp = await client.post(
        "/api/v1/brand-voice",
        json={"name": "My Voice", "tone": "professional"},
    )
    voice_id = create_resp.json()["id"]

    patch_resp = await client.patch(
        f"/api/v1/brand-voice/{voice_id}",
        json={"tone": "conversational"},
    )
    assert patch_resp.status_code == 200
    updated = patch_resp.json()
    assert updated["tone"] == "conversational"
    assert updated["name"] == "My Voice"  # unchanged


@pytest.mark.asyncio
async def test_add_text_source(client, org):
    """POST /brand-voice/{id}/sources with type='text' adds a source."""
    create_resp = await client.post("/api/v1/brand-voice", json={"name": "My Voice"})
    voice_id = create_resp.json()["id"]

    source_resp = await client.post(
        f"/api/v1/brand-voice/{voice_id}/sources",
        json={"source_type": "text", "content": "We build great products for everyone."},
    )
    assert source_resp.status_code == 201
    source = source_resp.json()
    assert source["source_type"] == "text"
    assert source["content"] == "We build great products for everyone."
    assert source["extracted_text"] == "We build great products for everyone."
    assert source["brand_voice_id"] == voice_id


@pytest.mark.asyncio
async def test_generate_voice_prompt(client, org):
    """POST /brand-voice/{id}/generate-prompt generates a voice_prompt string."""
    create_resp = await client.post(
        "/api/v1/brand-voice",
        json={
            "name": "Tech Voice",
            "tone": "technical",
            "description": "Clear and precise technical writing",
            "vocabulary": ["leverage", "optimize", "scalable"],
            "avoid_words": ["very", "really", "just"],
        },
    )
    voice_id = create_resp.json()["id"]

    # Add a text source to include in the prompt
    await client.post(
        f"/api/v1/brand-voice/{voice_id}/sources",
        json={"source_type": "text", "content": "Our platform scales effortlessly."},
    )

    gen_resp = await client.post(f"/api/v1/brand-voice/{voice_id}/generate-prompt")
    assert gen_resp.status_code == 200
    data = gen_resp.json()
    assert data["voice_id"] == voice_id
    assert "technical" in data["voice_prompt"]
    assert "leverage" in data["voice_prompt"]
    assert "very" in data["voice_prompt"]
    assert "scales effortlessly" in data["voice_prompt"]

    # Verify the voice_prompt was persisted
    get_resp = await client.get(f"/api/v1/brand-voice/{voice_id}")
    assert get_resp.json()["voice_prompt"] is not None


@pytest.mark.asyncio
async def test_set_default_brand_voice(client, org):
    """POST /brand-voice/{id}/set-default updates the default voice."""
    first_resp = await client.post("/api/v1/brand-voice", json={"name": "First"})
    first_id = first_resp.json()["id"]
    assert first_resp.json()["is_default"] is True

    second_resp = await client.post("/api/v1/brand-voice", json={"name": "Second"})
    second_id = second_resp.json()["id"]
    assert second_resp.json()["is_default"] is False

    # Set second as default
    set_resp = await client.post(f"/api/v1/brand-voice/{second_id}/set-default")
    assert set_resp.status_code == 200
    assert set_resp.json()["is_default"] is True

    # Verify first is no longer default
    first_get = await client.get(f"/api/v1/brand-voice/{first_id}")
    assert first_get.json()["is_default"] is False


@pytest.mark.asyncio
async def test_delete_brand_voice(client, org):
    """DELETE /brand-voice/{id} removes the voice."""
    create_resp = await client.post("/api/v1/brand-voice", json={"name": "Temp Voice"})
    voice_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/v1/brand-voice/{voice_id}")
    assert del_resp.status_code == 204

    get_resp = await client.get(f"/api/v1/brand-voice/{voice_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_get_brand_voice_not_found(client, org):
    """GET /brand-voice/{id} returns 404 for unknown voice."""
    response = await client.get(f"/api/v1/brand-voice/{uuid.uuid4()}")
    assert response.status_code == 404
