"""POST /images/ab-test — generate N creative variants of the same concept."""
import asyncio
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select

from app.core.billing import check_project_not_locked, increment_usage
from app.core.dependencies import CurrentUser, DB
from app.core.security import decrypt_api_key
from app.models.ab_test import ABTest, ABTestVariant
from app.models.api_key import APIKey
from app.models.brand_kit import BrandKit as BrandKitModel
from app.models.image import GeneratedImage, ImageStatus, ImageStyle, ImageUsage
from app.models.project import Project
from app.services.image_service import generate_image_dalle
from app.api.v1.routers.images import ImageOut

router = APIRouter()

_VARIANT_ANGLES = [
    ("Emotional",   "emotional, human connection, warm and relatable"),
    ("Minimal",     "minimalist, clean, white space, premium"),
    ("Bold",        "bold colors, high contrast, energetic, dynamic"),
    ("Lifestyle",   "lifestyle photography, aspirational, real-world context"),
    ("Abstract",    "abstract art direction, creative, unexpected"),
    ("Cinematic",   "cinematic, dramatic lighting, movie-poster style"),
    ("Flat",        "flat illustration, geometric, modern graphic design"),
    ("Dark",        "dark background, moody, luxury, sophisticated"),
    ("Bright",      "bright, cheerful, optimistic, summer colors"),
    ("Vintage",     "vintage aesthetic, retro color palette, nostalgic"),
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
    result = await db.execute(
        select(APIKey).where(APIKey.org_id == org_id, APIKey.provider == "openai")
    )
    row = result.scalar_one_or_none()
    return decrypt_api_key(row.encrypted_value) if row else None


@router.post("/ab-test", response_model=ABTestOut)
async def create_ab_test(body: ABTestRequest, current_user: CurrentUser, db: DB):
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

    test = ABTest(
        org_id=current_user.org_id,
        project_id=body.project_id,
        concept=body.concept,
        style=body.style,
        variant_count=body.variant_count,
    )
    db.add(test)
    await db.flush()
    await db.refresh(test)

    angles = _VARIANT_ANGLES[: body.variant_count]

    brand_hint = ""
    if brand_kit and brand_kit.colors:
        brand_hint = f" Brand palette: {', '.join(brand_kit.colors)}."

    async def _generate_variant(label: str, angle_desc: str) -> GeneratedImage:
        prompt = f"Creative ad for: {body.concept}. Angle: {angle_desc}. Style: {body.style}.{brand_hint}"
        image = GeneratedImage(
            org_id=current_user.org_id,
            project_id=body.project_id,
            prompt=prompt,
            style=ImageStyle.professional,
            usage=ImageUsage.marketing_banner,
            status=ImageStatus.generating,
        )
        db.add(image)
        await db.flush()
        await db.refresh(image)

        if openai_key:
            result = await generate_image_dalle(
                prompt=prompt, style=body.style, usage="marketing_banner", openai_api_key=openai_key
            )
        else:
            result = {"ok": False, "error": "No OpenAI key configured"}

        if result.get("ok"):
            image.status = ImageStatus.ready
            image.image_url = result["image_url"]
            image.thumbnail_url = result["image_url"]
            image.width = 1080
            image.height = 1080
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
    if test_result.scalar_one_or_none() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "A/B test not found")

    variants_result = await db.execute(
        select(ABTestVariant, GeneratedImage)
        .join(GeneratedImage, ABTestVariant.image_id == GeneratedImage.id)
        .where(ABTestVariant.test_id == test_id)
    )
    images = [row[1] for row in variants_result.all()]
    return ABTestOut(test_id=test_id, variants=[ImageOut.model_validate(img) for img in images])
