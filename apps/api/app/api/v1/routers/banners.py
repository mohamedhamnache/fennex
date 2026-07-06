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
    if body.format_ids:
        unknown = [f for f in body.format_ids if f not in BANNER_FORMATS]
        if unknown:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Unknown format(s): {unknown}. Available: {list(BANNER_FORMATS)}",
            )

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

    valid_styles = {e.value for e in ImageStyle}
    image_style = ImageStyle(body.style) if body.style in valid_styles else ImageStyle.professional

    async def _generate_one(variant: dict) -> GeneratedImage:
        image = GeneratedImage(
            org_id=current_user.org_id,
            project_id=body.project_id,
            prompt=variant["prompt"],
            style=image_style,
            usage=ImageUsage.marketing_banner,
            status=ImageStatus.generating,
            banner_format=variant["format_id"],
        )
        db.add(image)
        await db.flush()
        await db.refresh(image)

        if openai_key:
            result = await generate_image_dalle(
                prompt=variant["prompt"],
                style=body.style,
                usage="marketing_banner",
                openai_api_key=openai_key,
                size_override=variant["generation_size"],
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
