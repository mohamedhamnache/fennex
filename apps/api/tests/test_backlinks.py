import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.organization import Organization
from app.models.project import Project
from app.models.user import User, UserRole
from app.models.backlinks import BacklinkProfile, Backlink, BacklinkOpportunity

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSession = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

FAKE_ORG_ID = uuid.uuid4()
FAKE_PROJECT_ID = uuid.uuid4()
fake_user = User(
    id=uuid.uuid4(), org_id=FAKE_ORG_ID,
    email="test@test.com", hashed_password="x",
    full_name="Test", role=UserRole.OWNER, is_active=True,
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
        project = Project(id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, name="Test", domain="test.com", locale="en")
        session.add_all([org, project])
        await session.commit()
    yield
    app.dependency_overrides.clear()
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.mark.asyncio
async def test_get_profile_empty():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/api/v1/backlinks/profile?project_id={FAKE_PROJECT_ID}", headers={"Authorization": "Bearer token"})
    assert r.status_code == 404

@pytest.mark.asyncio
async def test_list_backlinks_empty():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/api/v1/backlinks?project_id={FAKE_PROJECT_ID}", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    assert r.json() == []

@pytest.mark.asyncio
async def test_list_opportunities_empty():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/api/v1/backlinks/opportunities?project_id={FAKE_PROJECT_ID}", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    assert r.json() == []
