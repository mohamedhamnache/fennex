# Image Studio Phase 3B — Smart Content-Aware Features

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Analyze article content and automatically suggest or auto-generate images at the right positions — hero image, section illustrations, infographics. Users editing an article see a sidebar "Image Suggestions" panel powered by Claude/GPT that reads the article and proposes 3–5 specific image ideas, each with a "Generate" button.

**Architecture:** New `POST /articles/{id}/suggest-images` endpoint reads the article body, calls the org LLM, and returns a list of `{section_hint, image_concept, suggested_prompt, placement}` objects. The article editor page gets a collapsible right panel showing these suggestions. Each suggestion has a "Generate" button that fires the existing `generate_image` endpoint with the suggested prompt and attaches the result to the article. No new DB tables — uses existing `GeneratedImage.article_id` relationship.

**Tech Stack:** FastAPI, existing `call_llm` from `llm_service`, Next.js 14 App Router, TanStack Query v5, Tailwind CSS v3

## Global Constraints

- Python 3.11+, FastAPI, SQLAlchemy 2 async, Pydantic v2
- TypeScript: 0 errors (`cd apps/web && npm run typecheck`)
- TDD: write failing test first, then implement

---

### Task 1: Article suggest-images endpoint

**Files:**
- Create: `apps/api/app/api/v1/routers/articles_images.py`
- Modify: `apps/api/app/api/v1/router.py`
- Test: `apps/api/tests/test_article_image_suggestions.py`

**Interfaces:**
- Produces: `POST /api/v1/articles/{article_id}/suggest-images` → `list[ImageSuggestion]`

Each `ImageSuggestion`:
```json
{
  "placement": "hero",
  "section_hint": "Introduction about remote work trends",
  "image_concept": "Person working from a cozy cafe with laptop",
  "suggested_prompt": "Ultra-realistic photo of a focused professional working on a laptop in a warm, sunlit coffee shop..."
}
```

- [ ] **Step 1: Write failing test**

```python
# apps/api/tests/test_article_image_suggestions.py
import pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient


async def test_suggest_images_returns_list(client: AsyncClient, auth_headers: dict, sample_article):
    mock_response = '''[
      {"placement": "hero", "section_hint": "Intro", "image_concept": "Remote worker", "suggested_prompt": "Professional working from home in modern apartment..."},
      {"placement": "body", "section_hint": "Section 2", "image_concept": "Team collaboration", "suggested_prompt": "Diverse team video call on laptop screen..."}
    ]'''
    with patch("app.api.v1.routers.articles_images.call_llm", AsyncMock(return_value=mock_response)):
        with patch("app.api.v1.routers.articles_images.get_org_llm_keys", AsyncMock(return_value={"anthropic": "sk-test"})):
            response = await client.post(
                f"/api/v1/articles/{sample_article.id}/suggest-images",
                headers=auth_headers,
            )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 2
    assert data[0]["placement"] == "hero"
    assert "suggested_prompt" in data[0]


async def test_suggest_images_no_llm_keys(client: AsyncClient, auth_headers: dict, sample_article):
    with patch("app.api.v1.routers.articles_images.get_org_llm_keys", AsyncMock(return_value={})):
        response = await client.post(
            f"/api/v1/articles/{sample_article.id}/suggest-images",
            headers=auth_headers,
        )
    assert response.status_code == 422


async def test_suggest_images_article_not_found(client: AsyncClient, auth_headers: dict):
    response = await client.post(
        "/api/v1/articles/00000000-0000-0000-0000-000000000000/suggest-images",
        headers=auth_headers,
    )
    assert response.status_code == 404
```

Run: `cd apps/api && pytest tests/test_article_image_suggestions.py -v`
Expected: FAIL (404 — endpoint not registered)

- [ ] **Step 2: Create router**

