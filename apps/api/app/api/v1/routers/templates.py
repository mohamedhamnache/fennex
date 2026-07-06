"""GET /templates and POST /images/from-template — template catalog and slot-based generation."""
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from app.core.dependencies import CurrentUser, DB
from app.core.security import decrypt_api_key
from app.core.billing import check_project_not_locked, increment_usage
from app.models.api_key import APIKey
from app.models.brand_kit import BrandKit as BrandKitModel
from app.models.image import GeneratedImage, ImageStatus, ImageUsage, ImageStyle
from app.models.project import Project
from app.services.template_service import TEMPLATE_CATALOG, fill_template
from app.services.image_service import generate_image_dalle
from app.api.v1.routers.images import ImageOut

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
    model_config = ConfigDict(from_attributes=False)


class FromTemplateRequest(BaseModel):
    project_id: uuid.UUID
    template_id: str
    slots: dict[str, str] = {}
    use_brand_kit: bool = False


async def _get_openai_key(org_id: uuid.UUID, db) -> Optional[str]:
    result = await db.execute(
        select(APIKey).where(APIKey.org_id == org_id, APIKey.provider == "openai")
    )
    row = result.scalar_one_or_none()
    return decrypt_api_key(row.encrypted_value) if row else None


@router.get("", response_model=list[TemplateOut])
async def list_templates():
    return [
        TemplateOut(
            id=k,
            label=v["label"],
            category=v["category"],
            description=v["description"],
            slots=v.get("slots", {}),
            width=v["width"],
            height=v["height"],
        )
        for k, v in TEMPLATE_CATALOG.items()
    ]


@image_router.post("/from-template", response_model=ImageOut)
async def generate_from_template(body: FromTemplateRequest, current_user: CurrentUser, db: DB):
    if body.template_id not in TEMPLATE_CATALOG:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown template: {body.template_id}")

    proj_result = await db.execute(
        select(Project).where(Project.id == body.project_id, Project.org_id == current_user.org_id)
    )
    if proj_result.scalar_one_or_none() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")

    await check_project_not_locked(body.project_id, db)

    brand_kit = None
    if body.use_brand_kit:
        bk_result = await db.execute(
            select(BrandKitModel).where(BrandKitModel.org_id == current_user.org_id)
        )
        brand_kit = bk_result.scalar_one_or_none()

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
        result = await generate_image_dalle(
            prompt=prompt,
            style="professional",
            usage="article_cover",
            openai_api_key=openai_key,
        )
    else:
        result = {"ok": False, "error": "No OpenAI key configured. Add one in Settings > API Keys."}

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
