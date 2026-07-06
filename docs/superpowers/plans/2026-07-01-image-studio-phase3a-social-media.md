# Image Studio Phase 3A — Social Media Creative Generator

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users generate images pre-sized for specific social platforms (Instagram, YouTube, LinkedIn, TikTok, Pinterest, Facebook) with one click, using platform-aware prompts and correct dimensions.

**Architecture:** A new `SocialPreset` enum + DB column captures which platform an image was created for. The generate endpoint accepts `social_platform` and derives `width`, `height`, and prompt style automatically. The studio gets a new "Social" tab in the left panel showing platform icons and quick-generate buttons. No new external services — uses existing DALL-E generation.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, OpenAI gpt-image-1, Next.js 14 App Router, TanStack Query v5, Tailwind CSS v3

## Global Constraints

- Python 3.11+, FastAPI, SQLAlchemy 2 async, Pydantic v2
- Tailwind CSS v3 — CSS variables only
- TypeScript: 0 errors (`cd apps/web && npm run typecheck`)
- TDD: write failing test first, then implement

---

### Task 1: SocialPreset enum + social_platform column

**Files:**
- Modify: `apps/api/app/models/image.py`
- Create: migration via autogenerate
- Test: `apps/api/tests/test_social_columns.py`

- [ ] **Step 1: Write failing test**

```python
# apps/api/tests/test_social_columns.py
async def test_has_social_platform_column():
    from sqlalchemy import inspect
    from app.core.database import async_engine
    async with async_engine.connect() as conn:
        insp = await conn.run_sync(inspect)
        cols = {c["name"] for c in insp.get_columns("generated_images")}
    assert "social_platform" in cols
```

- [ ] **Step 2: Add enum and column**

```python
# apps/api/app/models/image.py — add SocialPreset enum before GeneratedImage class:
class SocialPreset(str, PyEnum):
    instagram_post = "instagram_post"       # 1080×1080
    instagram_story = "instagram_story"     # 1080×1920
    instagram_reel = "instagram_reel"       # 1080×1920
    youtube_thumbnail = "youtube_thumbnail" # 1280×720
    linkedin_banner = "linkedin_banner"     # 1584×396
    linkedin_post = "linkedin_post"         # 1200×627
    facebook_ad = "facebook_ad"             # 1200×628
    tiktok_cover = "tiktok_cover"           # 1080×1920
    pinterest_pin = "pinterest_pin"         # 1000×1500

# Inside GeneratedImage class, after edit_operation:
    social_platform: Mapped[str | None] = mapped_column(String(60), nullable=True)
```

- [ ] **Step 3: Generate migration + apply**

```bash
docker compose exec api alembic revision --autogenerate -m "image_social_platform"
make db-migrate
```

- [ ] **Step 4: Run test and commit**

```bash
cd apps/api && pytest tests/test_social_columns.py -v
git add apps/api/app/models/image.py apps/api/alembic/versions/ apps/api/tests/test_social_columns.py
git commit -m "feat(social): add SocialPreset enum and social_platform column"
```

---

### Task 2: Social platform dimensions + prompt helper

**Files:**
- Modify: `apps/api/app/services/image_service.py`
- Test: `apps/api/tests/test_social_service.py`

**Interfaces:**
- Produces: `SOCIAL_PRESETS: dict`, `build_social_prompt(platform, subject, brand_kit) -> str`
- Consumed by: Task 3

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_social_service.py
from app.services.image_service import SOCIAL_PRESETS, build_social_prompt


def test_social_preset_dimensions():
    assert SOCIAL_PRESETS["instagram_post"] == {"width": 1080, "height": 1080, "label": "Instagram Post"}
    assert SOCIAL_PRESETS["youtube_thumbnail"]["width"] == 1280
    assert SOCIAL_PRESETS["tiktok_cover"]["height"] == 1920


def test_build_social_prompt_contains_platform():
    prompt = build_social_prompt("instagram_post", "product launch", None)
    assert "Instagram" in prompt
    assert "1080" in prompt or "square" in prompt.lower()


def test_build_social_prompt_includes_brand_kit():
    from app.models.brand_kit import BrandKit
    import uuid
    kit = BrandKit(id=uuid.uuid4(), org_id=uuid.uuid4(), colors=["#FF6B35"], tone="Bold")
    prompt = build_social_prompt("youtube_thumbnail", "tech review", kit)
    assert "#FF6B35" in prompt
```

- [ ] **Step 2: Add to image_service.py**

```python
# apps/api/app/services/image_service.py — append:

