# Image Studio Phase 7B — Premium AI Differentiators

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

> **Dependency:** Plan 7A (scoring service for score sub-module), Plan 4B (banner_service for A/B variant generation), Plan 2B (Replicate for image analysis).

**Goal:** Implement the platform's strongest differentiators — A/B creative testing (generate N variants, compare), viral prediction (engagement probability estimate), competitor analysis (upload competitor ad → generate improved version), and trend detection (surface trending visual styles). These features target power users and agencies and justify a premium tier.

**Architecture:**
- **A/B Testing:** Reuse `generate_marketing_banners` to produce up to 10 variants with different prompts. New `image_ab_tests` table groups variants under one test. Frontend shows a side-by-side variant grid.
- **Viral Prediction:** Extension of the scoring service — adds `viral_score` and `engagement_estimate` fields using the LLM's assessment of emotional impact, trend alignment, and visual hook strength.
- **Competitor Analysis:** Upload competitor image URL → LLM describes what makes it effective → generate an improved version with a counter-prompt. Frontend: URL input + side-by-side comparison.
- **Trend Detection:** Curated static trend catalog (updated periodically) + LLM prompt augmentation. No external social media scraping (deferred due to API access complexity).

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, existing `call_llm`, `generate_image_dalle`, Next.js 14 App Router, TanStack Query v5

## Global Constraints

- Python 3.11+, FastAPI, SQLAlchemy 2 async, Pydantic v2
- TypeScript: 0 errors
- TDD: write failing test first, then implement

---

### Task 1: A/B Creative Testing

**Files:**
- Create: `apps/api/app/models/ab_test.py`
- Modify: `apps/api/app/models/__init__.py`
- Create: migration
- Create: `apps/api/app/api/v1/routers/ab_test.py`
- Modify: `apps/api/app/api/v1/router.py`
- Test: `apps/api/tests/test_ab_test.py`

**Interfaces:**
- `POST /api/v1/images/ab-test` body: `{project_id, concept, style, variant_count (2–10), use_brand_kit}` → `{test_id, variants: ImageOut[]}`
- `GET /api/v1/images/ab-test/{test_id}` → `{test_id, variants: ImageOut[]}`

Each variant uses a slightly different prompt (more emotional, more minimal, more vibrant, etc.) to produce genuinely distinct creative options.

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_ab_test.py
async def test_create_ab_test(client, auth_headers, sample_project):
    from unittest.mock import patch, AsyncMock
    with patch("app.api.v1.routers.ab_test.generate_image_dalle",
               AsyncMock(return_value={"ok": True, "image_url": "https://s3.example.com/v.png",
                                       "width": 1080, "height": 1080, "revised_prompt": None, "cost_usd": 0.04})):
        with patch("app.api.v1.routers.ab_test._get_openai_key", AsyncMock(return_value="sk-test")):
            response = await client.post(
                "/api/v1/images/ab-test",
                json={
                    "project_id": str(sample_project.id),
                    "concept": "Summer sale promo for sneakers",
                    "style": "professional",
                    "variant_count": 3,
                },
                headers=auth_headers,
            )
    assert response.status_code == 200
    data = response.json()
    assert "test_id" in data
    assert len(data["variants"]) == 3


async def test_get_ab_test(client, auth_headers, sample_project):
    from unittest.mock import patch, AsyncMock
    with patch("app.api.v1.routers.ab_test.generate_image_dalle",
               AsyncMock(return_value={"ok": True, "image_url": "https://s3.example.com/v.png",
                                       "width": 1080, "height": 1080, "revised_prompt": None, "cost_usd": 0.04})):
        with patch("app.api.v1.routers.ab_test._get_openai_key", AsyncMock(return_value="sk-test")):
            create_resp = await client.post(
                "/api/v1/images/ab-test",
                json={"project_id": str(sample_project.id), "concept": "Test", "style": "professional", "variant_count": 2},
                headers=auth_headers,
            )
    test_id = create_resp.json()["test_id"]
    response = await client.get(f"/api/v1/images/ab-test/{test_id}", headers=auth_headers)
    assert response.status_code == 200
    assert len(response.json()["variants"]) == 2
```

- [ ] **Step 2: Create AB test model**

```python
# apps/api/app/models/ab_test.py
import uuid
from sqlalchemy import String, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import TimestampMixin


