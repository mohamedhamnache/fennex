import uuid
import ast
import json
import re
import os
import base64
import io
from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, status, Query, File, Form, UploadFile
from sqlalchemy import or_
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from app.core.billing import check_usage_limit, check_project_not_locked, increment_usage, require_credits
from app.core.dependencies import CurrentUser, DB
from app.core.security import decrypt_api_key
from app.models.image import GeneratedImage, ImageStyle, ImageStatus, ImageUsage
from app.models.api_key import APIKey
from app.models.brand_kit import BrandKit as BrandKitModel
from app.models.project import Project
from app.services.image_service import build_image_prompt, build_social_prompt, generate_image_dalle, get_placeholder_url, SOCIAL_PRESETS
from app.core.storage import upload_file
from app.services.llm_service import get_org_llm_keys, call_llm, call_llm_vision, project_locale
from app.services import editing_service

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
    social_platform: Optional[str] = None
    folder_id: Optional[uuid.UUID] = None
    collection_id: Optional[uuid.UUID] = None
    tags: list = []
    is_deleted: bool = False
    # Not a GeneratedImage column -- seed is a generation parameter, not
    # persisted state. Only Product Showcase populates it (echoing the
    # request's seed back for reproducibility); every other endpoint leaves
    # it at its default None via model_validate's missing-attribute fallback.
    seed: Optional[int] = None
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
    social_platform: Optional[str] = None


class AttachImageRequest(BaseModel):
    article_id: Optional[uuid.UUID] = None
    social_post_id: Optional[uuid.UUID] = None


class ImprovePromptRequest(BaseModel):
    prompt: str
    usage: Optional[str] = None
    style: Optional[str] = None
    # Which KIND of prompt is being improved. "generate" (the default, and the
    # only behaviour before Mirage's rephrase control existed) rewrites a
    # text-to-image brief. "edit_instruction" rewrites an instruction aimed at
    # an image that ALREADY exists, which is a different job entirely: asked to
    # improve "remove the mint", the generate-mode system prompt happily
    # returns a full scene description with lighting and mood, and the editor
    # would then be told to generate a new picture instead of removing
    # anything. One endpoint, one metered call path, two system prompts --
    # there is deliberately no second improve endpoint.
    mode: Optional[str] = None


class ImprovePromptResponse(BaseModel):
    improved_prompt: str


# ── Campaign planning (AI Studio) ─────────────────────────────────────────────

class CampaignAsset(BaseModel):
    title: str
    prompt: str
    style: str = "professional"
    usage: str = "custom"
    platform: Optional[str] = None
    caption: str = ""


class CampaignPlan(BaseModel):
    title: str
    summary: str
    assets: list[CampaignAsset] = []


class PlanCampaignRequest(BaseModel):
    goal: str
    use_brand_kit: bool = False
    project_id: Optional[uuid.UUID] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_image_or_404(image_id: uuid.UUID, org_id: uuid.UUID, db) -> GeneratedImage:
    result = await db.execute(
        select(GeneratedImage).where(
            GeneratedImage.id == image_id,
            GeneratedImage.org_id == org_id,
            GeneratedImage.is_deleted.is_(False),
        )
    )
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    return image


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=ImageOut)
async def upload_image(
    project_id: Annotated[uuid.UUID, Form()],
    file: Annotated[UploadFile, File()],
    current_user: CurrentUser,
    db: DB,
    _: Annotated[None, Depends(check_usage_limit("images"))],
):
    proj = await db.execute(
        select(Project).where(Project.id == project_id, Project.org_id == current_user.org_id)
    )
    if proj.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    content = await file.read()
    url = await upload_file(content, file.filename or "upload.png", folder="user-uploads")

    image = GeneratedImage(
        org_id=current_user.org_id,
        project_id=project_id,
        prompt="User uploaded image",
        style=ImageStyle.professional,
        usage=ImageUsage.custom,
        status=ImageStatus.ready,
        image_url=url,
        thumbnail_url=url,
    )
    db.add(image)
    await db.flush()
    await db.refresh(image)
    await db.commit()
    await increment_usage(current_user.org_id, "images", db)
    return ImageOut.model_validate(image)


_IMPROVE_SYSTEM = (
    "You are an expert AI image prompt engineer. "
    "Given a short or vague image description, rewrite it as a single, highly detailed, "
    "evocative image generation prompt (no markdown, no lists, no explanations — just the prompt). "
    "Preserve the user's intent. Add lighting, composition, mood, technical details. "
    "Keep it under 200 words."
)

# Mirage's rephrase control. The input is an EDIT instruction against a picture
# that already exists, so the job is precision, not evocation: name the target,
# state the change, and say nothing about anything the user did not ask to
# touch. Length is a failure mode here rather than a goal -- a rephrase that
# merely lengthens is worse than none, because every extra clause is another
# thing the instruction model may decide to re-render.
_IMPROVE_EDIT_SYSTEM = (
    "You rewrite image EDITING instructions for an AI photo editor. "
    "The picture already exists; the user wants it changed, not replaced. "
    "Rewrite the instruction so it names exactly what to change and how, in one "
    "or two plain sentences. Keep the user's intent, language and every "
    "constraint they stated. Never invent a new subject, scene, style, lighting "
    "or mood they did not ask for, and never describe parts of the image they "
    "did not mention. Shorter and more specific beats longer. "
    "Reply with the rewritten instruction only -- no markdown, no explanation."
)

_IMPROVE_PROVIDERS = [
    ("anthropic", "claude-haiku-4-5-20251001"),
    ("openai", "gpt-4o-mini"),
]

# The metering key for this endpoint's usage events. The call is already
# attributed to the org ambiently (get_org_llm_keys -> set_metering_org, read
# back by call_llm's else-branch), but without a feature name the resulting
# UsageEvent.feature is NULL and the spend cannot be told apart from every
# other unnamed LLM call in the org's ledger.
_IMPROVE_FEATURE = "improve_prompt"


@router.post("/improve-prompt", response_model=ImprovePromptResponse)
async def improve_prompt(body: ImprovePromptRequest, current_user: CurrentUser, db: DB):
    if not body.prompt.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Prompt cannot be empty")

    keys = await get_org_llm_keys(current_user.org_id, db)

    if body.mode == "edit_instruction":
        system = _IMPROVE_EDIT_SYSTEM
        user_prompt = f"Rewrite this editing instruction:\n\n{body.prompt.strip()}"
    else:
        system = _IMPROVE_SYSTEM
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
                improved = await call_llm(provider, model, keys[provider], system, user_prompt,
                                          feature=_IMPROVE_FEATURE)
                return ImprovePromptResponse(improved_prompt=improved.strip())
            except Exception:
                continue

    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="No AI API key configured. Add an Anthropic or OpenAI key in Settings → API Keys.",
    )


# ── Attachment interpretation (Mirage chat) ───────────────────────────────────

