# Async LLM Article Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the synchronous mock article generator with a real async LLM call via the arq background worker, so `POST /articles/{id}/generate` returns immediately with `status: generating` while the worker writes the final content.

**Architecture:** The endpoint sets `status=generating`, commits, and enqueues an arq job. The worker loads org API keys, routes to the preferred LLM provider via `LLMRouter`, calls the SDK, parses the structured response, and saves the article. The frontend polls every 3 seconds while any article is in `generating` state.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy async, arq (Redis), Anthropic SDK (`anthropic`), OpenAI SDK (`openai`), httpx (Google), Next.js 14 React Query

## Global Constraints

- Python `>=3.11`; FastAPI `>=0.111`; SQLAlchemy `>=2.0`; arq `>=0.25`
- anthropic `>=0.28.0`; openai `>=1.30.0`
- SQLite+aiosqlite for tests (no real Redis or LLM calls in tests)
- Mock arq with `AsyncMock`; mock LLM SDKs with `patch`
- Patch `async_session_factory` in worker task modules to point at `TestSessionLocal`
- Alembic migrations use raw SQL via `op.execute(sa.text(...))`
- Revision ID format: one-letter prefix + 15 hex chars (e.g. `j5e6f7a8b9c0d1e2`)
- All new backend tests go in `apps/api/tests/`

---

### Task 1: Add `failed` to `ArticleStatus` enum

The worker sets `status=failed` on errors. This value is missing from the model and the Postgres enum.

**Files:**
- Modify: `apps/api/app/models/article.py`
- Create: `apps/api/alembic/versions/j5e6f7a8b9c0d1e2_article_status_failed.py`

**Interfaces:**
- Produces: `ArticleStatus.failed` — used in Tasks 3, 4, 5

- [ ] **Step 1: Add `failed` to the Python enum**

In `apps/api/app/models/article.py`, change:

```python
class ArticleStatus(str, PyEnum):
    draft = "draft"
    generating = "generating"
    ready = "ready"
    published = "published"
```

to:

```python
class ArticleStatus(str, PyEnum):
    draft = "draft"
    generating = "generating"
    ready = "ready"
    published = "published"
    failed = "failed"
```

- [ ] **Step 2: Create Alembic migration**

Create `apps/api/alembic/versions/j5e6f7a8b9c0d1e2_article_status_failed.py`:

```python
"""Add failed to article_status_enum

Revision ID: j5e6f7a8b9c0d1e2
Revises: i4d5e6f7a8b9
Create Date: 2026-06-27
"""
from alembic import op
import sqlalchemy as sa

revision = "j5e6f7a8b9c0d1e2"
down_revision = "i4d5e6f7a8b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TYPE article_status_enum ADD VALUE IF NOT EXISTS 'failed';"))


def downgrade() -> None:
    # Postgres does not support removing enum values; downgrade is a no-op
    pass
```

- [ ] **Step 3: Run existing article tests to confirm enum change doesn't break anything**

```bash
cd apps/api && python -m pytest tests/test_articles.py -v
```

Expected: all existing tests PASS (SQLite tests are unaffected since SQLite stores enums as VARCHAR).

- [ ] **Step 4: Commit**

```bash
git add apps/api/app/models/article.py apps/api/alembic/versions/j5e6f7a8b9c0d1e2_article_status_failed.py
git commit -m "feat(api): add failed status to ArticleStatus enum + migration"
```

---

### Task 2: Add LLM SDK dependencies

**Files:**
- Modify: `apps/api/pyproject.toml`

**Interfaces:**
- Produces: `anthropic` and `openai` packages available for import in Task 3

- [ ] **Step 1: Add SDK dependencies**

In `apps/api/pyproject.toml`, add to the `dependencies` list:

```toml
"anthropic>=0.28.0",
"openai>=1.30.0",
```

The full dependencies block becomes:

