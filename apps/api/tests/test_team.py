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
OWNER_ID = uuid.uuid4()
fake_owner = User(
    id=OWNER_ID, org_id=FAKE_ORG_ID,
    email="owner@test.com", hashed_password="x",
    full_name="Owner", role=UserRole.OWNER, is_active=True,
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
    return fake_owner

@pytest.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with TestSession() as session:
        org = Organization(id=FAKE_ORG_ID, slug="test-org", name="Test Org")
        session.add_all([org, fake_owner])
        await session.commit()
    yield
    app.dependency_overrides.clear()
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.mark.asyncio
async def test_list_members():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/api/v1/organizations/{FAKE_ORG_ID}/members", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["email"] == "owner@test.com"

@pytest.mark.asyncio
async def test_invite_member():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            f"/api/v1/organizations/{FAKE_ORG_ID}/invites",
            json={"email": "new@test.com", "role": "editor"},
            headers={"Authorization": "Bearer token"},
        )
    assert r.status_code == 201
    body = r.json()
    assert body["email"] == "new@test.com"
    assert "invite_link" in body

@pytest.mark.asyncio
async def test_update_member_role():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # add a second member
        member = User(
            id=uuid.uuid4(), org_id=FAKE_ORG_ID,
            email="member@test.com", hashed_password="x",
            full_name="Member", role=UserRole.VIEWER, is_active=True,
        )
        async with TestSession() as session:
            session.add(member)
            await session.commit()
        r = await client.patch(
            f"/api/v1/organizations/{FAKE_ORG_ID}/members/{member.id}",
            json={"role": "editor"},
            headers={"Authorization": "Bearer token"},
        )
    assert r.status_code == 200
    assert r.json()["role"] == "editor"