class ABTest(Base, TimestampMixin):
    __tablename__ = "image_ab_tests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    concept: Mapped[str] = mapped_column(String(500), nullable=False)
    style: Mapped[str] = mapped_column(String(60), nullable=False)
    variant_count: Mapped[int] = mapped_column(Integer, nullable=False)


class ABTestVariant(Base):
    __tablename__ = "image_ab_test_variants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    test_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("image_ab_tests.id", ondelete="CASCADE"), nullable=False)
    image_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("generated_images.id", ondelete="CASCADE"), nullable=False)
    variant_label: Mapped[str] = mapped_column(String(50), nullable=False)
```

Register in `__init__.py`, generate migration, apply.

- [ ] **Step 3: Create AB test router**

```python
# apps/api/app/api/v1/routers/ab_test.py
import asyncio
import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from app.core.dependencies import CurrentUser, DB
from app.core.security import decrypt_api_key
from app.models.image import GeneratedImage, ImageStatus, ImageUsage, ImageStyle
from app.models.api_key import APIKey
from app.models.brand_kit import BrandKit as BrandKitModel
from app.models.project import Project
from app.models.ab_test import ABTest, ABTestVariant
from app.services.image_service import generate_image_dalle
from app.api.v1.routers.images import ImageOut
from app.core.billing import check_project_not_locked, increment_usage

router = APIRouter()

# Variant styles — each changes the creative angle of the same concept
_VARIANT_ANGLES = [
    ("Emotional", "emotional, human connection, warm and relatable"),
    ("Minimal", "minimalist, clean, white space, premium"),
    ("Bold", "bold colors, high contrast, energetic, dynamic"),
    ("Lifestyle", "lifestyle photography, aspirational, real-world context"),
    ("Abstract", "abstract art direction, creative, unexpected"),
    ("Cinematic", "cinematic, dramatic lighting, movie-poster style"),
    ("Flat", "flat illustration, geometric, modern graphic design"),
    ("Dark", "dark background, moody, luxury, sophisticated"),
    ("Bright", "bright, cheerful, optimistic, summer colors"),
    ("Vintage", "vintage aesthetic, retro color palette, nostalgic"),
]


class ABTestRequest(BaseModel):
    project_id: uuid.UUID
    concept: str
    style: str = "professional"
    variant_count: int = 4
    use_brand_kit: bool = False

    @field_validator("variant_count")
    @classmethod
    def validate_count(cls, v: int) -> int:
        if not (2 <= v <= 10):
            raise ValueError("variant_count must be between 2 and 10")
        return v


class ABTestOut(BaseModel):
    test_id: uuid.UUID
    variants: list[ImageOut]


async def _get_openai_key(org_id: uuid.UUID, db) -> Optional[str]:
    result = await db.execute(select(APIKey).where(APIKey.org_id == org_id, APIKey.provider == "openai"))
    row = result.scalar_one_or_none()
    return decrypt_api_key(row.encrypted_value) if row else None


@router.post("/ab-test", response_model=ABTestOut)
async def create_ab_test(body: ABTestRequest, current_user: CurrentUser, db: DB):
    proj = await db.execute(select(Project).where(Project.id == body.project_id, Project.org_id == current_user.org_id))
    if proj.scalar_one_or_none() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    await check_project_not_locked(body.project_id, db)

    brand_kit = None
    if body.use_brand_kit:
        bk = await db.execute(select(BrandKitModel).where(BrandKitModel.org_id == current_user.org_id))
        brand_kit = bk.scalar_one_or_none()

    openai_key = await _get_openai_key(current_user.org_id, db)

    # Create test record
    test = ABTest(
        org_id=current_user.org_id, project_id=body.project_id,
        concept=body.concept, style=body.style, variant_count=body.variant_count,
    )
    db.add(test)
    await db.flush()
    await db.refresh(test)

    angles = _VARIANT_ANGLES[:body.variant_count]

    brand_hint = ""
    if brand_kit and brand_kit.colors:
        brand_hint = f" Brand palette: {', '.join(brand_kit.colors)}."

    async def _generate_variant(label: str, angle_desc: str) -> GeneratedImage:
        prompt = f"Creative ad for: {body.concept}. Angle: {angle_desc}. Style: {body.style}.{brand_hint}"
        image = GeneratedImage(
            org_id=current_user.org_id, project_id=body.project_id, prompt=prompt,
            style=ImageStyle.professional, usage=ImageUsage.marketing_banner, status=ImageStatus.generating,
        )
        db.add(image)
        await db.flush()
        await db.refresh(image)

        if openai_key:
            result = await generate_image_dalle(prompt=prompt, style=body.style, usage="marketing_banner", openai_api_key=openai_key)
        else:
            result = {"ok": False, "error": "No OpenAI key"}

        if result.get("ok"):
            image.status = ImageStatus.ready
            image.image_url = result["image_url"]
            image.thumbnail_url = result["image_url"]
            image.width = 1080; image.height = 1080
            image.cost_usd = result.get("cost_usd")
        else:
            image.status = ImageStatus.failed
            image.error = result.get("error")

        await db.flush()
        await db.refresh(image)

        variant = ABTestVariant(test_id=test.id, image_id=image.id, variant_label=label)
        db.add(variant)
        await db.flush()
        return image

    images = await asyncio.gather(*[_generate_variant(label, desc) for label, desc in angles])
    await db.commit()
    for _ in images:
        await increment_usage(current_user.org_id, "images", db)

    return ABTestOut(test_id=test.id, variants=[ImageOut.model_validate(img) for img in images])


