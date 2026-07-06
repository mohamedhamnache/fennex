# Image Studio Phase 4A — Product Photography Studio

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

> **Dependency:** Replicate API key and `editing_service._replicate_run` from Plan 2B. Shopify integration from existing `social_connections_service.py`.

**Goal:** Let ecommerce users paste a product image URL and place it in AI-generated lifestyle or packshot scenes — "Shoe on athlete", "Mug on café table", "Sofa in living room". Built on Replicate's image-conditioned generation. Adds a "Product" tab to the studio with a scene selector and product image input.

**Architecture:** New `ProductScene` catalog (static in-code, no DB). New `POST /images/product-scene` endpoint: download product image → run Replicate image-conditioning model (Flux Kontext Pro or similar) with scene prompt → upload result → store as `GeneratedImage` with `usage=product_shot`. New `ProductStudioTab` in the frontend.

**Tech Stack:** FastAPI, Replicate (via `_replicate_run` from editing_service), Pillow (background removal prep), Next.js 14 App Router, TanStack Query v5

## Global Constraints

- Python 3.11+, FastAPI, SQLAlchemy 2 async, Pydantic v2
- TypeScript: 0 errors
- TDD: write failing test first, then implement
- `REPLICATE_API_KEY` required (already in config from Plan 2A Task 3)

---

### Task 1: Add `product_shot` to ImageUsage enum

**Files:**
- Modify: `apps/api/app/models/image.py`
- Create: migration
- Test: `apps/api/tests/test_product_usage.py`

- [ ] **Step 1: Write failing test**

```python
# apps/api/tests/test_product_usage.py
from app.models.image import ImageUsage

def test_product_shot_in_usage():
    assert "product_shot" in [e.value for e in ImageUsage]
```

- [ ] **Step 2: Add enum value**

```python
# apps/api/app/models/image.py — add to ImageUsage:
    product_shot = "product_shot"
```

- [ ] **Step 3: Migration (ADD VALUE cannot run in transaction)**

```python
# Create migration manually:
def upgrade():
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE image_usage_enum ADD VALUE IF NOT EXISTS 'product_shot'")

def downgrade():
    pass
```

```bash
make db-migrate
cd apps/api && pytest tests/test_product_usage.py -v
git add apps/api/app/models/image.py apps/api/alembic/versions/ apps/api/tests/test_product_usage.py
git commit -m "feat(product): add product_shot to ImageUsage enum"
```

---

### Task 2: Product scene catalog + prompt builder

**Files:**
- Create: `apps/api/app/services/product_service.py`
- Test: `apps/api/tests/test_product_service.py`

**Interfaces:**
- Produces: `PRODUCT_SCENES: dict`, `build_scene_prompt(scene_id, product_description, brand_kit) -> str`

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_product_service.py
from app.services.product_service import PRODUCT_SCENES, build_scene_prompt


def test_scenes_have_required_keys():
    for scene_id, scene in PRODUCT_SCENES.items():
        assert "label" in scene
        assert "prompt_template" in scene
        assert "category" in scene


def test_build_scene_prompt_includes_product():
    prompt = build_scene_prompt("cafe_table", "ceramic coffee mug with floral design", None)
    assert "ceramic coffee mug" in prompt.lower() or "mug" in prompt.lower()
    assert len(prompt) > 50


def test_build_scene_prompt_includes_brand_kit():
    from app.models.brand_kit import BrandKit
    import uuid
    kit = BrandKit(id=uuid.uuid4(), org_id=uuid.uuid4(), colors=["#1A2B3C"], style_rules="Minimal")
    prompt = build_scene_prompt("white_studio", "running shoe", kit)
    assert "#1A2B3C" in prompt or "minimal" in prompt.lower()
```

- [ ] **Step 2: Create product_service.py**

```python
# apps/api/app/services/product_service.py
"""Product photography scene catalog and prompt builder."""
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.brand_kit import BrandKit

