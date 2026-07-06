# Image Studio Phase 4B — Marketing Banner Generator

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

> **Dependency:** Plan 2A (brand kit prompt injection), Plan 3A (SOCIAL_PRESETS for dimension reference).

**Goal:** Let users input a product name, offer/headline, CTA text, and brand kit, and generate multiple ad creative variants (hero banner, promo ad, sale poster, email graphic) in one click. Each variant is a `GeneratedImage` with `usage=marketing_banner` and a stored `banner_format`.

**Architecture:** New `banner_format` column on `GeneratedImage`. New `POST /images/marketing-banner` endpoint builds rich prompt variants from inputs and calls DALL-E for each, returning all variants. New `MarketingTab` in studio. No new external services.

**Tech Stack:** FastAPI, existing DALL-E generation, Next.js 14 App Router, TanStack Query v5

## Global Constraints

- Python 3.11+, FastAPI, SQLAlchemy 2 async, Pydantic v2
- TypeScript: 0 errors
- TDD: write failing test first, then implement

---

### Task 1: banner_format column + marketing_banner usage

**Files:**
- Modify: `apps/api/app/models/image.py`
- Create: migration
- Test: `apps/api/tests/test_banner_columns.py`

- [ ] **Step 1: Write failing test**

```python
# apps/api/tests/test_banner_columns.py
async def test_has_banner_format_column():
    from sqlalchemy import inspect
    from app.core.database import async_engine
    async with async_engine.connect() as conn:
        insp = await conn.run_sync(inspect)
        cols = {c["name"] for c in insp.get_columns("generated_images")}
    assert "banner_format" in cols
```

- [ ] **Step 2: Add column and enum value**

```python
# apps/api/app/models/image.py

# In ImageUsage enum, add:
    marketing_banner = "marketing_banner"

# In GeneratedImage class, after social_platform:
    banner_format: Mapped[str | None] = mapped_column(String(60), nullable=True)
```

- [ ] **Step 3: Migration**

```python
# Manual migration for enum value + autogenerate for column:
def upgrade():
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE image_usage_enum ADD VALUE IF NOT EXISTS 'marketing_banner'")
    op.add_column("generated_images", sa.Column("banner_format", sa.String(60), nullable=True))
```

```bash
make db-migrate
cd apps/api && pytest tests/test_banner_columns.py -v
git add apps/api/app/models/image.py apps/api/alembic/versions/ apps/api/tests/test_banner_columns.py
git commit -m "feat(banners): add marketing_banner usage, banner_format column"
```

---

### Task 2: Banner format catalog and prompt builder

**Files:**
- Create: `apps/api/app/services/banner_service.py`
- Test: `apps/api/tests/test_banner_service.py`

**Interfaces:**
- Produces: `BANNER_FORMATS: dict`, `build_banner_prompts(product, offer, cta, style, brand_kit) -> list[dict]`

Each returned item: `{format_id, prompt, width, height, label}`

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_banner_service.py
from app.services.banner_service import BANNER_FORMATS, build_banner_prompts


def test_banner_formats_have_dimensions():
    for fmt_id, fmt in BANNER_FORMATS.items():
        assert "width" in fmt and "height" in fmt
        assert "label" in fmt


def test_build_banner_prompts_returns_all_formats():
    prompts = build_banner_prompts("Nike Air Max", "50% Off Summer Sale", "Shop Now", "professional", None)
    assert len(prompts) == len(BANNER_FORMATS)
    for p in prompts:
        assert "format_id" in p
        assert "prompt" in p
        assert "Nike Air Max" in p["prompt"] or "Summer Sale" in p["prompt"]


def test_build_banner_prompts_subset():
    prompts = build_banner_prompts("Sofa", "New Collection", "Explore", "luxury_product", None, format_ids=["hero_banner", "email_header"])
    assert len(prompts) == 2


def test_build_banner_prompts_with_brand_kit():
    from app.models.brand_kit import BrandKit
    import uuid
    kit = BrandKit(id=uuid.uuid4(), org_id=uuid.uuid4(), colors=["#FF0000"], tone="Bold")
    prompts = build_banner_prompts("Sneakers", "Sale", "Buy Now", "cinematic", kit, format_ids=["hero_banner"])
    assert "#FF0000" in prompts[0]["prompt"] or "bold" in prompts[0]["prompt"].lower()
```

- [ ] **Step 2: Create banner_service.py**

```python
# apps/api/app/services/banner_service.py
"""Marketing banner format catalog and prompt builder."""
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.brand_kit import BrandKit

