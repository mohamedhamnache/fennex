import uuid
import io
import base64
import asyncio
import urllib.request
from typing import Annotated, Optional
import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from PIL import Image
from sqlalchemy import select
from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.models.image import GeneratedImage, ImageStatus, ImageUsage, ImageStyle
from app.models.brand_kit import BrandKit as BrandKitModel
from app.models.project import Project
from app.models.api_key import APIKey
from app.services.product_service import PRODUCT_SCENES, build_scene_prompt
from app.services.image_service import generate_image_dalle
from app.services.editing_service import _replicate_run
from app.services.image_output import ResolutionPolicy, finalize
from app.services.prompting import vocab as prompt_vocab
from app.api.v1.routers.images import ImageOut
from app.core.billing import check_project_not_locked, increment_usage, require_credits
from app.core.security import decrypt_api_key

router = APIRouter()

_FLUX_KONTEXT_MODEL = "black-forest-labs/flux-kontext-pro"

# Server-side defaults for the optional photographic controls below --
# unchanged from the fixed values build_scene_prompt always used, so a
# request carrying only the pre-existing fields (project_id,
# product_image_url, product_description, scene_id, use_brand_kit) keeps
# producing the exact same prompt and Replicate call as before.
_DEFAULT_LIGHTING: prompt_vocab.LightingToken = "diffused_daylight"
_DEFAULT_CAMERA: prompt_vocab.CameraToken = "50mm"
_DEFAULT_ASPECT_RATIO: prompt_vocab.AspectRatioToken = "1:1"
_DEFAULT_CREATIVITY = 30
_DEFAULT_PRODUCT_PRESERVATION = 100
_DEFAULT_QUALITY: prompt_vocab.QualityToken = "ultra"

# Fix 5 (fix-round-1): pixel dimensions persisted on GeneratedImage per
# aspect ratio. Before this fix, width/height were hardcoded to 1024x1024
# regardless of the requested aspect_ratio, so a 16:9 or 9:16 image was
# stored with the wrong dimensions. flux-kontext-pro does not echo back the
# actual output size, so these are the dimensions WE requested via the
# `aspect_ratio` input, computed to keep the same ~1024px long edge and a
# multiple-of-8 short edge (a common requirement for diffusion-model output).
_ASPECT_RATIO_DIMENSIONS: dict[prompt_vocab.AspectRatioToken, tuple[int, int]] = {
    "1:1": (1024, 1024),
    "4:5": (816, 1024),
    "3:2": (1024, 680),
    "16:9": (1024, 576),
    "9:16": (576, 1024),
}


def _prep_product_image(image_url: str) -> str:
    """Return an RGB data-URI of the product for flux-kontext.

    An isolated product is a transparent PNG; flux-kontext expects RGB and would
    render the alpha as black, ruining the composite. We flatten any transparency
    onto white so the model receives a clean product on a neutral background.
    Passes RGB http(s) URLs through unchanged.
    """
    try:
        if image_url.startswith("data:"):
            _, b64 = image_url.split(",", 1)
            raw = base64.b64decode(b64)
        else:
            with urllib.request.urlopen(image_url, timeout=15) as r:
                raw = r.read()
        img = Image.open(io.BytesIO(raw))
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[3])
            buf = io.BytesIO()
            bg.save(buf, format="PNG")
            return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
        # Already opaque — only re-encode data URIs to guarantee RGB; pass URLs through
        if image_url.startswith("data:"):
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="PNG")
            return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
        return image_url
    except Exception:
        return image_url


class ProductSceneRequest(BaseModel):
    project_id: uuid.UUID
    product_image_url: str
    product_description: str
    scene_id: str
    use_brand_kit: bool = False
    # Photographic controls below are all optional with server-side defaults
    # (see the _DEFAULT_* constants above) so the existing frontend, which
    # only ever sends the fields above, keeps working unchanged. Every enum
    # field uses the Literal token types from `prompting/vocab.py` directly,
    # so an unrecognised token fails FastAPI's request validation (422) --
    # it never reaches `build_scene_prompt` and can never 500.
    lighting: Optional[prompt_vocab.LightingToken] = None
    camera: Optional[prompt_vocab.CameraToken] = None
    aspect_ratio: Optional[prompt_vocab.AspectRatioToken] = None
    creativity: Optional[int] = Field(default=None, ge=0, le=100)
    product_preservation: Optional[int] = Field(default=None, ge=0, le=100)
    prompt: Optional[str] = None  # user intent, appended last by PromptBuilder
    negative_prompt: Optional[str] = None
    seed: Optional[int] = None  # null = random; echoed back in the response for reproducibility
    quality: Optional[prompt_vocab.QualityToken] = None


async def _analyze_product_image(image_url: str, openai_key: str) -> str:
    """Use GPT-4o-mini vision to extract visual attributes from the product image URL."""
    payload = {
        "model": "gpt-4o-mini",
        "max_tokens": 300,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": image_url, "detail": "low"},
                    },
                    {
                        "type": "text",
                        "text": (
                            "Describe this product image in one concise sentence focusing on: "
                            "exact shape, primary colors, material/texture, size impression, and any visible branding or text. "
                            "Be specific and visual. Do not mention the background."
                        ),
                    },
                ],
            }
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {openai_key}", "Content-Type": "application/json"},
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception:
        return ""


