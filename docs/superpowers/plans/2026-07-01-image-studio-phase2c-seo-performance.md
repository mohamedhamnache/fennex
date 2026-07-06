# Image Studio Phase 2C — SEO & Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Dependency:** This plan depends on Plan 2A (Brand Kit) for `app/core/storage.py` and Plan 2B (AI Editing) for `Pillow` being installed and `editing_service._download` being available.

**Goal:** Add SEO metadata generation (alt text, captions, SEO filenames) to every generated image using the org's LLM keys, plus WebP/compressed export via Pillow. Every image in the studio gets a one-click "Generate SEO data" button and an "Export" dialog with format/quality options.

**Architecture:** New `alt_text`, `caption`, `seo_filename` columns on `GeneratedImage`. New `seo_service.py` for LLM-powered text generation. New `POST /images/{id}/seo` endpoint auto-generates alt text + caption + slug using the existing `call_llm` helper. New `POST /images/{id}/export` endpoint converts to WebP/JPEG/PNG at chosen quality via Pillow and returns a presigned download URL. Frontend adds a SEO panel below the version strip in the edit page and an Export button on image cards.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, Pillow (already installed), anthropic/openai SDKs (via `llm_service.call_llm`), Next.js 14 App Router, TanStack Query v5, Tailwind CSS v3

## Global Constraints

- Python 3.11+, FastAPI, SQLAlchemy 2 async, Pydantic v2
- Next.js 14 App Router, React 18, TypeScript 5
- Tailwind CSS v3 — CSS variables only, never hard-code colors
- `cn()` from `@/lib/cn`; `@/` path aliases throughout
- TypeScript: 0 errors (`cd apps/web && npm run typecheck`)
- TDD: write failing test first, then implement
- Alembic migration required for every DB column change

---

### Task 1: Add SEO columns to GeneratedImage + migration

**Files:**
- Modify: `apps/api/app/models/image.py`
- Create: migration via autogenerate
- Test: `apps/api/tests/test_seo_columns.py`

**Interfaces:**
- Produces: `GeneratedImage.alt_text`, `.caption`, `.seo_filename` — consumed by Tasks 2, 3, 4

- [ ] **Step 1: Write failing test**

```python
# apps/api/tests/test_seo_columns.py
import pytest
from sqlalchemy import inspect
from app.core.database import async_engine


async def test_generated_image_has_seo_columns():
    async with async_engine.connect() as conn:
        insp = await conn.run_sync(inspect)
        cols = {c["name"] for c in insp.get_columns("generated_images")}
    assert "alt_text" in cols
    assert "caption" in cols
    assert "seo_filename" in cols
```

Run: `cd apps/api && pytest tests/test_seo_columns.py -v`
Expected: FAIL (columns not yet present)

- [ ] **Step 2: Add columns to GeneratedImage**

```python
# apps/api/app/models/image.py — add inside GeneratedImage class after edit_operation:
    alt_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    seo_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
```

- [ ] **Step 3: Generate and apply migration**

```bash
docker compose exec api alembic revision --autogenerate -m "image_seo_columns"
make db-migrate
```

- [ ] **Step 4: Run test**

```bash
cd apps/api && pytest tests/test_seo_columns.py -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/models/image.py apps/api/alembic/versions/ apps/api/tests/test_seo_columns.py
git commit -m "feat(seo): add alt_text, caption, seo_filename columns to GeneratedImage"
```

---

### Task 2: SEO service — LLM-powered text generation

**Files:**
- Create: `apps/api/app/services/seo_service.py`
- Test: `apps/api/tests/test_seo_service.py`

**Interfaces:**
- Produces:
  - `generate_seo_data(prompt: str, usage: str, org_id: UUID, db) -> dict` — returns `{alt_text, caption, seo_filename}`
- Consumed by: Task 3 (endpoint)

- [ ] **Step 1: Write failing test**