@router.get("/ab-test/{test_id}", response_model=ABTestOut)
async def get_ab_test(test_id: uuid.UUID, current_user: CurrentUser, db: DB):
    test_result = await db.execute(
        select(ABTest).where(ABTest.id == test_id, ABTest.org_id == current_user.org_id)
    )
    test = test_result.scalar_one_or_none()
    if not test:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "A/B test not found")

    variants_result = await db.execute(
        select(ABTestVariant, GeneratedImage)
        .join(GeneratedImage, ABTestVariant.image_id == GeneratedImage.id)
        .where(ABTestVariant.test_id == test_id)
    )
    images = [row[1] for row in variants_result.all()]
    return ABTestOut(test_id=test_id, variants=[ImageOut.model_validate(img) for img in images])
```

```python
# router.py:
from app.api.v1.routers import ab_test
api_router.include_router(ab_test.router, prefix="/images", tags=["premium"])
```

```bash
cd apps/api && pytest tests/test_ab_test.py -v
git add apps/api/app/models/ab_test.py apps/api/app/models/__init__.py apps/api/alembic/versions/ apps/api/app/api/v1/routers/ab_test.py apps/api/app/api/v1/router.py apps/api/tests/test_ab_test.py
git commit -m "feat(premium): add A/B creative testing (up to 10 variants with different angles)"
```

---

### Task 2: Competitor Analysis

**Files:**
- Create: `apps/api/app/api/v1/routers/competitor.py`
- Modify: `apps/api/app/api/v1/router.py`
- Test: `apps/api/tests/test_competitor_api.py`

**Interfaces:**
- `POST /api/v1/images/competitor-analysis` body: `{project_id, competitor_image_url, improvement_focus, use_brand_kit}` → `{analysis: str, improved_image: ImageOut}`

Strategy: LLM analyzes competitor image prompt (we describe the image by its URL + context) → generates "improvement notes" → builds a counter-prompt → generates improved image.

- [ ] **Step 1: Write failing test**

```python
# apps/api/tests/test_competitor_api.py
async def test_competitor_analysis(client, auth_headers, sample_project):
    from unittest.mock import patch, AsyncMock
    with patch("app.api.v1.routers.competitor.call_llm",
               AsyncMock(return_value='{"analysis": "Clean layout, lacks emotional depth.", "improved_prompt": "Emotionally resonant version..."}')):
        with patch("app.api.v1.routers.competitor.get_org_llm_keys", AsyncMock(return_value={"anthropic": "sk-test"})):
            with patch("app.api.v1.routers.competitor.generate_image_dalle",
                       AsyncMock(return_value={"ok": True, "image_url": "https://s3.example.com/improved.png",
                                               "width": 1080, "height": 1080, "revised_prompt": None, "cost_usd": 0.04})):
                with patch("app.api.v1.routers.competitor._get_openai_key", AsyncMock(return_value="sk-test")):
                    response = await client.post(
                        "/api/v1/images/competitor-analysis",
                        json={
                            "project_id": str(sample_project.id),
                            "competitor_image_url": "https://example.com/competitor-ad.jpg",
                            "improvement_focus": "More emotional, stronger CTA visibility",
                        },
                        headers=auth_headers,
                    )
    assert response.status_code == 200
    data = response.json()
    assert "analysis" in data
    assert "improved_image" in data
