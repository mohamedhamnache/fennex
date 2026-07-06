# Image Studio Phase 6B — Templates & Layouts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

> **Dependency:** Plan 2A (brand kit for brand color injection). Plan 3A (SOCIAL_PRESETS for dimensions).

**Goal:** Provide a library of pre-defined templates — blog featured image, product card, testimonial card, quote graphic, carousel slide, ad creative — that users can select, customise (swap text/image slots), and generate as finished images via DALL-E. Templates are prompt-based (no canvas layer engine required for Phase 6B). A true drag-and-drop layer editor is Phase 11 of the full roadmap and is deferred here.

**Architecture:** A static in-code `TEMPLATE_CATALOG` with ~20 templates grouped by category. Each template has a `prompt_template` with `{variable}` slots. New `POST /images/from-template` endpoint fills slots and calls DALL-E. New "Templates" tab in studio. A simple visual grid card for each template shows a preview description and the input fields needed.

**Note:** Full drag-and-drop layer support (§11) is a separate, much larger effort requiring a canvas rendering engine (Fabric.js or Konva). This plan delivers a usable "prompt templates" version that covers the core value without that complexity.

**Tech Stack:** FastAPI, existing DALL-E generation, Next.js 14 App Router, TanStack Query v5

## Global Constraints

- Python 3.11+, FastAPI, SQLAlchemy 2 async, Pydantic v2
- TypeScript: 0 errors
- TDD: write failing test first, then implement

---

### Task 1: Template catalog + slot filling service

**Files:**
- Create: `apps/api/app/services/template_service.py`
- Test: `apps/api/tests/test_template_service.py`

**Interfaces:**
- Produces: `TEMPLATE_CATALOG: dict`, `fill_template(template_id, slots, brand_kit) -> str`

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_template_service.py
from app.services.template_service import TEMPLATE_CATALOG, fill_template


def test_catalog_has_expected_categories():
    categories = {t["category"] for t in TEMPLATE_CATALOG.values()}
    assert "blog" in categories
    assert "product" in categories
    assert "social" in categories
    assert "ad" in categories


def test_fill_blog_template():
    prompt = fill_template("blog_featured", {"topic": "remote work trends", "style": "professional"}, None)
    assert "remote work" in prompt.lower()
    assert len(prompt) > 30


def test_fill_template_with_brand_kit():
    from app.models.brand_kit import BrandKit
    import uuid
    kit = BrandKit(id=uuid.uuid4(), org_id=uuid.uuid4(), colors=["#1A2B3C"], tone="Premium")
    prompt = fill_template("blog_featured", {"topic": "AI trends"}, kit)
    assert "#1A2B3C" in prompt or "premium" in prompt.lower()


def test_fill_unknown_template():
    import pytest
    with pytest.raises(ValueError, match="Unknown template"):
        fill_template("BOGUS_TEMPLATE", {}, None)
```

- [ ] **Step 2: Create template_service.py**

```python
# apps/api/app/services/template_service.py
"""Pre-defined image generation templates with slot filling."""
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.brand_kit import BrandKit