```python
# apps/api/tests/test_seo_service.py
import uuid
import pytest
from unittest.mock import AsyncMock, patch
from app.services.seo_service import generate_seo_data


@pytest.mark.asyncio
async def test_generate_seo_data_returns_all_fields(monkeypatch):
    monkeypatch.setattr(
        "app.services.seo_service.get_org_llm_keys",
        AsyncMock(return_value={"anthropic": "sk-test"}),
    )
    monkeypatch.setattr(
        "app.services.seo_service.call_llm",
        AsyncMock(return_value='{"alt_text": "A red sports shoe on white background", "caption": "Classic athletic sneaker in vibrant red.", "seo_filename": "red-sports-shoe-white-background"}'),
    )
    result = await generate_seo_data("Red sports shoe product shot", "article_cover", uuid.uuid4(), db=None)
    assert result["alt_text"] == "A red sports shoe on white background"
    assert result["caption"] == "Classic athletic sneaker in vibrant red."
    assert result["seo_filename"] == "red-sports-shoe-white-background"


@pytest.mark.asyncio
async def test_generate_seo_data_no_llm_keys(monkeypatch):
    monkeypatch.setattr(
        "app.services.seo_service.get_org_llm_keys",
        AsyncMock(return_value={}),
    )
    result = await generate_seo_data("A product image", "article_cover", uuid.uuid4(), db=None)
    assert result["alt_text"] is None
    assert result["error"] == "no_llm_keys"


@pytest.mark.asyncio
async def test_seo_filename_is_slugified(monkeypatch):
    monkeypatch.setattr(
        "app.services.seo_service.get_org_llm_keys",
        AsyncMock(return_value={"openai": "sk-test"}),
    )
    monkeypatch.setattr(
        "app.services.seo_service.call_llm",
        AsyncMock(return_value='{"alt_text": "Laptop on desk", "caption": "Modern laptop.", "seo_filename": "Laptop On Desk!"}'),
    )
    result = await generate_seo_data("Laptop on desk", "article_cover", uuid.uuid4(), db=None)
    assert result["seo_filename"] == "laptop-on-desk"
```

Run: `cd apps/api && pytest tests/test_seo_service.py -v`
Expected: FAIL (module not found)

- [ ] **Step 2: Create seo_service.py**

```python
# apps/api/app/services/seo_service.py
"""LLM-powered SEO metadata generation for images."""
import json
import re
import uuid
from typing import Optional

from app.services.llm_service import get_org_llm_keys, call_llm

_SEO_SYSTEM = (
    "You are an SEO expert specializing in image optimization. "
    "Given an image prompt and usage context, generate: "
    "1) A concise, descriptive alt text (max 125 chars, no 'image of' prefix). "
    "2) A short caption suitable for a blog or product page (max 200 chars). "
    "3) A slug for the filename (lowercase, hyphens only, max 60 chars, no file extension). "
    "Respond with ONLY a JSON object: {\"alt_text\": \"...\", \"caption\": \"...\", \"seo_filename\": \"...\"}. "
    "No markdown, no explanation."
)

_PROVIDERS = [
    ("anthropic", "claude-haiku-4-5-20251001"),
    ("openai", "gpt-4o-mini"),
]


def _slugify(text: str) -> str:
    slug = text.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s-]+", "-", slug).strip("-")
    return slug[:60]


async def generate_seo_data(
    prompt: str,
    usage: str,
    org_id: uuid.UUID,
    db,
) -> dict:
    keys = await get_org_llm_keys(org_id, db)
    if not keys:
        return {"alt_text": None, "caption": None, "seo_filename": None, "error": "no_llm_keys"}

    user_msg = f"Image prompt: {prompt}\nUsage: {usage.replace('_', ' ')}"

    for provider, model in _PROVIDERS:
        if provider not in keys:
            continue
        try:
            raw = await call_llm(provider, model, keys[provider], _SEO_SYSTEM, user_msg)
            data = json.loads(raw.strip())
            return {
                "alt_text": str(data.get("alt_text", ""))[:125] or None,
                "caption": str(data.get("caption", ""))[:200] or None,
                "seo_filename": _slugify(str(data.get("seo_filename", ""))) or None,
            }
        except Exception:
            continue

    return {"alt_text": None, "caption": None, "seo_filename": None, "error": "llm_failed"}
```