```toml
dependencies = [
    "fastapi>=0.111.0",
    "uvicorn[standard]>=0.29.0",
    "sqlalchemy>=2.0.0",
    "asyncpg>=0.29.0",
    "alembic>=1.13.0",
    "pydantic>=2.7.0",
    "pydantic[email]>=2.7.0",
    "pydantic-settings>=2.2.0",
    "python-jose[cryptography]>=3.3.0",
    "passlib[bcrypt]>=1.7.4",
    "bcrypt>=4.0.0,<5.0.0",
    "python-multipart>=0.0.9",
    "httpx>=0.27.0",
    "beautifulsoup4>=4.12.0",
    "arq>=0.25.0",
    "redis>=5.0.0",
    "cryptography>=42.0.0",
    "pgvector>=0.3.0",
    "psycopg2-binary>=2.9.9",
    "anthropic>=0.28.0",
    "openai>=1.30.0",
]
```

- [ ] **Step 2: Install and verify**

```bash
cd apps/api && pip install -e ".[dev]"
python -c "import anthropic; import openai; print('anthropic:', anthropic.__version__, '  openai:', openai.__version__)"
```

Expected: version strings printed, no ImportError.

- [ ] **Step 3: Commit**

```bash
git add apps/api/pyproject.toml
git commit -m "feat(api): add anthropic and openai SDK dependencies"
```

---

### Task 3: Create `llm_service.py`

Two public async functions: `get_org_llm_keys` to decrypt org keys from DB, and `call_llm` to dispatch to the correct provider SDK.

**Files:**
- Create: `apps/api/app/services/llm_service.py`
- Create: `apps/api/tests/test_llm_service.py`

**Interfaces:**
- Consumes: `APIKey` model, `decrypt_value` from `app.core.security`
- Produces:
  - `get_org_llm_keys(org_id: uuid.UUID, db: AsyncSession) -> dict[str, str]`
  - `call_llm(provider: str, model: str, api_key: str, system_prompt: str, user_prompt: str) -> str` (async)

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_llm_service.py`:

```python
"""Tests for llm_service.py."""
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.security import encrypt_value
from app.models.api_key import APIKey
from app.models.organization import Organization

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

FAKE_ORG_ID = uuid.uuid4()


@pytest.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def db():
    async with TestSessionLocal() as session:
        yield session


@pytest.fixture
async def org_with_keys(db):
    org = Organization(id=FAKE_ORG_ID, slug="test-org", name="Test Org")
    db.add(org)
    await db.flush()
    db.add(APIKey(org_id=FAKE_ORG_ID, provider="anthropic", encrypted_value=encrypt_value("sk-ant-test-key")))
    db.add(APIKey(org_id=FAKE_ORG_ID, provider="openai", encrypted_value=encrypt_value("sk-openai-test-key")))
    await db.commit()


@pytest.mark.asyncio
async def test_get_org_llm_keys_returns_decrypted_dict(db, org_with_keys):
    from app.services.llm_service import get_org_llm_keys
    keys = await get_org_llm_keys(FAKE_ORG_ID, db)
    assert keys == {"anthropic": "sk-ant-test-key", "openai": "sk-openai-test-key"}


@pytest.mark.asyncio
async def test_get_org_llm_keys_empty_when_no_keys(db):
    from app.services.llm_service import get_org_llm_keys
    keys = await get_org_llm_keys(FAKE_ORG_ID, db)
    assert keys == {}


@pytest.mark.asyncio
async def test_call_llm_anthropic():
    from app.services.llm_service import call_llm
    mock_content = MagicMock(text="Anthropic generated text")
    mock_message = MagicMock(content=[mock_content])
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_message)
    mock_cls = MagicMock(return_value=mock_client)

    with patch("app.services.llm_service.AsyncAnthropic", mock_cls):
        result = await call_llm("anthropic", "claude-sonnet-4-6", "sk-ant-key", "system", "user")

    assert result == "Anthropic generated text"
    mock_cls.assert_called_once_with(api_key="sk-ant-key")
    mock_client.messages.create.assert_awaited_once_with(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system="system",
        messages=[{"role": "user", "content": "user"}],
    )


@pytest.mark.asyncio
async def test_call_llm_openai():
    from app.services.llm_service import call_llm
    mock_choice = MagicMock()
    mock_choice.message.content = "OpenAI generated text"
    mock_response = MagicMock(choices=[mock_choice])
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
    mock_cls = MagicMock(return_value=mock_client)

    with patch("app.services.llm_service.AsyncOpenAI", mock_cls):
        result = await call_llm("openai", "gpt-4o", "sk-openai-key", "system", "user")

    assert result == "OpenAI generated text"
    mock_cls.assert_called_once_with(api_key="sk-openai-key")