TEMPLATE_CATALOG: dict[str, dict] = {
    # Blog
    "blog_featured": {
        "label": "Blog Featured Image",
        "category": "blog",
        "description": "Wide hero image for blog articles",
        "slots": {"topic": "Article topic or title", "style": "Visual style (e.g. professional, abstract)"},
        "prompt_template": (
            "Professional blog featured image for an article about '{topic}'. "
            "Style: {style}. Wide landscape format, no text, atmospheric, editorial photography."
        ),
        "width": 1200, "height": 630,
    },
    "blog_infographic": {
        "label": "Blog Infographic Visual",
        "category": "blog",
        "description": "Illustrative visual to accompany data or statistics",
        "slots": {"topic": "Data topic", "style": "flat illustration"},
        "prompt_template": (
            "Clean flat illustration representing '{topic}' data. "
            "Style: {style}. Minimalist infographic aesthetic, icons, charts concept. No actual numbers."
        ),
        "width": 1200, "height": 800,
    },
    # Product
    "product_card": {
        "label": "Product Card",
        "category": "product",
        "description": "Square ecommerce product card",
        "slots": {"product": "Product name and description", "background": "Background setting"},
        "prompt_template": (
            "Professional ecommerce product photography of {product}. "
            "Background: {background}. Square format, clean lighting, premium product presentation."
        ),
        "width": 1080, "height": 1080,
    },
    "product_lifestyle": {
        "label": "Product Lifestyle Shot",
        "category": "product",
        "description": "Product in a real-world lifestyle context",
        "slots": {"product": "Product name", "scene": "Lifestyle scene description"},
        "prompt_template": (
            "Lifestyle product photography of {product} in {scene}. "
            "Natural lighting, aspirational lifestyle aesthetic, editorial quality."
        ),
        "width": 1200, "height": 800,
    },
    # Testimonial / Quote
    "testimonial_card": {
        "label": "Testimonial Card",
        "category": "social",
        "description": "Background for testimonial or review graphic",
        "slots": {"mood": "Emotional tone (e.g. happy, professional, trustworthy)", "industry": "Customer industry"},
        "prompt_template": (
            "Clean modern background for a {mood} customer testimonial card in the {industry} industry. "
            "Soft gradient, bokeh, professional, suitable for overlaying white text. No people, no text."
        ),
        "width": 1080, "height": 1080,
    },
    "quote_graphic": {
        "label": "Quote Graphic",
        "category": "social",
        "description": "Atmospheric background for a quote image",
        "slots": {"theme": "Quote theme or emotion", "color_mood": "Color mood (e.g. warm, cool, neutral)"},
        "prompt_template": (
            "Artistic abstract background for a {theme} motivational quote. "
            "Color mood: {color_mood}. Bokeh, gradient, texture. Suitable for overlaying text. No text in image."
        ),
        "width": 1080, "height": 1080,
    },
    # Carousel
    "carousel_slide_cover": {
        "label": "Carousel Cover Slide",
        "category": "social",
        "description": "First slide of an Instagram/LinkedIn carousel",
        "slots": {"topic": "Carousel topic", "industry": "Your industry"},
        "prompt_template": (
            "Eye-catching cover image for a '{topic}' educational carousel in the {industry} space. "
            "Bold, modern, professional. Space for large text overlay. Square format."
        ),
        "width": 1080, "height": 1080,
    },
    "carousel_slide_body": {
        "label": "Carousel Body Slide",
        "category": "social",
        "description": "Interior slide background for a carousel",
        "slots": {"style": "Visual style", "color": "Primary color theme"},
        "prompt_template": (
            "Clean minimal slide background. Style: {style}. Color theme: {color}. "
            "Simple, elegant, suitable for data or text overlay. Square format."
        ),
        "width": 1080, "height": 1080,
    },
    # Ads
    "ad_creative_square": {
        "label": "Ad Creative (Square)",
        "category": "ad",
        "description": "Social media ad background",
        "slots": {"product_category": "Product or service category", "mood": "Ad mood (e.g. energetic, luxurious, friendly)"},
        "prompt_template": (
            "High-impact advertising creative background for a {product_category} brand. "
            "Mood: {mood}. Bold, eye-catching, professional. Space for product and CTA text overlay."
        ),
        "width": 1080, "height": 1080,
    },
    "ad_creative_landscape": {
        "label": "Ad Creative (Landscape)",
        "category": "ad",
        "description": "Landscape ad for Facebook / display network",
        "slots": {"product_category": "Product or service category", "mood": "Mood"},
        "prompt_template": (
            "Professional landscape advertising banner for a {product_category} brand. "
            "Mood: {mood}. Bold, clean design with space for headline text. 1200×628 format."
        ),
        "width": 1200, "height": 628,
    },
    # Email
    "email_hero": {
        "label": "Email Hero Image",
        "category": "email",
        "description": "Email newsletter hero section image",
        "slots": {"campaign_theme": "Campaign theme or offer", "season": "Season or occasion"},
        "prompt_template": (
            "Professional email marketing hero image for a {campaign_theme} campaign during {season}. "
            "Horizontal format 600×300, clean and inviting, no text."
        ),
        "width": 600, "height": 300,
    },
    # Events
    "event_banner": {
        "label": "Event Banner",
        "category": "event",
        "description": "Banner for webinar, conference or event",
        "slots": {"event_type": "Type of event", "topic": "Event topic", "style": "Visual style"},
        "prompt_template": (
            "Professional event marketing banner for a {event_type} about '{topic}'. "
            "Style: {style}. Dynamic and engaging, suitable for text overlay. Landscape format."
        ),
        "width": 1920, "height": 600,
    },
}