- [ ] **Step 3: Run tests**

```bash
cd apps/api && pytest tests/test_seo_service.py -v
```

Expected: 3 PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/app/services/seo_service.py apps/api/tests/test_seo_service.py
git commit -m "feat(seo): add LLM-powered SEO metadata generation service"
```

---

### Task 3: SEO endpoint + Export endpoint

**Files:**
- Create: `apps/api/app/api/v1/routers/seo.py`
- Modify: `apps/api/app/api/v1/router.py`
- Modify: `apps/api/app/api/v1/routers/images.py` (add seo fields to ImageOut)
- Test: `apps/api/tests/test_seo_api.py`

**Interfaces:**
- Produces:
  - `POST /api/v1/images/{id}/seo` → updated `ImageOut` with seo fields populated
  - `POST /api/v1/images/{id}/export` → `{"download_url": str, "format": str, "size_bytes": int}`

- [ ] **Step 1: Add SEO fields to ImageOut**

```python
# apps/api/app/api/v1/routers/images.py — add to ImageOut:
    alt_text: Optional[str] = None
    caption: Optional[str] = None
    seo_filename: Optional[str] = None
```

- [ ] **Step 2: Write failing tests**

```python
# apps/api/tests/test_seo_api.py
import pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient


async def test_generate_seo_data(client: AsyncClient, auth_headers: dict, sample_image):
    with patch(
        "app.api.v1.routers.seo.generate_seo_data",
        AsyncMock(return_value={
            "alt_text": "Red sneaker on white background",
            "caption": "Classic athletic sneaker.",
            "seo_filename": "red-sneaker-white-background",
        }),
    ):
        response = await client.post(
            f"/api/v1/images/{sample_image.id}/seo",
            headers=auth_headers,
        )
    assert response.status_code == 200
    data = response.json()
    assert data["alt_text"] == "Red sneaker on white background"
    assert data["seo_filename"] == "red-sneaker-white-background"


async def test_seo_image_not_found(client: AsyncClient, auth_headers: dict):
    response = await client.post(
        "/api/v1/images/00000000-0000-0000-0000-000000000000/seo",
        headers=auth_headers,
    )
    assert response.status_code == 404


async def test_export_image_webp(client: AsyncClient, auth_headers: dict, sample_image):
    with patch(
        "app.api.v1.routers.seo._convert_and_upload",
        AsyncMock(return_value={"download_url": "https://storage.example.com/export.webp", "size_bytes": 12345}),
    ):
        response = await client.post(
            f"/api/v1/images/{sample_image.id}/export",
            json={"format": "webp", "quality": 85},
            headers=auth_headers,
        )
    assert response.status_code == 200
    data = response.json()
    assert data["format"] == "webp"
    assert "download_url" in data


async def test_export_image_invalid_format(client: AsyncClient, auth_headers: dict, sample_image):
    response = await client.post(
        f"/api/v1/images/{sample_image.id}/export",
        json={"format": "bmp", "quality": 90},
        headers=auth_headers,
    )
    assert response.status_code == 422
```

Run: `cd apps/api && pytest tests/test_seo_api.py -v`
Expected: FAIL (endpoints not registered)

- [ ] **Step 3: Create seo router**

```python
# apps/api/app/api/v1/routers/seo.py
import io
import uuid
from typing import Literal, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import select
from PIL import Image as PILImage
from app.core.dependencies import CurrentUser, DB
from app.core.storage import upload_bytes
from app.models.image import GeneratedImage
from app.services.seo_service import generate_seo_data
from app.services.editing_service import _download

router = APIRouter()

ALLOWED_FORMATS = {"png", "jpg", "webp"}

_FORMAT_PILLOW = {"png": "PNG", "jpg": "JPEG", "webp": "WEBP"}
_FORMAT_MIME = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}


