import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.organization import Organization
from app.models.user import User, UserRole

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSession = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

FAKE_ORG_ID = uuid.uuid4()
fake_user = User(
    id=uuid.uuid4(), org_id=FAKE_ORG_ID,
    email="admin@test.com", hashed_password="x",
    full_name="Admin", role=UserRole.ADMIN, is_active=True,
)

async def override_get_db():
    async with TestSession() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise

async def override_get_current_user():
    return fake_user

@pytest.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with TestSession() as session:
        org = Organization(id=FAKE_ORG_ID, slug="test-org", name="Test Org")
        session.add(org)
        await session.commit()
    yield
    app.dependency_overrides.clear()
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.mark.asyncio
async def test_list_empty():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/social/connections", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    assert r.json() == []

@pytest.mark.asyncio
async def test_upsert_and_list():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.put(
            "/api/v1/social/connections/linkedin",
            json={"handle": "@mypage", "token": "my-secret-token"},
            headers={"Authorization": "Bearer token"},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["platform"] == "linkedin"
    assert body["handle"] == "@mypage"
    assert "token" not in body  # raw token never returned

@pytest.mark.asyncio
async def test_delete():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.put(
            "/api/v1/social/connections/twitter",
            json={"handle": "@acme", "token": "tok123"},
            headers={"Authorization": "Bearer token"},
        )
        r = await client.delete("/api/v1/social/connections/twitter", headers={"Authorization": "Bearer token"})
    assert r.status_code == 204