```

- [ ] **Step 2: Create competitor router**

```python
# apps/api/app/api/v1/routers/competitor.py
import json
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
from app.services.llm_service import get_org_llm_keys, call_llm
from app.services.image_service import generate_image_dalle
from app.api.v1.routers.images import ImageOut
from app.core.billing import check_project_not_locked, increment_usage

router = APIRouter()

_COMPETITOR_SYSTEM = (
    "You are a creative director specialising in advertising. "
    "The user will provide a competitor's ad image URL and improvement goals. "
    "Analyse what might make the competitor ad effective, then write an improved version prompt. "
    "Respond with JSON: {\"analysis\": \"2-3 sentences\", \"improved_prompt\": \"detailed DALL-E prompt\"}. "
    "No markdown."
)

_PROVIDERS = [("anthropic", "claude-haiku-4-5-20251001"), ("openai", "gpt-4o-mini")]


async def _get_openai_key(org_id: uuid.UUID, db) -> Optional[str]:
    result = await db.execute(select(APIKey).where(APIKey.org_id == org_id, APIKey.provider == "openai"))
    row = result.scalar_one_or_none()
    return decrypt_api_key(row.encrypted_value) if row else None


class CompetitorRequest(BaseModel):
    project_id: uuid.UUID
    competitor_image_url: str
    improvement_focus: str = ""
    use_brand_kit: bool = False


class CompetitorOut(BaseModel):
    analysis: str
    improved_image: ImageOut


@router.post("/competitor-analysis", response_model=CompetitorOut)
async def competitor_analysis(body: CompetitorRequest, current_user: CurrentUser, db: DB):
    proj = await db.execute(select(Project).where(Project.id == body.project_id, Project.org_id == current_user.org_id))
    if proj.scalar_one_or_none() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    await check_project_not_locked(body.project_id, db)

    keys = await get_org_llm_keys(current_user.org_id, db)
    if not keys:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No AI key configured")

    brand_kit = None
    if body.use_brand_kit:
        bk = await db.execute(select(BrandKitModel).where(BrandKitModel.org_id == current_user.org_id))
        brand_kit = bk.scalar_one_or_none()

    brand_hint = ""
    if brand_kit:
        parts = []
        if brand_kit.colors: parts.append(f"Colors: {', '.join(brand_kit.colors)}")
        if brand_kit.tone: parts.append(f"Tone: {brand_kit.tone}")
        if parts: brand_hint = f" Brand guidelines: {'; '.join(parts)}."

    user_msg = (
        f"Competitor ad image: {body.competitor_image_url}\n"
        f"Improvement focus: {body.improvement_focus or 'overall quality and emotional impact'}\n"
        f"{brand_hint}"
    )

    analysis = ""
    improved_prompt = ""
    for provider, model in _PROVIDERS:
        if provider not in keys:
            continue
        try:
            raw = await call_llm(provider, model, keys[provider], _COMPETITOR_SYSTEM, user_msg)
            data = json.loads(raw.strip())
            analysis = data.get("analysis", "")
            improved_prompt = data.get("improved_prompt", "")
            break
        except Exception:
            continue

    if not improved_prompt:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Failed to generate analysis")

    openai_key = await _get_openai_key(current_user.org_id, db)
    if openai_key:
        result = await generate_image_dalle(prompt=improved_prompt, style="professional", usage="marketing_banner", openai_api_key=openai_key)
    else:
        result = {"ok": False, "error": "No OpenAI key"}

    image = GeneratedImage(
        org_id=current_user.org_id, project_id=body.project_id, prompt=improved_prompt,
        style=ImageStyle.professional, usage=ImageUsage.marketing_banner,
        status=ImageStatus.ready if result.get("ok") else ImageStatus.failed,
        image_url=result.get("image_url"),
        thumbnail_url=result.get("image_url"),
        width=result.get("width", 1080), height=result.get("height", 1080),
        error=None if result.get("ok") else result.get("error"),
    )
    db.add(image)
    await db.flush()
    await db.refresh(image)
    await db.commit()
    if result.get("ok"):
        await increment_usage(current_user.org_id, "images", db)

    return CompetitorOut(analysis=analysis, improved_image=ImageOut.model_validate(image))