BANNER_FORMATS: dict[str, dict] = {
    "hero_banner": {
        "label": "Hero Banner",
        "width": 1920,
        "height": 600,
        "description": "Wide website hero section",
        "prompt_style": "Wide cinematic composition, product hero image, dramatic lighting, clean background with space for headline text",
    },
    "promo_ad_square": {
        "label": "Promo Ad (Square)",
        "width": 1080,
        "height": 1080,
        "description": "Social media promo ad",
        "prompt_style": "Bold promotional graphic, product centered, high contrast, eye-catching colors, space for offer text at bottom",
    },
    "sale_poster": {
        "label": "Sale Poster",
        "width": 800,
        "height": 1200,
        "description": "Tall sale / promotional poster",
        "prompt_style": "Vertical promotional poster layout, product featured prominently, vibrant sale atmosphere, energetic composition",
    },
    "email_header": {
        "label": "Email Header",
        "width": 600,
        "height": 200,
        "description": "Email newsletter header",
        "prompt_style": "Horizontal email banner, clean minimal product image, professional and trustworthy, subtle background",
    },
    "display_ad_rectangle": {
        "label": "Display Ad (Rectangle)",
        "width": 728,
        "height": 90,
        "description": "Leaderboard display ad",
        "prompt_style": "Ultra-wide banner, product image on left, clean background, professional advertising layout",
    },
    "story_ad": {
        "label": "Story Ad (9:16)",
        "width": 1080,
        "height": 1920,
        "description": "Instagram / TikTok story ad",
        "prompt_style": "Full-screen vertical story format, immersive lifestyle product image, bold and engaging",
    },
}


def build_banner_prompts(
    product: str,
    offer: str,
    cta: str,
    style: str,
    brand_kit: Optional["BrandKit"],
    format_ids: Optional[list[str]] = None,
) -> list[dict]:
    formats = {k: v for k, v in BANNER_FORMATS.items() if not format_ids or k in format_ids}
    result = []
    for fmt_id, fmt in formats.items():
        base = (
            f"Marketing creative for {product}. Offer: {offer}. CTA: {cta}. "
            f"{fmt['prompt_style']}. "
            f"Style: {style.replace('_', ' ')}. "
            f"Professional advertising photography. No text overlays — image only."
        )
        if brand_kit:
            parts = []
            if brand_kit.colors:
                parts.append(f"Brand palette: {', '.join(brand_kit.colors)}")
            if brand_kit.tone:
                parts.append(f"Tone: {brand_kit.tone}")
            if brand_kit.style_rules:
                parts.append(f"Style rules: {brand_kit.style_rules}")
            if parts:
                base = f"{base} {'. '.join(parts)}."
        result.append({
            "format_id": fmt_id,
            "label": fmt["label"],
            "prompt": base,
            "width": fmt["width"],
            "height": fmt["height"],
        })
    return result
```

- [ ] **Step 3: Run tests and commit**

```bash
cd apps/api && pytest tests/test_banner_service.py -v
git add apps/api/app/services/banner_service.py apps/api/tests/test_banner_service.py
git commit -m "feat(banners): add banner format catalog and prompt builder"
```

---

### Task 3: Marketing banner endpoint

**Files:**
- Create: `apps/api/app/api/v1/routers/banners.py`
- Modify: `apps/api/app/api/v1/router.py`
- Test: `apps/api/tests/test_banners_api.py`

**Interfaces:**
- Produces: `POST /api/v1/images/marketing-banners` → `list[ImageOut]`

Generates all selected formats in parallel (asyncio.gather).

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_banners_api.py
async def test_generate_banners(client, auth_headers, sample_project):
    from unittest.mock import patch, AsyncMock
    with patch("app.api.v1.routers.banners.generate_image_dalle",
               AsyncMock(return_value={"ok": True, "image_url": "https://s3.example.com/banner.png",
                                       "width": 1920, "height": 600, "revised_prompt": None, "cost_usd": 0.04})):
        with patch("app.api.v1.routers.banners._get_openai_key", AsyncMock(return_value="sk-test")):
            response = await client.post(
                "/api/v1/images/marketing-banners",
                json={
                    "project_id": str(sample_project.id),
                    "product": "Premium sneakers",
                    "offer": "30% off",
                    "cta": "Shop now",
                    "style": "professional",
                    "format_ids": ["hero_banner", "email_header"],
                },
                headers=auth_headers,
            )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 2


async def test_generate_banners_unknown_format(client, auth_headers, sample_project):
    response = await client.post(
        "/api/v1/images/marketing-banners",
        json={"project_id": str(sample_project.id), "product": "X", "offer": "Y", "cta": "Z",
              "style": "professional", "format_ids": ["BOGUS"]},
        headers=auth_headers,
    )
    assert response.status_code == 400
```