@pytest.mark.asyncio
async def test_call_llm_google():
    from app.services.llm_service import call_llm
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "candidates": [{"content": {"parts": [{"text": "Google generated text"}]}}]
    }
    mock_http_client = AsyncMock()
    mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
    mock_http_client.__aexit__ = AsyncMock(return_value=False)
    mock_http_client.post = AsyncMock(return_value=mock_resp)

    with patch("app.services.llm_service.httpx.AsyncClient", return_value=mock_http_client):
        result = await call_llm("google", "gemini-1.5-flash", "google-key", "system", "user")

    assert result == "Google generated text"


@pytest.mark.asyncio
async def test_call_llm_unknown_provider_raises():
    from app.services.llm_service import call_llm
    with pytest.raises(ValueError, match="Unknown provider: badprovider"):
        await call_llm("badprovider", "model", "key", "system", "user")
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && python -m pytest tests/test_llm_service.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.llm_service'`

- [ ] **Step 3: Implement `llm_service.py`**

Create `apps/api/app/services/llm_service.py`:

```python
"""LLM provider dispatch: decrypt org keys, call Anthropic/OpenAI/Google."""
import uuid

import httpx
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decrypt_value
from app.models.api_key import APIKey


async def get_org_llm_keys(org_id: uuid.UUID, db: AsyncSession) -> dict[str, str]:
    """Return {provider: plaintext_key} for every API key stored for the org."""
    result = await db.execute(select(APIKey).where(APIKey.org_id == org_id))
    return {k.provider: decrypt_value(k.encrypted_value) for k in result.scalars().all()}


async def call_llm(
    provider: str,
    model: str,
    api_key: str,
    system_prompt: str,
    user_prompt: str,
) -> str:
    """Call the named provider and return the raw text response."""
    if provider == "anthropic":
        return await _call_anthropic(model, api_key, system_prompt, user_prompt)
    if provider == "openai":
        return await _call_openai(model, api_key, system_prompt, user_prompt)
    if provider == "google":
        return await _call_google(model, api_key, system_prompt, user_prompt)
    raise ValueError(f"Unknown provider: {provider}")


async def _call_anthropic(model: str, api_key: str, system_prompt: str, user_prompt: str) -> str:
    client = AsyncAnthropic(api_key=api_key)
    message = await client.messages.create(
        model=model,
        max_tokens=4096,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    return message.content[0].text


async def _call_openai(model: str, api_key: str, system_prompt: str, user_prompt: str) -> str:
    client = AsyncOpenAI(api_key=api_key)
    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=4096,
    )
    return response.choices[0].message.content


async def _call_google(model: str, api_key: str, system_prompt: str, user_prompt: str) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            url,
            params={"key": api_key},
            json={
                "system_instruction": {"parts": [{"text": system_prompt}]},
                "contents": [{"parts": [{"text": user_prompt}]}],
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/api && python -m pytest tests/test_llm_service.py -v
```

Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/llm_service.py apps/api/tests/test_llm_service.py
git commit -m "feat(api): add llm_service with get_org_llm_keys and call_llm"
```

---

### Task 4: Create `article_tasks.py` arq worker task

The arq task that does the actual LLM article generation. Uses three DB session phases: (1) load data + validate keys, (2) call LLM outside session, (3) save results.

**Files:**
- Create: `apps/api/app/workers/tasks/article_tasks.py`
- Create: `apps/api/tests/test_article_tasks.py`

**Interfaces:**
- Consumes:
  - `get_org_llm_keys(org_id, db) -> dict[str, str]` from Task 3
  - `call_llm(provider, model, api_key, system_prompt, user_prompt) -> str` from Task 3
  - `LLMRouter(available_providers: set[LLMProvider]).resolve(TaskType) -> (LLMProvider, str)` from `app.agents.llm_router`
  - `_markdown_to_html(markdown: str) -> str` from `app.services.article_service`
  - `_deterministic_seo_score(title: str) -> float` from `app.services.article_service`
  - `ArticleStatus.failed` from Task 1
- Produces:
  - `generate_article_task(ctx, article_id: str, org_id: str)` — arq task function
  - `_parse_llm_response(raw: str, article_title: str) -> dict` — module-level helper (used in tests)

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_article_tasks.py`:

