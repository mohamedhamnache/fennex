"""
Tests for Project CRUD, Crawl, and Audit endpoints.

Strategy:
- Override `get_db` with an in-memory SQLite async session (aiosqlite)
- Override `get_current_user` with a fake user
- Mock arq.create_pool so no real Redis is needed
"""
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app
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
async def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ── Mock ARQ pool ─────────────────────────────────────────────────────────────

def make_mock_pool():
    pool = AsyncMock()
    pool.enqueue_job = AsyncMock(return_value=MagicMock())
    pool.aclose = AsyncMock()
    return pool


# ── Project Tests ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_project(client):
    response = await client.post(
        "/api/v1/projects",
        json={"name": "My Site", "domain": "mysite.com", "locale": "en"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "My Site"
    assert data["domain"] == "mysite.com"
    assert data["org_id"] == str(FAKE_ORG_ID)


@pytest.mark.asyncio
async def test_list_projects(client):
    # Create two projects first
    await client.post(
        "/api/v1/projects",
        json={"name": "Site A", "domain": "a.com"},
    )
    await client.post(
        "/api/v1/projects",
        json={"name": "Site B", "domain": "b.com"},
    )

    response = await client.get("/api/v1/projects")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    domains = {p["domain"] for p in data}
    assert domains == {"a.com", "b.com"}


@pytest.mark.asyncio
async def test_get_project(client):
    create_resp = await client.post(
        "/api/v1/projects",
        json={"name": "Detail Site", "domain": "detail.com"},
    )
    project_id = create_resp.json()["id"]

    response = await client.get(f"/api/v1/projects/{project_id}")
    assert response.status_code == 200
    assert response.json()["id"] == project_id


@pytest.mark.asyncio
async def test_get_project_not_found(client):
    response = await client.get(f"/api/v1/projects/{uuid.uuid4()}")
    assert response.status_code == 404


# ── Crawl Tests ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_trigger_crawl(client):
    # First create a project
    create_resp = await client.post(
        "/api/v1/projects",
        json={"name": "Crawl Site", "domain": "crawl.com"},
    )
    project_id = create_resp.json()["id"]

    mock_pool = make_mock_pool()
    with patch("app.api.v1.routers.crawl.arq.create_pool", return_value=mock_pool):
        response = await client.post(
            "/api/v1/crawl",
            json={"project_id": project_id, "url": "https://crawl.com"},
        )

    assert response.status_code == 202
    data = response.json()
    assert "job_id" in data
    assert data["status"] == "pending"
    mock_pool.enqueue_job.assert_awaited_once()


# ── Audit Tests ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_trigger_audit(client):
    # First create a project
    create_resp = await client.post(
        "/api/v1/projects",
        json={"name": "Audit Site", "domain": "audit.com"},
    )
    project_id = create_resp.json()["id"]

    mock_pool = make_mock_pool()
    with patch("app.api.v1.routers.audit.arq.create_pool", return_value=mock_pool):
        response = await client.post(
            "/api/v1/audit",
            json={"project_id": project_id},
        )

    assert response.status_code == 202
    data = response.json()
    assert "audit_id" in data
    assert data["status"] == "pending"
    mock_pool.enqueue_job.assert_awaited_once()