class InterpretAttachmentRequest(BaseModel):
    """One image the user attached to a Mirage message, plus what they asked."""
    command: str
    # The GeneratedImage row created by POST /images/upload. Taken as an ID
    # rather than a URL on purpose: the row is looked up scoped to the caller's
    # org, so there is no client-supplied URL to fetch server-side and
    # therefore no request-forgery surface to guard (contrast mask_urls in
    # ai_command.py, which does take URLs and must run every one of them
    # through is_own_storage_url first).
    attachment_image_id: uuid.UUID


class InterpretAttachmentResponse(BaseModel):
    # "insert": the attachment is an element to place INTO the picture (a
    # logo, a product, a person). "reference": it shows a look to imitate and
    # must never itself appear in the result.
    intent: Literal["insert", "reference"]
    # What the image shows. Returned for BOTH intents -- see _INTERPRET_FEATURE
    # for why -- so the caller can switch interpretation without paying again.
    description: str
    # True when no vision-capable key was configured and the verdict came from
    # the wording of the command alone. The caller shows the interpretation
    # either way; this only says how confident it is entitled to sound.
    guessed: bool = False


_INTERPRET_SYSTEM = (
    "You decide what a user wants done with an image they attached to a photo-"
    "editing chat message, and you describe that image.\n\n"
    "Two possible intents:\n"
    '- "insert": the attached image is a THING to place into the picture they '
    "are editing -- a logo, a product, a person, an object. Signals: add, put, "
    "place, insert, stick, paste, overlay, \"this logo\", \"this product\".\n"
    '- "reference": the attached image shows a LOOK to imitate -- a style, a '
    "colour palette, a background, a mood. It must never itself appear in the "
    "result. Signals: like this, in this style, match this, similar to, "
    '"make the background look like this".\n\n'
    "Then describe the attached image in two or three sentences: the subject, "
    "the colours, the lighting, the background, and whether it has a "
    "transparent or plain backdrop. Write the description so it could guide an "
    "image editor that cannot see the image.\n\n"
    'Reply with ONLY this JSON: {"intent": "insert"|"reference", '
    '"description": "..."}. No markdown, no text outside the JSON.'
)

# Vision-capable, cheap-band models. Both entries carry `vision: true` in the
# provider catalog (app/services/providers/catalog.py).
_INTERPRET_PROVIDERS = [
    ("anthropic", "claude-haiku-4-5-20251001"),
    ("openai", "gpt-4o-mini"),
]

# ONE vision call answers both questions, and it is made for BOTH verdicts --
# the description is fetched even when the answer is "insert", where nothing
# will read it. That looks wasteful and is not: the classification will
# sometimes be wrong, and the failure is asymmetric (a reference treated as an
# insert puts an unwanted picture in the frame; an insert treated as a
# reference silently drops the element that was asked for). Having both
# artifacts in hand after one call is what lets the user correct the verdict in
# either direction without re-uploading and without paying a second time. It
# also makes the price quotable up front as a single number instead of a range
# that depends on a verdict nobody has yet.
_INTERPRET_FEATURE = "attachment_intent"

# Fallback classification when no vision-capable key is configured. Deliberately
# crude and deliberately biased: with no model to ask, the safer default is
# "reference", because a wrong reference produces a slightly-off edit the user
# can see and correct, while a wrong insert stamps an unwanted image into their
# picture.
_INSERT_HINTS = (
    # en
    "add ", "insert", "put ", "place ", "paste", "overlay", "stick ",
    # fr / es / pt / de / ar
    "ajoute", "insère", "insere", "mets ", "colle", "pose ",
    "añade", "anade", "agrega", "pon ", "coloca", "inserta",
    "adicione", "coloque", "insira",
    "füge", "fuege", "setze", "platziere",
    "أضف", "ضع", "أدرج",
)


def _classify_from_command(command: str) -> str:
    lowered = (command or "").lower()
    return "insert" if any(hint in lowered for hint in _INSERT_HINTS) else "reference"


def _parse_interpretation(raw: str) -> tuple[Optional[str], str]:
    """Pull {intent, description} out of a model reply. Returns (None, "") when
    the reply is not usable, so the caller can try the next provider."""
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"```$", "", text).strip()
    try:
        data = json.loads(text)
    except Exception:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return None, ""
        try:
            data = json.loads(match.group(0))
        except Exception:
            return None, ""
    if not isinstance(data, Mapping):
        return None, ""
    intent = str(data.get("intent") or "").strip().lower()
    if intent not in ("insert", "reference"):
        intent = None
    return intent, str(data.get("description") or "").strip()


@router.post("/interpret-attachment", response_model=InterpretAttachmentResponse)
async def interpret_attachment(
    body: InterpretAttachmentRequest, current_user: CurrentUser, db: DB,
    _: Annotated[None, Depends(require_credits("ai"))],
):
    """Decide whether an attached image is to be INSERTED or used as a
    REFERENCE, and describe it, in a single metered vision call.

    Deliberately NOT folded into POST /images/{id}/ai-command. That route
    carries the mask-confirmation round trip and its resume token, whose entire
    purpose is that a chain which stops for confirmation is never re-planned
    and never re-billed for steps already applied. A vision call inside it
    would either run again on every confirmation round trip -- exactly the
    repeat billing the resume token exists to prevent -- or need its result
    threaded through the chain snapshot as well. Answering here instead leaves
    that machinery untouched, and lets the caller hold the answer across as
    many confirmation round trips, retries and corrections as it likes.
    """
    result = await db.execute(
        select(GeneratedImage).where(
            GeneratedImage.id == body.attachment_image_id,
            GeneratedImage.org_id == current_user.org_id,
        )
    )
    attachment = result.scalar_one_or_none()
    if attachment is None or not attachment.image_url:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")

    keys = await get_org_llm_keys(current_user.org_id, db)
    providers = [(p, m) for p, m in _INTERPRET_PROVIDERS if p in keys]

    if providers:
        from app.services.image_output import _download

        try:
            image_bytes = await _download(attachment.image_url)
        except Exception:
            image_bytes = None

        if image_bytes:
            media_type = "image/png"
            lowered_url = attachment.image_url.lower()
            if lowered_url.endswith((".jpg", ".jpeg")) or "image/jpeg" in lowered_url:
                media_type = "image/jpeg"
            elif lowered_url.endswith(".webp") or "image/webp" in lowered_url:
                media_type = "image/webp"

            user_prompt = (
                f"The user attached this image and wrote:\n\n{body.command.strip()}"
            )
            for provider, model in providers:
                try:
                    raw = await call_llm_vision(
                        provider, model, keys[provider], _INTERPRET_SYSTEM, user_prompt,
                        image_bytes, media_type, feature=_INTERPRET_FEATURE,
                    )
                except Exception:
                    continue
                intent, description = _parse_interpretation(raw)
                if intent:
                    return InterpretAttachmentResponse(
                        intent=intent, description=description, guessed=False,
                    )

    # No vision key, an unreachable file, or every provider failed. Never a hard
    # error: the user has already uploaded the image and is waiting on a reply,
    # and a wording-based verdict is far better than refusing the message.
    return InterpretAttachmentResponse(
        intent=_classify_from_command(body.command), description="", guessed=True,
    )