```python
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/api && python -m pytest tests/test_article_tasks.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.workers.tasks.article_tasks'`

- [ ] **Step 3: Implement `article_tasks.py`**

Create `apps/api/app/workers/tasks/article_tasks.py`:

```python
"""ARQ task: generate article content via real LLM providers."""
import re
import uuid

from app.agents.llm_router import LLMProvider, LLMRouter, TaskType
from app.core.database import async_session_factory
from app.models.article import Article, ArticleRevision, ArticleStatus
from app.models.brand_voice import BrandVoice
from app.services.article_service import _deterministic_seo_score, _markdown_to_html
from app.services.llm_service import call_llm, get_org_llm_keys


def _parse_llm_response(raw: str, article_title: str) -> dict:
    """Split on the first '\\n---\\n' to extract meta fields and body."""
    parts = raw.split("\n---\n", 1)
    if len(parts) == 2:
        header, body_markdown = parts[0], parts[1].strip()
        meta_title = None
        meta_description = None
        for line in header.splitlines():
            if line.startswith("META_TITLE:"):
                meta_title = line[len("META_TITLE:"):].strip()
            elif line.startswith("META_DESCRIPTION:"):
                meta_description = line[len("META_DESCRIPTION:"):].strip()
        if not meta_title:
            meta_title = article_title[:60]
        if not meta_description:
            plain = re.sub(r"[#*`]", "", body_markdown)
            meta_description = (plain[:157] + "...") if len(plain) > 157 else plain
    else:
        body_markdown = raw.strip()
        meta_title = article_title[:60]
        plain = re.sub(r"[#*`]", "", body_markdown)
        meta_description = (plain[:157] + "...") if len(plain) > 157 else plain
    return {
        "body_markdown": body_markdown,
        "meta_title": meta_title,
        "meta_description": meta_description,
    }


def _build_system_prompt(brand_voice: BrandVoice | None) -> str:
    lines = [
        "You are an expert SEO content writer. Write comprehensive, well-structured, "
        "engaging articles that rank well in search engines and genuinely help readers."
    ]
    if brand_voice:
        if brand_voice.voice_prompt:
            lines.append(f"Brand voice instructions: {brand_voice.voice_prompt}.")
        tone = brand_voice.tone.value if hasattr(brand_voice.tone, "value") else brand_voice.tone
        lines.append(f"Tone: {tone}.")
        if brand_voice.vocabulary:
            lines.append(f"Preferred vocabulary: {', '.join(brand_voice.vocabulary)}.")
        if brand_voice.avoid_words:
            lines.append(f"Avoid these words: {', '.join(brand_voice.avoid_words)}.")
    return "\n".join(lines)


def _build_user_prompt(article: Article) -> str:
    kw = article.target_keyword or article.title
    return (
        f"Write a complete SEO-optimized article with these specifications:\n"
        f"- Title: {article.title}\n"
        f"- Target keyword: {kw}\n"
        f"- Tone: {article.tone}\n"
        f"- Target length: approximately {article.word_count_target} words\n\n"
        f"Structure:\n"
        f"- H1 title\n"
        f"- Engaging introduction (mention the keyword naturally)\n"
        f"- 5–7 H2 sections with detailed paragraphs\n"
        f"- Conclusion\n\n"
        f"Reply in this exact format (do not add anything before META_TITLE):\n\n"
        f"META_TITLE: <SEO title, max 60 characters>\n"
        f"META_DESCRIPTION: <SEO description, max 160 characters>\n\n"
        f"---\n\n"
        f"<full article in Markdown>"
    )