class ExportRequest(BaseModel):
    format: Literal["png", "jpg", "webp"] = "webp"
    quality: int = 85

    @field_validator("quality")
    @classmethod
    def quality_range(cls, v: int) -> int:
        if not (1 <= v <= 100):
            raise ValueError("quality must be between 1 and 100")
        return v


class ExportOut(BaseModel):
    download_url: str
    format: str
    size_bytes: int


class SeoOut(BaseModel):
    id: uuid.UUID
    alt_text: Optional[str] = None
    caption: Optional[str] = None
    seo_filename: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


async def _get_image_or_404(image_id: uuid.UUID, org_id: uuid.UUID, db) -> GeneratedImage:
    result = await db.execute(
        select(GeneratedImage).where(
            GeneratedImage.id == image_id,
            GeneratedImage.org_id == org_id,
        )
    )
    img = result.scalar_one_or_none()
    if img is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    return img


async def _convert_and_upload(image_url: str, fmt: str, quality: int, org_id: uuid.UUID) -> dict:
    data = await _download(image_url)
    pil = PILImage.open(io.BytesIO(data))
    if fmt != "png" and pil.mode == "RGBA":
        pil = pil.convert("RGB")
    buf = io.BytesIO()
    pil.save(buf, format=_FORMAT_PILLOW[fmt], quality=quality if fmt != "png" else None,
             optimize=True, lossless=(fmt == "webp") if False else False)
    buf.seek(0)
    out_bytes = buf.read()
    key = f"exports/{org_id}/{uuid.uuid4().hex}.{fmt}"
    url = await upload_bytes(out_bytes, key, _FORMAT_MIME[fmt])
    return {"download_url": url, "size_bytes": len(out_bytes)}


@router.post("/{image_id}/seo", response_model=SeoOut)
async def generate_image_seo(image_id: uuid.UUID, current_user: CurrentUser, db: DB):
    img = await _get_image_or_404(image_id, current_user.org_id, db)

    seo = await generate_seo_data(img.prompt or "", img.usage or "article_cover", current_user.org_id, db)

    img.alt_text = seo.get("alt_text")
    img.caption = seo.get("caption")
    img.seo_filename = seo.get("seo_filename")
    await db.flush()
    await db.refresh(img)
    await db.commit()
    return SeoOut.model_validate(img)


@router.post("/{image_id}/export", response_model=ExportOut)
async def export_image(image_id: uuid.UUID, body: ExportRequest, current_user: CurrentUser, db: DB):
    img = await _get_image_or_404(image_id, current_user.org_id, db)
    if not img.image_url:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Image has no URL to export")

    result = await _convert_and_upload(img.image_url, body.format, body.quality, current_user.org_id)
    return ExportOut(download_url=result["download_url"], format=body.format, size_bytes=result["size_bytes"])
```

- [ ] **Step 4: Register router**

```python
# apps/api/app/api/v1/router.py — add:
from app.api.v1.routers import seo

api_router.include_router(seo.router, prefix="/images", tags=["seo"])
```

- [ ] **Step 5: Run tests**

```bash
cd apps/api && pytest tests/test_seo_api.py -v
```

Expected: all 4 PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/api/v1/routers/seo.py apps/api/app/api/v1/router.py apps/api/app/api/v1/routers/images.py apps/api/tests/test_seo_api.py
git commit -m "feat(seo): add /images/{id}/seo and /images/{id}/export endpoints"
```

---

### Task 4: Frontend API client additions

**Files:**
- Modify: `apps/web/lib/api.ts`

**Interfaces:**
- Produces: `generateImageSeo()`, `exportImage()`, updated `GeneratedImage` type with seo fields

- [ ] **Step 1: Update GeneratedImage type and add functions**