PRODUCT_SCENES: dict[str, dict] = {
    # Lifestyle — General
    "cafe_table": {
        "label": "Café Table",
        "category": "lifestyle",
        "prompt_template": "Product placed on a wooden café table, morning light streaming through window, warm bokeh background, premium lifestyle photography",
    },
    "marble_countertop": {
        "label": "Marble Countertop",
        "category": "lifestyle",
        "prompt_template": "Product displayed on white marble countertop, clean minimal styling, soft natural window light, luxury product photography",
    },
    "outdoor_nature": {
        "label": "Outdoor / Nature",
        "category": "lifestyle",
        "prompt_template": "Product in natural outdoor setting, lush green background, soft diffused daylight, fresh and vibrant aesthetic",
    },
    "home_living_room": {
        "label": "Living Room",
        "category": "lifestyle",
        "prompt_template": "Product styled in a modern Scandinavian living room, warm ambient lighting, cozy home atmosphere",
    },
    # Fashion / Apparel
    "athlete_action": {
        "label": "Athlete in Action",
        "category": "fashion",
        "prompt_template": "Product worn by athletic model in dynamic action pose, stadium or track background, energetic sports photography",
    },
    "model_studio": {
        "label": "Model Studio Shot",
        "category": "fashion",
        "prompt_template": "Product on professional model, clean studio backdrop, high-key lighting, fashion editorial style",
    },
    # Ecommerce / Packshot
    "white_studio": {
        "label": "White Studio",
        "category": "packshot",
        "prompt_template": "Product on pure white background, professional packshot lighting with soft shadows, clean ecommerce photography",
    },
    "gradient_studio": {
        "label": "Gradient Background",
        "category": "packshot",
        "prompt_template": "Product centered on smooth gradient background, professional lighting, ecommerce ready",
    },
    "floating_shadow": {
        "label": "Floating with Shadow",
        "category": "packshot",
        "prompt_template": "Product floating slightly above surface, realistic drop shadow below, clean white background, premium ecommerce shot",
    },
    # Food & Beverage
    "food_table_scene": {
        "label": "Food Table Scene",
        "category": "food",
        "prompt_template": "Product styled in an appetizing table scene with complementary food props, warm restaurant lighting, editorial food photography",
    },
    # Tech & Electronics
    "desk_setup": {
        "label": "Desk Setup",
        "category": "tech",
        "prompt_template": "Product in a clean modern desk setup, minimal accessories, soft office lighting, professional tech product photography",
    },
}


def build_scene_prompt(
    scene_id: str,
    product_description: str,
    brand_kit: Optional["BrandKit"],
) -> str:
    scene = PRODUCT_SCENES.get(scene_id)
    if not scene:
        raise ValueError(f"Unknown scene: {scene_id}")

    base = (
        f"Product photography: {product_description}. "
        f"{scene['prompt_template']}. "
        f"Ultra realistic, high resolution, professional product photography."
    )

    if brand_kit:
        parts = []
        if brand_kit.colors:
            parts.append(f"Brand palette: {', '.join(brand_kit.colors)}")
        if brand_kit.style_rules:
            parts.append(f"Style: {brand_kit.style_rules}")
        if parts:
            base = f"{base} {'. '.join(parts)}."

    return base
```

- [ ] **Step 3: Run tests and commit**

```bash
cd apps/api && pytest tests/test_product_service.py -v
git add apps/api/app/services/product_service.py apps/api/tests/test_product_service.py
git commit -m "feat(product): add product scene catalog and prompt builder"
```

---

### Task 3: Product scene generation endpoint

**Files:**
- Create: `apps/api/app/api/v1/routers/product.py`
- Modify: `apps/api/app/api/v1/router.py`
- Test: `apps/api/tests/test_product_api.py`

**Interfaces:**
- Produces: `POST /api/v1/images/product-scene` → `ImageOut`

Request body:
```json
{
  "project_id": "uuid",
  "product_image_url": "https://...",
  "product_description": "ceramic coffee mug with floral pattern",
  "scene_id": "cafe_table",
  "use_brand_kit": false
}
```

Two generation paths:
1. **If `REPLICATE_API_KEY` set:** Use Replicate flux-kontext (image-conditioned generation) to composite product into scene.
2. **Fallback (no Replicate key):** Use existing `generate_image_dalle` with the scene prompt (no product image compositing, just scene generation).

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_product_api.py
import pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient


async def test_product_scene_unknown_scene(client: AsyncClient, auth_headers: dict, sample_project):
    response = await client.post(
        "/api/v1/images/product-scene",
        json={
            "project_id": str(sample_project.id),
            "product_image_url": "https://example.com/product.png",
            "product_description": "running shoe",
            "scene_id": "NONEXISTENT_SCENE",
        },
        headers=auth_headers,
    )
    assert response.status_code == 400


async def test_product_scene_uses_fallback_without_replicate(client: AsyncClient, auth_headers: dict, sample_project, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.REPLICATE_API_KEY", "")
    with patch("app.api.v1.routers.product.generate_image_dalle",
               AsyncMock(return_value={"ok": True, "image_url": "https://s3.example.com/result.png",
                                       "width": 1024, "height": 1024, "revised_prompt": None, "cost_usd": 0.04})):
        response = await client.post(
            "/api/v1/images/product-scene",
            json={
                "project_id": str(sample_project.id),
                "product_image_url": "https://example.com/product.png",
                "product_description": "white sneaker",
                "scene_id": "white_studio",
            },
            headers=auth_headers,
        )
    assert response.status_code == 200
    data = response.json()
    assert data["usage"] == "product_shot"
    assert data["image_url"] == "https://s3.example.com/result.png"
```