SOCIAL_PRESETS: dict[str, dict] = {
    "instagram_post":    {"width": 1080, "height": 1080, "label": "Instagram Post", "aspect": "1:1"},
    "instagram_story":   {"width": 1080, "height": 1920, "label": "Instagram Story", "aspect": "9:16"},
    "instagram_reel":    {"width": 1080, "height": 1920, "label": "Instagram Reel", "aspect": "9:16"},
    "youtube_thumbnail": {"width": 1280, "height": 720,  "label": "YouTube Thumbnail", "aspect": "16:9"},
    "linkedin_banner":   {"width": 1584, "height": 396,  "label": "LinkedIn Banner", "aspect": "4:1"},
    "linkedin_post":     {"width": 1200, "height": 627,  "label": "LinkedIn Post", "aspect": "1.91:1"},
    "facebook_ad":       {"width": 1200, "height": 628,  "label": "Facebook Ad", "aspect": "1.91:1"},
    "tiktok_cover":      {"width": 1080, "height": 1920, "label": "TikTok Cover", "aspect": "9:16"},
    "pinterest_pin":     {"width": 1000, "height": 1500, "label": "Pinterest Pin", "aspect": "2:3"},
}


def build_social_prompt(
    platform: str,
    subject: str,
    brand_kit=None,
) -> str:
    meta = SOCIAL_PRESETS.get(platform, {})
    label = meta.get("label", platform.replace("_", " ").title())
    aspect = meta.get("aspect", "")
    base = (
        f"Professional {label} image ({aspect} aspect ratio). "
        f"Subject: {subject}. "
        f"Bold, eye-catching composition optimised for social media engagement. "
        f"No text overlays. High quality, vibrant."
    )
    if brand_kit:
        parts = []
        if brand_kit.colors:
            parts.append(f"Brand palette: {', '.join(brand_kit.colors)}")
        if brand_kit.tone:
            parts.append(f"Tone: {brand_kit.tone}")
        if parts:
            base = f"{base} {'. '.join(parts)}."
    return base
```

- [ ] **Step 3: Run tests and commit**

```bash
cd apps/api && pytest tests/test_social_service.py -v
git add apps/api/app/services/image_service.py apps/api/tests/test_social_service.py
git commit -m "feat(social): add SOCIAL_PRESETS and build_social_prompt helper"
```

---

### Task 3: Update generate endpoint to accept social_platform

**Files:**
- Modify: `apps/api/app/api/v1/routers/images.py`
- Test: add to `apps/api/tests/test_images.py`

- [ ] **Step 1: Update GenerateImageRequest and generate_image**

```python
# apps/api/app/api/v1/routers/images.py

# Add import:
from app.services.image_service import SOCIAL_PRESETS, build_social_prompt

# Add to GenerateImageRequest:
    social_platform: Optional[str] = None

# Add to ImageOut:
    social_platform: Optional[str] = None

# In generate_image(), before building prompt — if social_platform supplied, override dimensions and prompt:
    social_platform = body.social_platform
    if social_platform and social_platform in SOCIAL_PRESETS:
        preset = SOCIAL_PRESETS[social_platform]
        # Override width/height on the image record after flush
        if not body.prompt:
            subject = body.title or body.keyword or "content"
            prompt = build_social_prompt(social_platform, subject, brand_kit)
    
    # After flushing image record:
    if social_platform and social_platform in SOCIAL_PRESETS:
        preset = SOCIAL_PRESETS[social_platform]
        image.width = preset["width"]
        image.height = preset["height"]
        image.social_platform = social_platform
```

- [ ] **Step 2: Write and run test**

```python
# apps/api/tests/test_images.py — add:
async def test_generate_image_with_social_platform(client, auth_headers, sample_project):
    from unittest.mock import patch, AsyncMock
    with patch("app.api.v1.routers.images.generate_image_dalle",
               AsyncMock(return_value={"ok": True, "image_url": "https://example.com/img.png",
                                       "width": 1080, "height": 1080, "revised_prompt": None, "cost_usd": 0.04})):
        response = await client.post(
            "/api/v1/images/generate",
            json={"project_id": str(sample_project.id), "title": "New product", "social_platform": "instagram_post"},
            headers=auth_headers,
        )
    assert response.status_code == 200
    data = response.json()
    assert data["social_platform"] == "instagram_post"
```

```bash
cd apps/api && pytest tests/test_images.py::test_generate_image_with_social_platform -v
git add apps/api/app/api/v1/routers/images.py apps/api/tests/test_images.py
git commit -m "feat(social): accept social_platform in generate endpoint"
```

---

### Task 4: Frontend — Social tab in Studio left panel

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/components/studio/SocialTab.tsx`
- Modify: `apps/web/app/(dashboard)/[projectId]/images/studio/page.tsx`

