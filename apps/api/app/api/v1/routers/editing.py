"""POST /images/{image_id}/edit — dispatch to editing_service operations."""
import base64
import uuid
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.dependencies import CurrentUser, DB
from app.core.security import decrypt_api_key
from app.core.storage import upload_bytes
from app.models.api_key import APIKey
from app.models.image import GeneratedImage, ImageStatus
from app.services import editing_service

router = APIRouter()

# Operations that accept a painted canvas mask (mask_base64 → uploaded mask_url)
_MASK_OPS = {"replace_background", "remove_object", "insert_object", "generative_fill", "smart_erase"}

# Maps operation name → (service function, required param keys, optional param keys)
# mask_url for Replicate ops is injected at runtime from mask_base64; not listed here.
_DISPATCH: dict[str, tuple[Any, list[str], list[str]]] = {
    # Basic (Pillow)
    "crop":               (editing_service.crop_image,        ["x", "y", "w", "h"],    []),
    "resize":             (editing_service.resize_image,      ["width", "height"],      ["keep_aspect"]),
    "rotate":             (editing_service.rotate_image,      ["angle"],                ["fill_color"]),
    "flip":               (editing_service.flip_image,        ["direction"],            []),
    "adjust":             (editing_service.adjust_image,      [],                       ["brightness", "contrast", "saturation"]),
    "filter":             (editing_service.apply_filter,      ["filter_name"],          []),
    "denoise":            (editing_service.denoise_image,     [],                       ["strength"]),
    "sharpen":            (editing_service.sharpen_image,     [],                       ["strength"]),
    # Remove.bg — no mask required, auto-detects background
    "remove_background":  (editing_service.remove_background, [],                       []),
    # Replicate AI — mask_url injected from mask_base64 by the router
    "replace_background": (editing_service.replace_background, ["prompt"],              []),
    "remove_object":      (editing_service.remove_object,     [],                       []),
    "insert_object":      (editing_service.insert_object,     ["prompt"],               []),
    "generative_fill":    (editing_service.generative_fill,   ["prompt"],               []),
    "smart_erase":        (editing_service.smart_erase,       [],                       []),
    "generate_shadow":    (editing_service.generate_shadow,   [],                       ["direction"]),
    "relight":            (editing_service.relight_image,     [],                       ["direction", "intensity"]),
    "restore_face":       (editing_service.restore_face,      [],                       ["fidelity"]),
    "upscale":            (editing_service.upscale_image,     [],                       ["scale"]),
}


async def _resolve_mask_url(params: dict) -> Optional[str]:
    """Convert mask_base64 (canvas data URL) to a storage URL for Replicate."""
    b64 = params.get("mask_base64")
    if not b64:
        return None
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    data = base64.b64decode(b64)
    key = f"masks/{uuid.uuid4().hex}.png"
    return await upload_bytes(data, key, "image/png")


class EditRequest(BaseModel):
    operation: str
    params: Optional[dict[str, Any]] = None


class EditOut(BaseModel):
    ok: bool
    image_url: Optional[str] = None
    image_id: Optional[uuid.UUID] = None
    error: Optional[str] = None


@router.post("/{image_id}/edit", response_model=EditOut)
async def edit_image(
    image_id: uuid.UUID,
    body: EditRequest,
    current_user: CurrentUser,
    db: DB,
):
    # Fetch source image
    result = await db.execute(
        select(GeneratedImage).where(
            GeneratedImage.id == image_id,
            GeneratedImage.org_id == current_user.org_id,
        )
    )
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    if not image.image_url:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Image has no URL to edit")

    if body.operation not in _DISPATCH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown operation: {body.operation}. Valid operations: {sorted(_DISPATCH)}",
        )

    fn, required_keys, optional_keys = _DISPATCH[body.operation]
    params = body.params or {}

    # Validate required params
    missing = [k for k in required_keys if k not in params]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Operation '{body.operation}' requires params: {missing}",
        )

    # Build kwargs for the service call
    kwargs: dict[str, Any] = {k: params[k] for k in required_keys}
    for k in optional_keys:
        if k in params:
            kwargs[k] = params[k]

    # For Replicate masked operations: upload the canvas mask and inject mask_url
    if body.operation in _MASK_OPS:
        mask_url = await _resolve_mask_url(params)
        if mask_url:
            kwargs["mask_url"] = mask_url
        elif body.operation in {"replace_background", "remove_object", "insert_object", "generative_fill", "smart_erase"}:
            return EditOut(ok=False, error="Please paint the area on the image first, then apply.")

    # For removal ops: inject OpenAI key so the service can do vision-based background analysis
    if body.operation in {"smart_erase", "remove_object"}:
        key_row = await db.execute(
            select(APIKey).where(APIKey.org_id == current_user.org_id, APIKey.provider == "openai")
        )
        api_key_row = key_row.scalar_one_or_none()
        if api_key_row:
            kwargs["openai_key"] = decrypt_api_key(api_key_row.encrypted_value)

    # Call service
    edit_result = await fn(image.image_url, **kwargs)

    if not edit_result.get("ok"):
        return EditOut(ok=False, error=edit_result.get("error", "Unknown error"))

    # Persist as a new child image record
    edited = GeneratedImage(
        org_id=image.org_id,
        project_id=image.project_id,
        prompt=image.prompt,
        style=image.style,
        usage=image.usage,
        status=ImageStatus.ready,
        image_url=edit_result["image_url"],
        thumbnail_url=edit_result["image_url"],
        width=image.width,
        height=image.height,
        source_image_id=image.id,
        edit_operation=body.operation,
        alt_text=image.alt_text,
        caption=image.caption,
        seo_filename=image.seo_filename,
        social_platform=image.social_platform,
    )
    db.add(edited)
    await db.commit()
    await db.refresh(edited)

    return EditOut(ok=True, image_url=edit_result["image_url"], image_id=edited.id)