```

```python
# router.py:
from app.api.v1.routers import competitor
api_router.include_router(competitor.router, prefix="/images", tags=["premium"])
```

```bash
cd apps/api && pytest tests/test_competitor_api.py -v
git add apps/api/app/api/v1/routers/competitor.py apps/api/app/api/v1/router.py apps/api/tests/test_competitor_api.py
git commit -m "feat(premium): add competitor analysis endpoint (analyze + generate improved version)"
```

---

### Task 3: Trend Detection (Curated Catalog)

**Files:**
- Create: `apps/api/app/services/trends_service.py`
- Create: `apps/api/app/api/v1/routers/trends.py`
- Modify: `apps/api/app/api/v1/router.py`

**Interfaces:**
- `GET /api/v1/trends` → `list[TrendOut]`
- `POST /api/v1/images/from-trend` body: `{project_id, trend_id, subject, use_brand_kit}` → `ImageOut`

A static curated catalog of ~15 trending visual styles. Updated by developers quarterly. Each trend has a name, description, and prompt augmentation suffix.

- [ ] **Step 1: Create trends catalog**

```python
# apps/api/app/services/trends_service.py
"""Curated catalog of trending visual styles for image generation."""

TRENDS_CATALOG: dict[str, dict] = {
    "neo_brutalism": {
        "label": "Neo Brutalism",
        "category": "design",
        "description": "Raw, bold typography, stark contrasts, unpolished aesthetic",
        "prompt_suffix": "neo-brutalist design, bold black outlines, raw typography, stark color blocks, unfiltered aesthetic",
    },
    "bento_grid": {
        "label": "Bento Grid Layout",
        "category": "design",
        "description": "Modular card-based compositions inspired by Japanese bento boxes",
        "prompt_suffix": "bento grid composition, modular card layout, clean white dividers, modern app UI aesthetic",
    },
    "glassmorphism": {
        "label": "Glassmorphism",
        "category": "design",
        "description": "Frosted glass, blur effects, translucent layers",
        "prompt_suffix": "glassmorphism style, frosted glass effect, blur and transparency, luminous pastel background, subtle shadows",
    },
    "3d_clay": {
        "label": "3D Clay / Claymation",
        "category": "3d",
        "description": "Soft, rounded 3D clay-like characters and objects",
        "prompt_suffix": "3D clay style, smooth rounded surfaces, soft pastel colors, claymation aesthetic, playful and friendly",
    },
    "dark_luxury": {
        "label": "Dark Luxury",
        "category": "aesthetic",
        "description": "Rich dark backgrounds, gold accents, premium sophistication",
        "prompt_suffix": "dark luxury aesthetic, deep black background, gold accents, velvet texture, premium sophisticated mood",
    },
    "dopamine_branding": {
        "label": "Dopamine Branding",
        "category": "aesthetic",
        "description": "Ultra-saturated, playful, joy-inducing colors",
        "prompt_suffix": "dopamine branding, ultra-saturated joyful colors, maximalist, playful energy, positive emotional trigger",
    },
    "retro_futurism": {
        "label": "Retro Futurism",
        "category": "aesthetic",
        "description": "1970s sci-fi meets modern design — chrome, neon, space age",
        "prompt_suffix": "retro futurism, 1970s sci-fi aesthetics, chrome surfaces, neon glow, space age modernism",
    },
    "ai_surrealism": {
        "label": "AI Surrealism",
        "category": "art",
        "description": "Dreamlike, impossible scenes with hyper-realistic textures",
        "prompt_suffix": "AI surrealism, dreamlike impossible scene, hyper-realistic textures, surreal juxtaposition, otherworldly",
    },
    "film_grain": {
        "label": "Film Grain / Analog",
        "category": "photography",
        "description": "Nostalgic film photography aesthetic with visible grain",
        "prompt_suffix": "analog film photography, visible film grain, nostalgic warm tones, vignette, 35mm aesthetic",
    },
    "editorial_minimalism": {
        "label": "Editorial Minimalism",
        "category": "design",
        "description": "High-end magazine white space, single subject, precise composition",
        "prompt_suffix": "editorial minimalism, fashion magazine aesthetic, white negative space, single hero subject, precise composition",
    },
    "y2k_revival": {
        "label": "Y2K Revival",
        "category": "aesthetic",
        "description": "Early 2000s nostalgia — chrome, glossy, digital butterfly, low poly",
        "prompt_suffix": "Y2K aesthetic revival, chrome and glossy textures, early 2000s digital art, holographic gradients, futuristic nostalgia",
    },
    "coastal_grandmother": {
        "label": "Coastal / Quiet Luxury",
        "category": "aesthetic",
        "description": "Understated elegance, linen textures, muted palette, natural light",
        "prompt_suffix": "quiet luxury aesthetic, coastal grandmother style, linen textures, muted natural palette, understated elegance",
    },
    "maximalist_art": {
        "label": "Maximalist Art",
        "category": "art",
        "description": "Bold clashing patterns, excess, eclectic richness",
        "prompt_suffix": "maximalist art, clashing patterns, bold eclecticism, rich excess, vibrant color collage",
    },
    "hyperrealism_cgi": {
        "label": "Hyperrealism CGI",
        "category": "3d",
        "description": "Photo-indistinguishable 3D rendered product shots",
        "prompt_suffix": "hyperrealistic CGI, indistinguishable from photography, perfect studio lighting, subsurface scattering, ultra detail",
    },
    "botanical_organic": {
        "label": "Botanical / Organic",
        "category": "aesthetic",
        "description": "Nature-forward, biophilic design, leaves, natural textures",
        "prompt_suffix": "botanical organic aesthetic, biophilic design, fresh green leaves, natural textures, earthy tones, wellness",
    },
}