_VALID_STYLES = {
    "photorealistic", "illustration", "minimalist", "abstract", "professional",
    "3d_render", "anime", "cinematic", "luxury_product",
}
_VALID_USAGES = {"article_cover", "social_post", "brand_asset", "custom"}

_CAMPAIGN_PROVIDERS = [
    ("anthropic", "claude-opus-4-8"),
    ("openai", "gpt-4o"),
]

from app.agents.registry import agent_persona as _agent_persona

_CAMPAIGN_SYSTEM = _agent_persona("sirocco") + (
    "Given a user's goal, "
    "design a coordinated set of 3-5 image assets that work together as one campaign "
    "with a consistent visual voice. Return ONLY a valid JSON object — no markdown, no prose:\n\n"
    "{\n"
    '  "title": "short campaign name",\n'
    '  "summary": "one sentence describing the set and how the pieces fit together",\n'
    '  "assets": [\n'
    "    {\n"
    '      "title": "short asset name (e.g. Hero shot, Lifestyle angle, Story)",\n'
    '      "prompt": "a detailed, self-contained image-generation prompt — subject, composition, lighting, mood, colours",\n'
    '      "style": "one of: photorealistic, illustration, minimalist, abstract, professional, 3d_render, anime, cinematic, luxury_product",\n'
    '      "usage": "one of: article_cover, social_post, brand_asset, custom",\n'
    '      "platform": "optional, one of: instagram_post, instagram_story, instagram_reel, youtube_thumbnail, linkedin_banner, linkedin_post, facebook_ad, tiktok_cover, pinterest_pin — or null",\n'
    '      "caption": "ready-to-post caption or on-image copy, matched to the platform"\n'
    "    }\n"
    "  ]\n"
    "}\n\n"
    "Rules: each asset must be visually distinct but share the same palette and mood. "
    "Choose platform values only when the goal is clearly for social media, and vary them sensibly "
    "(e.g. a square post plus a vertical story). Keep prompts vivid and specific. "
    "Never include text you cannot render as an actual image; put copy in the caption field."
)


@router.post("/plan-campaign", response_model=CampaignPlan)
async def plan_campaign(body: PlanCampaignRequest, current_user: CurrentUser, db: DB):
    if not body.goal.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Goal cannot be empty")

    keys = await get_org_llm_keys(current_user.org_id, db)

    brand_context = ""
    if body.use_brand_kit and body.project_id is not None:
        bk_result = await db.execute(
            select(BrandKitModel).where(
                BrandKitModel.org_id == current_user.org_id,
                BrandKitModel.project_id == body.project_id,
            )
        )
        bk = bk_result.scalar_one_or_none()
        if bk:
            parts = []
            if bk.colors:
                parts.append(f"brand colours {', '.join(bk.colors)}")
            if bk.tone:
                parts.append(f"tone: {bk.tone}")
            if bk.style_rules:
                parts.append(f"style rules: {bk.style_rules}")
            if parts:
                brand_context = "\n\nApply this brand identity across every asset: " + "; ".join(parts) + "."

    # Ground the plan in the project's onboarding profile (persona, niche, store…)
    from app.services.ai_analytics_service import project_profile
    profile = ""
    if getattr(body, "project_id", None):
        try:
            profile = await project_profile(body.project_id, db)
        except Exception:
            profile = ""
    profile_block = f"\n\nAbout the user: {profile}." if profile else ""

    user_prompt = f"Campaign goal:\n{body.goal.strip()}{profile_block}{brand_context}"

    raw: str | None = None
    for provider, model in _CAMPAIGN_PROVIDERS:
        if provider in keys:
            try:
                raw = await call_llm(provider, model, keys[provider], _CAMPAIGN_SYSTEM, user_prompt, locale=await project_locale(getattr(body, "project_id", None), db))
                break
            except Exception:
                continue

    if raw is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No AI API key configured. Add an Anthropic or OpenAI key in Settings → API Keys.",
        )

    cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="AI returned invalid JSON — try again")

    assets: list[CampaignAsset] = []
    for a in data.get("assets", [])[:5]:
        style = a.get("style") if a.get("style") in _VALID_STYLES else "professional"
        usage = a.get("usage") if a.get("usage") in _VALID_USAGES else "custom"
        platform = a.get("platform") if a.get("platform") in SOCIAL_PRESETS else None
        prompt_text = (a.get("prompt") or "").strip()
        if not prompt_text:
            continue
        assets.append(CampaignAsset(
            title=(a.get("title") or "Asset").strip(),
            prompt=prompt_text,
            style=style,
            usage=usage,
            platform=platform,
            caption=(a.get("caption") or "").strip(),
        ))

    if not assets:
        raise HTTPException(status_code=500, detail="AI did not return any usable assets — try again")

    return CampaignPlan(
        title=(data.get("title") or "Campaign").strip(),
        summary=(data.get("summary") or "").strip(),
        assets=assets,
    )


@router.post("/generate", status_code=200, response_model=ImageOut)
async def generate_image(
    body: GenerateImageRequest,
    current_user: CurrentUser,
    db: DB,
    _: Annotated[None, Depends(check_usage_limit("images"))],
    __: Annotated[None, Depends(require_credits("ai"))],
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
            select(BrandKitModel).where(
                BrandKitModel.org_id == current_user.org_id,
                BrandKitModel.project_id == body.project_id,
            )
        )
        brand_kit = bk_result.scalar_one_or_none()

    social_platform = body.social_platform if body.social_platform in SOCIAL_PRESETS else None

    if body.prompt:
        prompt = body.prompt
    elif social_platform:
        subject = body.title or body.keyword or "content"
        prompt = build_social_prompt(social_platform, subject, brand_kit)
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

    dalle_size = SOCIAL_PRESETS[social_platform]["dalle_size"] if social_platform else None

    if api_key_row is not None:
        openai_key = decrypt_api_key(api_key_row.encrypted_value)
        result = await generate_image_dalle(
            prompt=prompt,
            style=style,
            usage=usage,
            openai_api_key=openai_key,
            quality=body.quality or "standard",
            size_override=dalle_size,
        )
    else:
        result = get_placeholder_url(usage)

    if result["ok"]:
        image.status = ImageStatus.ready
        image.image_url = result["image_url"]
        image.thumbnail_url = result["image_url"]
        image.revised_prompt = result.get("revised_prompt")
        image.cost_usd = result.get("cost_usd")
        if social_platform:
            preset = SOCIAL_PRESETS[social_platform]
            image.width = preset["width"]
            image.height = preset["height"]
            image.social_platform = social_platform
        else:
            image.width = result["width"]
            image.height = result["height"]
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
    folder_id: Optional[uuid.UUID] = Query(None),
):
    query = select(GeneratedImage).where(
        GeneratedImage.project_id == project_id,
        GeneratedImage.org_id == current_user.org_id,
        GeneratedImage.source_image_id.is_(None),  # exclude edited versions
        GeneratedImage.is_deleted.is_(False),
    )
    if usage is not None:
        query = query.where(GeneratedImage.usage == usage)
    if folder_id is not None:
        query = query.where(GeneratedImage.folder_id == folder_id)
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
    image.is_deleted = True
    await db.commit()
    return None


