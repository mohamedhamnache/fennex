"""POST /images/{image_id}/edit — dispatch to editing_service operations."""
import uuid
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.dependencies import CurrentUser, DB
from app.models.image import GeneratedImage, ImageStatus
from app.services import editing_service

router = APIRouter()

# Maps operation name → (service function, required param keys, optional param keys)
_DISPATCH: dict[str, tuple[Any, list[str], list[str]]] = {
    # Basic (Pillow)
    "crop":               (editing_service.crop_image,        ["x", "y", "w", "h"],    []),
    "resize":             (editing_service.resize_image,      ["width", "height"],      ["keep_aspect"]),
    "rotate":             (editing_service.rotate_image,      ["angle"],                ["fill_color"]),
    "adjust":             (editing_service.adjust_image,      [],                       ["brightness", "contrast"]),
    "filter":             (editing_service.apply_filter,      ["filter_name"],          []),
    "denoise":            (editing_service.denoise_image,     [],                       ["strength"]),
    "sharpen":            (editing_service.sharpen_image,     [],                       ["strength"]),
    # Remove.bg
    "remove_background":  (editing_service.remove_background, [],                       []),
    # Replicate AI
    "replace_background": (editing_service.replace_background, ["mask_url", "prompt"],  []),
    "remove_object":      (editing_service.remove_object,     ["mask_url"],             []),
    "insert_object":      (editing_service.insert_object,     ["mask_url", "prompt"],   []),
    "generative_fill":    (editing_service.generative_fill,   ["mask_url", "prompt"],   []),
    "smart_erase":        (editing_service.smart_erase,       ["mask_url"],             []),
    "generate_shadow":    (editing_service.generate_shadow,   [],                       ["direction"]),
    "relight":            (editing_service.relight_image,     [],                       ["direction", "intensity"]),
    "restore_face":       (editing_service.restore_face,      [],                       ["fidelity"]),
    "upscale":            (editing_service.upscale_image,     [],                       ["scale"]),
}


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
    )
    db.add(edited)
    await db.commit()
    await db.refresh(edited)

    return EditOut(ok=True, image_url=edit_result["image_url"], image_id=edited.id)
