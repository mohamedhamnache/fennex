"""
Tests for article endpoints.

Strategy:
- Override `get_db` with an in-memory SQLite async session (aiosqlite)
- Override `get_current_user` with a fake user
- Test CRUD endpoints, generation, SEO scoring, and revisions
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
async def test_create_article_draft(client, org_and_project):
    """POST /articles creates a draft article."""
    response = await client.post(
        "/api/v1/articles",
        json={
            "project_id": str(FAKE_PROJECT_ID),
            "title": "SEO Guide for Beginners",
            "target_keyword": "seo guide",
            "tone": "professional",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "SEO Guide for Beginners"
    assert data["target_keyword"] == "seo guide"
    assert data["status"] == "draft"
    assert data["project_id"] == str(FAKE_PROJECT_ID)
    assert data["body_markdown"] is None
    assert "id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_list_articles(client, org_and_project):
    """GET /articles?project_id=... lists articles for a project."""
    # Create two articles
    for title in ["Article One", "Article Two"]:
        await client.post(
            "/api/v1/articles",
            json={"project_id": str(FAKE_PROJECT_ID), "title": title},
        )

    response = await client.get(f"/api/v1/articles?project_id={FAKE_PROJECT_ID}")
    assert response.status_code == 200
    articles = response.json()
    assert len(articles) == 2
    titles = {a["title"] for a in articles}
    assert titles == {"Article One", "Article Two"}


@pytest.mark.asyncio
async def test_generate_article_enqueues_job(client, org_and_project):
    """POST /articles/{id}/generate sets status=generating and enqueues arq job."""
    from unittest.mock import AsyncMock, patch

    create_resp = await client.post(
        "/api/v1/articles",
        json={
            "project_id": str(FAKE_PROJECT_ID),
            "title": "Content Marketing Strategies",
            "target_keyword": "content marketing",
        },
    )
    assert create_resp.status_code == 201
    article_id = create_resp.json()["id"]

    mock_pool = AsyncMock()
    mock_pool.enqueue_job = AsyncMock()
    mock_pool.aclose = AsyncMock()

    with patch("app.api.v1.routers.articles.arq.create_pool", return_value=mock_pool):
        gen_resp = await client.post(f"/api/v1/articles/{article_id}/generate")

    assert gen_resp.status_code == 200
    data = gen_resp.json()
    assert data["status"] == "generating"
    assert data["body_markdown"] is None
    mock_pool.enqueue_job.assert_awaited_once_with(
        "generate_article_task", article_id, str(FAKE_ORG_ID)
    )


@pytest.mark.asyncio
async def test_seo_score_endpoint(client, org_and_project, db_session):
    """GET /articles/{id}/seo-score returns score with breakdown."""
    from app.models.article import Article, ArticleStatus

    # Create article directly in the ready state (bypasses generate endpoint)
    article = Article(
        org_id=FAKE_ORG_ID,
        project_id=FAKE_PROJECT_ID,
        title="SEO Best Practices Guide",
        target_keyword="seo",
        tone="professional",
        status=ArticleStatus.ready,
        body_markdown="# SEO Best Practices Guide\n\nLearn seo fundamentals.\n\n## Why SEO Matters\n\nSEO drives traffic.",
        body_html="<h1>SEO Best Practices Guide</h1><p>Learn seo fundamentals.</p>",
        word_count=12,
        meta_description="Learn seo best practices.",
        word_count_target=1500,
    )
    db_session.add(article)
    await db_session.commit()

    score_resp = await client.get(f"/api/v1/articles/{article.id}/seo-score")
    assert score_resp.status_code == 200
    data = score_resp.json()
    assert "score" in data
    assert "breakdown" in data
    assert isinstance(data["score"], (int, float))
    assert 0 <= data["score"] <= 100
    expected_keys = {
        "keyword_in_title",
        "keyword_in_first_paragraph",
        "keyword_density",
        "word_count",
        "has_h2_headings",
        "meta_description",
    }
    assert expected_keys.issubset(set(data["breakdown"].keys()))


@pytest.mark.asyncio
async def test_update_article(client, org_and_project):
    """PATCH /articles/{id} updates article title."""
    create_resp = await client.post(
        "/api/v1/articles",
        json={"project_id": str(FAKE_PROJECT_ID), "title": "Original Title"},
    )
    assert create_resp.status_code == 201
    article_id = create_resp.json()["id"]

    patch_resp = await client.patch(
        f"/api/v1/articles/{article_id}",
        json={"title": "Updated Title"},
    )
    assert patch_resp.status_code == 200
    data = patch_resp.json()
    assert data["title"] == "Updated Title"


@pytest.mark.asyncio
async def test_save_revision(client, org_and_project, db_session):
    """POST /articles/{id}/save-revision saves current content as revision."""
    from app.models.article import Article, ArticleStatus

    article = Article(
        org_id=FAKE_ORG_ID,
        project_id=FAKE_PROJECT_ID,
        title="Revision Test Article",
        target_keyword="revision testing",
        tone="professional",
        status=ArticleStatus.ready,
        body_markdown="# Revision Test\n\nContent to revise.",
        body_html="<h1>Revision Test</h1><p>Content to revise.</p>",
        word_count=6,
        word_count_target=1500,
    )
    db_session.add(article)
    await db_session.commit()

    rev_resp = await client.post(
        f"/api/v1/articles/{article.id}/save-revision",
        json={"note": "First manual revision"},
    )
    assert rev_resp.status_code == 200
    data = rev_resp.json()
    assert "revision_id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_delete_article(client, org_and_project):
    """DELETE /articles/{id} removes the article."""
    create_resp = await client.post(
        "/api/v1/articles",
        json={"project_id": str(FAKE_PROJECT_ID), "title": "Article to Delete"},
    )
    article_id = create_resp.json()["id"]

    delete_resp = await client.delete(f"/api/v1/articles/{article_id}")
    assert delete_resp.status_code == 204

    # Verify it's gone
    get_resp = await client.get(f"/api/v1/articles/{article_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_create_article_project_not_found(client, org_and_project):
    """POST /articles returns 404 when project not in org."""
    response = await client.post(
        "/api/v1/articles",
        json={"project_id": str(uuid.uuid4()), "title": "Test"},
    )
    assert response.status_code == 404
