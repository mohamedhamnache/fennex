"""Tests for user language preference endpoint."""
import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app as fastapi_app
from app.models.organization import Organization, PlanTier
from app.models.user import User, UserRole

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

FAKE_ORG_ID = uuid.uuid4()
FAKE_USER_ID = uuid.uuid4()


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
        hashed_password="x", full_name="Test User", role=UserRole.OWNER,
        is_active=True, language="en",
    )


@pytest.fixture(autouse=True)
async def setup_db():
    tables = [Base.metadata.tables[n] for n in ("organizations", "users") if n in Base.metadata.tables]
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=tables)
    async with TestSessionLocal() as session:
        session.add(Organization(id=FAKE_ORG_ID, slug="test", name="Test Org", plan_tier=PlanTier.FREE))
        session.add(User(
            id=FAKE_USER_ID, org_id=FAKE_ORG_ID, email="test@test.com",
            hashed_password="x", full_name="Test User", role=UserRole.OWNER,
            is_active=True, language="en",
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


async def test_get_me_includes_language(client):
    """GET /users/me returns language field."""
    resp = await client.get("/api/v1/users/me", headers={"Authorization": "Bearer fake"})
    assert resp.status_code == 200
    assert resp.json()["language"] == "en"


async def test_patch_language_valid(client):
    """PATCH /users/me/language with supported locale returns updated language."""
    resp = await client.patch(
        "/api/v1/users/me/language",
        json={"language": "fr"},
        headers={"Authorization": "Bearer fake"},
    )
    assert resp.status_code == 200
    assert resp.json()["language"] == "fr"


async def test_patch_language_invalid(client):
    """PATCH /users/me/language with unsupported locale returns 400."""
    resp = await client.patch(
        "/api/v1/users/me/language",
        json={"language": "zh"},
        headers={"Authorization": "Bearer fake"},
    )
    assert resp.status_code == 400
    assert "not supported" in resp.json()["detail"].lower()