def fill_template(
    template_id: str,
    slots: dict[str, str],
    brand_kit: Optional["BrandKit"],
) -> str:
    template = TEMPLATE_CATALOG.get(template_id)
    if not template:
        raise ValueError(f"Unknown template: {template_id}. Available: {list(TEMPLATE_CATALOG)}")

    prompt = template["prompt_template"]
    for key, value in slots.items():
        prompt = prompt.replace(f"{{{key}}}", value or "general")

    # Fill any remaining unfilled slots with defaults
    import re
    unfilled = re.findall(r"\{(\w+)\}", prompt)
    for key in unfilled:
        prompt = prompt.replace(f"{{{key}}}", "general")

    if brand_kit:
        parts = []
        if brand_kit.colors:
            parts.append(f"Brand palette: {', '.join(brand_kit.colors)}")
        if brand_kit.style_rules:
            parts.append(f"Style: {brand_kit.style_rules}")
        if brand_kit.tone:
            parts.append(f"Tone: {brand_kit.tone}")
        if parts:
            prompt = f"{prompt} {'. '.join(parts)}."

    return prompt
```

- [ ] **Step 3: Run tests and commit**

```bash
cd apps/api && pytest tests/test_template_service.py -v
git add apps/api/app/services/template_service.py apps/api/tests/test_template_service.py
git commit -m "feat(templates): add template catalog (12 templates, 6 categories) with slot filling"
```

---

### Task 2: Template generation endpoint

**Files:**
- Create: `apps/api/app/api/v1/routers/templates.py`
- Modify: `apps/api/app/api/v1/router.py`
- Test: `apps/api/tests/test_templates_api.py`

**Interfaces:**
- `GET /api/v1/templates` → `list[TemplateOut]` (catalog listing — no auth required)
- `POST /api/v1/images/from-template` body: `{project_id, template_id, slots, use_brand_kit}` → `ImageOut`

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_templates_api.py
async def test_list_templates(client, auth_headers):
    response = await client.get("/api/v1/templates", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 10
    assert all("id" in t and "label" in t and "category" in t for t in data)


async def test_generate_from_template(client, auth_headers, sample_project):
    from unittest.mock import patch, AsyncMock
    with patch("app.api.v1.routers.templates.generate_image_dalle",
               AsyncMock(return_value={"ok": True, "image_url": "https://s3.example.com/blog.png",
                                       "width": 1200, "height": 630, "revised_prompt": None, "cost_usd": 0.04})):
        with patch("app.api.v1.routers.templates._get_openai_key", AsyncMock(return_value="sk-test")):
            response = await client.post(
                "/api/v1/images/from-template",
                json={
                    "project_id": str(sample_project.id),
                    "template_id": "blog_featured",
                    "slots": {"topic": "AI trends", "style": "professional"},
                },
                headers=auth_headers,
            )
    assert response.status_code == 200
    data = response.json()
    assert data["image_url"] == "https://s3.example.com/blog.png"


async def test_generate_unknown_template(client, auth_headers, sample_project):
    response = await client.post(
        "/api/v1/images/from-template",
        json={"project_id": str(sample_project.id), "template_id": "BOGUS", "slots": {}},
        headers=auth_headers,
    )
    assert response.status_code == 400
```

- [ ] **Step 2: Create templates router**