async def generate_article_task(ctx, article_id: str, org_id: str):
    """ARQ task: call LLM and save generated article content."""
    article_id_uuid = uuid.UUID(article_id)
    org_id_uuid = uuid.UUID(org_id)

    # Phase 1: load article + keys, build prompts
    async with async_session_factory() as db:
        article = await db.get(Article, article_id_uuid)
        if article is None:
            return

        brand_voice = None
        if article.brand_voice_id:
            brand_voice = await db.get(BrandVoice, article.brand_voice_id)

        org_keys = await get_org_llm_keys(org_id_uuid, db)
        if not org_keys:
            article.status = ArticleStatus.failed
            article.error = "No LLM API keys configured. Add keys in Settings."
            await db.commit()
            return

        available_providers = {LLMProvider(p) for p in org_keys}
        provider, model = LLMRouter(available_providers).resolve(TaskType.LONG_FORM_ARTICLE)
        api_key = org_keys[provider.value]

        system_prompt = _build_system_prompt(brand_voice)
        user_prompt = _build_user_prompt(article)
        article_title = article.title

    # Phase 2: call LLM (outside DB session)
    try:
        raw = await call_llm(provider.value, model, api_key, system_prompt, user_prompt)
    except Exception as e:
        async with async_session_factory() as db:
            art = await db.get(Article, article_id_uuid)
            if art:
                art.status = ArticleStatus.failed
                art.error = str(e)
                await db.commit()
        raise

    # Phase 3: parse response and persist
    parsed = _parse_llm_response(raw, article_title)
    body_html = _markdown_to_html(parsed["body_markdown"])
    word_count = len(parsed["body_markdown"].split())
    seo_score = _deterministic_seo_score(article_title)

    async with async_session_factory() as db:
        art = await db.get(Article, article_id_uuid)
        if art is None:
            return
        art.body_markdown = parsed["body_markdown"]
        art.body_html = body_html
        art.meta_title = parsed["meta_title"]
        art.meta_description = parsed["meta_description"]
        art.word_count = word_count
        art.seo_score = seo_score
        art.status = ArticleStatus.ready
        art.error = None

        db.add(ArticleRevision(
            article_id=article_id_uuid,
            body_markdown=parsed["body_markdown"],
            word_count=word_count,
            note="Initial generation",
        ))
        await db.commit()
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/api && python -m pytest tests/test_article_tasks.py -v
```

Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/workers/tasks/article_tasks.py apps/api/tests/test_article_tasks.py
git commit -m "feat(api): add generate_article_task arq worker with LLM dispatch"
```

---

### Task 5: Update `generate_article` endpoint + fix `test_articles.py`

Replace the synchronous mock call with arq enqueueing. The endpoint commits `status=generating` and returns immediately. Fix existing tests that relied on the endpoint doing synchronous generation.

**Files:**
- Modify: `apps/api/app/api/v1/routers/articles.py`
- Modify: `apps/api/tests/test_articles.py`

**Interfaces:**
- Consumes: `generate_article_task` function name (as string `"generate_article_task"`) passed to arq
- Consumes: `arq.create_pool(settings.REDIS_SETTINGS)` — same pattern as `app/api/v1/routers/keywords.py`

- [ ] **Step 1: Update `articles.py` router**

In `apps/api/app/api/v1/routers/articles.py`:

**Replace** the import line:
```python
from app.services.article_service import generate_article_mock
```

**With:**
```python
import arq

from app.core.config import settings
```

**Replace** the entire `generate_article` endpoint (lines 174–216) with:

```python
@router.post("/{article_id}/generate", response_model=ArticleOut)
async def generate_article(
    article_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    article = await _get_article_or_404(article_id, current_user.org_id, db)

    article.status = ArticleStatus.generating
    article.error = None
    await db.flush()
    await db.commit()
    await db.refresh(article)

    redis_pool = await arq.create_pool(settings.REDIS_SETTINGS)
    try:
        await redis_pool.enqueue_job(
            "generate_article_task",
            str(article.id),
            str(current_user.org_id),
        )
    finally:
        await redis_pool.aclose()

    return ArticleOut.model_validate(article)
```

- [ ] **Step 2: Update `test_articles.py`**

Three tests need changes:

**a) `test_generate_article`** — now expects `status=generating` and a mocked arq pool:

Replace the entire `test_generate_article` function with:

```python
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
```

