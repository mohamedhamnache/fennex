"""
Tests for content plan endpoints.

Strategy:
- Override `get_db` with an in-memory SQLite async session (aiosqlite)
- Override `get_current_user` with a fake user
- Test CRUD endpoints and AI plan generation fallback
"""
import uuid
from datetime import datetime

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.organization import Organization
from app.models.project import Project
from app.models.user import User, UserRole
from app.models.content import ContentPlan, ContentItem, ContentItemStatus, ContentItemType
from app.models.keyword import KeywordResearchJob, Keyword, ResearchStatus, KeywordIntent

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
FAKE_PROJECT_ID = uuid.uuid4()

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
async def org_and_project(db_session):
    """Create an org and project in the test DB."""
    org = Organization(id=FAKE_ORG_ID, slug="test-org", name="Test Org")
    db_session.add(org)
    await db_session.flush()

    project = Project(
        id=FAKE_PROJECT_ID,
        org_id=FAKE_ORG_ID,
        name="Test Project",
        domain="example.com",
    )
    db_session.add(project)
    await db_session.commit()
    return org, project


@pytest.fixture
async def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ── Endpoint Tests ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_content_plan(client, org_and_project):
    """POST /content-plans creates a plan."""
    response = await client.post(
        "/api/v1/content-plans",
        json={"project_id": str(FAKE_PROJECT_ID), "name": "My SEO Plan"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "My SEO Plan"
    assert data["project_id"] == str(FAKE_PROJECT_ID)
    assert data["items"] == []
    assert "id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_create_content_plan_project_not_found(client, org_and_project):
    """POST /content-plans returns 404 when project not in org."""
    response = await client.post(
        "/api/v1/content-plans",
        json={"project_id": str(uuid.uuid4())},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_add_content_item(client, org_and_project):
    """POST /content-plans/{id}/items adds an item to the plan."""
    # First create a plan
    create_resp = await client.post(
        "/api/v1/content-plans",
        json={"project_id": str(FAKE_PROJECT_ID)},
    )
    assert create_resp.status_code == 201
    plan_id = create_resp.json()["id"]

    # Add an item
    item_resp = await client.post(
        f"/api/v1/content-plans/{plan_id}/items",
        json={
            "title": "Best SEO Tools for 2025",
            "content_type": "article",
            "status": "idea",
            "target_keyword": "seo tools",
            "word_count_target": 2000,
        },
    )
    assert item_resp.status_code == 201
    item = item_resp.json()
    assert item["title"] == "Best SEO Tools for 2025"
    assert item["content_type"] == "article"
    assert item["status"] == "idea"
    assert item["target_keyword"] == "seo tools"
    assert item["word_count_target"] == 2000
    assert item["plan_id"] == plan_id


@pytest.mark.asyncio
async def test_update_content_item_status(client, org_and_project):
    """PATCH /content-plans/{id}/items/{item_id} updates item status."""
    # Create plan
    plan_resp = await client.post(
        "/api/v1/content-plans",
        json={"project_id": str(FAKE_PROJECT_ID)},
    )
    plan_id = plan_resp.json()["id"]

    # Add item
    item_resp = await client.post(
        f"/api/v1/content-plans/{plan_id}/items",
        json={"title": "Draft Article", "status": "idea"},
    )
    item_id = item_resp.json()["id"]

    # Update status
    patch_resp = await client.patch(
        f"/api/v1/content-plans/{plan_id}/items/{item_id}",
        json={"status": "draft"},
    )
    assert patch_resp.status_code == 200
    updated = patch_resp.json()
    assert updated["status"] == "draft"
    assert updated["title"] == "Draft Article"  # unchanged


@pytest.mark.asyncio
async def test_delete_content_item(client, org_and_project):
    """DELETE /content-plans/{id}/items/{item_id} removes the item."""
    # Create plan
    plan_resp = await client.post(
        "/api/v1/content-plans",
        json={"project_id": str(FAKE_PROJECT_ID)},
    )
    plan_id = plan_resp.json()["id"]

    # Add item
    item_resp = await client.post(
        f"/api/v1/content-plans/{plan_id}/items",
        json={"title": "Item to Delete"},
    )
    item_id = item_resp.json()["id"]

    # Delete item
    delete_resp = await client.delete(f"/api/v1/content-plans/{plan_id}/items/{item_id}")
    assert delete_resp.status_code == 204

    # Verify item is gone (GET the plan and check items)
    get_resp = await client.get(f"/api/v1/content-plans/{plan_id}")
    assert get_resp.status_code == 200
    plan_data = get_resp.json()
    assert len(plan_data["items"]) == 0


@pytest.mark.asyncio
async def test_generate_plan_with_seed_keyword_fallback(client, org_and_project):
    """POST /content-plans/{id}/generate with seed_keyword (no keyword job) creates 5 items."""
    # Create plan
    plan_resp = await client.post(
        "/api/v1/content-plans",
        json={"project_id": str(FAKE_PROJECT_ID)},
    )
    plan_id = plan_resp.json()["id"]

    # Generate plan with seed keyword (no keyword research job exists)
    gen_resp = await client.post(
        f"/api/v1/content-plans/{plan_id}/generate",
        json={"seed_keyword": "content marketing"},
    )
    assert gen_resp.status_code == 202
    data = gen_resp.json()
    assert data["plan_id"] == plan_id
    assert data["items_added"] == 5

    # Verify the items were actually created
    get_resp = await client.get(f"/api/v1/content-plans/{plan_id}")
    plan_data = get_resp.json()
    assert len(plan_data["items"]) == 5
    # Verify items reference the seed keyword
    for item in plan_data["items"]:
        assert item["target_keyword"] == "content marketing"
        assert item["status"] == "idea"
        assert item["content_type"] == "article"
        assert item["scheduled_date"] is not None


@pytest.mark.asyncio
async def test_generate_plan_with_keyword_job(client, org_and_project, db_session):
    """POST /content-plans/{id}/generate uses keywords from completed research job."""
    # Create a completed keyword research job with keywords
    job = KeywordResearchJob(
        org_id=FAKE_ORG_ID,
        project_id=FAKE_PROJECT_ID,
        seed_keyword="seo",
        status=ResearchStatus.completed,
        keywords_found=3,
    )
    db_session.add(job)
    await db_session.flush()

    # Add 3 keywords
    for i, (kw, intent) in enumerate([
        ("seo guide", KeywordIntent.informational),
        ("best seo tools", KeywordIntent.commercial),
        ("seo", KeywordIntent.navigational),
    ]):
        db_session.add(Keyword(
            job_id=job.id,
            org_id=FAKE_ORG_ID,
            project_id=FAKE_PROJECT_ID,
            keyword=kw,
            search_volume=1000 - i * 100,
            difficulty=0.5,
            cpc=1.0,
            intent=intent,
            is_seed=(i == 0),
        ))
    await db_session.commit()

    # Create plan
    plan_resp = await client.post(
        "/api/v1/content-plans",
        json={"project_id": str(FAKE_PROJECT_ID)},
    )
    plan_id = plan_resp.json()["id"]

    # Generate plan
    gen_resp = await client.post(
        f"/api/v1/content-plans/{plan_id}/generate",
        json={},
    )
    assert gen_resp.status_code == 202
    data = gen_resp.json()
    assert data["items_added"] == 3

    # Verify items
    get_resp = await client.get(f"/api/v1/content-plans/{plan_id}")
    plan_data = get_resp.json()
    assert len(plan_data["items"]) == 3

    # Check that titles were generated based on intent
    titles = {item["target_keyword"]: item["title"] for item in plan_data["items"]}
    assert "Complete Guide" in titles["seo guide"]  # informational
    assert titles["best seo tools"].startswith("Best ")  # commercial
    assert titles["seo"].startswith("How to ")  # navigational


@pytest.mark.asyncio
async def test_list_content_plans(client, org_and_project):
    """GET /content-plans?project_id=... returns all plans for project."""
    # Create two plans
    await client.post("/api/v1/content-plans", json={"project_id": str(FAKE_PROJECT_ID), "name": "Plan A"})
    await client.post("/api/v1/content-plans", json={"project_id": str(FAKE_PROJECT_ID), "name": "Plan B"})

    response = await client.get(f"/api/v1/content-plans?project_id={FAKE_PROJECT_ID}")
    assert response.status_code == 200
    plans = response.json()
    assert len(plans) == 2
    names = {p["name"] for p in plans}
    assert names == {"Plan A", "Plan B"}


@pytest.mark.asyncio
async def test_get_content_plan_not_found(client, org_and_project):
    """GET /content-plans/{id} returns 404 for unknown plan."""
    response = await client.get(f"/api/v1/content-plans/{uuid.uuid4()}")
    assert response.status_code == 404