**Interfaces:**
- Produces: Social platform quick-generate tab visible alongside existing studio controls

- [ ] **Step 1: Add social_platform to GenerateImageRequest in api.ts**

```typescript
// apps/web/lib/api.ts — in GenerateImageRequest:
  social_platform?: string;
```

Add `social_platform` to `GeneratedImage`:
```typescript
  social_platform?: string | null;
```

- [ ] **Step 2: Create SocialTab component**

```tsx
// apps/web/components/studio/SocialTab.tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { generateImage } from "@/lib/api";

const PLATFORMS = [
  { id: "instagram_post",    label: "Instagram Post",    size: "1080×1080", icon: "📷" },
  { id: "instagram_story",   label: "Instagram Story",   size: "1080×1920", icon: "📱" },
  { id: "youtube_thumbnail", label: "YouTube Thumbnail", size: "1280×720",  icon: "▶️" },
  { id: "linkedin_banner",   label: "LinkedIn Banner",   size: "1584×396",  icon: "💼" },
  { id: "linkedin_post",     label: "LinkedIn Post",     size: "1200×627",  icon: "🔗" },
  { id: "facebook_ad",       label: "Facebook Ad",       size: "1200×628",  icon: "📘" },
  { id: "tiktok_cover",      label: "TikTok Cover",      size: "1080×1920", icon: "🎵" },
  { id: "pinterest_pin",     label: "Pinterest Pin",     size: "1000×1500", icon: "📌" },
];

interface SocialTabProps {
  projectId: string;
  subject: string;
  useBrandKit: boolean;
  onGenerated: () => void;
}

export function SocialTab({ projectId, subject, useBrandKit, onGenerated }: SocialTabProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const platforms = selected.length > 0 ? selected : ["instagram_post"];
      await Promise.all(
        platforms.map((platform) =>
          generateImage({
            project_id: projectId,
            title: subject || "Social media content",
            usage: "social_post",
            social_platform: platform,
            use_brand_kit: useBrandKit,
          }),
        ),
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["images", projectId] });
      onGenerated();
    },
  });

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-xs text-muted-foreground">Select platforms to generate for:</p>
      <div className="grid grid-cols-1 gap-1.5">
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() =>
              setSelected((prev) =>
                prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id],
              )
            }
            className={cn(
              "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
              selected.includes(p.id)
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:border-border/80",
            )}
          >
            <span className="text-base leading-none">{p.icon}</span>
            <span className="flex-1 text-xs font-medium">{p.label}</span>
            <span className="text-[10px] text-muted-foreground tabular-nums">{p.size}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        className="btn-primary w-full py-2 text-sm disabled:opacity-50 mt-1"
      >
        {mutation.isPending
          ? "Generating…"
          : selected.length > 1
          ? `Generate ${selected.length} formats`
          : "Generate"}
      </button>

      {mutation.isError && (
        <p className="text-xs text-destructive">Generation failed — please try again.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add Social tab to studio page**

In the studio page, add a tab switcher between "Generate" and "Social". When "Social" is active, render `<SocialTab>` in the left panel area with the current prompt/title as `subject`.

- [ ] **Step 4: Typecheck and commit**

```bash
cd apps/web && npm run typecheck
git add apps/web/lib/api.ts apps/web/components/studio/SocialTab.tsx apps/web/app/\(dashboard\)/\[projectId\]/images/studio/page.tsx
git commit -m "feat(social): add SocialTab with multi-platform quick generate"
```

---

### Task 5: Social badge on studio image cards

Display platform label badge on cards generated for a specific platform.

- [ ] **Step 1: Add platform badge to image card**

In the studio result card, add below the image:

```tsx
{image.social_platform && (
  <span className="absolute top-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-white uppercase tracking-wide">
    {image.social_platform.replace(/_/g, " ")}
  </span>
)}
```

- [ ] **Step 2: Typecheck, visual test, commit**

```bash
cd apps/web && npm run typecheck && npm run dev
# Verify: social badge appears, generate all 8 formats works
git add apps/web/components/studio/
git commit -m "feat(social): show social platform badge on studio result cards"
```

---

## Self-Review

| Requirement | Task |
|---|---|
| Platform presets with correct dimensions | Tasks 1, 2 |
| Platform-aware prompt generation | Task 2 |
| `social_platform` stored on GeneratedImage | Tasks 1, 3 |
| Multi-platform batch generation from studio | Task 4 |
| Platform badge on image cards | Task 5 |
| Brand kit injection into social prompts | Task 2 |
| All 8 platforms: Instagram, YouTube, LinkedIn, Facebook, TikTok, Pinterest | Tasks 1, 4 |

All §6 requirements covered. ✓