class TagsUpdate(BaseModel):
    tags: list[str]


class FolderMove(BaseModel):
    folder_id: Optional[uuid.UUID] = None


@router.patch("/{image_id}/tags", response_model=ImageOut)
async def update_image_tags(image_id: uuid.UUID, body: TagsUpdate, current_user: CurrentUser, db: DB):
    image = await _get_image_or_404(image_id, current_user.org_id, db)
    image.tags = body.tags
    await db.flush()
    await db.refresh(image)
    await db.commit()
    return ImageOut.model_validate(image)


# Depth cap: a cycle in source_image_id would otherwise loop forever, and no
# legitimate edit chain comes close to this.
_MAX_VERSION_CHAIN = 200


async def _is_in_chain(version: GeneratedImage, root_id: uuid.UUID, db) -> bool:
    """True when `version` descends from `root_id` (or IS it)."""
    seen: set[uuid.UUID] = set()
    current = version
    for _ in range(_MAX_VERSION_CHAIN):
        if current.id == root_id:
            return True
        parent_id = current.source_image_id
        if parent_id is None or parent_id in seen:
            return False
        seen.add(parent_id)
        current = (await db.execute(
            select(GeneratedImage).where(GeneratedImage.id == parent_id)
        )).scalar_one_or_none()
        if current is None:
            return False
    return False


class CommitVersion(BaseModel):
    version_id: uuid.UUID


@router.post("/{image_id}/commit-version", response_model=ImageOut)
async def commit_version(image_id: uuid.UUID, body: CommitVersion,
                         current_user: CurrentUser, db: DB):
    """Make an edited version the image itself.

    Every edit writes a CHILD row (source_image_id set), and the gallery
    deliberately hides children so intermediate steps do not clutter it. Nothing
    ever pointed the original at the result, so edits were stored and then
    invisible: the library kept showing the untouched original and reopening the
    editor loaded it back. "Done" was pure navigation.

    This commits the chosen version's file onto the original record. History is
    NOT destroyed -- the child rows remain, so the version chain is still there
    to walk back through.
    """
    image = await _get_image_or_404(image_id, current_user.org_id, db)
    version = await _get_image_or_404(body.version_id, current_user.org_id, db)

    # The version must belong to THIS image's chain, or one org member could
    # graft an unrelated picture onto another image.
    #
    # Editing is a CHAIN, not one level: each edit applies to the version on
    # screen and records THAT as its parent, so the second edit's parent is the
    # first edit, not the original. Checking only source_image_id therefore
    # accepted the first edit and rejected every one after it -- which is what
    # made Done fail with a retry state once you had edited twice. Walk up to
    # the root instead.
    if not await _is_in_chain(version, image.id, db):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "That version does not belong to this image.",
        )
    if not version.image_url:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "That version has no stored file.",
        )

    image.image_url = version.image_url
    image.thumbnail_url = version.thumbnail_url or version.image_url
    # Carried because edits legitimately change them -- upscale, relight and
    # shadow all do -- and a stale size here is what the UI would report.
    image.width = version.width
    image.height = version.height
    image.edit_operation = version.edit_operation
    await db.flush()
    await db.refresh(image)
    await db.commit()
    return ImageOut.model_validate(image)


@router.patch("/{image_id}/folder", response_model=ImageOut)
async def move_image_to_folder(image_id: uuid.UUID, body: FolderMove, current_user: CurrentUser, db: DB):
    image = await _get_image_or_404(image_id, current_user.org_id, db)
    image.folder_id = body.folder_id
    await db.flush()
    await db.refresh(image)
    await db.commit()
    return ImageOut.model_validate(image)


@router.get("/search", response_model=list[ImageOut])
async def search_images(
    current_user: CurrentUser,
    db: DB,
    project_id: uuid.UUID = Query(...),
    q: str = Query(...),
    folder_id: Optional[uuid.UUID] = Query(None),
):
    query = (
        select(GeneratedImage)
        .where(
            GeneratedImage.project_id == project_id,
            GeneratedImage.org_id == current_user.org_id,
            GeneratedImage.is_deleted.is_(False),
            GeneratedImage.source_image_id.is_(None),
            or_(
                GeneratedImage.prompt.ilike(f"%{q}%"),
                GeneratedImage.alt_text.ilike(f"%{q}%"),
                GeneratedImage.caption.ilike(f"%{q}%"),
            ),
        )
        .order_by(GeneratedImage.created_at.desc())
        .limit(50)
    )
    if folder_id is not None:
        query = query.where(GeneratedImage.folder_id == folder_id)
    result = await db.execute(query)
    return [ImageOut.model_validate(img) for img in result.scalars().all()]


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


# ── Canvas decomposition ──────────────────────────────────────────────────────

class CanvasTextElement(BaseModel):
    text: str
    x_pct: float
    y_pct: float
    width_pct: float = 50
    height_pct: float = 10
    font_size: int = 32
    color: str = "#ffffff"
    bold: bool = False
    italic: bool = False

class CanvasObjectElement(BaseModel):
    description: str
    x_pct: float
    y_pct: float
    width_pct: float
    height_pct: float = 30
    image_data: str = ""

class CanvasBackground(BaseModel):
    description: str
    dominant_color: str = "#1e293b"
    image_data: str = ""
    image_width: int = 0
    image_height: int = 0

class DecomposeResult(BaseModel):
    text_elements: list[CanvasTextElement] = []
    objects: list[CanvasObjectElement] = []
    background: CanvasBackground = CanvasBackground(description="Background")


class DecomposeRequest(BaseModel):
    # Background reconstruction engine: "diffusion" (fast, scipy) or "lama" (SOTA ONNX)
    inpaint_method: Literal["diffusion", "lama"] = "diffusion"


# ── Detection (Florence-2) ────────────────────────────────────────────────────
#
# This replaced a Claude/GPT-4o call that was asked to return, as JSON, the
# pixel coordinates of every text element and object in the image. Vision-
# language models are weak at precise localisation -- that is what detection
# models exist for -- so both halves of the result were approximations, and the
# whole path was unmetered.
#
# Verified live against the Replicate API on 2026-08-04: 2,157,981 runs, input
# schema {image, task_input, text_input}, output {img, text}. `task_input` is
# an enum and the two members below are exact strings from it. Do not "correct"
# this version from memory -- a nonexistent model has reached production in
# this codebase before by being recalled rather than resolved.
_FLORENCE_MODEL = "lucataco/florence-2-large"
_FLORENCE_VERSION = "da53547e17d45b9cfb48174b2f18af8b83ca020fa76db62136bf9c6616762595"
_FLORENCE_TASK_OCR = "OCR with Region"
_FLORENCE_TASK_OBJECTS = "Object Detection"

# The sentinel HuggingFace's OCR post-processing leaves on every label.
_FLORENCE_LABEL_SENTINEL = "</s>"


