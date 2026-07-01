import uuid
from datetime import datetime
from typing import Annotated, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from app.core.billing import check_usage_limit, check_project_not_locked, increment_usage
from app.core.dependencies import CurrentUser, DB
from app.core.security import decrypt_api_key
from app.models.image import GeneratedImage, ImageStyle, ImageStatus, ImageUsage
from app.models.api_key import APIKey
from app.models.brand_kit import BrandKit as BrandKitModel
from app.models.project import Project
from app.services.image_service import build_image_prompt, generate_image_dalle, get_placeholder_url
from app.services.llm_service import get_org_llm_keys, call_llm

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class ImageOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    prompt: str
    revised_prompt: Optional[str]
    style: str
    usage: str
    status: str
    image_url: Optional[str]
    thumbnail_url: Optional[str]
    width: int
    height: int
    article_id: Optional[uuid.UUID]
    social_post_id: Optional[uuid.UUID]
    cost_usd: Optional[float]
    error: Optional[str]
    created_at: datetime
    source_image_id: Optional[uuid.UUID]
    edit_operation: Optional[str]
    alt_text: Optional[str] = None
    caption: Optional[str] = None
    seo_filename: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class GenerateImageRequest(BaseModel):
    project_id: uuid.UUID
    prompt: Optional[str] = None
    title: Optional[str] = None
    keyword: Optional[str] = None
    style: Optional[str] = ImageStyle.professional
    usage: Optional[str] = ImageUsage.article_cover
    article_id: Optional[uuid.UUID] = None
    social_post_id: Optional[uuid.UUID] = None
    quality: Optional[Literal["standard", "hd"]] = "standard"
    use_brand_kit: bool = False


class AttachImageRequest(BaseModel):
    article_id: Optional[uuid.UUID] = None
    social_post_id: Optional[uuid.UUID] = None


class ImprovePromptRequest(BaseModel):
    prompt: str
    usage: Optional[str] = None
    style: Optional[str] = None


class ImprovePromptResponse(BaseModel):
    improved_prompt: str


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_image_or_404(image_id: uuid.UUID, org_id: uuid.UUID, db) -> GeneratedImage:
    result = await db.execute(
        select(GeneratedImage).where(
            GeneratedImage.id == image_id,
            GeneratedImage.org_id == org_id,
        )
    )
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    return image


# ── Endpoints ─────────────────────────────────────────────────────────────────

_IMPROVE_SYSTEM = (
    "You are an expert AI image prompt engineer. "
    "Given a short or vague image description, rewrite it as a single, highly detailed, "
    "evocative image generation prompt (no markdown, no lists, no explanations — just the prompt). "
    "Preserve the user's intent. Add lighting, composition, mood, technical details. "
    "Keep it under 200 words."
)

_IMPROVE_PROVIDERS = [
    ("anthropic", "claude-haiku-4-5-20251001"),
    ("openai", "gpt-4o-mini"),
]


@router.post("/improve-prompt", response_model=ImprovePromptResponse)
async def improve_prompt(body: ImprovePromptRequest, current_user: CurrentUser, db: DB):
    if not body.prompt.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Prompt cannot be empty")

    keys = await get_org_llm_keys(current_user.org_id, db)

    context_parts = []
    if body.usage:
        context_parts.append(f"Usage: {body.usage.replace('_', ' ')}")
    if body.style:
        context_parts.append(f"Style: {body.style.replace('_', ' ')}")
    context = f" [{', '.join(context_parts)}]" if context_parts else ""

    user_prompt = f"Improve this image prompt{context}:\n\n{body.prompt.strip()}"

    for provider, model in _IMPROVE_PROVIDERS:
        if provider in keys:
            try:
                improved = await call_llm(provider, model, keys[provider], _IMPROVE_SYSTEM, user_prompt)
                return ImprovePromptResponse(improved_prompt=improved.strip())
            except Exception:
                continue

    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="No AI API key configured. Add an Anthropic or OpenAI key in Settings → API Keys.",
    )