```typescript
// apps/web/lib/api.ts — add seo fields to GeneratedImage interface:
  alt_text?: string | null;
  caption?: string | null;
  seo_filename?: string | null;

// Add after editImage function:

export async function generateImageSeo(imageId: string): Promise<GeneratedImage> {
  return apiClient.post<GeneratedImage>(`/images/${imageId}/seo`, {});
}

export interface ExportResult {
  download_url: string;
  format: string;
  size_bytes: number;
}

export async function exportImage(
  imageId: string,
  format: "png" | "jpg" | "webp" = "webp",
  quality = 85,
): Promise<ExportResult> {
  return apiClient.post<ExportResult>(`/images/${imageId}/export`, { format, quality });
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/api.ts
git commit -m "feat(seo): add generateImageSeo and exportImage API client functions"
```

---

### Task 5: SEO Panel in edit page

**Files:**
- Create: `apps/web/components/studio/edit/SeoPanel.tsx`
- Modify: `apps/web/app/(dashboard)/[projectId]/images/edit/[imageId]/page.tsx`

**Interfaces:**
- Consumes: `generateImageSeo`, `exportImage` from `lib/api`
- Produces: `<SeoPanel imageId editTargetId />` — displayed below version strip in edit page

- [ ] **Step 1: Create SeoPanel component**

```tsx
// apps/web/components/studio/edit/SeoPanel.tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Download, Copy, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { generateImageSeo, exportImage, type GeneratedImage } from "@/lib/api";

interface SeoPanelProps {
  imageId: string;
  image: GeneratedImage | undefined;
}

export function SeoPanel({ imageId, image }: SeoPanelProps) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<"png" | "jpg" | "webp">("webp");
  const [exportQuality, setExportQuality] = useState(85);

  const seoMutation = useMutation({
    mutationFn: () => generateImageSeo(imageId),
    onSuccess: (data) => {
      qc.setQueryData(["image", imageId], data);
    },
  });

  const exportMutation = useMutation({
    mutationFn: () => exportImage(imageId, exportFormat, exportQuality),
    onSuccess: (data) => {
      const a = document.createElement("a");
      a.href = data.download_url;
      a.download = `${image?.seo_filename || "image"}.${exportFormat}`;
      a.click();
    },
  });

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const hasSeo = !!(image?.alt_text || image?.caption || image?.seo_filename);

  return (
    <div className="border-t border-border bg-card px-4 py-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">SEO & Export</span>
        <button
          type="button"
          onClick={() => seoMutation.mutate()}
          disabled={seoMutation.isPending}
          className="flex items-center gap-1.5 rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          <Sparkles className="h-3 w-3" />
          {seoMutation.isPending ? "Generating…" : hasSeo ? "Regenerate SEO" : "Generate SEO"}
        </button>
      </div>

      {hasSeo && (
        <div className="grid grid-cols-1 gap-2">
          {image?.alt_text && (
            <SeoField label="Alt text" value={image.alt_text} fieldKey="alt" copied={copied} onCopy={copyToClipboard} />
          )}
          {image?.caption && (
            <SeoField label="Caption" value={image.caption} fieldKey="caption" copied={copied} onCopy={copyToClipboard} />
          )}
          {image?.seo_filename && (
            <SeoField label="Filename" value={`${image.seo_filename}.${exportFormat}`} fieldKey="filename" copied={copied} onCopy={copyToClipboard} />
          )}
        </div>
      )}

      {/* Export */}
      <div className="flex items-center gap-2 pt-1 border-t border-border/50">
        <div className="flex gap-1">
          {(["webp", "jpg", "png"] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => setExportFormat(fmt)}
              className={cn(
                "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                exportFormat === fmt
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground border border-border",
              )}
            >
              {fmt.toUpperCase()}
            </button>
          ))}
        </div>
        {exportFormat !== "png" && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Q</span>
            <input
              type="range"
              min={60}
              max={100}
              value={exportQuality}
              onChange={(e) => setExportQuality(Number(e.target.value))}
              className="w-16 accent-primary"
            />
            <span className="w-6 tabular-nums">{exportQuality}</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => exportMutation.mutate()}
          disabled={exportMutation.isPending || !image?.image_url}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          {exportMutation.isPending ? "Exporting…" : "Export"}
        </button>
      </div>

      {(seoMutation.isError || exportMutation.isError) && (
        <p className="text-xs text-destructive">
          {(seoMutation.error || exportMutation.error) instanceof Error
            ? (seoMutation.error || exportMutation.error)!.message
            : "Failed — please try again."}
        </p>
      )}
    </div>
  );
}

interface SeoFieldProps {
  label: string;
  value: string;
  fieldKey: string;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
}

function SeoField({ label, value, fieldKey, copied, onCopy }: SeoFieldProps) {
  return (
    <div className="group flex items-start gap-2 rounded-lg bg-muted/40 px-2.5 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mb-0.5">{label}</p>
        <p className="text-xs text-foreground leading-relaxed break-words">{value}</p>
      </div>
      <button
        type="button"
        onClick={() => onCopy(value, fieldKey)}
        className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Copy"
      >
        {copied === fieldKey
          ? <Check className="h-3.5 w-3.5 text-green-500" />
          : <Copy className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
        }
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add SeoPanel to edit page**

```tsx
// apps/web/app/(dashboard)/[projectId]/images/edit/[imageId]/page.tsx