**b) `test_seo_score_endpoint`** — needs a ready article without calling generate endpoint. Replace with:

```python
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
```

**c) `test_save_revision`** — same approach, create article directly:

```python
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
```

Also add `from unittest.mock import AsyncMock, patch` to the top-level imports in `test_articles.py` if not already present.

- [ ] **Step 3: Run the updated article tests**

```bash
cd apps/api && python -m pytest tests/test_articles.py -v
```

Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/app/api/v1/routers/articles.py apps/api/tests/test_articles.py
git commit -m "feat(api): generate_article endpoint enqueues arq job instead of calling mock"
```

---

### Task 6: Register `generate_article_task` in the worker

**Files:**
- Modify: `apps/api/app/workers/worker.py`

**Interfaces:**
- Consumes: `generate_article_task` from `app.workers.tasks.article_tasks` (Task 4)

- [ ] **Step 1: Update `worker.py`**

In `apps/api/app/workers/worker.py`, add the import:

```python
from app.workers.tasks.article_tasks import generate_article_task
```

And add `generate_article_task` to the `functions` list:

```python
class WorkerSettings:
    functions = [
        _noop,
        crawl_website,
        run_seo_audit,
        run_keyword_research,
        seed_analytics_history,
        sync_analytics_data,
        sync_backlink_profile,
        verify_exchange_link,
        weekly_backlink_discovery,
        generate_article_task,
    ]
```

- [ ] **Step 2: Verify the worker module imports cleanly**

```bash
cd apps/api && python -c "from app.workers.worker import WorkerSettings; print('functions:', [f.__name__ for f in WorkerSettings.functions])"
```

Expected: `functions: ['_noop', 'crawl_website', ..., 'generate_article_task']`

- [ ] **Step 3: Commit**

```bash
git add apps/api/app/workers/worker.py
git commit -m "feat(api): register generate_article_task in arq WorkerSettings"
```

---

### Task 7: Frontend — polling + `failed` status badge

Add `refetchInterval` to poll while any article is generating. Add `failed` to the `STATUS_TONE` map. Fix the editor so it re-populates content when the article transitions from `generating` to `ready`.

**Files:**
- Modify: `apps/web/app/(dashboard)/[projectId]/articles/page.tsx`

**Interfaces:**
- Consumes: `Article.status` which can now be `"draft" | "generating" | "ready" | "published" | "failed"`

- [ ] **Step 1: Add `failed` to `STATUS_TONE`**

In `apps/web/app/(dashboard)/[projectId]/articles/page.tsx`, change:

```tsx
const STATUS_TONE: Record<ArticleStatus, BadgeTone> = {
  draft: "neutral",
  generating: "warning",
  ready: "info",
  published: "success",
};
```

to:

```tsx
const STATUS_TONE: Record<ArticleStatus, BadgeTone> = {
  draft: "neutral",
  generating: "warning",
  ready: "info",
  published: "success",
  failed: "destructive",
};
```

Also update the `ArticleStatus` type (if it is a local type, not imported). Search for where `ArticleStatus` is defined or imported in this file and add `"failed"`. If it is declared as a string union type in `lib/api.ts`, update it there:

```ts
export type ArticleStatus = "draft" | "generating" | "ready" | "published" | "failed";
```

- [ ] **Step 2: Add polling to the article list query**

In the `ArticlesPage` component, find the list query:

```tsx
const { data: articles = [], isLoading } = useQuery<Article[]>({
    queryKey: ["articles", projectId],
    queryFn: () => listArticles(projectId),
});
```

Replace with:

```tsx
const { data: articles = [], isLoading } = useQuery<Article[]>({
    queryKey: ["articles", projectId],
    queryFn: () => listArticles(projectId),
    refetchInterval: (query) => {
      const data = query.state.data ?? [];
      return data.some((a) => a.status === "generating") ? 3000 : false;
    },
});
```

- [ ] **Step 3: Add polling to the article editor query**

In the `ArticleEditor` component, find the article query:

```tsx
const { data: article, isLoading } = useQuery<Article>({
    queryKey: ["article", articleId],
    queryFn: () => getArticle(articleId),
});
```

Replace with:

```tsx
const { data: article, isLoading } = useQuery<Article>({
    queryKey: ["article", articleId],
    queryFn: () => getArticle(articleId),
    refetchInterval: (query) => query.state.data?.status === "generating" ? 3000 : false,
});
```

- [ ] **Step 4: Fix editor re-population when article transitions from `generating` to `ready`**

In `ArticleEditor`, add a `prevStatusRef` to detect when status changes from `generating` to a settled state. Find the existing `initialized` ref and `useEffect`:

```tsx
const initialized = useRef(false);

