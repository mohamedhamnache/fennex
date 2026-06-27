"""
Tests for image generation endpoints.

Strategy:
- Override `get_db` with an in-memory SQLite async session (aiosqlite)
- Override `get_current_user` with a fake user
- Mock `generate_image_dalle` for tests requiring OpenAI key behaviour
- Test all 8 required scenarios
"""
import uuid
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.core.security import encrypt_api_key
from app.main import app
from app.models.api_key import APIKey
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
        title="The SEO Guide",
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


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_generate_image_no_key_returns_placeholder(client, org_and_project):
    """POST /images/generate with no OpenAI key → returns placeholder URL, status=ready."""
    response = await client.post(
        "/api/v1/images/generate",
        json={
            "project_id": str(FAKE_PROJECT_ID),
            "title": "SEO for Beginners",
            "usage": "article_cover",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert data["image_url"] is not None
    assert "placehold.co" in data["image_url"]
    assert data["project_id"] == str(FAKE_PROJECT_ID)


@pytest.mark.asyncio
async def test_generate_image_custom_prompt_saved(client, org_and_project):
    """POST /images/generate with custom prompt → saves prompt correctly."""
    custom_prompt = "A stunning futuristic cityscape with neon lights"
    response = await client.post(
        "/api/v1/images/generate",
        json={
            "project_id": str(FAKE_PROJECT_ID),
            "prompt": custom_prompt,
            "usage": "article_cover",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["prompt"] == custom_prompt
    assert data["status"] == "ready"


@pytest.mark.asyncio
async def test_generate_image_builds_prompt_from_title_keyword(client, org_and_project):
    """POST /images/generate with title+keyword → auto-builds prompt via build_image_prompt."""
    response = await client.post(
        "/api/v1/images/generate",
        json={
            "project_id": str(FAKE_PROJECT_ID),
            "title": "Content Marketing in 2026",
            "keyword": "content marketing",
            "usage": "article_cover",
            "style": "professional",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    # The prompt should contain the title and keyword
    assert "Content Marketing in 2026" in data["prompt"]
    assert "content marketing" in data["prompt"]


@pytest.mark.asyncio
async def test_generate_image_with_mocked_openai_key(client, org_and_project, db_session):
    """POST /images/generate with mocked OpenAI key → mock generate_image_dalle to return
    success; verify status=ready, image_url set."""
    # Insert an openai api key for the org
    encrypted = encrypt_api_key("sk-test-fake-key")
    api_key = APIKey(
        org_id=FAKE_ORG_ID,
        provider="openai",
        encrypted_value=encrypted,
    )
    db_session.add(api_key)
    await db_session.commit()

    mock_result = {
        "ok": True,
        "image_url": "https://openai-cdn.example.com/image-abc123.png",
        "revised_prompt": "A professional blog cover with SEO theme",
        "width": 1792,
        "height": 1024,
        "cost_usd": 0.08,
    }

    with patch(
        "app.api.v1.routers.images.generate_image_dalle",
        new_callable=AsyncMock,
        return_value=mock_result,
    ):
        response = await client.post(
            "/api/v1/images/generate",
            json={
                "project_id": str(FAKE_PROJECT_ID),
                "title": "SEO Strategies",
                "keyword": "seo",
                "usage": "article_cover",
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert data["image_url"] == "https://openai-cdn.example.com/image-abc123.png"
    assert data["revised_prompt"] == "A professional blog cover with SEO theme"
    assert data["cost_usd"] == 0.08


@pytest.mark.asyncio
async def test_list_images(client, org_and_project):
    """GET /images?project_id=... lists images for the project."""
    # Create two images
    for title in ["Image One", "Image Two"]:
        await client.post(
            "/api/v1/images/generate",
            json={
                "project_id": str(FAKE_PROJECT_ID),
                "title": title,
                "usage": "article_cover",
            },
        )

    response = await client.get(f"/api/v1/images?project_id={FAKE_PROJECT_ID}")
    assert response.status_code == 200
    images = response.json()
    assert len(images) == 2


@pytest.mark.asyncio
async def test_list_images_filter_by_usage(client, org_and_project):
    """GET /images?project_id=...&usage=article_cover filters by usage."""
    # Create article_cover and social_post images
    await client.post(
        "/api/v1/images/generate",
        json={"project_id": str(FAKE_PROJECT_ID), "title": "Cover", "usage": "article_cover"},
    )
    await client.post(
        "/api/v1/images/generate",
        json={"project_id": str(FAKE_PROJECT_ID), "title": "Social", "usage": "social_post"},
    )

    response = await client.get(
        f"/api/v1/images?project_id={FAKE_PROJECT_ID}&usage=article_cover"
    )
    assert response.status_code == 200
    images = response.json()
    assert len(images) == 1
    assert images[0]["usage"] == "article_cover"


@pytest.mark.asyncio
async def test_delete_image(client, org_and_project):
    """DELETE /images/{id} returns 204."""
    create_resp = await client.post(
        "/api/v1/images/generate",
        json={"project_id": str(FAKE_PROJECT_ID), "title": "To Delete", "usage": "custom"},
    )
    assert create_resp.status_code == 200
    image_id = create_resp.json()["id"]

    del_resp = await client.delete(f"/api/v1/images/{image_id}")
    assert del_resp.status_code == 204

    # Verify it's gone
    get_resp = await client.get(f"/api/v1/images/{image_id}")
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_attach_image_to_article(client, org_and_project, article):
    """POST /images/{id}/attach attaches to article_id."""
    create_resp = await client.post(
        "/api/v1/images/generate",
        json={"project_id": str(FAKE_PROJECT_ID), "title": "Blog Cover", "usage": "article_cover"},
    )
    assert create_resp.status_code == 200
    image_id = create_resp.json()["id"]

    attach_resp = await client.post(
        f"/api/v1/images/{image_id}/attach",
        json={"article_id": str(article.id)},
    )
    assert attach_resp.status_code == 200
    data = attach_resp.json()
    assert data["article_id"] == str(article.id)


# ── Quality parameter tests ───────────────────────────────────────────────────

from unittest.mock import MagicMock
from app.services.image_service import generate_image_dalle


@pytest.mark.asyncio
async def test_generate_image_dalle_standard_quality():
    """Standard quality sends quality=standard and correct cost."""
    captured = {}

    async def fake_post(url, **kwargs):
        captured["payload"] = kwargs["json"]
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json = MagicMock(return_value={
            "data": [{"url": "https://example.com/img.png", "revised_prompt": None}]
        })
        return mock_resp

    with patch("httpx.AsyncClient") as MockClient:
        instance = MockClient.return_value.__aenter__.return_value
        instance.post = fake_post
        result = await generate_image_dalle(
            prompt="A blog image",
            style="professional",
            usage="social_post",
            openai_api_key="sk-test",
            quality="standard",
        )

    assert captured["payload"]["quality"] == "standard"
    assert result["ok"] is True
    assert result["cost_usd"] == 0.04  # standard 1024x1024


@pytest.mark.asyncio
async def test_generate_image_dalle_hd_quality():
    """HD quality sends quality=hd and doubles cost."""
    captured = {}

    async def fake_post(url, **kwargs):
        captured["payload"] = kwargs["json"]
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json = MagicMock(return_value={
            "data": [{"url": "https://example.com/img.png", "revised_prompt": "HD image"}]
        })
        return mock_resp

    with patch("httpx.AsyncClient") as MockClient:
        instance = MockClient.return_value.__aenter__.return_value
        instance.post = fake_post
        result = await generate_image_dalle(
            prompt="A blog image",
            style="professional",
            usage="social_post",
            openai_api_key="sk-test",
            quality="hd",
        )

    assert captured["payload"]["quality"] == "hd"
    assert result["ok"] is True
    assert result["cost_usd"] == 0.08  # hd 1024x1024 = double standard


@pytest.mark.asyncio
async def test_generate_image_dalle_hd_article_cover_cost():
    """HD article_cover (1792x1024) costs $0.12."""
    async def fake_post(url, **kwargs):
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json = MagicMock(return_value={
            "data": [{"url": "https://example.com/img.png", "revised_prompt": None}]
        })
        return mock_resp

    with patch("httpx.AsyncClient") as MockClient:
        instance = MockClient.return_value.__aenter__.return_value
        instance.post = fake_post
        result = await generate_image_dalle(
            prompt="A blog cover",
            style="professional",
            usage="article_cover",
            openai_api_key="sk-test",
            quality="hd",
        )

    assert result["cost_usd"] == 0.12  # hd 1792x1024


@pytest.mark.asyncio
async def test_generate_image_dalle_invalid_quality():
    """Invalid quality returns ok=False without hitting the API."""
    result = await generate_image_dalle(
        prompt="test",
        style="professional",
        usage="social_post",
        openai_api_key="sk-test",
        quality="ultra",
    )
    assert result["ok"] is False
    assert "ultra" in result["error"]