- [ ] **Step 2: Create banners router**

```python
# apps/api/app/api/v1/routers/banners.py
import asyncio
import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from app.core.dependencies import CurrentUser, DB
from app.core.security import decrypt_api_key
from app.models.image import GeneratedImage, ImageStatus, ImageUsage, ImageStyle
from app.models.api_key import APIKey
from app.models.brand_kit import BrandKit as BrandKitModel
from app.models.project import Project
from app.services.banner_service import BANNER_FORMATS, build_banner_prompts
from app.services.image_service import generate_image_dalle
from app.api.v1.routers.images import ImageOut
from app.core.billing import check_project_not_locked, increment_usage

router = APIRouter()


class MarketingBannerRequest(BaseModel):
    project_id: uuid.UUID
    product: str
    offer: str
    cta: str
    style: str = "professional"
    format_ids: Optional[list[str]] = None
    use_brand_kit: bool = False


async def _get_openai_key(org_id: uuid.UUID, db) -> Optional[str]:
    result = await db.execute(
        select(APIKey).where(APIKey.org_id == org_id, APIKey.provider == "openai")
    )
    row = result.scalar_one_or_none()
    return decrypt_api_key(row.encrypted_value) if row else None


@router.post("/marketing-banners", response_model=list[ImageOut])
async def generate_marketing_banners(body: MarketingBannerRequest, current_user: CurrentUser, db: DB):
    # Validate format_ids
    if body.format_ids:
        unknown = [f for f in body.format_ids if f not in BANNER_FORMATS]
        if unknown:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown format(s): {unknown}. Available: {list(BANNER_FORMATS)}")

    proj = await db.execute(
        select(Project).where(Project.id == body.project_id, Project.org_id == current_user.org_id)
    )
    if proj.scalar_one_or_none() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    await check_project_not_locked(body.project_id, db)

    brand_kit = None
    if body.use_brand_kit:
        bk = await db.execute(select(BrandKitModel).where(BrandKitModel.org_id == current_user.org_id))
        brand_kit = bk.scalar_one_or_none()

    openai_key = await _get_openai_key(current_user.org_id, db)
    banner_variants = build_banner_prompts(body.product, body.offer, body.cta, body.style, brand_kit, body.format_ids)

    async def _generate_one(variant: dict) -> GeneratedImage:
        image = GeneratedImage(
            org_id=current_user.org_id,
            project_id=body.project_id,
            prompt=variant["prompt"],
            style=ImageStyle(body.style) if body.style in [e.value for e in ImageStyle] else ImageStyle.professional,
            usage=ImageUsage.marketing_banner,
            status=ImageStatus.generating,
            banner_format=variant["format_id"],
        )
        db.add(image)
        await db.flush()
        await db.refresh(image)

        if openai_key:
            result = await generate_image_dalle(
                prompt=variant["prompt"], style=body.style, usage="marketing_banner", openai_api_key=openai_key
            )
        else:
            result = {"ok": False, "error": "No OpenAI key configured"}

        if result.get("ok"):
            image.status = ImageStatus.ready
            image.image_url = result["image_url"]
            image.thumbnail_url = result["image_url"]
            image.width = variant["width"]
            image.height = variant["height"]
            image.cost_usd = result.get("cost_usd")
        else:
            image.status = ImageStatus.failed
            image.error = result.get("error")

        await db.flush()
        await db.refresh(image)
        return image

    images = await asyncio.gather(*[_generate_one(v) for v in banner_variants])
    await db.commit()
    for _ in images:
        await increment_usage(current_user.org_id, "images", db)
    return [ImageOut.model_validate(img) for img in images]
```

- [ ] **Step 3: Register and test**

```python
# apps/api/app/api/v1/router.py:
from app.api.v1.routers import banners
api_router.include_router(banners.router, prefix="/images", tags=["banners"])
```

```bash
cd apps/api && pytest tests/test_banners_api.py -v
git add apps/api/app/api/v1/routers/banners.py apps/api/app/api/v1/router.py apps/api/tests/test_banners_api.py
git commit -m "feat(banners): add POST /images/marketing-banners endpoint (parallel generation)"
```

---

### Task 4: Frontend — Marketing tab in studio

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/components/studio/MarketingTab.tsx`

- [ ] **Step 1: Add API function**

```typescript
// apps/web/lib/api.ts

