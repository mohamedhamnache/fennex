"""POST /images/competitor-analysis — analyze a competitor ad and generate an improved version."""
import json
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.billing import check_project_not_locked, increment_usage
from app.core.dependencies import CurrentUser, DB
from app.core.security import decrypt_api_key
from app.models.api_key import APIKey
from app.models.brand_kit import BrandKit as BrandKitModel
from app.models.image import GeneratedImage, ImageStatus, ImageStyle, ImageUsage
from app.models.project import Project
from app.services.image_service import generate_image_dalle
from app.services.llm_service import call_llm, get_org_llm_keys
from app.api.v1.routers.images import ImageOut

router = APIRouter()

_COMPETITOR_SYSTEM = (
    "You are a creative director specialising in advertising. "
    "The user will provide a competitor's ad image URL and improvement goals. "
    "Analyse what might make the competitor ad effective, then write an improved version prompt. "
    'Respond with JSON: {"analysis": "2-3 sentences", "improved_prompt": "detailed DALL-E prompt"}. '
    "No markdown."
)

_PROVIDERS = [("anthropic", "claude-haiku-4-5-20251001"), ("openai", "gpt-4o-mini")]


async def _get_openai_key(org_id: uuid.UUID, db) -> Optional[str]:
    result = await db.execute(
        select(APIKey).where(APIKey.org_id == org_id, APIKey.provider == "openai")
    )
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
    proj = await db.execute(
        select(Project).where(Project.id == body.project_id, Project.org_id == current_user.org_id)
    )
    if proj.scalar_one_or_none() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    await check_project_not_locked(body.project_id, db)

    keys = await get_org_llm_keys(current_user.org_id, db)
    if not keys:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No AI key configured. Add one in Settings > API Keys.")

    brand_kit = None
    if body.use_brand_kit:
        bk = await db.execute(select(BrandKitModel).where(BrandKitModel.org_id == current_user.org_id))
        brand_kit = bk.scalar_one_or_none()

    brand_hint = ""
    if brand_kit:
        parts = []
        if brand_kit.colors:
            parts.append(f"Colors: {', '.join(brand_kit.colors)}")
        if brand_kit.tone:
            parts.append(f"Tone: {brand_kit.tone}")
        if parts:
            brand_hint = f" Brand guidelines: {'; '.join(parts)}."

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
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Failed to generate analysis — check your AI key.")

    openai_key = await _get_openai_key(current_user.org_id, db)
    if openai_key:
        result = await generate_image_dalle(
            prompt=improved_prompt, style="professional", usage="marketing_banner", openai_api_key=openai_key
        )
    else:
        result = {"ok": False, "error": "No OpenAI key configured"}

    image = GeneratedImage(
        org_id=current_user.org_id,
        project_id=body.project_id,
        prompt=improved_prompt,
        style=ImageStyle.professional,
        usage=ImageUsage.marketing_banner,
        status=ImageStatus.ready if result.get("ok") else ImageStatus.failed,
        image_url=result.get("image_url"),
        thumbnail_url=result.get("image_url"),
        width=result.get("width", 1080),
        height=result.get("height", 1080),
        error=None if result.get("ok") else result.get("error"),
    )
    db.add(image)
    await db.flush()
    await db.refresh(image)
    await db.commit()

    if result.get("ok"):
        await increment_usage(current_user.org_id, "images", db)

    return CompetitorOut(analysis=analysis, improved_image=ImageOut.model_validate(image))
