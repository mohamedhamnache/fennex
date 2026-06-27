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

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
engine = create_async_engine(TEST_DATABASE_URL, echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

ORG_ID = uuid.uuid4()
PROJ_ID = uuid.uuid4()
OTHER_PROJ_ID = uuid.uuid4()

fake_user = User(
    id=uuid.uuid4(), org_id=ORG_ID, email="t@t.com",
    hashed_password="x", full_name="T", role=UserRole.OWNER, is_active=True,
)

async def override_get_db():
    async with Session() as s:
        try:
            yield s
            await s.commit()
        except Exception:
            await s.rollback()
            raise

async def override_get_current_user():
    return fake_user

@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with Session() as s:
        s.add_all([
            Organization(id=ORG_ID, slug="org", name="Org"),
            Project(id=PROJ_ID, org_id=ORG_ID, name="P", domain="p.com", locale="en"),
            Project(id=OTHER_PROJ_ID, org_id=ORG_ID, name="Q", domain="q.com", locale="en"),
        ])
        await s.commit()
    yield
    app.dependency_overrides.clear()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.mark.asyncio
async def test_board_empty():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get(f"/api/v1/backlinks/exchange/board?project_id={PROJ_ID}", headers={"Authorization": "Bearer x"})
    assert r.status_code == 200
    assert r.json() == []

@pytest.mark.asyncio
async def test_create_and_get_listing():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(
            f"/api/v1/backlinks/exchange/listing?project_id={PROJ_ID}",
            json={"site_url": "https://p.com", "niche": "tech"},
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 201
        r2 = await c.get(f"/api/v1/backlinks/exchange/listing?project_id={PROJ_ID}", headers={"Authorization": "Bearer x"})
        assert r2.status_code == 200
        assert r2.json()["site_url"] == "https://p.com"

@pytest.mark.asyncio
async def test_requests_empty():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get(f"/api/v1/backlinks/exchange/requests?project_id={PROJ_ID}", headers={"Authorization": "Bearer x"})
    assert r.status_code == 200
    assert r.json() == []
