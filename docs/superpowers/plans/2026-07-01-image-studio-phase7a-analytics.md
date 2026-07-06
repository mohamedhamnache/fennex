# Image Studio Phase 7A — Analytics & Scoring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

> **Dependency:** Plan 2A (brand kit), Plan 2C (alt_text, seo_filename on GeneratedImage). Existing `call_llm`.

**Goal:** Score every generated image on visual quality, brand consistency, SEO friendliness, and predicted ad performance. Users see a score card on each image in the studio. Clicking it shows a breakdown with actionable improvement tips.

**Architecture:** New `image_scores` table storing per-image scores and LLM feedback. New `POST /images/{id}/score` endpoint calls the org's LLM with a structured prompt to evaluate the image's prompt, alt text, brand alignment, and usage context → returns scores (0–100 each) and text feedback. Frontend adds a score badge on image cards and a score breakdown panel in the edit page.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, existing `call_llm`, Next.js 14 App Router, TanStack Query v5

## Global Constraints

- Python 3.11+, FastAPI, SQLAlchemy 2 async, Pydantic v2
- TypeScript: 0 errors
- TDD: write failing test first, then implement

---

### Task 1: ImageScore model + migration

**Files:**
- Create: `apps/api/app/models/image_score.py`
- Modify: `apps/api/app/models/__init__.py`
- Create: migration

**Interfaces:**
- Produces: `ImageScore(image_id, visual_quality, brand_consistency, seo_score, ad_performance, overall, feedback)` — consumed by Tasks 2, 3

- [ ] **Step 1: Write failing test**

```python
# apps/api/tests/test_image_score_model.py
async def test_image_scores_table_exists():
    from sqlalchemy import inspect
    from app.core.database import async_engine
    async with async_engine.connect() as conn:
        insp = await conn.run_sync(inspect)
        assert "image_scores" in insp.get_table_names()
```

- [ ] **Step 2: Create model**

```python
# apps/api/app/models/image_score.py
import uuid
from datetime import datetime
from sqlalchemy import Float, ForeignKey, Text, DateTime, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class ImageScore(Base):
    __tablename__ = "image_scores"
    __table_args__ = (UniqueConstraint("image_id", name="uq_image_score_image"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    image_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("generated_images.id", ondelete="CASCADE"),
        nullable=False, unique=True,
    )
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    visual_quality: Mapped[float | None] = mapped_column(Float, nullable=True)
    brand_consistency: Mapped[float | None] = mapped_column(Float, nullable=True)
    seo_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    ad_performance: Mapped[float | None] = mapped_column(Float, nullable=True)
    overall: Mapped[float | None] = mapped_column(Float, nullable=True)
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    scored_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
```

- [ ] **Step 3: Register, migrate, test, commit**

```python
# apps/api/app/models/__init__.py:
from app.models.image_score import ImageScore  # noqa
```

```bash
docker compose exec api alembic revision --autogenerate -m "image_scores"
make db-migrate
cd apps/api && pytest tests/test_image_score_model.py -v
git add apps/api/app/models/image_score.py apps/api/app/models/__init__.py apps/api/alembic/versions/ apps/api/tests/test_image_score_model.py
git commit -m "feat(analytics): add ImageScore model"
```

---

### Task 2: Scoring service

**Files:**
- Create: `apps/api/app/services/scoring_service.py`
- Test: `apps/api/tests/test_scoring_service.py`

**Interfaces:**
- Produces: `score_image(image, brand_kit, org_id, db) -> dict`
  - Returns `{visual_quality, brand_consistency, seo_score, ad_performance, overall, feedback}`

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_scoring_service.py
import pytest
import uuid
from unittest.mock import AsyncMock, patch
from app.services.scoring_service import score_image


@pytest.mark.asyncio
async def test_score_image_returns_all_fields(monkeypatch):
    monkeypatch.setattr(
        "app.services.scoring_service.get_org_llm_keys",
        AsyncMock(return_value={"anthropic": "sk-test"}),
    )
    monkeypatch.setattr(
        "app.services.scoring_service.call_llm",
        AsyncMock(return_value='''{
            "visual_quality": 82,
            "brand_consistency": 91,
            "seo_score": 78,
            "ad_performance": 74,
            "overall": 81,
            "feedback": "Strong composition. Alt text could be more descriptive. CTA visibility is low."
        }'''),
    )

    class FakeImage:
        prompt = "Red sneaker product shot"
        alt_text = "sneaker"
        usage = "article_cover"
        style = "photorealistic"
        seo_filename = None

    result = await score_image(FakeImage(), None, uuid.uuid4(), db=None)
    assert result["overall"] == 81
    assert "feedback" in result
    assert 0 <= result["visual_quality"] <= 100