```python
# apps/api/app/api/v1/routers/articles_images.py
import json
import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from app.core.dependencies import CurrentUser, DB
from app.models.article import Article
from app.services.llm_service import get_org_llm_keys, call_llm

router = APIRouter()

_SUGGEST_SYSTEM = (
    "You are an expert content strategist. "
    "Given article content, identify 3–5 places where images would enhance the reader experience. "
    "For each, specify: placement (hero/body/sidebar), the section it belongs to, "
    "a concise image concept, and a detailed AI image generation prompt. "
    "Respond ONLY with a JSON array of objects with keys: "
    "placement, section_hint, image_concept, suggested_prompt. "
    "No markdown, no extra text."
)

_PROVIDERS = [
    ("anthropic", "claude-haiku-4-5-20251001"),
    ("openai", "gpt-4o-mini"),
]


class ImageSuggestion(BaseModel):
    placement: str
    section_hint: str
    image_concept: str
    suggested_prompt: str


@router.post("/{article_id}/suggest-images", response_model=list[ImageSuggestion])
async def suggest_images_for_article(article_id: uuid.UUID, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(Article).where(
            Article.id == article_id,
            Article.org_id == current_user.org_id,
        )
    )
    article = result.scalar_one_or_none()
    if article is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Article not found")

    keys = await get_org_llm_keys(current_user.org_id, db)
    if not keys:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "No AI API key configured. Add an Anthropic or OpenAI key in Settings → API Keys.",
        )

    # Build article content for context
    body_text = article.content or ""
    if len(body_text) > 4000:
        body_text = body_text[:4000] + "…"

    user_msg = (
        f"Article title: {article.title or 'Untitled'}\n\n"
        f"Article content:\n{body_text}"
    )

    last_error = None
    for provider, model in _PROVIDERS:
        if provider not in keys:
            continue
        try:
            raw = await call_llm(provider, model, keys[provider], _SUGGEST_SYSTEM, user_msg)
            suggestions_data = json.loads(raw.strip())
            return [ImageSuggestion(**s) for s in suggestions_data[:5]]
        except Exception as e:
            last_error = e
            continue

    raise HTTPException(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        f"LLM call failed: {last_error}",
    )
```

- [ ] **Step 3: Register router**

```python
# apps/api/app/api/v1/router.py — add:
from app.api.v1.routers import articles_images

api_router.include_router(articles_images.router, prefix="/articles", tags=["articles-images"])
```

- [ ] **Step 4: Run tests and commit**

```bash
cd apps/api && pytest tests/test_article_image_suggestions.py -v
git add apps/api/app/api/v1/routers/articles_images.py apps/api/app/api/v1/router.py apps/api/tests/test_article_image_suggestions.py
git commit -m "feat(smart-content): add POST /articles/{id}/suggest-images endpoint"
```

---

### Task 2: Frontend API client

**Files:**
- Modify: `apps/web/lib/api.ts`

- [ ] **Step 1: Add type and function**

```typescript
// apps/web/lib/api.ts

export interface ImageSuggestion {
  placement: string;
  section_hint: string;
  image_concept: string;
  suggested_prompt: string;
}

export async function suggestImagesForArticle(articleId: string): Promise<ImageSuggestion[]> {
  return apiClient.post<ImageSuggestion[]>(`/articles/${articleId}/suggest-images`, {});
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
cd apps/web && npm run typecheck
git add apps/web/lib/api.ts
git commit -m "feat(smart-content): add suggestImagesForArticle API client function"
```

---

### Task 3: Image Suggestions panel in article editor

**Files:**
- Create: `apps/web/components/articles/ImageSuggestionsPanel.tsx`
- Modify: article editor page (find existing article editor component, e.g., `apps/web/app/(dashboard)/[projectId]/articles/[articleId]/page.tsx` or `edit/page.tsx`)

**Interfaces:**
- Consumes: `suggestImagesForArticle`, `generateImage` from `lib/api`
- Produces: collapsible side panel with suggestions list + per-suggestion Generate button

- [ ] **Step 1: Create ImageSuggestionsPanel**