export interface MarketingBannerRequest {
  project_id: string;
  product: string;
  offer: string;
  cta: string;
  style?: string;
  format_ids?: string[];
  use_brand_kit?: boolean;
}

export async function generateMarketingBanners(req: MarketingBannerRequest): Promise<GeneratedImage[]> {
  return apiClient.post<GeneratedImage[]>("/images/marketing-banners", req);
}
```

- [ ] **Step 2: Create MarketingTab**

```tsx
// apps/web/components/studio/MarketingTab.tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { generateMarketingBanners } from "@/lib/api";

const FORMATS = [
  { id: "hero_banner",          label: "Hero Banner",     size: "1920×600" },
  { id: "promo_ad_square",      label: "Promo Ad",        size: "1080×1080" },
  { id: "sale_poster",          label: "Sale Poster",     size: "800×1200" },
  { id: "email_header",         label: "Email Header",    size: "600×200" },
  { id: "display_ad_rectangle", label: "Display Ad",      size: "728×90" },
  { id: "story_ad",             label: "Story Ad",        size: "1080×1920" },
];

interface MarketingTabProps {
  projectId: string;
  useBrandKit: boolean;
  onGenerated: () => void;
}

export function MarketingTab({ projectId, useBrandKit, onGenerated }: MarketingTabProps) {
  const [product, setProduct] = useState("");
  const [offer, setOffer] = useState("");
  const [cta, setCta] = useState("Shop Now");
  const [selectedFormats, setSelectedFormats] = useState<string[]>(["hero_banner", "promo_ad_square"]);
  const qc = useQueryClient();

  function toggleFormat(id: string) {
    setSelectedFormats((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const mutation = useMutation({
    mutationFn: () =>
      generateMarketingBanners({
        project_id: projectId,
        product: product.trim(),
        offer: offer.trim(),
        cta: cta.trim(),
        format_ids: selectedFormats,
        use_brand_kit: useBrandKit,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["images", projectId] });
      onGenerated();
    },
  });

  return (
    <div className="flex flex-col gap-4 p-4">
      {[
        { label: "Product", value: product, setter: setProduct, placeholder: "e.g. Nike Air Max 90" },
        { label: "Offer / Headline", value: offer, setter: setOffer, placeholder: "e.g. 30% Off Summer Sale" },
        { label: "CTA", value: cta, setter: setCta, placeholder: "e.g. Shop Now" },
      ].map(({ label, value, setter, placeholder }) => (
        <div key={label}>
          <label className="block text-xs font-semibold text-foreground mb-1.5">{label}</label>
          <input
            type="text"
            value={value}
            onChange={(e) => setter(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      ))}

      <div>
        <label className="block text-xs font-semibold text-foreground mb-2">
          Formats ({selectedFormats.length} selected)
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {FORMATS.map((fmt) => (
            <button
              key={fmt.id}
              type="button"
              onClick={() => toggleFormat(fmt.id)}
              className={cn(
                "rounded-lg border px-2.5 py-2 text-left transition-colors",
                selectedFormats.includes(fmt.id)
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <p className="text-xs font-medium">{fmt.label}</p>
              <p className="text-[10px] text-muted-foreground tabular-nums">{fmt.size}</p>
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        disabled={mutation.isPending || !product.trim() || selectedFormats.length === 0}
        onClick={() => mutation.mutate()}
        className="btn-primary w-full py-2 text-sm disabled:opacity-50"
      >
        {mutation.isPending
          ? `Generating ${selectedFormats.length} banner${selectedFormats.length > 1 ? "s" : ""}…`
          : `Generate ${selectedFormats.length} banner${selectedFormats.length > 1 ? "s" : ""}`}
      </button>

      {mutation.isError && (
        <p className="text-xs text-destructive">
          {mutation.error instanceof Error ? mutation.error.message : "Generation failed"}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add "Marketing" tab to studio page, typecheck, commit**

```bash
cd apps/web && npm run typecheck
git add apps/web/lib/api.ts apps/web/components/studio/MarketingTab.tsx
git commit -m "feat(banners): add MarketingTab with product/offer/CTA inputs and format selector"
```

---

## Self-Review

| Requirement | Task |
|---|---|
| 6 banner formats with correct dimensions | Task 2 |
| Inputs: product, offer, CTA, brand kit | Tasks 2, 3 |
| Parallel generation of all selected formats | Task 3 |
| `banner_format` stored on GeneratedImage | Task 1 |
| Brand kit injection into banner prompts | Task 2 |
| MarketingTab with format multi-select | Task 4 |
| Shows generation count ("Generate 3 banners") | Task 4 |

All §7 requirements covered. ✓