@pytest.mark.asyncio
async def test_score_image_no_llm_keys(monkeypatch):
    monkeypatch.setattr("app.services.scoring_service.get_org_llm_keys", AsyncMock(return_value={}))

    class FakeImage:
        prompt = "Test"
        alt_text = None
        usage = "article_cover"
        style = "professional"
        seo_filename = None

    result = await score_image(FakeImage(), None, uuid.uuid4(), db=None)
    assert result.get("error") == "no_llm_keys"
```

- [ ] **Step 2: Create scoring_service.py**

```python
# apps/api/app/services/scoring_service.py
"""LLM-powered image quality and performance scoring."""
import json
import uuid
from typing import Optional, TYPE_CHECKING

from app.services.llm_service import get_org_llm_keys, call_llm

if TYPE_CHECKING:
    from app.models.image import GeneratedImage
    from app.models.brand_kit import BrandKit

_SCORING_SYSTEM = (
    "You are an expert image marketing analyst. "
    "Evaluate an AI-generated image based on its generation prompt, metadata, and context. "
    "Score it on 4 dimensions (each 0–100) and provide actionable feedback. "
    "Respond ONLY with a JSON object with keys: "
    "visual_quality (composition, lighting, realism), "
    "brand_consistency (alignment with brand guidelines if provided, otherwise 70), "
    "seo_score (alt text quality, filename quality, usage context), "
    "ad_performance (predicted engagement, CTA visibility potential, emotional impact), "
    "overall (weighted average), "
    "feedback (2-3 sentence actionable summary). "
    "No markdown, no explanation outside JSON."
)

_PROVIDERS = [
    ("anthropic", "claude-haiku-4-5-20251001"),
    ("openai", "gpt-4o-mini"),
]


async def score_image(
    image,
    brand_kit: Optional["BrandKit"],
    org_id: uuid.UUID,
    db,
) -> dict:
    keys = await get_org_llm_keys(org_id, db)
    if not keys:
        return {"error": "no_llm_keys"}

    # Build evaluation context
    context_parts = [
        f"Prompt: {image.prompt or 'Not provided'}",
        f"Usage: {(image.usage or 'unknown').replace('_', ' ')}",
        f"Style: {image.style or 'unknown'}",
        f"Alt text: {image.alt_text or 'MISSING — SEO issue'}",
        f"SEO filename: {image.seo_filename or 'MISSING'}",
    ]

    if brand_kit:
        brand_parts = []
        if brand_kit.colors:
            brand_parts.append(f"Colors: {', '.join(brand_kit.colors)}")
        if brand_kit.style_rules:
            brand_parts.append(f"Style rules: {brand_kit.style_rules}")
        if brand_kit.tone:
            brand_parts.append(f"Tone: {brand_kit.tone}")
        if brand_parts:
            context_parts.append(f"Brand kit: {'; '.join(brand_parts)}")
    else:
        context_parts.append("Brand kit: not configured")

    user_msg = "\n".join(context_parts)

    for provider, model in _PROVIDERS:
        if provider not in keys:
            continue
        try:
            raw = await call_llm(provider, model, keys[provider], _SCORING_SYSTEM, user_msg)
            data = json.loads(raw.strip())
            # Clamp all numeric scores to 0–100
            for key in ("visual_quality", "brand_consistency", "seo_score", "ad_performance", "overall"):
                if key in data:
                    data[key] = max(0.0, min(100.0, float(data[key])))
            return data
        except Exception:
            continue

    return {"error": "Scoring failed — LLM returned invalid response"}
