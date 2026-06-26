"""
Tests for social media studio endpoints.

Strategy:
- Override `get_db` with an in-memory SQLite async session (aiosqlite)
- Override `get_current_user` with a fake user
- Test CRUD, generation, schedule, publish, and delete endpoints
"""
import uuid
from datetime import datetime

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.article import Article, ArticleStatus
from app.models.organization import Organization
from app.models.project import Project
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
async def article(db_session, org_and_project):
    """Create a test article."""
    art = Article(
        id=uuid.uuid4(),
        org_id=FAKE_ORG_ID,
        project_id=FAKE_PROJECT_ID,
        title="The Ultimate SEO Guide",
        target_keyword="seo guide",
        status=ArticleStatus.ready,
        body_markdown="# SEO Guide\n\nContent here.",
    )
    db_session.add(art)
    await db_session.commit()
    return art


@pytest.fixture
async def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ── Endpoint Tests ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_social_post_draft(client, org_and_project):
    """POST /social creates a draft post with correct char_count."""
    content = "Check out our latest SEO guide for 2024."
    response = await client.post(
        "/api/v1/social",
        json={
            "project_id": str(FAKE_PROJECT_ID),
            "platform": "linkedin",
            "content": content,
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["platform"] == "linkedin"
    assert data["status"] == "draft"
    assert data["content"] == content
    assert data["char_count"] == len(content)
    assert data["project_id"] == str(FAKE_PROJECT_ID)
    assert "id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_list_social_posts(client, org_and_project):
    """GET /social?project_id=... lists posts."""
    # Create two posts
    for platform in ["linkedin", "twitter"]:
        await client.post(
            "/api/v1/social",
            json={
                "project_id": str(FAKE_PROJECT_ID),
                "platform": platform,
                "content": f"Post for {platform}",
            },
        )

    response = await client.get(f"/api/v1/social?project_id={FAKE_PROJECT_ID}")
    assert response.status_code == 200
    posts = response.json()
    assert len(posts) == 2
    platforms = {p["platform"] for p in posts}
    assert platforms == {"linkedin", "twitter"}


@pytest.mark.asyncio
async def test_list_social_posts_filter_by_platform(client, org_and_project):
    """GET /social?project_id=...&platform=linkedin filters by platform."""
    for platform in ["linkedin", "twitter", "linkedin"]:
        await client.post(
            "/api/v1/social",
            json={
                "project_id": str(FAKE_PROJECT_ID),
                "platform": platform,
                "content": f"Post for {platform}",
            },
        )

    response = await client.get(
        f"/api/v1/social?project_id={FAKE_PROJECT_ID}&platform=linkedin"
    )
    assert response.status_code == 200
    posts = response.json()
    assert len(posts) == 2
    assert all(p["platform"] == "linkedin" for p in posts)


@pytest.mark.asyncio
async def test_generate_post_with_article(client, org_and_project, article):
    """POST /social/generate with article_id generates platform-specific content."""
    response = await client.post(
        "/api/v1/social/generate",
        json={
            "project_id": str(FAKE_PROJECT_ID),
            "platform": "linkedin",
            "article_id": str(article.id),
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["platform"] == "linkedin"
    assert data["status"] == "draft"
    assert data["article_id"] == str(article.id)
    assert data["content"] is not None
    assert len(data["content"]) > 0
    assert data["char_count"] == len(data["content"])
    # LinkedIn content should reference keyword or title
    assert "seo guide" in data["content"].lower() or "The Ultimate SEO Guide" in data["content"]


@pytest.mark.asyncio
async def test_generate_post_without_article(client, org_and_project):
    """POST /social/generate without article_id generates generic content."""
    response = await client.post(
        "/api/v1/social/generate",
        json={
            "project_id": str(FAKE_PROJECT_ID),
            "platform": "twitter",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["platform"] == "twitter"
    assert data["status"] == "draft"
    assert data["article_id"] is None
    assert data["content"] is not None
    assert len(data["content"]) > 0
    # Twitter content should be under 280 chars
    assert data["char_count"] <= 280


@pytest.mark.asyncio
async def test_update_social_post_recalculates_char_count(client, org_and_project):
    """PATCH /social/{id} updates content and recalculates char_count."""
    create_resp = await client.post(
        "/api/v1/social",
        json={
            "project_id": str(FAKE_PROJECT_ID),
            "platform": "facebook",
            "content": "Short content.",
        },
    )
    assert create_resp.status_code == 201
    post_id = create_resp.json()["id"]

    new_content = "This is a much longer updated content for our social post test."
    patch_resp = await client.patch(
        f"/api/v1/social/{post_id}",
        json={"content": new_content},
    )
    assert patch_resp.status_code == 200
    data = patch_resp.json()
    assert data["content"] == new_content
    assert data["char_count"] == len(new_content)


@pytest.mark.asyncio
async def test_schedule_post(client, org_and_project):
    """POST /social/{id}/schedule sets scheduled_at and status=scheduled."""
    create_resp = await client.post(
        "/api/v1/social",
        json={
            "project_id": str(FAKE_PROJECT_ID),
            "platform": "instagram",
            "content": "Awesome content for Instagram.",
        },
    )
    assert create_resp.status_code == 201
    post_id = create_resp.json()["id"]

    scheduled_time = "2026-07-01T10:00:00Z"
    sched_resp = await client.post(
        f"/api/v1/social/{post_id}/schedule",
        json={"scheduled_at": scheduled_time},
    )
    assert sched_resp.status_code == 200
    data = sched_resp.json()
    assert data["status"] == "scheduled"
    assert data["scheduled_at"] == scheduled_time


@pytest.mark.asyncio
async def test_publish_post(client, org_and_project):
    """POST /social/{id}/publish sets status=published."""
    create_resp = await client.post(
        "/api/v1/social",
        json={
            "project_id": str(FAKE_PROJECT_ID),
            "platform": "linkedin",
            "content": "Publishing this now.",
        },
    )
    assert create_resp.status_code == 201
    post_id = create_resp.json()["id"]

    pub_resp = await client.post(f"/api/v1/social/{post_id}/publish")
    assert pub_resp.status_code == 200
    data = pub_resp.json()
    assert data["status"] == "published"
    assert data["published_at"] is not None


@pytest.mark.asyncio
async def test_delete_social_post(client, org_and_project):
    """DELETE /social/{id} returns 204."""
    create_resp = await client.post(
        "/api/v1/social",
        json={
            "project_id": str(FAKE_PROJECT_ID),
            "platform": "twitter",
            "content": "To be deleted.",
        },
    )
    assert create_resp.status_code == 201
    post_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/v1/social/{post_id}")
    assert del_resp.status_code == 204

    # Verify it's gone
    get_resp = await client.get(f"/api/v1/social/{post_id}")
    assert get_resp.status_code == 404