async def _run_flux_kontext(
    product_url: str,
    prompt: str,
    *,
    aspect_ratio: str = "1:1",
    seed: int | None = None,
) -> dict:
    try:
        # Flatten transparency onto white so flux-kontext sees a clean RGB product.
        flux_input = await asyncio.to_thread(_prep_product_image, product_url)
        replicate_input = {
            "input_image": flux_input,
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            "output_format": "png",
            # Keep upsampling off so the model stays faithful to our preservation
            # instruction instead of creatively rewriting the prompt.
            "prompt_upsampling": False,
            "safety_tolerance": 2,
        }
        if seed is not None:
            replicate_input["seed"] = seed
        output = await _replicate_run(_FLUX_KONTEXT_MODEL, replicate_input)
        # Product-scene re-frames the product into a new scene at the requested
        # aspect ratio, so the output size legitimately differs from the source.
        stored = await finalize(output, policy=ResolutionPolicy.ALLOW_CHANGE)
        url = stored.url
        # The stored file is the truth; the aspect table is only a fallback for
        # when finalize could not measure it.
        width, height = stored.width, stored.height
        return {"ok": True, "image_url": url, "width": width, "height": height, "revised_prompt": None, "cost_usd": None}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/product-scene", response_model=ImageOut)
async def generate_product_scene(
    body: ProductSceneRequest,
    current_user: CurrentUser,
    db: DB,
    _: Annotated[None, Depends(require_credits("ai"))],
):
    if body.scene_id not in PRODUCT_SCENES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unknown scene: {body.scene_id}. Available: {list(PRODUCT_SCENES)}",
        )

    proj_result = await db.execute(
        select(Project).where(Project.id == body.project_id, Project.org_id == current_user.org_id)
    )
    if proj_result.scalar_one_or_none() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    await check_project_not_locked(body.project_id, db)

    brand_kit = None
    if body.use_brand_kit:
        bk = await db.execute(
            select(BrandKitModel).where(
                BrandKitModel.org_id == current_user.org_id,
                BrandKitModel.project_id == body.project_id,
            )
        )
        brand_kit = bk.scalar_one_or_none()

    lighting = body.lighting or _DEFAULT_LIGHTING
    camera = body.camera or _DEFAULT_CAMERA
    aspect_ratio = body.aspect_ratio or _DEFAULT_ASPECT_RATIO
    creativity = body.creativity if body.creativity is not None else _DEFAULT_CREATIVITY
    product_preservation = (
        body.product_preservation if body.product_preservation is not None else _DEFAULT_PRODUCT_PRESERVATION
    )
    quality = body.quality or _DEFAULT_QUALITY

    prompt = build_scene_prompt(
        body.scene_id,
        body.product_description,
        brand_kit,
        lighting=lighting,
        camera=camera,
        aspect_ratio=aspect_ratio,
        creativity=creativity,
        product_preservation=product_preservation,
        user_prompt=body.prompt or "",
        negative_prompt=body.negative_prompt or "",
        seed=body.seed,
        quality=quality,
    )

    # Run generation BEFORE persisting so failed attempts never clutter the library.
    if settings.REPLICATE_API_KEY:
        # Replicate flux-kontext-pro: true image-conditioned generation — URL is passed directly
        result = await _run_flux_kontext(
            body.product_image_url, prompt, aspect_ratio=aspect_ratio, seed=body.seed
        )
    else:
        key_result = await db.execute(
            select(APIKey).where(APIKey.org_id == current_user.org_id, APIKey.provider == "openai")
        )
        api_key_row = key_result.scalar_one_or_none()
        if api_key_row:
            openai_key = decrypt_api_key(api_key_row.encrypted_value)
            # Analyze the product image with vision so DALL-E prompt reflects the actual product
            visual_description = await _analyze_product_image(body.product_image_url, openai_key)
            if visual_description:
                enriched_prompt = f"{prompt} The product looks like this: {visual_description}"
            else:
                enriched_prompt = prompt
            result = await generate_image_dalle(
                prompt=enriched_prompt,
                style="photorealistic",
                usage="product_shot",
                openai_api_key=openai_key,
            )
        else:
            result = {"ok": False, "error": "No Replicate or OpenAI key configured"}

    if not result.get("ok"):
        # Nothing is saved — surface the error to the client instead.
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            result.get("error") or "Product shot generation failed",
        )

    image = GeneratedImage(
        org_id=current_user.org_id,
        project_id=body.project_id,
        prompt=prompt,
        style=ImageStyle.photorealistic,
        usage=ImageUsage.product_shot,
        status=ImageStatus.ready,
        image_url=result["image_url"],
        thumbnail_url=result["image_url"],
        revised_prompt=result.get("revised_prompt"),
        width=result.get("width", 1024),
        height=result.get("height", 1024),
        cost_usd=result.get("cost_usd"),
    )
    db.add(image)
    await db.flush()
    await db.refresh(image)
    await db.commit()
    await increment_usage(current_user.org_id, "images", db)
    image_out = ImageOut.model_validate(image)
    # GeneratedImage has no `seed` column (seed is a generation parameter, not
    # persisted state) -- echo the requested seed back on the response object
    # directly so the caller can reproduce this exact generation.
    image_out.seed = body.seed
    return image_out