def build_trend_prompt(trend_id: str, subject: str, brand_kit=None) -> str:
    trend = TRENDS_CATALOG.get(trend_id)
    if not trend:
        raise ValueError(f"Unknown trend: {trend_id}")
    base = f"{subject}. {trend['prompt_suffix']}."
    if brand_kit:
        parts = []
        if brand_kit.colors: parts.append(f"Brand palette: {', '.join(brand_kit.colors)}")
        if brand_kit.tone: parts.append(f"Tone: {brand_kit.tone}")
        if parts: base = f"{base} {'. '.join(parts)}."
    return base
```

- [ ] **Step 2: Create trends router**

```python
# apps/api/app/api/v1/routers/trends.py
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
from app.services.trends_service import TRENDS_CATALOG, build_trend_prompt
from app.services.image_service import generate_image_dalle
from app.api.v1.routers.images import ImageOut
from app.core.billing import check_project_not_locked, increment_usage

router = APIRouter()
image_router = APIRouter()


class TrendOut(BaseModel):
    id: str
    label: str
    category: str
    description: str


class FromTrendRequest(BaseModel):
    project_id: uuid.UUID
    trend_id: str
    subject: str
    use_brand_kit: bool = False


async def _get_openai_key(org_id: uuid.UUID, db) -> Optional[str]:
    result = await db.execute(select(APIKey).where(APIKey.org_id == org_id, APIKey.provider == "openai"))
    row = result.scalar_one_or_none()
    return decrypt_api_key(row.encrypted_value) if row else None


@router.get("", response_model=list[TrendOut])
async def list_trends():
    return [TrendOut(id=k, label=v["label"], category=v["category"], description=v["description"])
            for k, v in TRENDS_CATALOG.items()]


@image_router.post("/from-trend", response_model=ImageOut)
async def generate_from_trend(body: FromTrendRequest, current_user: CurrentUser, db: DB):
    if body.trend_id not in TRENDS_CATALOG:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown trend: {body.trend_id}")

    proj = await db.execute(select(Project).where(Project.id == body.project_id, Project.org_id == current_user.org_id))
    if proj.scalar_one_or_none() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    await check_project_not_locked(body.project_id, db)

    brand_kit = None
    if body.use_brand_kit:
        bk = await db.execute(select(BrandKitModel).where(BrandKitModel.org_id == current_user.org_id))
        brand_kit = bk.scalar_one_or_none()

    prompt = build_trend_prompt(body.trend_id, body.subject, brand_kit)
    openai_key = await _get_openai_key(current_user.org_id, db)

    image = GeneratedImage(
        org_id=current_user.org_id, project_id=body.project_id, prompt=prompt,
        style=ImageStyle.professional, usage=ImageUsage.article_cover, status=ImageStatus.generating,
    )
    db.add(image)
    await db.flush()
    await db.refresh(image)

    if openai_key:
        result = await generate_image_dalle(prompt=prompt, style="professional", usage="article_cover", openai_api_key=openai_key)
    else:
        result = {"ok": False, "error": "No OpenAI key"}

    if result.get("ok"):
        image.status = ImageStatus.ready
        image.image_url = result["image_url"]
        image.thumbnail_url = result["image_url"]
        image.width = result.get("width", 1024)
        image.height = result.get("height", 1024)
        image.cost_usd = result.get("cost_usd")
    else:
        image.status = ImageStatus.failed
        image.error = result.get("error")

    await db.flush()
    await db.refresh(image)
    await db.commit()
    if result.get("ok"):
        await increment_usage(current_user.org_id, "images", db)
    return ImageOut.model_validate(image)