```tsx
// apps/web/components/articles/ImageSuggestionsPanel.tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Image as ImageIcon, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { suggestImagesForArticle, generateImage, type ImageSuggestion } from "@/lib/api";

const PLACEMENT_LABELS: Record<string, string> = {
  hero: "Hero",
  body: "Body",
  sidebar: "Sidebar",
};

interface ImageSuggestionsPanelProps {
  articleId: string;
  projectId: string;
}

export function ImageSuggestionsPanel({ articleId, projectId }: ImageSuggestionsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<ImageSuggestion[]>([]);
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null);
  const qc = useQueryClient();

  const analyzeMutation = useMutation({
    mutationFn: () => suggestImagesForArticle(articleId),
    onSuccess: (data) => {
      setSuggestions(data);
      setIsOpen(true);
    },
  });

  async function handleGenerate(suggestion: ImageSuggestion, idx: number) {
    setGeneratingIdx(idx);
    try {
      await generateImage({
        project_id: projectId,
        prompt: suggestion.suggested_prompt,
        usage: "article_cover",
        article_id: articleId,
      });
      qc.invalidateQueries({ queryKey: ["article-images", articleId] });
    } finally {
      setGeneratingIdx(null);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Image Suggestions
          {suggestions.length > 0 && (
            <span className="rounded-full bg-primary/10 text-primary text-xs font-medium px-1.5 py-0.5">
              {suggestions.length}
            </span>
          )}
        </div>
        {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {isOpen && (
        <div className="border-t border-border p-4 flex flex-col gap-3">
          <button
            type="button"
            disabled={analyzeMutation.isPending}
            onClick={() => analyzeMutation.mutate()}
            className="flex items-center gap-2 self-start rounded-lg bg-primary/10 border border-primary/20 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            {analyzeMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {analyzeMutation.isPending ? "Analyzing…" : suggestions.length > 0 ? "Re-analyze" : "Analyze article"}
          </button>

          {analyzeMutation.isError && (
            <p className="text-xs text-destructive">Analysis failed — ensure an AI key is configured in Settings.</p>
          )}

          {suggestions.map((s, i) => (
            <div key={i} className="rounded-lg border border-border bg-muted/20 p-3 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <span className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  s.placement === "hero" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                )}>
                  {PLACEMENT_LABELS[s.placement] ?? s.placement}
                </span>
                <p className="text-xs text-muted-foreground leading-snug flex-1">{s.section_hint}</p>
              </div>
              <p className="text-xs font-medium text-foreground">{s.image_concept}</p>
              <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">{s.suggested_prompt}</p>
              <button
                type="button"
                disabled={generatingIdx === i}
                onClick={() => handleGenerate(s, i)}
                className="flex items-center gap-1.5 self-start rounded-lg border border-border px-2.5 py-1 text-xs text-foreground hover:bg-accent transition-colors disabled:opacity-50"
              >
                {generatingIdx === i ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ImageIcon className="h-3 w-3" />
                )}
                {generatingIdx === i ? "Generating…" : "Generate"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add to article editor page**

Find the article editor page in `apps/web/app/(dashboard)/[projectId]/articles/`. Add in the right sidebar or below the article form:

```tsx
import { ImageSuggestionsPanel } from "@/components/articles/ImageSuggestionsPanel";

// In JSX (right column or bottom of article form):
<ImageSuggestionsPanel articleId={articleId} projectId={projectId} />
```

- [ ] **Step 3: Typecheck, visual test, commit**

```bash
cd apps/web && npm run typecheck && npm run dev
# Verify: open an article → Image Suggestions panel appears
# Click "Analyze article" → suggestions appear with placement badges
# Click "Generate" on a suggestion → image generated and linked to article
git add apps/web/components/articles/ImageSuggestionsPanel.tsx apps/web/app/
git commit -m "feat(smart-content): add ImageSuggestionsPanel to article editor"
```

---

## Self-Review

| Requirement | Task |
|---|---|
| Analyze article content → suggest images | Task 1 |
| Suggest hero image, body illustrations, sidebar | Tasks 1, 3 |
| Detailed AI-ready prompts for each suggestion | Task 1 |
| "Generate" button per suggestion fires existing generate flow | Task 3 |
| Generated images linked to article via `article_id` | Task 3 |
| Works with Anthropic or OpenAI key (whichever org has) | Task 1 |
| No new DB tables — uses existing `GeneratedImage.article_id` | Task 1 |

All §9 requirements covered. ✓
