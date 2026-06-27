"""Tests for article_tasks arq worker."""
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.security import encrypt_value
from app.models.api_key import APIKey
from app.models.article import Article, ArticleRevision, ArticleStatus
from app.models.organization import Organization
from app.models.project import Project

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

FAKE_ORG_ID = uuid.uuid4()
FAKE_PROJECT_ID = uuid.uuid4()


@pytest.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def _seed(with_key: bool = True) -> uuid.UUID:
    """Create org, project, article (and optionally an Anthropic key) in the test DB."""
    async with TestSessionLocal() as session:
        org = Organization(id=FAKE_ORG_ID, slug="test-org", name="Test Org")
        session.add(org)
        await session.flush()

        project = Project(id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, name="Test Project", domain="example.com")
        session.add(project)
        await session.flush()

        if with_key:
            session.add(APIKey(
                org_id=FAKE_ORG_ID,
                provider="anthropic",
                encrypted_value=encrypt_value("sk-ant-test"),
            ))

        article = Article(
            org_id=FAKE_ORG_ID,
            project_id=FAKE_PROJECT_ID,
            title="SEO Guide for Beginners",
            target_keyword="seo guide",
            tone="professional",
            status=ArticleStatus.generating,
            word_count_target=1500,
        )
        session.add(article)
        await session.commit()
        return article.id


# ── _parse_llm_response unit tests ───────────────────────────────────────────

def test_parse_llm_response_well_formed():
    from app.workers.tasks.article_tasks import _parse_llm_response
    raw = (
        "META_TITLE: My SEO Title\n"
        "META_DESCRIPTION: My SEO description here.\n"
        "\n---\n\n"
        "# Full Article\n\nContent here."
    )
    result = _parse_llm_response(raw, "Original Title")
    assert result["meta_title"] == "My SEO Title"
    assert result["meta_description"] == "My SEO description here."
    assert result["body_markdown"] == "# Full Article\n\nContent here."


def test_parse_llm_response_fallback_when_no_separator():
    from app.workers.tasks.article_tasks import _parse_llm_response
    raw = "Just some article content without any separator."
    result = _parse_llm_response(raw, "My Article Title")
    assert result["body_markdown"] == raw
    assert result["meta_title"] == "My Article Title"
    assert "meta_description" in result
    assert len(result["meta_description"]) > 0


def test_parse_llm_response_fallback_missing_meta_title():
    from app.workers.tasks.article_tasks import _parse_llm_response
    raw = "META_DESCRIPTION: Some desc.\n\n---\n\n# Body"
    result = _parse_llm_response(raw, "Fallback Title")
    assert result["meta_title"] == "Fallback Title"
    assert result["meta_description"] == "Some desc."
    assert result["body_markdown"] == "# Body"


# ── generate_article_task integration tests ───────────────────────────────────

@pytest.mark.asyncio
async def test_generate_article_task_no_keys():
    """When org has no API keys, article gets status=failed with informative error."""
    from app.workers.tasks.article_tasks import generate_article_task
    article_id = await _seed(with_key=False)

    with patch("app.workers.tasks.article_tasks.async_session_factory", TestSessionLocal):
        await generate_article_task(ctx={}, article_id=str(article_id), org_id=str(FAKE_ORG_ID))

    async with TestSessionLocal() as session:
        article = await session.get(Article, article_id)
        assert article.status == ArticleStatus.failed
        assert "No LLM API keys configured" in article.error


@pytest.mark.asyncio
async def test_generate_article_task_success():
    """Happy path: article ends up ready with parsed content and one revision."""
    from app.workers.tasks.article_tasks import generate_article_task
    article_id = await _seed()

    llm_response = (
        "META_TITLE: SEO Guide for Beginners 2024\n"
        "META_DESCRIPTION: Learn SEO essentials to rank higher in search.\n"
        "\n---\n\n"
        "# SEO Guide for Beginners\n\n"
        "Introduction about seo guide. The seo guide is important.\n\n"
        "## What is SEO?\n\nSEO stands for search engine optimization.\n\n"
        "## Why SEO Matters\n\nSEO drives organic traffic.\n\n"
        "## Conclusion\n\nStart your seo guide journey today."
    )

    with patch("app.workers.tasks.article_tasks.async_session_factory", TestSessionLocal):
        with patch("app.workers.tasks.article_tasks.call_llm", AsyncMock(return_value=llm_response)):
            await generate_article_task(ctx={}, article_id=str(article_id), org_id=str(FAKE_ORG_ID))

    async with TestSessionLocal() as session:
        article = await session.get(Article, article_id)
        assert article.status == ArticleStatus.ready
        assert article.error is None
        assert "# SEO Guide" in article.body_markdown
        assert article.meta_title == "SEO Guide for Beginners 2024"
        assert article.meta_description == "Learn SEO essentials to rank higher in search."
        assert article.body_html is not None
        assert "<h1>" in article.body_html or "<h2>" in article.body_html
        assert article.word_count > 0
        assert article.seo_score is not None

        revisions = (await session.execute(
            select(ArticleRevision).where(ArticleRevision.article_id == article_id)
        )).scalars().all()
        assert len(revisions) == 1
        assert revisions[0].note == "Initial generation"
        assert revisions[0].word_count == article.word_count


@pytest.mark.asyncio
async def test_generate_article_task_llm_error():
    """When LLM call raises, article gets status=failed and exception is re-raised."""
    from app.workers.tasks.article_tasks import generate_article_task
    article_id = await _seed()

    with patch("app.workers.tasks.article_tasks.async_session_factory", TestSessionLocal):
        with patch("app.workers.tasks.article_tasks.call_llm", AsyncMock(side_effect=RuntimeError("Rate limit exceeded"))):
            with pytest.raises(RuntimeError, match="Rate limit exceeded"):
                await generate_article_task(ctx={}, article_id=str(article_id), org_id=str(FAKE_ORG_ID))

    async with TestSessionLocal() as session:
        article = await session.get(Article, article_id)
        assert article.status == ArticleStatus.failed
        assert "Rate limit exceeded" in article.error


@pytest.mark.asyncio
async def test_generate_article_task_missing_article():
    """Task returns None gracefully when article_id is unknown."""
    from app.workers.tasks.article_tasks import generate_article_task
    async with TestSessionLocal() as session:
        org = Organization(id=FAKE_ORG_ID, slug="test-org", name="Test Org")
        session.add(org)
        await session.commit()

    with patch("app.workers.tasks.article_tasks.async_session_factory", TestSessionLocal):
        result = await generate_article_task(ctx={}, article_id=str(uuid.uuid4()), org_id=str(FAKE_ORG_ID))

    assert result is None