async def _florence(image_url: str, task: str) -> dict:
    """One Florence-2 run, returning that task's parsed result payload.

    The model returns {"img": <annotated preview>, "text": <str>}, where the
    text is a Python-literal repr of HuggingFace's post-processed output keyed
    by the task token, e.g.

        "{'<OD>': {'bboxes': [[x0, y0, x1, y1]], 'labels': ['car']}}"

    Boxes are already in the source image's pixel space. ast.literal_eval and
    not json.loads: the repr uses single quotes and is not JSON. Not eval
    either -- literal_eval cannot execute anything, which matters because this
    string arrives over the network.

    Goes through editing_service._replicate_run, the single supplier
    chokepoint, which is where Replicate calls are metered; no per-caller
    metering is added here.
    """
    out = await editing_service._replicate_run(
        _FLORENCE_MODEL,
        {"image": image_url, "task_input": task},
        version=_FLORENCE_VERSION,
    )
    text = out.get("text") if isinstance(out, Mapping) else out
    try:
        parsed = ast.literal_eval(text)
    except (ValueError, SyntaxError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Detection returned unreadable output for '{task}'",
        ) from exc
    # One key, the task token; its value is the payload.
    if isinstance(parsed, dict) and len(parsed) == 1:
        parsed = next(iter(parsed.values()))
    return parsed if isinstance(parsed, dict) else {}


def _clean_label(label: str) -> str:
    return str(label).replace(_FLORENCE_LABEL_SENTINEL, "").strip()


def _text_color(rgb, x0: int, y0: int, x1: int, y1: int) -> str:
    """Hex colour of the glyphs inside a detected text box.

    Florence gives the box but not the colour. The box's own median colour is
    its local background, so the glyphs are the pixels furthest from it --
    averaging those is far closer than the language model's guess, and unlike
    that guess it degrades to the box's average rather than to a default.
    """
    import numpy as np

    region = rgb[y0:y1, x0:x1]
    if region.size == 0:
        return "#ffffff"
    flat = region.reshape(-1, 3).astype(np.float32)
    median = np.median(flat, axis=0)
    dist = np.sqrt(((flat - median) ** 2).sum(axis=1))
    picked = flat[dist > max(40.0, float(np.percentile(dist, 80)))]
    if picked.size == 0:
        picked = flat
    # Median, not mean: the picked set still holds anti-aliased edge pixels
    # part-way to the background, and averaging drags the result toward it.
    r, g, b = (int(v) for v in np.median(picked, axis=0))
    return f"#{r:02x}{g:02x}{b:02x}"


def _elements_from_detections(raw: bytes, ocr: dict, detection: dict) -> tuple[list, list[dict]]:
    """Turn two Florence-2 payloads into the canvas contract's shapes.

    Returns (text_elements, raw_objects). raw_objects keeps the loose dict
    shape _build_layers and _match_description already consume, so only the
    source of the numbers changed, not the plumbing.

    Sync, and called through asyncio.to_thread: it decodes the image.
    """
    from PIL import Image
    import numpy as np

    img = Image.open(io.BytesIO(raw)).convert("RGB")
    iw, ih = img.size
    rgb = np.asarray(img)

    text_elements: list[CanvasTextElement] = []
    quads = ocr.get("quad_boxes") or []
    for quad, label in zip(quads, ocr.get("labels") or []):
        text = _clean_label(label)
        if not text:
            continue
        xs, ys = list(quad[0::2]), list(quad[1::2])
        x0, x1 = max(0, min(xs)), min(iw, max(xs))
        y0, y1 = max(0, min(ys)), min(ih, max(ys))
        if x1 <= x0 or y1 <= y0:
            continue
        # font_size keeps the contract's convention: pixels on a 1080px-tall
        # frame. A tight OCR box's height is close to the cap height.
        font_size = max(10, min(200, int(round((y1 - y0) / ih * 1080))))
        text_elements.append(CanvasTextElement(
            text=text,
            x_pct=x0 / iw * 100,
            y_pct=y0 / ih * 100,
            width_pct=(x1 - x0) / iw * 100,
            height_pct=(y1 - y0) / ih * 100,
            font_size=font_size,
            color=_text_color(rgb, int(x0), int(y0), int(x1), int(y1)),
        ))

    raw_objects: list[dict] = []
    for box, label in zip(detection.get("bboxes") or [], detection.get("labels") or []):
        x0, y0, x1, y1 = box
        if x1 <= x0 or y1 <= y0:
            continue
        raw_objects.append({
            "description": _clean_label(label) or "Object",
            "x_pct": max(0.0, x0) / iw * 100,
            "y_pct": max(0.0, y0) / ih * 100,
            "width_pct": (min(iw, x1) - max(0.0, x0)) / iw * 100,
            "height_pct": (min(ih, y1) - max(0.0, y0)) / ih * 100,
        })

    return text_elements, raw_objects


def _load_image_bytes(image_url: str) -> bytes:
    """Decode a data URI or return raw bytes from an HTTP URL (sync, called via to_thread)."""
    if image_url.startswith("data:"):
        header, b64 = image_url.split(",", 1)
        return base64.b64decode(b64)
    import urllib.request
    with urllib.request.urlopen(image_url, timeout=15) as r:
        return r.read()


def _to_b64_png(img) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}"


# LaMa (Large-Mask inpainting) ONNX — SOTA object-removal background reconstruction.
# Runs through the already-installed onnxruntime (no PyTorch). Model is cached on a
# mounted volume; downloaded lazily on first use.
_LAMA_MODEL_URL = "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx"
_LAMA_MODEL_PATH = os.environ.get("LAMA_MODEL_PATH", "/root/.lama/lama_fp32.onnx")
_LAMA_SIZE = 512
_lama_session = None


def _get_lama_session():
    """Lazy-load the LaMa ONNX session, downloading the model on first use.

    The first InferenceSession build runs full graph optimization (~50s); we persist
    the optimized graph next to the model so every later process load is fast.
    """
    global _lama_session
    if _lama_session is not None:
        return _lama_session
    import onnxruntime as ort

    path = _LAMA_MODEL_PATH
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        import urllib.request
        tmp = path + ".part"
        urllib.request.urlretrieve(_LAMA_MODEL_URL, tmp)
        os.replace(tmp, path)

    opt_path = path + ".opt.onnx"
    so = ort.SessionOptions()
    # Leave intra_op threads at the ORT default — overriding to cpu_count caused
    # oversubscription and slower inference in benchmarks.
    if os.path.exists(opt_path):
        # Already-optimized graph — load as-is (fast, no re-optimization).
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        _lama_session = ort.InferenceSession(opt_path, so, providers=["CPUExecutionProvider"])
    else:
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        so.optimized_model_filepath = opt_path
        _lama_session = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
    return _lama_session