useEffect(() => {
    if (article && !initialized.current) {
        initialized.current = true;
        setBody(article.body_markdown ?? "");
        setTitle(article.title);
        setMetaTitle(article.meta_title ?? "");
        setMetaDesc(article.meta_description ?? "");
    }
}, [article]);
```

Replace with:

```tsx
const initialized = useRef(false);
const prevStatusRef = useRef<string | null>(null);

useEffect(() => {
    if (!article) return;
    // Re-seed editor when article leaves the generating state
    if (prevStatusRef.current === "generating" && article.status !== "generating") {
        initialized.current = false;
    }
    prevStatusRef.current = article.status;
    if (!initialized.current) {
        initialized.current = true;
        setBody(article.body_markdown ?? "");
        setTitle(article.title);
        setMetaTitle(article.meta_title ?? "");
        setMetaDesc(article.meta_description ?? "");
    }
}, [article]);
```

- [ ] **Step 5: Find the ArticleStatus type in `lib/api.ts` and confirm it includes `"failed"`**

```bash
grep -n "ArticleStatus" apps/web/lib/api.ts
```

If the type is `"draft" | "generating" | "ready" | "published"`, add `| "failed"`.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/(dashboard)/[projectId]/articles/page.tsx apps/web/lib/api.ts
git commit -m "feat(web): articles page polls while generating, adds failed badge"
```

---

## Self-Review

### Spec coverage

| Spec requirement | Covered by |
|---|---|
| `llm_service.py` with `get_org_llm_keys` | Task 3 |
| `llm_service.py` with `call_llm` (Anthropic/OpenAI/Google) | Task 3 |
| `article_tasks.py` with `generate_article_task` | Task 4 |
| Load article + brand voice | Task 4 (`_build_system_prompt`) |
| No keys → `status=failed` | Task 4 |
| LLMRouter fallback chain | Task 4 (via `LLMRouter.resolve`) |
| Prompt format (META_TITLE / META_DESC / --- / body) | Task 4 (`_build_user_prompt`) |
| Response parsing with fallback | Task 4 (`_parse_llm_response`) |
| `_markdown_to_html` + `_deterministic_seo_score` | Task 4 |
| `ArticleRevision` created on success | Task 4 |
| LLM exception → `status=failed` | Task 4 |
| `pyproject.toml` deps | Task 2 |
| Endpoint enqueues instead of calling mock | Task 5 |
| Worker registers task | Task 6 |
| Frontend `refetchInterval` (list + editor) | Task 7 |
| Frontend re-populate editor after `generating→ready` | Task 7 |
| `failed` status badge in UI | Task 7 |
| `failed` enum value in DB | Task 1 |

### Placeholder scan

No TBDs, no "handle edge cases", all code blocks are complete.

### Type consistency

- `generate_article_task(ctx, article_id: str, org_id: str)` — Task 4 defines it, Task 5 calls `enqueue_job("generate_article_task", str(article.id), str(current_user.org_id))` — matches.
- `get_org_llm_keys(org_id: uuid.UUID, db: AsyncSession) -> dict[str, str]` — Task 3 defines it, Task 4 calls `get_org_llm_keys(org_id_uuid, db)` — matches.
- `call_llm(provider: str, model: str, api_key: str, system_prompt: str, user_prompt: str) -> str` — Task 3 defines it, Task 4 calls `call_llm(provider.value, model, api_key, system_prompt, user_prompt)` — matches.
- `_parse_llm_response(raw: str, article_title: str) -> dict` — Task 4 defines it, tests call it the same way — matches.
- `ArticleStatus.failed` — Task 1 adds it, Tasks 4 and 7 use it — consistent.