```python
# apps/api/app/api/v1/routers/templates.py
import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from app.core.dependencies import CurrentUser, DB
from app.core.security import decrypt_api_key
from app.models.image import GeneratedImage, ImageStatus, ImageUsage, ImageStyle
from app.models.api_key import APIKey
from app.models.brand_kit import BrandKit as BrandKitModel
from app.models.project import Project
from app.services.template_service import TEMPLATE_CATALOG, fill_template
from app.services.image_service import generate_image_dalle
from app.api.v1.routers.images import ImageOut
from app.core.billing import check_project_not_locked, increment_usage

router = APIRouter()
image_router = APIRouter()


class TemplateOut(BaseModel):
    id: str
    label: str
    category: str
    description: str
    slots: dict
    width: int
    height: int


class FromTemplateRequest(BaseModel):
    project_id: uuid.UUID
    template_id: str
    slots: dict[str, str] = {}
    use_brand_kit: bool = False


async def _get_openai_key(org_id: uuid.UUID, db) -> Optional[str]:
    result = await db.execute(select(APIKey).where(APIKey.org_id == org_id, APIKey.provider == "openai"))
    row = result.scalar_one_or_none()
    return decrypt_api_key(row.encrypted_value) if row else None


@router.get("", response_model=list[TemplateOut])
async def list_templates():
    return [
        TemplateOut(id=k, label=v["label"], category=v["category"], description=v["description"],
                    slots=v.get("slots", {}), width=v["width"], height=v["height"])
        for k, v in TEMPLATE_CATALOG.items()
    ]


@image_router.post("/from-template", response_model=ImageOut)
async def generate_from_template(body: FromTemplateRequest, current_user: CurrentUser, db: DB):
    if body.template_id not in TEMPLATE_CATALOG:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown template: {body.template_id}")

    proj = await db.execute(select(Project).where(Project.id == body.project_id, Project.org_id == current_user.org_id))
    if proj.scalar_one_or_none() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    await check_project_not_locked(body.project_id, db)

    brand_kit = None
    if body.use_brand_kit:
        bk = await db.execute(select(BrandKitModel).where(BrandKitModel.org_id == current_user.org_id))
        brand_kit = bk.scalar_one_or_none()

    prompt = fill_template(body.template_id, body.slots, brand_kit)
    tmpl = TEMPLATE_CATALOG[body.template_id]

    image = GeneratedImage(
        org_id=current_user.org_id,
        project_id=body.project_id,
        prompt=prompt,
        style=ImageStyle.professional,
        usage=ImageUsage.article_cover,
        status=ImageStatus.generating,
        width=tmpl["width"],
        height=tmpl["height"],
    )
    db.add(image)
    await db.flush()
    await db.refresh(image)

    openai_key = await _get_openai_key(current_user.org_id, db)
    if openai_key:
        result = await generate_image_dalle(prompt=prompt, style="professional", usage="article_cover", openai_api_key=openai_key)
    else:
        result = {"ok": False, "error": "No OpenAI key configured"}

    if result.get("ok"):
        image.status = ImageStatus.ready
        image.image_url = result["image_url"]
        image.thumbnail_url = result["image_url"]
        image.width = tmpl["width"]
        image.height = tmpl["height"]
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

- [ ] **Step 3: Register routers, test, commit**

```python
# router.py:
from app.api.v1.routers.templates import router as templates_router, image_router as template_image_router
api_router.include_router(templates_router, prefix="/templates", tags=["templates"])
api_router.include_router(template_image_router, prefix="/images", tags=["templates"])
```

```bash
cd apps/api && pytest tests/test_templates_api.py -v
git add apps/api/app/api/v1/routers/templates.py apps/api/app/api/v1/router.py apps/api/tests/test_templates_api.py
git commit -m "feat(templates): add template catalog API and POST /images/from-template endpoint"
```

---

### Task 3: Frontend — Templates tab in studio

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/components/studio/TemplatesTab.tsx`

- [ ] **Step 1: Add API functions**

```typescript
// apps/web/lib/api.ts

export interface StudioTemplate {
  id: string;
  label: string;
  category: string;
  description: string;
  slots: Record<string, string>;
  width: number;
  height: number;
}

export async function listTemplates(): Promise<StudioTemplate[]> {
  return apiClient.get<StudioTemplate[]>("/templates");
}

export async function generateFromTemplate(
  projectId: string,
  templateId: string,
  slots: Record<string, string>,
  useBrandKit = false,
): Promise<GeneratedImage> {
  return apiClient.post<GeneratedImage>("/images/from-template", {
    project_id: projectId,
    template_id: templateId,
    slots,
    use_brand_kit: useBrandKit,
  });
}
```