```

- [ ] **Step 3: Run tests and commit**

```bash
cd apps/api && pytest tests/test_scoring_service.py -v
git add apps/api/app/services/scoring_service.py apps/api/tests/test_scoring_service.py
git commit -m "feat(analytics): add LLM-powered image scoring service"
```

---

### Task 3: Score endpoint

**Files:**
- Create: `apps/api/app/api/v1/routers/scoring.py`
- Modify: `apps/api/app/api/v1/router.py`
- Test: `apps/api/tests/test_scoring_api.py`

**Interfaces:**
- `POST /api/v1/images/{id}/score` → `ScoreOut`
- `GET /api/v1/images/{id}/score` → `ScoreOut` (retrieve cached score)

`ScoreOut`:
```json
{
  "image_id": "uuid",
  "visual_quality": 82,
  "brand_consistency": 91,
  "seo_score": 78,
  "ad_performance": 74,
  "overall": 81,
  "feedback": "...",
  "scored_at": "2026-07-01T12:00:00"
}
```

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_scoring_api.py
async def test_score_image(client, auth_headers, sample_image):
    from unittest.mock import patch, AsyncMock
    with patch("app.api.v1.routers.scoring.score_image",
               AsyncMock(return_value={
                   "visual_quality": 80, "brand_consistency": 70, "seo_score": 65,
                   "ad_performance": 72, "overall": 72, "feedback": "Good composition.",
               })):
        response = await client.post(f"/api/v1/images/{sample_image.id}/score", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["overall"] == 72
    assert "Good composition" in data["feedback"]


async def test_get_cached_score(client, auth_headers, sample_image):
    from unittest.mock import patch, AsyncMock
    with patch("app.api.v1.routers.scoring.score_image",
               AsyncMock(return_value={"visual_quality": 80, "brand_consistency": 70, "seo_score": 65,
                                       "ad_performance": 72, "overall": 72, "feedback": "OK"})):
        await client.post(f"/api/v1/images/{sample_image.id}/score", headers=auth_headers)

    response = await client.get(f"/api/v1/images/{sample_image.id}/score", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["overall"] == 72
```

- [ ] **Step 2: Create scoring router**

```python
# apps/api/app/api/v1/routers/scoring.py
import uuid
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from app.core.dependencies import CurrentUser, DB
from app.models.image import GeneratedImage
from app.models.image_score import ImageScore
from app.models.brand_kit import BrandKit as BrandKitModel
from app.services.scoring_service import score_image

router = APIRouter()


class ScoreOut(BaseModel):
    image_id: uuid.UUID
    visual_quality: Optional[float] = None
    brand_consistency: Optional[float] = None
    seo_score: Optional[float] = None
    ad_performance: Optional[float] = None
    overall: Optional[float] = None
    feedback: Optional[str] = None
    scored_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


@router.post("/{image_id}/score", response_model=ScoreOut)
async def score_image_endpoint(image_id: uuid.UUID, current_user: CurrentUser, db: DB):
    img_result = await db.execute(
        select(GeneratedImage).where(GeneratedImage.id == image_id, GeneratedImage.org_id == current_user.org_id)
    )
    image = img_result.scalar_one_or_none()
    if not image:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")

    bk_result = await db.execute(select(BrandKitModel).where(BrandKitModel.org_id == current_user.org_id))
    brand_kit = bk_result.scalar_one_or_none()

    scores = await score_image(image, brand_kit, current_user.org_id, db)

    if "error" in scores:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            scores["error"] if scores["error"] != "no_llm_keys"
            else "No AI API key configured. Add one in Settings → API Keys.",
        )

    # Upsert score record
    existing_result = await db.execute(select(ImageScore).where(ImageScore.image_id == image_id))
    record = existing_result.scalar_one_or_none()
    if record is None:
        record = ImageScore(image_id=image_id, org_id=current_user.org_id)
        db.add(record)

    record.visual_quality = scores.get("visual_quality")
    record.brand_consistency = scores.get("brand_consistency")
    record.seo_score = scores.get("seo_score")
    record.ad_performance = scores.get("ad_performance")
    record.overall = scores.get("overall")
    record.feedback = scores.get("feedback")
    record.scored_at = datetime.utcnow()

    await db.flush()
    await db.refresh(record)
    await db.commit()
    return ScoreOut(image_id=image_id, **scores, scored_at=record.scored_at)


@router.get("/{image_id}/score", response_model=ScoreOut)
async def get_score(image_id: uuid.UUID, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(ImageScore).where(ImageScore.image_id == image_id, ImageScore.org_id == current_user.org_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No score found — run POST first")
    return ScoreOut.model_validate(record)
```

- [ ] **Step 3: Register, test, commit**

```python
# router.py:
from app.api.v1.routers import scoring
api_router.include_router(scoring.router, prefix="/images", tags=["analytics"])
```

```bash
cd apps/api && pytest tests/test_scoring_api.py -v
git add apps/api/app/api/v1/routers/scoring.py apps/api/app/api/v1/router.py apps/api/tests/test_scoring_api.py
git commit -m "feat(analytics): add POST/GET /images/{id}/score endpoints"
```

---

### Task 4: Frontend — Score badge + breakdown panel

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/components/studio/ScoreBadge.tsx`
- Create: `apps/web/components/studio/edit/ScorePanel.tsx`

- [ ] **Step 1: Add API functions**

```typescript
// apps/web/lib/api.ts