@router.post("/generate", status_code=200, response_model=ImageOut)
async def generate_image(
    body: GenerateImageRequest,
    current_user: CurrentUser,
    db: DB,
    _: Annotated[None, Depends(check_usage_limit("images"))],
):
    # Verify project belongs to org
    proj_result = await db.execute(
        select(Project).where(
            Project.id == body.project_id,
            Project.org_id == current_user.org_id,
        )
    )
    if proj_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    await check_project_not_locked(body.project_id, db)

    # Build prompt
    style = body.style or ImageStyle.professional
    usage = body.usage or ImageUsage.article_cover

    brand_kit = None
    if body.use_brand_kit:
        bk_result = await db.execute(
            select(BrandKitModel).where(BrandKitModel.org_id == current_user.org_id)
        )
        brand_kit = bk_result.scalar_one_or_none()

    if body.prompt:
        prompt = body.prompt
    else:
        title = body.title or ""
        prompt = build_image_prompt(
            title=title,
            keyword=body.keyword,
            style=style,
            usage=usage,
            brand_kit=brand_kit,
        )

    # Create record with status=generating
    image = GeneratedImage(
        org_id=current_user.org_id,
        project_id=body.project_id,
        prompt=prompt,
        style=ImageStyle(style) if isinstance(style, str) else style,
        usage=ImageUsage(usage) if isinstance(usage, str) else usage,
        status=ImageStatus.generating,
        article_id=body.article_id,
        social_post_id=body.social_post_id,
    )
    db.add(image)
    await db.flush()
    await db.refresh(image)

    # Check for OpenAI API key
    key_result = await db.execute(
        select(APIKey).where(
            APIKey.org_id == current_user.org_id,
            APIKey.provider == "openai",
        )
    )
    api_key_row = key_result.scalar_one_or_none()

    if api_key_row is not None:
        openai_key = decrypt_api_key(api_key_row.encrypted_value)
        result = await generate_image_dalle(
            prompt=prompt,
            style=style,
            usage=usage,
            openai_api_key=openai_key,
            quality=body.quality or "standard",   # NEW
        )
    else:
        result = get_placeholder_url(usage)

    if result["ok"]:
        image.status = ImageStatus.ready
        image.image_url = result["image_url"]
        image.thumbnail_url = result["image_url"]
        image.revised_prompt = result.get("revised_prompt")
        image.width = result["width"]
        image.height = result["height"]
        image.cost_usd = result.get("cost_usd")
        image.generation_meta = {
            "provider": "openai" if api_key_row else "placeholder",
            "model": "gpt-image-1" if api_key_row else None,
            "quality": body.quality or "standard",   # NEW
        }
    else:
        image.status = ImageStatus.failed
        image.error = result.get("error")

    await db.flush()
    await db.refresh(image)
    await db.commit()
    await increment_usage(current_user.org_id, "images", db)
    return ImageOut.model_validate(image)


@router.get("", response_model=list[ImageOut])
async def list_images(
    current_user: CurrentUser,
    db: DB,
    project_id: uuid.UUID = Query(...),
    usage: Optional[str] = Query(None),
):
    query = select(GeneratedImage).where(
        GeneratedImage.project_id == project_id,
        GeneratedImage.org_id == current_user.org_id,
        GeneratedImage.source_image_id.is_(None),  # exclude edited versions
    )
    if usage is not None:
        query = query.where(GeneratedImage.usage == usage)
    query = query.order_by(GeneratedImage.created_at.desc())

    result = await db.execute(query)
    images = result.scalars().all()
    return [ImageOut.model_validate(img) for img in images]


@router.get("/{image_id}", response_model=ImageOut)
async def get_image(
    image_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    image = await _get_image_or_404(image_id, current_user.org_id, db)
    return ImageOut.model_validate(image)


@router.delete("/{image_id}", status_code=204)
async def delete_image(
    image_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    image = await _get_image_or_404(image_id, current_user.org_id, db)
    await db.delete(image)
    await db.commit()
    return None


@router.post("/{image_id}/attach", response_model=ImageOut)
async def attach_image(
    image_id: uuid.UUID,
    body: AttachImageRequest,
    current_user: CurrentUser,
    db: DB,
):
    image = await _get_image_or_404(image_id, current_user.org_id, db)

    if body.article_id is not None:
        image.article_id = body.article_id
    if body.social_post_id is not None:
        image.social_post_id = body.social_post_id

    await db.flush()
    await db.refresh(image)
    await db.commit()
    return ImageOut.model_validate(image)