- [ ] **Step 2: Create TemplatesTab**

```tsx
// apps/web/components/studio/TemplatesTab.tsx
"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { listTemplates, generateFromTemplate, type StudioTemplate } from "@/lib/api";

const CATEGORY_LABELS: Record<string, string> = {
  blog: "Blog", product: "Product", social: "Social", ad: "Ad", email: "Email", event: "Event",
};

interface TemplatesTabProps {
  projectId: string;
  useBrandKit: boolean;
  onGenerated: () => void;
}

export function TemplatesTab({ projectId, useBrandKit, onGenerated }: TemplatesTabProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<StudioTemplate | null>(null);
  const [slots, setSlots] = useState<Record<string, string>>({});
  const [activeCategory, setActiveCategory] = useState("blog");
  const qc = useQueryClient();

  const { data: templates = [] } = useQuery({ queryKey: ["templates"], queryFn: listTemplates });
  const categories = [...new Set(templates.map((t) => t.category))];
  const filtered = templates.filter((t) => t.category === activeCategory);

  const mutation = useMutation({
    mutationFn: () => generateFromTemplate(projectId, selectedTemplate!.id, slots, useBrandKit),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["images", projectId] }); onGenerated(); },
  });

  function selectTemplate(t: StudioTemplate) {
    setSelectedTemplate(t);
    setSlots({});
  }

  if (selectedTemplate) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setSelectedTemplate(null)}
                  className="text-xs text-muted-foreground hover:text-foreground">← Back</button>
          <span className="text-xs font-semibold text-foreground">{selectedTemplate.label}</span>
        </div>

        <p className="text-xs text-muted-foreground">{selectedTemplate.description}</p>
        <p className="text-xs text-muted-foreground tabular-nums">{selectedTemplate.width}×{selectedTemplate.height}px</p>

        {Object.entries(selectedTemplate.slots).map(([key, description]) => (
          <div key={key}>
            <label className="block text-xs font-semibold text-foreground mb-1 capitalize">{key.replace(/_/g, " ")}</label>
            <input
              type="text"
              placeholder={description}
              value={slots[key] || ""}
              onChange={(e) => setSlots((prev) => ({ ...prev, [key]: e.target.value }))}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        ))}

        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
          className="btn-primary w-full py-2 text-sm disabled:opacity-50 mt-1"
        >
          {mutation.isPending ? "Generating…" : "Generate from template"}
        </button>

        {mutation.isError && (
          <p className="text-xs text-destructive">
            {mutation.error instanceof Error ? mutation.error.message : "Failed"}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex gap-1 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveCategory(cat)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[10px] font-medium capitalize transition-colors",
              activeCategory === cat ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {CATEGORY_LABELS[cat] || cat}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {filtered.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => selectTemplate(t)}
            className="text-left rounded-lg border border-border px-3 py-2.5 hover:border-primary/50 hover:bg-muted/30 transition-colors"
          >
            <p className="text-xs font-semibold text-foreground">{t.label}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t.description}</p>
            <p className="text-[10px] text-muted-foreground tabular-nums mt-1">{t.width}×{t.height}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add "Templates" tab to studio page, typecheck, commit**

```bash
cd apps/web && npm run typecheck
git add apps/web/lib/api.ts apps/web/components/studio/TemplatesTab.tsx apps/web/app/
git commit -m "feat(templates): add TemplatesTab to studio with 12 template cards and slot filling"
```

---

## Self-Review

| Requirement | Task |
|---|---|
| 12 templates across 6 categories | Task 1 |
| Blog featured image, product card, testimonial, quote, carousel, ad | Task 1 |
| Slot-based customisation (fill in topic, product, mood etc.) | Tasks 1, 3 |
| Brand kit injection into template prompts | Task 1 |
| `GET /templates` catalog endpoint | Task 2 |
| `POST /images/from-template` generation | Task 2 |
| Templates tab in studio with category filter + slot form | Task 3 |

Note: Full drag-and-drop canvas layer editor (true §11) requires a canvas engine (Fabric.js/Konva) and is a separate large project. This plan delivers the prompt-template equivalent that provides 80% of the value with 20% of the complexity. ✓
