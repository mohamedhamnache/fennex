# Model Selection for Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users choose which LLM provider+model is used for article generation, and pick image quality (standard/HD) for DALL-E 3 image generation.

**Architecture:** The article generate endpoint grows an optional `{ provider, model }` body; the arq task accepts those as keyword args and skips LLMRouter when provided. The image endpoint grows a `quality` field that flows through to the DALL-E payload and cost calculation. The frontend adds a two-dropdown model picker above the article Regenerate button (populated from the org's connected API keys) and a Standard/HD toggle in the image Generate modal.

**Tech Stack:** FastAPI/SQLAlchemy (API), arq (worker), React/TanStack Query (frontend), TypeScript, Tailwind CSS

## Global Constraints

- API: Python 3.11+, FastAPI, SQLAlchemy async, Pydantic v2 (`model_config = ConfigDict(from_attributes=True)`)
- Tests: pytest-asyncio, SQLite in-memory for unit tests; mock arq pool where needed
- Frontend: Next.js (App Router), React 18, TypeScript strict, Tailwind CSS with `cn()` from `apps/web/lib/cn.ts`
- All fetch functions live in `apps/web/lib/api.ts`
- No new dependencies; no new DB migrations needed (all new fields are in-memory/request params)
- DALL-E quality values are exactly `"standard"` and `"hd"` (OpenAI API strings)
- Provider values are exactly `"anthropic"`, `"openai"`, `"google"` (LLMProvider enum values)
- arq keyword args: `enqueue_job("task_name", pos_arg1, pos_arg2, kwarg=val)` passes kwargs to the task function

---

## File Map

| File | Change |
|------|--------|
| `apps/api/app/api/v1/routers/articles.py` | Add `GenerateArticleRequest` body with optional `provider`/`model`; pass as kwargs to arq |
| `apps/api/app/workers/tasks/article_tasks.py` | Add `provider_override`/`model_override` params; skip LLMRouter when set |
| `apps/api/app/services/image_service.py` | Add `quality` param to `generate_image_dalle()`; update cost |
| `apps/api/app/api/v1/routers/images.py` | Add `quality` field to `GenerateImageRequest`; pass through |
| `apps/api/tests/test_articles.py` | Update generate test to send body `{}`; add override test |
| `apps/api/tests/test_article_tasks.py` | Add test for provider/model override path |
| `apps/api/tests/test_images.py` | Add quality=hd test; verify cost |
| `apps/web/lib/api.ts` | Update `generateArticle()` signature; update `generateImage()` signature |
| `apps/web/app/(dashboard)/[projectId]/articles/page.tsx` | Add `PROVIDER_MODELS` const; add model picker above Regenerate button |
| `apps/web/app/(dashboard)/[projectId]/images/page.tsx` | Add quality state + Standard/HD toggle to `GenerateModal` |

---

### Task 1: API — article generate accepts provider/model override

**Files:**
- Modify: `apps/api/app/api/v1/routers/articles.py`
- Modify: `apps/api/app/workers/tasks/article_tasks.py`
- Test: `apps/api/tests/test_articles.py`
- Test: `apps/api/tests/test_article_tasks.py`

**Interfaces:**
- Produces: `generate_article_task(ctx, article_id: str, org_id: str, provider_override: str | None = None, model_override: str | None = None)`
- Produces: `generateArticle(id, options?)` in api.ts (consumed by Task 3)

**Context:**
- Current generate endpoint is at `apps/api/app/api/v1/routers/articles.py`, function `generate_article` (~line 150). It currently takes no body. Adding a Pydantic body with all-optional fields is backwards-compatible — the frontend already sends `{}`.
- The arq enqueue call is `await redis_pool.enqueue_job("generate_article_task", str(article.id), str(current_user.org_id))`. arq passes kwargs straight to the task function.
- `generate_article_task` lives in `apps/api/app/workers/tasks/article_tasks.py`, Phase 1 (~line 80). LLMRouter logic is at lines 102-109.
- Existing tests in `tests/test_articles.py` call the generate endpoint with an empty body `{}` — they must still pass unchanged.

- [ ] **Step 1: Write failing tests**

In `apps/api/tests/test_articles.py`, add after the existing `test_generate_article_enqueues_job` test:

```python
@pytest.mark.asyncio
async def test_generate_article_with_provider_override(db_session):
    """Passing provider+model in body is forwarded to arq as kwargs."""
    org = Organization(slug="test-org-override", name="Org")
    db_session.add(org)
    await db_session.flush()
    project = Project(org_id=org.id, name="P", domain="ex.com")
    db_session.add(project)
    await db_session.flush()
    user = User(org_id=org.id, email="u@ex.com", hashed_password="x", role="admin")
    db_session.add(user)
    article = Article(
        org_id=org.id, project_id=project.id, title="T",
        status=ArticleStatus.draft, tone="professional",
        word_count_target=1000,
    )
    db_session.add(article)
    await db_session.commit()

    token = create_access_token({"sub": str(user.id), "org_id": str(org.id)})
    enqueued_kwargs = {}

    async def fake_enqueue(fn, *args, **kwargs):
        enqueued_kwargs.update(kwargs)

    mock_pool = AsyncMock()
    mock_pool.enqueue_job = fake_enqueue
    mock_pool.aclose = AsyncMock()

    with patch("app.api.v1.routers.articles.arq.create_pool", return_value=mock_pool):
        resp = await client.post(
            f"/api/v1/articles/{article.id}/generate",
            json={"provider": "openai", "model": "gpt-4o"},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 200
    assert resp.json()["status"] == "generating"
    assert enqueued_kwargs.get("provider_override") == "openai"
    assert enqueued_kwargs.get("model_override") == "gpt-4o"
```

In `apps/api/tests/test_article_tasks.py`, add after existing tests:

```python
@pytest.mark.asyncio
async def test_generate_article_task_provider_override():
    """When provider_override + model_override are given, LLMRouter is bypassed."""
    article_id = await _seed(with_key=True)  # seeds anthropic key

    fake_raw = "META_TITLE: Override Title\nMETA_DESCRIPTION: Desc\n\n---\n\n# Body"

    with (
        patch("app.workers.tasks.article_tasks.async_session_factory", return_value=TestSessionLocal()),
        patch("app.workers.tasks.article_tasks.call_llm", new_callable=AsyncMock, return_value=fake_raw) as mock_call,
    ):
        await generate_article_task(
            {}, str(article_id), str(FAKE_ORG_ID),
            provider_override="anthropic",
            model_override="claude-haiku-4-5-20251001",
        )

    # call_llm was called with the overridden model, not the router's default
    mock_call.assert_called_once()
    call_args = mock_call.call_args
    assert call_args[0][0] == "anthropic"
    assert call_args[0][1] == "claude-haiku-4-5-20251001"

    async with TestSessionLocal() as s:
        art = await s.get(Article, article_id)
    assert art.status == ArticleStatus.ready
```

- [ ] **Step 2: Run tests — confirm both new tests fail**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex/apps/api
python -m pytest tests/test_articles.py::test_generate_article_with_provider_override tests/test_article_tasks.py::test_generate_article_task_provider_override -v
```
Expected: FAIL (generate endpoint rejects unknown body field OR kwargs not forwarded; task doesn't accept override params).

- [ ] **Step 3: Update `apps/api/app/api/v1/routers/articles.py`**

Add `GenerateArticleRequest` schema (near the top with other schemas, around line 30) and update the generate endpoint signature and arq call:

```python
# After existing ArticleOut schema
class GenerateArticleRequest(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None
```

Update the generate endpoint:

```python
@router.post("/{article_id}/generate", response_model=ArticleOut)
async def generate_article(
    article_id: uuid.UUID,
    body: GenerateArticleRequest,          # NEW — replaces no-body version
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
            provider_override=body.provider,    # NEW
            model_override=body.model,          # NEW
        )
    finally:
        await redis_pool.aclose()
    return ArticleOut.model_validate(article)
```

Ensure `Optional` is imported (from `typing import Optional` already present at top or add it).

- [ ] **Step 4: Update `apps/api/app/workers/tasks/article_tasks.py`**

Change the function signature and Phase 1 LLMRouter logic:

```python
async def generate_article_task(
    ctx,
    article_id: str,
    org_id: str,
    provider_override: str | None = None,
    model_override: str | None = None,
):
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

        try:
            if provider_override and model_override and provider_override in org_keys:
                provider_val = provider_override
                model = model_override
            else:
                available_providers = {LLMProvider(p) for p in org_keys}
                resolved_provider, model = LLMRouter(available_providers).resolve(TaskType.LONG_FORM_ARTICLE)
                provider_val = resolved_provider.value
        except (ValueError, KeyError) as e:
            article.status = ArticleStatus.failed
            article.error = str(e)
            await db.commit()
            return

        api_key = org_keys[provider_val]

        system_prompt = _build_system_prompt(brand_voice)
        user_prompt = _build_user_prompt(article)
        article_title = article.title

    # Phase 2: call LLM (outside DB session)
    try:
        raw = await call_llm(provider_val, model, api_key, system_prompt, user_prompt)
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

- [ ] **Step 5: Run all article tests**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex/apps/api
python -m pytest tests/test_articles.py tests/test_article_tasks.py -v
```
Expected: all tests pass (new + existing).

- [ ] **Step 6: Commit**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex
git add apps/api/app/api/v1/routers/articles.py apps/api/app/workers/tasks/article_tasks.py apps/api/tests/test_articles.py apps/api/tests/test_article_tasks.py
git commit -m "feat(api): article generate endpoint accepts provider/model override"
```

---

### Task 2: API — image generate accepts quality parameter

**Files:**
- Modify: `apps/api/app/services/image_service.py`
- Modify: `apps/api/app/api/v1/routers/images.py`
- Test: `apps/api/tests/test_images.py` (create if missing)

**Interfaces:**
- Produces: `generate_image_dalle(prompt, style, usage, openai_api_key, quality="standard")` — `quality` in `{"standard", "hd"}`
- Produces: `GenerateImageRequest.quality: Optional[str] = "standard"`

**Context:**
- DALL-E 3 pricing: standard 1024×1024 = $0.04, standard 1792×1024 = $0.08; HD 1024×1024 = $0.08, HD 1792×1024 = $0.12.
- `generate_image_dalle` currently hardcodes `"quality": "standard"` in the payload (line 70) and sets cost per usage.
- The router at line 131 calls `generate_image_dalle(prompt=prompt, style=style, usage=usage, openai_api_key=openai_key)`.
- Sending `quality=hd` to the DALL-E API requires just passing the string; OpenAI accepts `"standard"` or `"hd"`.

- [ ] **Step 1: Create or open test file**

Create `apps/api/tests/test_images.py` if it doesn't exist. Check first:

```bash
ls /home/mhamnache/Startup/AI/claude/fennex/apps/api/tests/
```

If the file exists, open it; otherwise create it with:

```python
"""Tests for image service and router."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
```

- [ ] **Step 2: Write failing tests for quality parameter**

Add to `tests/test_images.py`:

```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

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
```

- [ ] **Step 3: Run tests — confirm they fail**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex/apps/api
python -m pytest tests/test_images.py -v
```
Expected: ImportError or `TypeError: generate_image_dalle() got unexpected keyword argument 'quality'`.

- [ ] **Step 4: Update `apps/api/app/services/image_service.py`**

Replace the function signature and the cost/payload section:

```python
async def generate_image_dalle(
    prompt: str,
    style: str,
    usage: str,
    openai_api_key: str,
    quality: str = "standard",   # NEW — "standard" or "hd"
) -> dict:
    """
    Generate image via DALL-E 3 API.

    Returns: {ok: True, image_url, revised_prompt, width, height, cost_usd}
    Or: {ok: False, error: str}

    Timeout: 60s.
    """
    # Determine size and cost based on usage and quality
    if usage == "article_cover":
        size = "1792x1024"
        width = 1792
        height = 1024
        cost_usd = 0.12 if quality == "hd" else 0.08
    else:
        size = "1024x1024"
        width = 1024
        height = 1024
        cost_usd = 0.08 if quality == "hd" else 0.04

    payload = {
        "model": "dall-e-3",
        "prompt": prompt,
        "n": 1,
        "size": size,
        "quality": quality,      # was hardcoded "standard"
        "response_format": "url",
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/images/generations",
                headers={
                    "Authorization": f"Bearer {openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            image_data = data["data"][0]
            return {
                "ok": True,
                "image_url": image_data["url"],
                "revised_prompt": image_data.get("revised_prompt"),
                "width": width,
                "height": height,
                "cost_usd": cost_usd,
            }
    except httpx.HTTPStatusError as e:
        try:
            error_body = e.response.json()
            error_msg = error_body.get("error", {}).get("message", f"HTTP {e.response.status_code}")
        except Exception:
            error_msg = f"HTTP {e.response.status_code}"
        logger.error("DALL-E API HTTP error %s: %s", e.response.status_code, error_msg)
        return {"ok": False, "error": f"DALL-E error: {error_msg}"}
    except Exception as e:
        logger.error("DALL-E API error: %s", e)
        return {"ok": False, "error": str(e)}
```

- [ ] **Step 5: Update `apps/api/app/api/v1/routers/images.py`**

Add `quality` to `GenerateImageRequest`:

```python
class GenerateImageRequest(BaseModel):
    project_id: uuid.UUID
    prompt: Optional[str] = None
    title: Optional[str] = None
    keyword: Optional[str] = None
    style: Optional[str] = ImageStyle.professional
    usage: Optional[str] = ImageUsage.article_cover
    article_id: Optional[uuid.UUID] = None
    social_post_id: Optional[uuid.UUID] = None
    quality: Optional[str] = "standard"   # NEW — "standard" or "hd"
```

Update the `generate_image_dalle` call inside the endpoint (~line 131):

```python
    if api_key_row is not None:
        openai_key = decrypt_api_key(api_key_row.encrypted_value)
        result = await generate_image_dalle(
            prompt=prompt,
            style=style,
            usage=usage,
            openai_api_key=openai_key,
            quality=body.quality or "standard",   # NEW
        )
    else:
        result = get_placeholder_url(usage)
```

Update `generation_meta` (lines 148–151) to include quality:

```python
    image.generation_meta = {
        "provider": "openai" if api_key_row else "placeholder",
        "model": "dall-e-3" if api_key_row else None,
        "quality": body.quality or "standard",   # NEW
    }
```

- [ ] **Step 6: Run all image tests**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex/apps/api
python -m pytest tests/test_images.py -v
```
Expected: all 3 tests pass.

- [ ] **Step 7: Commit**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex
git add apps/api/app/services/image_service.py apps/api/app/api/v1/routers/images.py apps/api/tests/test_images.py
git commit -m "feat(api): image generate accepts quality parameter (standard/hd) with correct DALL-E 3 pricing"
```

---

### Task 3: Frontend — article model picker

**Files:**
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/app/(dashboard)/[projectId]/articles/page.tsx`

**Interfaces:**
- Consumes: Task 1's `GenerateArticleRequest { provider?, model? }` endpoint
- Consumes: existing `listApiKeys(): Promise<ApiKey[]>` from `apps/web/lib/api.ts` (already exported)
- `ApiKey` interface: `{ id: string; provider: string; masked_value: string; created_at: string | null }`

**Context:**
- `generateArticle` is at `apps/web/lib/api.ts:462`. It currently sends `{}` as body.
- The article editor is the component that owns the Regenerate button (~line 815 of articles/page.tsx). It has state for `articleId`, `generateMutation`, etc.
- The Regenerate button section (lines 814–830) renders inside a right sidebar `<div className="border-t border-border pt-4 flex flex-col gap-2">`.
- `listApiKeys` is already exported from `apps/web/lib/api.ts` (line 951). It must be imported in the articles page.
- The picker appears ABOVE the Regenerate button. When no selection (default), calls `generateArticle(id)` with no override (auto-routing). When a model is selected, passes `{provider, model}`.
- Hardcode model options per provider in a `PROVIDER_MODELS` constant (not fetched from API).

**PROVIDER_MODELS constant (place near the top of articles/page.tsx file, after imports):**

```typescript
const PROVIDER_MODELS: Record<string, { label: string; models: { id: string; label: string }[] }> = {
  anthropic: {
    label: "Anthropic",
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
  },
  openai: {
    label: "OpenAI",
    models: [
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
    ],
  },
  google: {
    label: "Google",
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    ],
  },
};
```

- [ ] **Step 1: Update `apps/web/lib/api.ts` — `generateArticle` signature**

Find line 462:
```typescript
export async function generateArticle(id: string): Promise<Article> {
  return apiClient.post<Article>(`/articles/${id}/generate`, {});
}
```

Replace with:
```typescript
export async function generateArticle(
  id: string,
  options?: { provider?: string; model?: string },
): Promise<Article> {
  return apiClient.post<Article>(`/articles/${id}/generate`, options ?? {});
}
```

- [ ] **Step 2: Add `PROVIDER_MODELS` constant to articles/page.tsx**

Find the first `const` declaration after the import block (e.g., `const STATUS_TONE = ...`). Insert `PROVIDER_MODELS` before it:

```typescript
const PROVIDER_MODELS: Record<string, { label: string; models: { id: string; label: string }[] }> = {
  anthropic: {
    label: "Anthropic",
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
  },
  openai: {
    label: "OpenAI",
    models: [
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
    ],
  },
  google: {
    label: "Google",
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    ],
  },
};
```

- [ ] **Step 3: Add `listApiKeys` to the articles page import**

Find the existing import of `generateArticle` from `"@/lib/api"` (~line 26). Add `listApiKeys` to the same import:

```typescript
import {
  // ... existing imports ...
  generateArticle,
  listApiKeys,
  // ...
} from "@/lib/api";
```

- [ ] **Step 4: Add model picker state and query to the article editor component**

The article editor component is the one that renders the Regenerate button. Find the component that has:
```typescript
const generateMutation = useMutation({
  mutationFn: () => generateArticle(articleId),
```

Add two new state vars and a query near the top of that component (alongside other `useState` / `useQuery` hooks):

```typescript
const [selectedProvider, setSelectedProvider] = useState<string>("");
const [selectedModel, setSelectedModel] = useState<string>("");

const { data: apiKeys = [] } = useQuery({
  queryKey: ["api-keys"],
  queryFn: listApiKeys,
});

const connectedProviders = apiKeys
  .map((k) => k.provider)
  .filter((p) => p in PROVIDER_MODELS);
```

Update `generateMutation` to pass overrides when both are set:

```typescript
const generateMutation = useMutation({
  mutationFn: () =>
    generateArticle(
      articleId,
      selectedProvider && selectedModel
        ? { provider: selectedProvider, model: selectedModel }
        : undefined,
    ),
  onSuccess: (updated) => {
    queryClient.setQueryData(["article", articleId], updated);
    setBody(updated.body_markdown ?? "");
    queryClient.invalidateQueries({ queryKey: ["article-seo", articleId] });
    success("Article regenerated");
  },
  onError: () => error("Couldn't regenerate article"),
});
```

- [ ] **Step 5: Add model picker UI above the Regenerate button**

Find the Regenerate button block (around line 814):
```tsx
<div className="border-t border-border pt-4 flex flex-col gap-2">
  {/* Regenerate */}
  <button
    onClick={() => generateMutation.mutate()}
```

Insert the model picker INSIDE that `<div>`, before the Regenerate button:

```tsx
{/* Model picker */}
{connectedProviders.length > 0 && (
  <div className="flex flex-col gap-1.5">
    <label className="text-xs font-medium text-muted-foreground">
      Model
    </label>
    <div className="flex gap-1.5">
      <select
        value={selectedProvider}
        onChange={(e) => {
          setSelectedProvider(e.target.value);
          setSelectedModel(
            e.target.value
              ? (PROVIDER_MODELS[e.target.value]?.models[0]?.id ?? "")
              : "",
          );
        }}
        className="flex-1 rounded-lg border border-border bg-input px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
      >
        <option value="">Auto</option>
        {connectedProviders.map((p) => (
          <option key={p} value={p}>
            {PROVIDER_MODELS[p]?.label ?? p}
          </option>
        ))}
      </select>
      {selectedProvider && (
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-input px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        >
          {(PROVIDER_MODELS[selectedProvider]?.models ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 6: Type-check**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex
pnpm --filter @fennex/web tsc --noEmit 2>&1 | head -40
```
Expected: 0 errors (or only pre-existing unrelated errors).

- [ ] **Step 7: Commit**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex
git add apps/web/lib/api.ts apps/web/app/\(dashboard\)/\[projectId\]/articles/page.tsx
git commit -m "feat(web): article editor — model picker for generation (provider + model dropdowns)"
```

---

### Task 4: Frontend — image quality picker

**Files:**
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/app/(dashboard)/[projectId]/images/page.tsx`

**Interfaces:**
- Consumes: Task 2's `quality` field in `POST /images/generate`
- `generateImage` already exists; add optional `quality` field

**Context:**
- `GenerateModal` is the component at `images/page.tsx:242`. It has `usage`, `style`, `prompt`, `title`, `keyword`, `articleId` state. The Generate button is at ~line 430.
- The quality toggle goes BELOW the Style select (before the Prompt textarea). This mirrors the style field format: label + select.
- Show costs inline as a hint: Standard (from $0.04) / HD (from $0.08).
- `generateImage` in `api.ts` at line 661 accepts a data object. Add `quality?: "standard" | "hd"`.

- [ ] **Step 1: Update `apps/web/lib/api.ts` — `generateImage` signature**

Find the `generateImage` function at line 661:

```typescript
export async function generateImage(data: {
  project_id: string;
  prompt?: string;
  title?: string;
  keyword?: string;
  style?: ImageStyle;
  usage?: ImageUsage;
  article_id?: string;
  social_post_id?: string;
}): Promise<GeneratedImage> {
  return apiClient.post<GeneratedImage>("/images/generate", data);
}
```

Replace with:

```typescript
export async function generateImage(data: {
  project_id: string;
  prompt?: string;
  title?: string;
  keyword?: string;
  style?: ImageStyle;
  usage?: ImageUsage;
  article_id?: string;
  social_post_id?: string;
  quality?: "standard" | "hd";   // NEW
}): Promise<GeneratedImage> {
  return apiClient.post<GeneratedImage>("/images/generate", data);
}
```

- [ ] **Step 2: Add quality state to `GenerateModal` in images/page.tsx**

Find the state declarations inside `GenerateModal` (~line 251):

```typescript
const [usage, setUsage] = useState<ImageUsage>("article_cover");
const [style, setStyle] = useState<ImageStyle>("professional");
const [prompt, setPrompt] = useState("");
```

Add quality state after them:

```typescript
const [quality, setQuality] = useState<"standard" | "hd">("standard");
```

- [ ] **Step 3: Pass quality to `generateImage` in `handleGenerate`**

Find `handleGenerate` (~line 269). The `generateImage` call currently is:

```typescript
const image = await generateImage({
  project_id: projectId,
  usage,
  style,
  ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
  ...(title.trim() ? { title: title.trim() } : {}),
  ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
  ...(articleId ? { article_id: articleId } : {}),
});
```

Add `quality` to the call:

```typescript
const image = await generateImage({
  project_id: projectId,
  usage,
  style,
  quality,              // NEW
  ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
  ...(title.trim() ? { title: title.trim() } : {}),
  ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
  ...(articleId ? { article_id: articleId } : {}),
});
```

- [ ] **Step 4: Add Quality toggle UI to the `GenerateModal` form**

Find the Style select block (~line 342):

```tsx
<div>
  <label className="block text-sm font-medium text-foreground mb-1.5">
    Style
  </label>
  <select ...>
```

Insert the Quality block IMMEDIATELY AFTER the Style closing `</div>`:

```tsx
<div>
  <label className="block text-sm font-medium text-foreground mb-1.5">
    Quality
  </label>
  <div className="flex gap-2">
    {(["standard", "hd"] as const).map((q) => (
      <button
        key={q}
        type="button"
        onClick={() => setQuality(q)}
        className={cn(
          "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
          quality === q
            ? "border-primary bg-primary/10 text-primary"
            : "border-border text-muted-foreground hover:bg-accent",
        )}
      >
        <span className="capitalize">{q}</span>
        <span className="block text-[10px] font-normal mt-0.5 opacity-70">
          {q === "standard" ? "from $0.04" : "from $0.08"}
        </span>
      </button>
    ))}
  </div>
</div>
```

Ensure `cn` is imported. It's at `apps/web/lib/cn.ts` and should already be used in the page — check:

```bash
grep -n "from.*cn\|import.*cn" /home/mhamnache/Startup/AI/claude/fennex/apps/web/app/\(dashboard\)/\[projectId\]/images/page.tsx | head -5
```

If not imported, add `import { cn } from "@/lib/cn";` to the page imports.

- [ ] **Step 5: Type-check**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex
pnpm --filter @fennex/web tsc --noEmit 2>&1 | head -40
```
Expected: 0 errors (or only pre-existing unrelated errors).

- [ ] **Step 6: Commit**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex
git add apps/web/lib/api.ts apps/web/app/\(dashboard\)/\[projectId\]/images/page.tsx
git commit -m "feat(web): image generate modal — Standard/HD quality toggle with cost hints"
```
