"""
Tests for publishing endpoints.

Strategy:
- Override `get_db` with an in-memory SQLite async session (aiosqlite)
- Override `get_current_user` with a fake user
- Mock WordPressConnector methods for test/publish calls
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
async def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ── Helper ────────────────────────────────────────────────────────────────────

async def create_connection(client, project_id=None):
    """Helper: create a publishing connection and return the response data."""
    return await client.post(
        "/api/v1/publishing/connections",
        json={
            "project_id": str(project_id or FAKE_PROJECT_ID),
            "name": "My WP Site",
            "platform": "wordpress",
            "site_url": "https://example.com",
            "credentials": {"username": "admin", "app_password": "xxxx xxxx xxxx xxxx"},
        },
    )


async def create_ready_article(db_session, org_id, project_id):
    """Helper: create an article in ready status."""
    article = Article(
        org_id=org_id,
        project_id=project_id,
        title="SEO Article",
        tone="professional",
        status=ArticleStatus.ready,
        body_html="<p>Hello world</p>",
        body_markdown="Hello world",
        word_count=2,
    )
    db_session.add(article)
    await db_session.commit()
    await db_session.refresh(article)
    return article


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_connection_encrypts_credentials(client, org_and_project, db_session):
    """POST /publishing/connections creates a connection; credentials must be encrypted at rest."""
    resp = await create_connection(client)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "My WP Site"
    assert data["platform"] == "wordpress"
    assert data["site_url"] == "https://example.com"
    assert data["is_active"] is True
    assert "credentials" not in data  # credentials NOT returned

    # Verify the stored value is not the raw password
    from app.models.publishing import PublishingConnection
    from sqlalchemy import select
    result = await db_session.execute(
        select(PublishingConnection).where(PublishingConnection.id == uuid.UUID(data["id"]))
    )
    conn_row = result.scalar_one()
    assert conn_row.credentials_encrypted is not None
    assert "xxxx xxxx xxxx xxxx" not in conn_row.credentials_encrypted


@pytest.mark.asyncio
async def test_list_connections(client, org_and_project):
    """GET /publishing/connections?project_id=... returns connections for the project."""
    await create_connection(client)
    await create_connection(client)

    resp = await client.get(f"/api/v1/publishing/connections?project_id={FAKE_PROJECT_ID}")
    assert resp.status_code == 200
    connections = resp.json()
    assert isinstance(connections, list)
    assert len(connections) == 2


@pytest.mark.asyncio
async def test_update_connection_name(client, org_and_project):
    """PATCH /publishing/connections/{id} updates the connection name."""
    create_resp = await create_connection(client)
    conn_id = create_resp.json()["id"]

    patch_resp = await client.patch(
        f"/api/v1/publishing/connections/{conn_id}",
        json={"name": "Updated Name"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["name"] == "Updated Name"


@pytest.mark.asyncio
async def test_delete_connection(client, org_and_project):
    """DELETE /publishing/connections/{id} returns 204."""
    create_resp = await create_connection(client)
    conn_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/v1/publishing/connections/{conn_id}")
    assert del_resp.status_code == 204

    # Confirm it's gone
    get_resp = await client.get(f"/api/v1/publishing/connections/{conn_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_test_connection_sets_last_test_ok(client, org_and_project):
    """POST /publishing/connections/{id}/test calls WP and persists last_test_ok=True."""
    create_resp = await create_connection(client)
    conn_id = create_resp.json()["id"]

    with patch(
        "app.api.v1.routers.publishing.WordPressConnector.test_connection",
        new_callable=AsyncMock,
        return_value={"ok": True, "user": "admin"},
    ):
        test_resp = await client.post(f"/api/v1/publishing/connections/{conn_id}/test")

    assert test_resp.status_code == 200
    result = test_resp.json()
    assert result["ok"] is True
    assert result["user"] == "admin"

    # Verify persisted
    get_resp = await client.get(f"/api/v1/publishing/connections/{conn_id}")
    assert get_resp.json()["last_test_ok"] is True
    assert get_resp.json()["last_tested_at"] is not None


@pytest.mark.asyncio
async def test_publish_article_success(client, org_and_project, db_session):
    """POST /publishing/publish publishes article, job status=done, article status=published."""
    article = await create_ready_article(db_session, FAKE_ORG_ID, FAKE_PROJECT_ID)
    create_resp = await create_connection(client)
    conn_id = create_resp.json()["id"]

    with patch(
        "app.api.v1.routers.publishing.WordPressConnector.publish_post",
        new_callable=AsyncMock,
        return_value={
            "ok": True,
            "post_id": 42,
            "url": "https://example.com/?p=42",
            "raw": {"id": 42, "link": "https://example.com/?p=42"},
        },
    ):
        pub_resp = await client.post(
            "/api/v1/publishing/publish",
            json={
                "article_id": str(article.id),
                "connection_id": conn_id,
                "publish_status": "publish",
            },
        )

    assert pub_resp.status_code == 200
    job_data = pub_resp.json()
    assert job_data["status"] == "done"
    assert job_data["platform_post_id"] == "42"
    assert job_data["published_url"] == "https://example.com/?p=42"
    assert job_data["error"] is None

    # Verify article status updated to published
    from app.models.article import Article as ArticleModel
    from sqlalchemy import select
    await db_session.refresh(article)
    result = await db_session.execute(
        select(ArticleModel).where(ArticleModel.id == article.id)
    )
    updated_article = result.scalar_one()
    assert updated_article.status == ArticleStatus.published


@pytest.mark.asyncio
async def test_publish_article_draft_status_rejected(client, org_and_project, db_session):
    """POST /publishing/publish with article in draft state returns 400."""
    # Create a draft article
    article = Article(
        org_id=FAKE_ORG_ID,
        project_id=FAKE_PROJECT_ID,
        title="Draft Article",
        tone="professional",
        status=ArticleStatus.draft,
        body_html="<p>Draft</p>",
        body_markdown="Draft",
        word_count=1,
    )
    db_session.add(article)
    await db_session.commit()
    await db_session.refresh(article)

    create_resp = await create_connection(client)
    conn_id = create_resp.json()["id"]

    pub_resp = await client.post(
        "/api/v1/publishing/publish",
        json={
            "article_id": str(article.id),
            "connection_id": conn_id,
            "publish_status": "publish",
        },
    )

    assert pub_resp.status_code == 400
    assert "ready" in pub_resp.json()["detail"].lower() or "draft" in pub_resp.json()["detail"].lower()
