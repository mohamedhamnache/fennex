# Async LLM Article Generation

**Date:** 2026-06-27
**Status:** Approved

## Overview

Wire real LLM providers (Anthropic, OpenAI, Google) into article generation using the existing arq worker infrastructure. The endpoint returns immediately with `status: generating`; the worker calls the LLM in the background and saves the result. The frontend polls until the article settles to `ready` or `failed`.

## Architecture

```
POST /articles/{id}/generate
  │  set status=generating, commit
  │  enqueue arq job: generate_article_task(article_id, org_id)
  └─► return article (status: "generating")

arq worker: generate_article_task(article_id, org_id)
  │  load article + decrypt org API keys from DB
  │  LLMRouter picks provider/model based on available keys
  │  call LLM via official SDK (Anthropic / OpenAI) or httpx (Google)
  │  parse delimiter-based response
  │  save body_markdown, body_html, meta_title, meta_description, word_count, seo_score
  │  set status=ready  (or status=failed + article.error on exception)

Frontend — articles page
  │  listArticles: refetchInterval=3000 while any article.status === "generating"
  └─► article detail: refetchInterval=3000 while article.status === "generating"
```

This mirrors the existing keyword research pattern (`run_keyword_research` / `KeywordResearchJob`) exactly.

## New Files

### `app/services/llm_service.py`

Two functions:

**`get_org_llm_keys(org_id, db) → dict[str, str]`**
Queries `api_keys` for the org, decrypts each value via `decrypt_value`, returns a plain dict `{"anthropic": "sk-ant-...", "openai": "sk-..."}`. Used to build the `available_providers` set for `LLMRouter`.

**`call_llm(provider, model, api_key, system_prompt, user_prompt) → str`**
Dispatches to the right SDK/client:
- `anthropic` → `anthropic.Anthropic(api_key=...).messages.create(...)`, extracts `.content[0].text`
- `openai` → `openai.OpenAI(api_key=...).chat.completions.create(...)`, extracts `.choices[0].message.content`
- `google` → raw `httpx.AsyncClient` POST to `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`

All three calls are `async`-compatible (Anthropic and OpenAI SDKs are used in their async variants).

### `app/workers/tasks/article_tasks.py`

**`generate_article_task(ctx, article_id: str, org_id: str)`** — arq task.

Steps:
1. Open DB session, load `Article` by id.
2. Call `get_org_llm_keys(org_id, db)` → build `available_providers` set.
3. If no keys: set `status=failed`, `error="No LLM API keys configured. Add keys in Settings."`, commit, return.
4. `LLMRouter(available_providers).resolve(TaskType.LONG_FORM_ARTICLE)` → `(provider, model)`.
5. Build system prompt: SEO writer persona always included. If `article.brand_voice_id` is set, load the `BrandVoice` row and append `voice_prompt`, `tone`, `vocabulary`, and `avoid_words` to the system prompt. If `brand_voice_id` is null, use `article.tone` for tone only.
6. Build user prompt (title, keyword, tone, word count target, output format).
7. `call_llm(provider, model, api_key, system_prompt, user_prompt)` → raw text.
8. Parse response (see Prompt Format below).
9. Convert markdown to HTML via existing `_markdown_to_html` from `article_service.py`.
10. Compute `seo_score` via existing `_deterministic_seo_score`.
11. Save all fields to article, set `status=ready`, add `ArticleRevision`, commit.
12. On any exception: set `status=failed`, `error=str(e)`, commit, re-raise.

## Prompt Format

**System prompt:**
```
You are an expert SEO content writer. Write comprehensive, well-structured, engaging articles
that rank well in search engines and genuinely help readers.
[If brand voice present:]
Brand voice instructions: {voice_prompt}. Tone: {tone}. 
Preferred vocabulary: {vocabulary}. Avoid: {avoid_words}.
```

**User prompt:**
```
Write a complete SEO-optimized article with these specifications:
- Title: {title}
- Target keyword: {keyword or title}
- Tone: {tone}
- Target length: approximately {word_count_target} words

Structure:
- H1 title
- Engaging introduction (mention the keyword naturally)
- 5–7 H2 sections with detailed paragraphs
- Conclusion

Reply in this exact format (do not add anything before META_TITLE):

META_TITLE: <SEO title, max 60 characters>
META_DESCRIPTION: <SEO description, max 160 characters>

---

<full article in Markdown>
```

**Parsing logic:**
1. Split on `\n---\n` (first occurrence). Everything after is `body_markdown`.
2. From the part before the separator, extract lines starting with `META_TITLE:` and `META_DESCRIPTION:`.
3. Fallback if parsing fails: entire response becomes `body_markdown`; `meta_title` is truncated title; `meta_description` is first 157 chars of body + `"..."`.

## Changes to Existing Files

### `app/api/v1/routers/articles.py`

`generate_article` endpoint:
- Remove import of `generate_article_mock` and the synchronous call block.
- After setting `status=generating` and committing, open an arq pool and enqueue `generate_article_task(str(article.id), str(current_user.org_id))`.
- Return `ArticleOut.model_validate(article)` immediately.

### `app/workers/worker.py`

- Import `generate_article_task` from `app.workers.tasks.article_tasks`.
- Add to `functions` list.
- Bump `job_timeout` from 600 to 600 (already sufficient; article gen ≤ 120s).

### `apps/api/pyproject.toml`

Add to `dependencies`:
```
anthropic>=0.28.0
openai>=1.30.0
```

### Frontend — `apps/web/app/(dashboard)/[projectId]/articles/page.tsx`

**Article list query** (`listArticles`):
```ts
refetchInterval: (query) => {
  const articles = query.state.data ?? [];
  return articles.some((a) => a.status === "generating") ? 3000 : false;
}
```

**Article detail query** (`getArticle` in the editor component):
```ts
refetchInterval: (query) => {
  return query.state.data?.status === "generating" ? 3000 : false;
}
```

No other UI changes — the `generating` badge and error display already exist.

## Error Handling

| Scenario | Behaviour |
|---|---|
| No API keys for org | `status=failed`, `error="No LLM API keys configured. Add keys in Settings."` |
| Preferred provider unavailable | `LLMRouter` falls back to next available provider automatically |
| LLM API error (rate limit, auth) | `status=failed`, `error=<exception message>` |
| Response parse failure | Fallback parsing (full response as body, generated meta) — `status=ready` |
| Network timeout | `status=failed`, `error=<timeout message>` |

## Out of Scope

- Streaming responses to the frontend (can be added later)
- Per-article provider override (LLMRouter handles routing automatically)
- Regeneration of brand voice prompt (uses existing `voice_prompt` field if set)