- [ ] **Step 2: Create router**

```python
# apps/api/app/api/v1/routers/product.py
import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.models.image import GeneratedImage, ImageStatus, ImageUsage, ImageStyle
from app.models.brand_kit import BrandKit as BrandKitModel
from app.models.project import Project
from app.services.product_service import PRODUCT_SCENES, build_scene_prompt
from app.services.image_service import generate_image_dalle
from app.services.editing_service import _replicate_run, _download_and_upload_url
from app.api.v1.routers.images import ImageOut
from app.core.billing import check_usage_limit, check_project_not_locked, increment_usage
from app.core.security import decrypt_api_key
from app.models.api_key import APIKey

router = APIRouter()

# Replicate flux-kontext model for image-conditioned generation
_FLUX_KONTEXT_MODEL = "black-forest-labs/flux-kontext-pro"


class ProductSceneRequest(BaseModel):
    project_id: uuid.UUID
    product_image_url: str
    product_description: str
    scene_id: str
    use_brand_kit: bool = False


async def _run_flux_kontext(product_url: str, prompt: str) -> dict:
    """Image-conditioned generation via Replicate flux-kontext."""
    try:
        output = await _replicate_run(
            _FLUX_KONTEXT_MODEL,
            {
                "input_image": product_url,
                "prompt": prompt,
                "aspect_ratio": "1:1",
                "output_format": "webp",
            },
        )
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url, "width": 1024, "height": 1024, "revised_prompt": None, "cost_usd": None}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/product-scene", response_model=ImageOut)
async def generate_product_scene(body: ProductSceneRequest, current_user: CurrentUser, db: DB):
    if body.scene_id not in PRODUCT_SCENES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown scene: {body.scene_id}. Available: {list(PRODUCT_SCENES)}")

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

    prompt = build_scene_prompt(body.scene_id, body.product_description, brand_kit)

    image = GeneratedImage(
        org_id=current_user.org_id,
        project_id=body.project_id,
        prompt=prompt,
        style=ImageStyle.photorealistic,
        usage=ImageUsage.product_shot,
        status=ImageStatus.generating,
    )
    db.add(image)
    await db.flush()
    await db.refresh(image)

    # Try Replicate flux-kontext first, fall back to DALL-E
    if settings.REPLICATE_API_KEY:
        result = await _run_flux_kontext(body.product_image_url, prompt)
    else:
        # DALL-E fallback — generate scene without product compositing
        key_result = await db.execute(
            select(APIKey).where(APIKey.org_id == current_user.org_id, APIKey.provider == "openai")
        )
        api_key_row = key_result.scalar_one_or_none()
        if api_key_row:
            openai_key = decrypt_api_key(api_key_row.encrypted_value)
            result = await generate_image_dalle(prompt=prompt, style="photorealistic", usage="product_shot", openai_api_key=openai_key)
        else:
            result = {"ok": False, "error": "No Replicate or OpenAI key configured"}

    if result.get("ok"):
        image.status = ImageStatus.ready
        image.image_url = result["image_url"]
        image.thumbnail_url = result["image_url"]
        image.revised_prompt = result.get("revised_prompt")
        image.width = result.get("width", 1024)
        image.height = result.get("height", 1024)
        image.cost_usd = result.get("cost_usd")
    else:
        image.status = ImageStatus.failed
        image.error = result.get("error")

    await db.flush()
    await db.refresh(image)
    await db.commit()
    await increment_usage(current_user.org_id, "images", db)
    return ImageOut.model_validate(image)
```

- [ ] **Step 3: Register router**

```python
# apps/api/app/api/v1/router.py:
from app.api.v1.routers import product

api_router.include_router(product.router, prefix="/images", tags=["product"])
```

- [ ] **Step 4: Run tests and commit**

```bash
cd apps/api && pytest tests/test_product_api.py -v
git add apps/api/app/api/v1/routers/product.py apps/api/app/api/v1/router.py apps/api/app/services/product_service.py apps/api/tests/test_product_api.py
git commit -m "feat(product): add POST /images/product-scene endpoint with Replicate + DALL-E fallback"
```

---

### Task 4: Frontend — Product Studio tab

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/components/studio/ProductTab.tsx`
- Modify: studio page to add "Product" tab alongside "Generate" and "Social"

- [ ] **Step 1: Add API client function**

```typescript
// apps/web/lib/api.ts

export interface ProductSceneRequest {
  project_id: string;
  product_image_url: string;
  product_description: string;
  scene_id: string;
  use_brand_kit?: boolean;
}