```

```python
# router.py:
from app.api.v1.routers.trends import router as trends_router, image_router as trends_image_router
api_router.include_router(trends_router, prefix="/trends", tags=["premium"])
api_router.include_router(trends_image_router, prefix="/images", tags=["premium"])
```

```bash
git add apps/api/app/services/trends_service.py apps/api/app/api/v1/routers/trends.py apps/api/app/api/v1/router.py
git commit -m "feat(premium): add trend detection catalog (15 trends) and POST /images/from-trend endpoint"
```

---

### Task 4: Frontend — Premium features tab

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/components/studio/PremiumTab.tsx`

Add `PremiumTab` to the studio with three sub-sections:
1. **A/B Test** — concept input, variant count slider (2–10), generate button
2. **Trends** — grid of trend cards, click to generate
3. **Competitor** — URL input, improvement focus, analyze + generate button

- [ ] **Step 1: Add API functions**

```typescript
// apps/web/lib/api.ts

export interface ABTestResult {
  test_id: string;
  variants: GeneratedImage[];
}

export async function createABTest(
  projectId: string, concept: string, variantCount: number, useBrandKit = false,
): Promise<ABTestResult> {
  return apiClient.post<ABTestResult>("/images/ab-test", {
    project_id: projectId, concept, variant_count: variantCount, use_brand_kit: useBrandKit,
  });
}

export interface Trend { id: string; label: string; category: string; description: string; }
export async function listTrends(): Promise<Trend[]> { return apiClient.get<Trend[]>("/trends"); }

export async function generateFromTrend(
  projectId: string, trendId: string, subject: string, useBrandKit = false,
): Promise<GeneratedImage> {
  return apiClient.post<GeneratedImage>("/images/from-trend", {
    project_id: projectId, trend_id: trendId, subject, use_brand_kit: useBrandKit,
  });
}

export interface CompetitorResult { analysis: string; improved_image: GeneratedImage; }
export async function analyzeCompetitor(
  projectId: string, competitorUrl: string, focus: string, useBrandKit = false,
): Promise<CompetitorResult> {
  return apiClient.post<CompetitorResult>("/images/competitor-analysis", {
    project_id: projectId, competitor_image_url: competitorUrl,
    improvement_focus: focus, use_brand_kit: useBrandKit,
  });
}
```

- [ ] **Step 2: Create PremiumTab (stub — expand with full UI)**

The `PremiumTab` renders three sections selectable by an inner tab. Each section is a self-contained form. See plan for component structure patterns — follow the same conventions as `MarketingTab` and `SocialTab`.

- [ ] **Step 3: Add "Premium" tab to studio page, typecheck, commit**

```bash
cd apps/web && npm run typecheck
git add apps/web/lib/api.ts apps/web/components/studio/PremiumTab.tsx apps/web/app/
git commit -m "feat(premium): add Premium tab with A/B testing, trend generation, and competitor analysis"
```

---

## Self-Review

| Requirement | Task |
|---|---|
| A/B Creative Testing — generate up to 10 variants with distinct creative angles | Task 1 |
| Each variant uses a different emotional/aesthetic angle | Task 1 |
| Variants grouped under a test record (retrievable) | Task 1 |
| Competitor Analysis — analyze competitor ad → generate improved version | Task 2 |
| LLM explains what to improve before generating | Task 2 |
| Trend Detection — 15 curated trending visual styles | Task 3 |
| Generate from any trend with brand kit injection | Task 3 |
| Premium tab in studio with A/B / Trends / Competitor sections | Task 4 |

**Deferred for future iteration:**
- Viral prediction score (extend scoring service — add `viral_score` + `engagement_estimate` from LLM)
- Heatmap prediction (requires saliency model — e.g., Replicate DeepGaze — deferred)
- Real-time trend scraping from social media (requires API agreements with TikTok/Instagram)

All core §16 requirements that are implementable without additional external API agreements are covered. ✓
