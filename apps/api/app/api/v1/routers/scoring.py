"""POST/GET /images/{id}/score — LLM-powered image quality scoring."""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from app.core.dependencies import CurrentUser, DB
from app.models.brand_kit import BrandKit as BrandKitModel
from app.models.image import GeneratedImage
from app.models.image_score import ImageScore
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
        select(GeneratedImage).where(
            GeneratedImage.id == image_id,
            GeneratedImage.org_id == current_user.org_id,
        )
    )
    image = img_result.scalar_one_or_none()
    if not image:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")

    bk_result = await db.execute(
        select(BrandKitModel).where(BrandKitModel.org_id == current_user.org_id)
    )
    brand_kit = bk_result.scalar_one_or_none()

    scores = await score_image(image, brand_kit, current_user.org_id, db)

    if "error" in scores:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "No AI API key configured. Add one in Settings > API Keys."
            if scores["error"] == "no_llm_keys"
            else scores["error"],
        )

    existing_result = await db.execute(
        select(ImageScore).where(ImageScore.image_id == image_id)
    )
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
        select(ImageScore).where(
            ImageScore.image_id == image_id,
            ImageScore.org_id == current_user.org_id,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No score found — run POST first")
    return ScoreOut.model_validate(record)