export async function generateProductScene(req: ProductSceneRequest): Promise<GeneratedImage> {
  return apiClient.post<GeneratedImage>("/images/product-scene", req);
}
```

- [ ] **Step 2: Create ProductTab component**

```tsx
// apps/web/components/studio/ProductTab.tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { generateProductScene } from "@/lib/api";

const SCENES = [
  { id: "white_studio",      label: "White Studio",       category: "packshot" },
  { id: "gradient_studio",   label: "Gradient BG",         category: "packshot" },
  { id: "floating_shadow",   label: "Floating Shadow",     category: "packshot" },
  { id: "cafe_table",        label: "Café Table",          category: "lifestyle" },
  { id: "marble_countertop", label: "Marble Counter",      category: "lifestyle" },
  { id: "outdoor_nature",    label: "Outdoor / Nature",    category: "lifestyle" },
  { id: "home_living_room",  label: "Living Room",         category: "lifestyle" },
  { id: "athlete_action",    label: "Athlete in Action",   category: "fashion" },
  { id: "model_studio",      label: "Model Studio",        category: "fashion" },
  { id: "food_table_scene",  label: "Food Table",          category: "food" },
  { id: "desk_setup",        label: "Desk Setup",          category: "tech" },
];

const CATEGORIES = ["packshot", "lifestyle", "fashion", "food", "tech"];

interface ProductTabProps {
  projectId: string;
  useBrandKit: boolean;
  onGenerated: () => void;
}

export function ProductTab({ projectId, useBrandKit, onGenerated }: ProductTabProps) {
  const [productUrl, setProductUrl] = useState("");
  const [description, setDescription] = useState("");
  const [selectedScene, setSelectedScene] = useState("white_studio");
  const [activeCategory, setActiveCategory] = useState("packshot");
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      generateProductScene({
        project_id: projectId,
        product_image_url: productUrl.trim(),
        product_description: description.trim() || "product",
        scene_id: selectedScene,
        use_brand_kit: useBrandKit,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["images", projectId] });
      onGenerated();
    },
  });

  const filteredScenes = SCENES.filter((s) => s.category === activeCategory);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <label className="block text-xs font-semibold text-foreground mb-1.5">Product Image URL</label>
        <input
          type="url"
          value={productUrl}
          onChange={(e) => setProductUrl(e.target.value)}
          placeholder="https://your-store.com/product.png"
          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <p className="mt-1 text-[10px] text-muted-foreground">Paste your product image URL. Use a clean product-only image for best results.</p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-foreground mb-1.5">Product Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. White ceramic coffee mug with floral pattern"
          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-foreground mb-2">Scene</label>
        <div className="flex gap-1 mb-2 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[10px] font-medium capitalize transition-colors",
                activeCategory === cat ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {cat}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {filteredScenes.map((scene) => (
            <button
              key={scene.id}
              type="button"
              onClick={() => setSelectedScene(scene.id)}
              className={cn(
                "rounded-lg border py-2 px-2.5 text-xs font-medium text-left transition-colors",
                selectedScene === scene.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {scene.label}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        disabled={mutation.isPending || !productUrl.trim()}
        onClick={() => mutation.mutate()}
        className="btn-primary w-full py-2 text-sm disabled:opacity-50"
      >
        {mutation.isPending ? "Generating…" : "Generate Product Shot"}
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

- [ ] **Step 3: Add "Product" tab to studio page**

In the studio page, add a "Product" tab alongside "Generate" and "Social". When active, render `<ProductTab>`.

- [ ] **Step 4: Typecheck and commit**

```bash
cd apps/web && npm run typecheck
git add apps/web/lib/api.ts apps/web/components/studio/ProductTab.tsx apps/web/app/\(dashboard\)/\[projectId\]/images/studio/page.tsx
git commit -m "feat(product): add ProductTab with scene selector for product photography"
```

---

## Self-Review

| Requirement | Task |
|---|---|
| Place product in scenes (lifestyle, packshot, fashion) | Tasks 2, 3 |
| 11 named scenes across 5 categories | Task 2 |
| Replicate image-conditioned generation (flux-kontext) | Task 3 |
| DALL-E fallback when no Replicate key | Task 3 |
| Brand kit injection into scene prompts | Tasks 2, 3 |
| Product tab in studio with URL input + scene selector | Task 4 |
| Scene category filter | Task 4 |
| `product_shot` usage stored on GeneratedImage | Task 1 |

All §5 (core) requirements covered. Shopify catalog pull (pull product images automatically) is deferred to Phase 5B Publishing & Connectors, where Shopify integration is already partially planned. ✓
