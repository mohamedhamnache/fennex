"""GET /trends and POST /images/from-trend — visual trend catalog and trend-based generation."""
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from app.core.billing import check_project_not_locked, increment_usage
from app.core.dependencies import CurrentUser, DB
from app.core.security import decrypt_api_key
from app.models.api_key import APIKey
from app.models.brand_kit import BrandKit as BrandKitModel
from app.models.image import GeneratedImage, ImageStatus, ImageStyle, ImageUsage
from app.models.project import Project
from app.services.image_service import generate_image_dalle
from app.services.trends_service import TRENDS_CATALOG, build_trend_prompt
from app.api.v1.routers.images import ImageOut

router = APIRouter()
image_router = APIRouter()


class TrendOut(BaseModel):
    id: str
    label: str
    category: str
    description: str
    model_config = ConfigDict(from_attributes=False)


class FromTrendRequest(BaseModel):
    project_id: uuid.UUID
    trend_id: str
    subject: str
    use_brand_kit: bool = False


async def _get_openai_key(org_id: uuid.UUID, db) -> Optional[str]:
    result = await db.execute(
        select(APIKey).where(APIKey.org_id == org_id, APIKey.provider == "openai")
    )
    row = result.scalar_one_or_none()
    return decrypt_api_key(row.encrypted_value) if row else None


@router.get("", response_model=list[TrendOut])
async def list_trends():
    return [
        TrendOut(id=k, label=v["label"], category=v["category"], description=v["description"])
        for k, v in TRENDS_CATALOG.items()
    ]


@image_router.post("/from-trend", response_model=ImageOut)
async def generate_from_trend(body: FromTrendRequest, current_user: CurrentUser, db: DB):
    if body.trend_id not in TRENDS_CATALOG:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown trend: {body.trend_id}")

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

    prompt = build_trend_prompt(body.trend_id, body.subject, brand_kit)
    openai_key = await _get_openai_key(current_user.org_id, db)

    image = GeneratedImage(
        org_id=current_user.org_id,
        project_id=body.project_id,
        prompt=prompt,
        style=ImageStyle.professional,
        usage=ImageUsage.article_cover,
        status=ImageStatus.generating,
    )
    db.add(image)
    await db.flush()
    await db.refresh(image)

    if openai_key:
        result = await generate_image_dalle(
            prompt=prompt, style="professional", usage="article_cover", openai_api_key=openai_key
        )
    else:
        result = {"ok": False, "error": "No OpenAI key configured. Add one in Settings > API Keys."}

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
