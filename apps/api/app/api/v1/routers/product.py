import uuid
import io
import base64
import asyncio
import urllib.request
import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
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
from app.services.editing_service import _replicate_run, _download_and_upload_url
from app.api.v1.routers.images import ImageOut
from app.core.billing import check_project_not_locked, increment_usage
from app.core.security import decrypt_api_key

router = APIRouter()

_FLUX_KONTEXT_MODEL = "black-forest-labs/flux-kontext-pro"


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


async def _run_flux_kontext(product_url: str, prompt: str) -> dict:
    try:
        # Flatten transparency onto white so flux-kontext sees a clean RGB product.
        flux_input = await asyncio.to_thread(_prep_product_image, product_url)
        output = await _replicate_run(
            _FLUX_KONTEXT_MODEL,
            {
                "input_image": flux_input,
                "prompt": prompt,
                "aspect_ratio": "1:1",
                "output_format": "png",
                # Keep upsampling off so the model stays faithful to our preservation
                # instruction instead of creatively rewriting the prompt.
                "prompt_upsampling": False,
                "safety_tolerance": 2,
            },
        )
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url, "width": 1024, "height": 1024, "revised_prompt": None, "cost_usd": None}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/product-scene", response_model=ImageOut)
async def generate_product_scene(body: ProductSceneRequest, current_user: CurrentUser, db: DB):
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
        bk = await db.execute(select(BrandKitModel).where(BrandKitModel.org_id == current_user.org_id))
        brand_kit = bk.scalar_one_or_none()

    prompt = build_scene_prompt(body.scene_id, body.product_description, brand_kit)

    # Run generation BEFORE persisting so failed attempts never clutter the library.
    if settings.REPLICATE_API_KEY:
        # Replicate flux-kontext-pro: true image-conditioned generation — URL is passed directly
        result = await _run_flux_kontext(body.product_image_url, prompt)
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
    return ImageOut.model_validate(image)