// Add import:
import { SeoPanel } from "@/components/studio/edit/SeoPanel";

// In the center column, below VersionStrip div:
          <div className="shrink-0 border-t border-border">
            <SeoPanel imageId={editTargetId} image={displayImage} />
          </div>
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/studio/edit/SeoPanel.tsx "apps/web/app/(dashboard)/[projectId]/images/edit/[imageId]/page.tsx"
git commit -m "feat(seo): add SeoPanel to edit page with alt text generation and WebP export"
```

---

### Task 6: Alt text display on studio image cards

**Files:**
- Modify: `apps/web/components/studio/ImageCard.tsx` (or equivalent ResultCard)

**Goal:** Show a small SEO indicator on image cards that have alt text, and show the alt text in the `<img>` tag for accessibility.

- [ ] **Step 1: Update image card**

Find the image card component in `apps/web/components/studio/` (check `ResultCard.tsx`, `ImageCard.tsx`, or similar).

Add `alt={image.alt_text ?? image.prompt ?? "Generated image"}` to the `<img>` element.

Add a small badge when `image.alt_text` is set:

```tsx
{image.alt_text && (
  <span
    title={image.alt_text}
    className="absolute top-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium text-white leading-none"
  >
    ALT
  </span>
)}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors

- [ ] **Step 3: Visual test**

```bash
cd apps/web && npm run dev
```

1. Generate an image in the studio
2. Click "Edit" on a result card → navigates to edit page
3. In the SEO panel at the bottom: click "Generate SEO" → alt text, caption, filename appear
4. Copy buttons work (clipboard)
5. Export → select WebP → click Export → file downloads
6. Back in studio dashboard: card now has "ALT" badge and `alt` attribute set

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/studio/
git commit -m "feat(seo): show alt text badge and accessible alt attribute on studio image cards"
```

---

## Self-Review

**Spec coverage (§8):**

| Requirement | Task |
|---|---|
| Auto alt text generation via LLM | Tasks 2, 3 |
| Image caption generation | Tasks 2, 3 |
| SEO filename slugification | Tasks 2, 3 |
| WebP / JPEG / PNG export with quality control | Task 3 |
| SEO panel in edit page with one-click generation | Task 5 |
| Copy-to-clipboard for alt text and caption | Task 5 |
| Export button with format/quality picker | Task 5 |
| Alt text on image cards (accessibility + indicator) | Task 6 |
| Reuses existing LLM keys (no new API keys needed) | Task 2 |
| Pillow for conversion (no new deps) | Task 3 |

All §8 requirements covered. ✓

**Dependencies satisfied:**
- `app/core/storage.py` → Plan 2A Task 3 ✓
- `Pillow` → Plan 2B Task 2 ✓  
- `call_llm`, `get_org_llm_keys` → existing `llm_service.py` ✓
- `editing_service._download` → Plan 2B Task 2 ✓