def _inpaint_lama(rgb, hole, ndimage, np, Image):
    """
    Reconstruct the masked region with the LaMa ONNX model (512×512 fixed input).

    The model is run at 512² then the result is resized back and composited only
    inside the (dilated, feathered) hole so untouched pixels stay pixel-perfect.
    Raises on any failure so the caller can fall back to diffusion.

    rgb:  (H, W, 3) uint8 ; hole: (H, W) bool (True = reconstruct)
    """
    H, W = hole.shape
    if not hole.any():
        return Image.fromarray(rgb, "RGB")

    session = _get_lama_session()

    # Dilate the mask so LaMa has clean context and leaves no boundary rim.
    dil = max(3, int(0.01 * max(H, W)))
    mask_full = ndimage.binary_dilation(
        hole, structure=np.ones((3, 3), dtype=bool), iterations=dil
    )

    img_512 = Image.fromarray(rgb, "RGB").resize((_LAMA_SIZE, _LAMA_SIZE), Image.BILINEAR)
    mask_512 = Image.fromarray((mask_full * 255).astype(np.uint8), "L").resize(
        (_LAMA_SIZE, _LAMA_SIZE), Image.NEAREST
    )

    img_in = (np.asarray(img_512).astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
    mask_in = (np.asarray(mask_512).astype(np.float32) / 255.0)[None, None]
    mask_in = (mask_in > 0.5).astype(np.float32)

    out = session.run(None, {"image": img_in, "mask": mask_in})[0]
    out = out[0].transpose(1, 2, 0)
    if out.max() <= 1.5:
        out = out * 255.0
    out = np.clip(out, 0, 255).astype(np.uint8)

    filled_full = np.asarray(
        Image.fromarray(out, "RGB").resize((W, H), Image.BILINEAR)
    ).astype(np.float32)

    # Composite only inside the hole; feather the seam for a clean blend.
    hole_f = np.clip(ndimage.gaussian_filter(mask_full.astype(np.float32), 2.0), 0.0, 1.0)[:, :, None]
    result = (rgb.astype(np.float32) * (1.0 - hole_f) + filled_full * hole_f).astype(np.uint8)
    return Image.fromarray(result, "RGB")


def _inpaint_diffusion(rgb, hole, ndimage, np, Image):
    """
    Multi-scale harmonic (diffusion) inpainting — fills the masked region by
    diffusing surrounding colours inward while holding known pixels fixed.

    Unlike nearest-neighbour fill (which leaves Voronoi smears on large holes),
    this reconstructs smooth gradients — ideal for marketing/product backgrounds.
    Work is done at reduced resolution for speed, then blended back at full res.

    rgb:  (H, W, 3) uint8 original image
    hole: (H, W) bool — True where pixels must be reconstructed
    """
    H, W = hole.shape
    known = ~hole
    if not hole.any() or not known.any():
        return Image.fromarray(rgb, "RGB")

    # Downscale to keep the diffusion cheap; background is low-frequency anyway.
    target = 384
    scale = min(1.0, target / max(H, W))
    lw, lh = max(2, int(W * scale)), max(2, int(H * scale))

    src_small = np.asarray(
        Image.fromarray(rgb, "RGB").resize((lw, lh), Image.BILINEAR)
    ).astype(np.float32)
    hole_small = np.asarray(
        Image.fromarray((hole * 255).astype(np.uint8), "L").resize((lw, lh), Image.NEAREST)
    ) > 127
    known_small = ~hole_small

    if not known_small.any():
        return Image.fromarray(rgb, "RGB")

    # Initialise holes with nearest known colour, then diffuse coarse → fine.
    idx = ndimage.distance_transform_edt(hole_small, return_distances=False, return_indices=True)
    filled = src_small[idx[0], idx[1]].copy()
    for sigma, iters in ((8, 14), (4, 10), (2, 6)):
        for _ in range(iters):
            for c in range(3):
                filled[:, :, c] = ndimage.gaussian_filter(filled[:, :, c], sigma)
            filled[known_small] = src_small[known_small]

    # Upscale the smooth fill back to full resolution.
    filled_full = np.asarray(
        Image.fromarray(filled.astype(np.uint8), "RGB").resize((W, H), Image.BILINEAR)
    ).astype(np.float32)

    # Composite: keep crisp original pixels outside the hole; feather the seam.
    hole_f = np.clip(ndimage.gaussian_filter(hole.astype(np.float32), 2.0), 0.0, 1.0)[:, :, None]
    out = (rgb.astype(np.float32) * (1.0 - hole_f) + filled_full * hole_f).astype(np.uint8)
    return Image.fromarray(out, "RGB")


def _match_description(cx: float, cy: float, raw_objects: list[dict], iw: int, ih: int) -> str:
    """Name a segmented blob by the nearest detected object (centroid distance).

    The boxes come from Florence-2's `Object Detection`, so the names are the
    model's own detection labels."""
    best_name = "Object"
    best_dist = float("inf")
    for ob in raw_objects:
        ox = (ob.get("x_pct", 0) + ob.get("width_pct", 0) / 2) / 100 * iw
        oy = (ob.get("y_pct", 0) + ob.get("height_pct", 0) / 2) / 100 * ih
        d = (ox - cx) ** 2 + (oy - cy) ** 2
        if d < best_dist:
            best_dist = d
            best_name = ob.get("description") or "Object"
    # Only trust the match if it's reasonably close (within 30% of the diagonal)
    if best_dist <= (0.30 * (iw ** 2 + ih ** 2) ** 0.5) ** 2:
        return best_name
    return "Object"


async def _build_layers(
    image_url: str,
    raw_objects: list[dict],
    text_elements: list,
    inpaint_method: str = "diffusion",
    raw: Optional[bytes] = None,
) -> tuple[str, int, int, list[dict], str]:
    """
    Decomposition driven by BiRefNet's pixel-accurate segmentation:

    - Objects come from CONNECTED COMPONENTS of the BiRefNet foreground mask, not
      from the detected bounding boxes. Each blob is extracted at its FULL extent
      (never cropped), with the model's anti-aliased alpha for clean edges. The
      detected boxes only supply names.
    - Background is the original image with all foreground pixels + text regions
      removed, then INPAINTED. inpaint_method="lama" uses the LaMa ONNX model
      (local, SOTA, slower); "diffusion" uses fast scipy harmonic diffusion. LaMa
      falls back to diffusion on error. Neither is a Replicate call.

    The mask source WAS a local rembg (u2net), which loses roughly 40% of fine
    strands on hair and struggles with transparency. Only the mask source
    changed; the connected-component splitting below is untouched.

    All layers share the source W×H; object position is encoded in the alpha channel.
    Returns: (bg_data_uri, width, height, [{image_data, description, x/y/width/height_pct}],
              dominant_background_hex)
    """
    import asyncio
    import numpy as np
    from scipy import ndimage
    from PIL import Image

    # The one Replicate call in this function. It asserts its own output frame,
    # so a silently downscaled mask cannot reach the compositing below.
    cut = await editing_service.birefnet_cutout(image_url)
    raw_bytes = raw if raw is not None else await asyncio.to_thread(_load_image_bytes, image_url)

    def _process():
        img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
        iw, ih = img.size
        rgb = np.asarray(img)  # (H, W, 3) uint8

        def _bbox_px(x_pct, y_pct, w_pct, h_pct):
            x = max(0, min(iw - 1, int(x_pct / 100 * iw)))
            y = max(0, min(ih - 1, int(y_pct / 100 * ih)))
            w = max(1, min(iw - x, int(w_pct / 100 * iw)))
            h = max(1, min(ih - y, int(h_pct / 100 * ih)))
            return x, y, w, h

        text_boxes = [_bbox_px(el.x_pct, el.y_pct, el.width_pct, el.height_pct) for el in text_elements]

        # Binary mask of all text regions (used to reject text-only blobs from objects)
        text_mask = np.zeros((ih, iw), dtype=bool)
        for (tx, ty, tw, th) in text_boxes:
            text_mask[ty:ty + th, tx:tx + tw] = True

        # ── BiRefNet foreground mask (pixel-accurate, anti-aliased) ─────────────
        mask = cut if cut.size == (iw, ih) else cut.resize((iw, ih), Image.LANCZOS)
        alpha = np.asarray(mask.split()[3])  # (H, W) uint8

        fg_bin = alpha > 100  # solid-foreground binary mask

        # ── Objects via connected-component labelling ───────────────────────────
        # Morphological closing consolidates thin/broken parts of a single object;
        # fill_holes makes each blob solid so interior gaps don't become transparent.
        struct = np.ones((7, 7), dtype=bool)
        fg_closed = ndimage.binary_closing(fg_bin, structure=struct, iterations=1)
        fg_closed = ndimage.binary_fill_holes(fg_closed)
        labels, n_comp = ndimage.label(fg_closed)

        min_area = max(64, int(0.004 * iw * ih))  # ignore specks < 0.4% of image
        objects_out: list[dict] = []
        if n_comp > 0:
            comp_sizes = ndimage.sum(np.ones_like(labels), labels, index=range(1, n_comp + 1))
            for lab in range(1, n_comp + 1):
                if comp_sizes[lab - 1] < min_area:
                    continue
                comp = labels == lab
                # Skip blobs that are mostly text — they belong to editable text layers
                comp_area = comp.sum()
                if text_mask.any() and (comp & text_mask).sum() / comp_area > 0.6:
                    continue
                ys, xs = np.where(comp)
                x0, x1 = int(xs.min()), int(xs.max())
                y0, y1 = int(ys.min()), int(ys.max())

                # Full-canvas RGBA: original RGB, alpha = BiRefNet alpha in this blob
                obj_alpha = np.where(comp, alpha, 0).astype(np.uint8)
                obj_rgba = np.dstack([rgb, obj_alpha])
                obj_img = Image.fromarray(obj_rgba, "RGBA")

                cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
                objects_out.append({
                    "image_data": _to_b64_png(obj_img),
                    "description": _match_description(cx, cy, raw_objects, iw, ih),
                    "x_pct": x0 / iw * 100,
                    "y_pct": y0 / ih * 100,
                    "width_pct": (x1 - x0 + 1) / iw * 100,
                    "height_pct": (y1 - y0 + 1) / ih * 100,
                })

        # ── Background: remove foreground + text, then inpaint the holes ─────────
        # Use a LOW alpha threshold so anti-aliased object fringes are caught too,
        # and dilate by a margin scaled to the image so soft shadows are removed.
        soft_fg = alpha > 8
        margin = max(6, int(0.015 * max(iw, ih)))
        remove_mask = ndimage.binary_dilation(
            soft_fg, structure=np.ones((3, 3), dtype=bool), iterations=margin
        )
        # Remove text robustly. Even a detected box can clip an ascender or a
        # drop shadow, so for each box we (a) mask a padded rectangle and (b)
        # additionally capture the actual glyph pixels by local colour contrast
        # inside a generous search region — this catches text that extends
        # beyond the box regardless of engine.
        for (tx, ty, tw, th) in text_boxes:
            pad_x = max(10, int(tw * 0.20))
            pad_y = max(10, int(th * 0.45))
            remove_mask[max(0, ty - pad_y):min(ih, ty + th + pad_y),
                        max(0, tx - pad_x):min(iw, tx + tw + pad_x)] = True

            # Text lines run horizontally and a per-word box undersizes the
            # line, so search a generously wide band (safe because only pixels that
            # contrast with the local background — the glyphs — are removed).
            ex = max(tw, int(0.10 * iw))
            ey = max(int(th * 0.7), 6)
            sx1 = max(0, tx - ex)
            sy1 = max(0, ty - ey)
            sx2 = min(iw, tx + tw + ex)
            sy2 = min(ih, ty + th + ey)
            region = rgb[sy1:sy2, sx1:sx2].astype(np.float32)
            if region.size == 0:
                continue
            # Local background = median of the band's top & bottom edge rows
            # (assumed glyph-free), then flag strongly-contrasting glyph pixels.
            edges = np.concatenate([region[0], region[-1]], axis=0)
            bg_col = np.median(edges, axis=0)
            diff = np.sqrt(((region - bg_col) ** 2).sum(axis=2))
            glyphs = diff > 55
            # Bridge letters along the baseline with a horizontally-biased dilation.
            glyphs = ndimage.binary_dilation(
                glyphs, structure=np.ones((3, 9), dtype=bool), iterations=2
            )
            remove_mask[sy1:sy2, sx1:sx2] |= glyphs

        # Cast-shadow removal. A shadow is a dark region hugging the object, darker
        # than its LOCAL surroundings. We reference the object's immediate band
        # (not a global percentile, which wrongly flagged dark backgrounds), SEED
        # from dark pixels touching the object, then grow each seed to its full
        # connected dark extent so shadows reaching beyond the band are captured.
        # Blobs larger than a plausible-shadow cap are rejected as background.
        struct3 = np.ones((3, 3), dtype=bool)
        if soft_fg.any():
            obj_area = int(soft_fg.sum())
            band = (
                ndimage.binary_dilation(soft_fg, structure=struct3, iterations=max(8, margin * 3))
                & ~ndimage.binary_dilation(soft_fg, structure=struct3, iterations=2)
            )
            if band.any():
                lum = (0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2])
                local_ref = float(np.median(lum[band]))
                thresh = local_ref * 0.72
                dark = (~soft_fg) & (lum < thresh)
                near_obj = ndimage.binary_dilation(soft_fg, structure=struct3, iterations=max(4, margin))
                dark_labels, _ = ndimage.label(dark)
                seed_ids = np.unique(dark_labels[dark & near_obj])
                seed_ids = seed_ids[seed_ids != 0]
                if seed_ids.size:
                    area_cap = min(int(1.5 * obj_area), int(0.12 * iw * ih))
                    keep = np.zeros_like(dark)
                    for lbl in seed_ids:
                        blob = dark_labels == lbl
                        if blob.sum() <= area_cap:  # reject background-sized blobs
                            keep |= blob
                    if keep.any():
                        keep = ndimage.binary_dilation(keep, structure=struct3, iterations=max(2, margin // 2))
                        remove_mask |= keep

        bg_img = None
        if inpaint_method == "lama":
            try:
                bg_img = _inpaint_lama(rgb, remove_mask, ndimage, np, Image)
            except Exception:
                bg_img = None  # fall through to diffusion
        if bg_img is None:
            bg_img = _inpaint_diffusion(rgb, remove_mask, ndimage, np, Image)
        bg_data = _to_b64_png(bg_img)

        # dominant_color was the language model's guess; it is now measured off
        # the reconstructed background, which is the surface it describes.
        small = bg_img.convert("RGB").resize((64, 64), Image.BILINEAR)
        counts = small.quantize(colors=8, method=Image.MEDIANCUT).convert("RGB").getcolors(64 * 64)
        r, g, b = max(counts)[1] if counts else (30, 41, 59)
        dominant = f"#{r:02x}{g:02x}{b:02x}"

        return bg_data, iw, ih, objects_out, dominant

    return await asyncio.to_thread(_process)


@router.post("/{image_id}/decompose", response_model=DecomposeResult)
async def decompose_image_to_canvas(
    image_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    _: Annotated[None, Depends(require_credits("ai"))],
    body: DecomposeRequest = DecomposeRequest(),
):
    """Split an image into editable canvas layers: text, objects, background.

    Three Replicate calls, each landing on MIN_REPLICATE_CREDITS -- about 30
    AI credits per conversion:

      1. Florence-2, `OCR with Region`   -> text and its real boxes
      2. Florence-2, `Object Detection`  -> object boxes and labels
      3. BiRefNet                        -> the foreground alpha the layers
                                            are cut from

    Inpainting (LaMa ONNX or scipy diffusion) runs locally and costs nothing.

    This used to ask Claude or GPT-4o for the pixel coordinates as JSON and
    cut the masks with a local rembg, and had no `meter`, no `record_*` and no
    `require_credits` anywhere -- so it was both inaccurate and unbilled
    supplier spend. Metering now happens inside `_replicate_run`, the single
    supplier chokepoint, so no per-call metering appears here; the credit gate
    matches every sibling image operation.

    The DecomposeResult contract is unchanged -- only how its fields are
    produced.
    """
    import asyncio

    image = await _get_image_or_404(image_id, current_user.org_id, db)
    if not image.image_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image has no URL")

    try:
        raw_bytes = await asyncio.to_thread(_load_image_bytes, image.image_url)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Could not load source image")

    # Sequential, not gathered. Below $5 of Replicate account credit prediction
    # creation is throttled to a burst of one, so firing both at once reliably
    # earns a 429 that _create_prediction then has to sleep through -- slower
    # than just running them in turn.
    ocr = await _florence(image.image_url, _FLORENCE_TASK_OCR)
    detection = await _florence(image.image_url, _FLORENCE_TASK_OBJECTS)

    raw_texts, raw_objects = await asyncio.to_thread(
        _elements_from_detections, raw_bytes, ocr, detection
    )

    try:
        bg_data, img_w, img_h, segmented_objects, dominant = await _build_layers(
            image.image_url, raw_objects, raw_texts,
            inpaint_method=body.inpaint_method, raw=raw_bytes,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail=f"Layer segmentation failed: {exc}")

    # Objects come from BiRefNet connected-component segmentation; the detected
    # boxes only supply the names.
    object_elements = [
        CanvasObjectElement(
            description=o["description"],
            x_pct=o["x_pct"],
            y_pct=o["y_pct"],
            width_pct=o["width_pct"],
            height_pct=o["height_pct"],
            image_data=o["image_data"],
        )
        for o in segmented_objects
    ]

    return DecomposeResult(
        text_elements=raw_texts,
        objects=object_elements,
        background=CanvasBackground(
            description="Background",
            dominant_color=dominant,
            image_data=bg_data,
            image_width=img_w,
            image_height=img_h,
        ),
    )


# ── Multi-size export ─────────────────────────────────────────────────────────

class ResizeSetRequest(BaseModel):
    # Social-platform preset keys (see SOCIAL_PRESETS) to render the image into.
    platforms: list[str]


@router.post("/{image_id}/resize-set", response_model=list[ImageOut])
async def resize_to_platforms(
    image_id: uuid.UUID,
    body: ResizeSetRequest,
    current_user: CurrentUser,
    db: DB,
):
    """Produce cover-fit crops of one image at every requested platform size,
    saved as new library images linked to the source (ready to publish)."""
    image = await _get_image_or_404(image_id, current_user.org_id, db)
    if not image.image_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image has no URL")

    platforms = [p for p in dict.fromkeys(body.platforms) if p in SOCIAL_PRESETS]
    if not platforms:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No valid platforms provided")

    import asyncio
    from PIL import Image, ImageOps

    try:
        raw = await asyncio.to_thread(_load_image_bytes, image.image_url)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not load source image")

    def _render(w: int, h: int) -> bytes:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        # Cover-fit: centre-crop to the target aspect, then resize to exact size.
        fitted = ImageOps.fit(img, (w, h), method=Image.LANCZOS)
        buf = io.BytesIO()
        fitted.save(buf, format="PNG", optimize=True)
        return buf.getvalue()

    out: list[ImageOut] = []
    for platform in platforms:
        preset = SOCIAL_PRESETS[platform]
        w, h = preset["width"], preset["height"]
        png = await asyncio.to_thread(_render, w, h)
        url = await upload_file(png, f"{platform}.png", folder="resized")
        new_img = GeneratedImage(
            org_id=current_user.org_id,
            project_id=image.project_id,
            prompt=image.prompt,
            style=image.style,
            usage=image.usage,
            status=ImageStatus.ready,
            image_url=url,
            thumbnail_url=url,
            width=w,
            height=h,
            source_image_id=image.id,
            social_platform=platform,
        )
        db.add(new_img)
        await db.flush()
        await db.refresh(new_img)
        out.append(ImageOut.model_validate(new_img))

    await db.commit()
    return out


# ── Cutout (cheap Replicate background removal, for template layers) ──────────
#
# Not in the /edit dispatch table (editing.py): that endpoint always persists
# its result as a new library version, which is right for a user-facing edit
# but wrong here -- a template's "subject-cutout" layer needs a background-free
# copy as an ingredient for a composition being built client-side, not a
# standalone version cluttering the gallery. Everything else about the call
# (credit gate, supplier, metering) matches the other paid image operations.

class CutoutOut(BaseModel):
    image_url: str
    width: int
    height: int


@router.post("/{image_id}/cutout", response_model=CutoutOut)
async def cutout_image(
    image_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    _: Annotated[None, Depends(require_credits("ai"))],
):
    """Background-removed copy of an image via the cheap Replicate cutout
    (editing_service.remove_background_cheap -- 851-labs/background-remover,
    meters at the MIN_REPLICATE_CREDITS floor). Used by the editor's template
    picker to gate a paid `typeWrap`-family layer behind a consent dialog
    before spending: the client confirms the cost with the user, then calls
    this, then builds the template's layers from the returned URL.
    """
    image = await _get_image_or_404(image_id, current_user.org_id, db)
    if not image.image_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image has no URL")

    result = await editing_service.remove_background_cheap(image.image_url)
    if not result.get("ok"):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=result.get("error", "Cutout failed"),
        )

    return CutoutOut(
        image_url=result["image_url"],
        width=result.get("width") or image.width,
        height=result.get("height") or image.height,
    )