export interface ImageScore {
  image_id: string;
  visual_quality: number | null;
  brand_consistency: number | null;
  seo_score: number | null;
  ad_performance: number | null;
  overall: number | null;
  feedback: string | null;
  scored_at: string | null;
}

export async function scoreImage(imageId: string): Promise<ImageScore> {
  return apiClient.post<ImageScore>(`/images/${imageId}/score`, {});
}

export async function getImageScore(imageId: string): Promise<ImageScore> {
  return apiClient.get<ImageScore>(`/images/${imageId}/score`);
}
```

- [ ] **Step 2: Create ScoreBadge (for image cards)**

```tsx
// apps/web/components/studio/ScoreBadge.tsx
"use client";

import { cn } from "@/lib/cn";

interface ScoreBadgeProps {
  score: number | null | undefined;
  className?: string;
}

export function ScoreBadge({ score, className }: ScoreBadgeProps) {
  if (score == null) return null;
  const color = score >= 80 ? "bg-green-500" : score >= 60 ? "bg-yellow-500" : "bg-red-500";
  return (
    <span className={cn(
      "inline-flex items-center justify-center rounded-full text-[10px] font-bold text-white tabular-nums w-6 h-6",
      color, className,
    )}>
      {Math.round(score)}
    </span>
  );
}
```

- [ ] **Step 3: Create ScorePanel (for edit page)**

```tsx
// apps/web/components/studio/edit/ScorePanel.tsx
"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { BarChart2, Loader2, Sparkles } from "lucide-react";
import { scoreImage, getImageScore, type ImageScore } from "@/lib/api";

const DIMENSIONS = [
  { key: "visual_quality" as const,     label: "Visual Quality" },
  { key: "brand_consistency" as const,  label: "Brand Consistency" },
  { key: "seo_score" as const,          label: "SEO Score" },
  { key: "ad_performance" as const,     label: "Ad Performance" },
] satisfies { key: keyof ImageScore; label: string }[];

interface ScorePanelProps {
  imageId: string;
}

function ScoreBar({ value }: { value: number | null }) {
  const pct = value ?? 0;
  const color = pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground w-6 text-right">{value != null ? Math.round(value) : "—"}</span>
    </div>
  );
}

export function ScorePanel({ imageId }: ScorePanelProps) {
  const { data: cached, refetch } = useQuery<ImageScore>({
    queryKey: ["image-score", imageId],
    queryFn: () => getImageScore(imageId),
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: () => scoreImage(imageId),
    onSuccess: () => refetch(),
  });

  return (
    <div className="border-t border-border bg-card px-4 py-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground">
            Score
            {cached?.overall != null && (
              <span className="ml-2 font-bold text-primary">{Math.round(cached.overall)}/100</span>
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="flex items-center gap-1.5 rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {cached ? "Re-score" : "Score image"}
        </button>
      </div>

      {cached && (
        <>
          <div className="flex flex-col gap-2">
            {DIMENSIONS.map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
                <ScoreBar value={cached[key] as number | null} />
              </div>
            ))}
          </div>

          {cached.feedback && (
            <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/50 pt-2">
              {cached.feedback}
            </p>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add ScorePanel to edit page and ScoreBadge to image cards**

- In edit page: add `<ScorePanel imageId={editTargetId} />` below `<SeoPanel>` in the center column.
- In studio result card: show `<ScoreBadge score={image.score?.overall} />` if score exists (requires passing score from parent or loading separately per card).

- [ ] **Step 5: Typecheck, visual test, commit**

```bash
cd apps/web && npm run typecheck
git add apps/web/lib/api.ts apps/web/components/studio/ScoreBadge.tsx apps/web/components/studio/edit/ScorePanel.tsx apps/web/app/
git commit -m "feat(analytics): add score panel to edit page and score badge on image cards"
```

---

## Self-Review

| Requirement | Task |
|---|---|
| `image_scores` table (visual_quality, brand_consistency, seo_score, ad_performance, overall) | Task 1 |
| LLM-powered multi-dimension scoring | Task 2 |
| Brand kit factored into brand_consistency score | Task 2 |
| Alt text / SEO filename factored into seo_score | Task 2 |
| Score upsert (re-scoring overwrites) | Task 3 |
| Score panel in edit page with bar chart dimensions | Task 4 |
| Feedback text with actionable suggestions | Tasks 2, 4 |
| Score badge on image cards | Task 4 |
| "This banner scores 87/100 but CTA visibility is low" example | Task 2 feedback field |

All §15 requirements covered. ✓
