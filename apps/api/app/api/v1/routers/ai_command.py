"""POST /images/{id}/ai-command — natural-language editing via LLM dispatch."""
import base64
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.dependencies import CurrentUser, DB
from app.core.storage import upload_bytes
from app.models.image import GeneratedImage, ImageStatus
from app.services.ai_command_service import parse_ai_command_steps
from app.services.llm_service import project_locale
from app.services import editing_service
from app.api.v1.routers.images import ImageOut

router = APIRouter()

_DISPATCH = {
    "crop":               lambda url, p, _: editing_service.crop_image(url, **p),
    "resize":             lambda url, p, _: editing_service.resize_image(url, **p),
    "rotate":             lambda url, p, _: editing_service.rotate_image(url, **p),
    "flip":               lambda url, p, _: editing_service.flip_image(url, **p),
    "adjust":             lambda url, p, _: editing_service.adjust_image(url, **p),
    "filter":             lambda url, p, _: editing_service.apply_filter(url, **p),
    "denoise":            lambda url, p, _: editing_service.denoise_image(url, **p),
    "sharpen":            lambda url, p, _: editing_service.sharpen_image(url, **p),
    "background_removal": lambda url, p, _: editing_service.remove_background(url),
    "upscale":            lambda url, p, _: editing_service.upscale_image(url, p.get("scale", 2)),
    "restore_face":       lambda url, p, _: editing_service.restore_face(url, p.get("fidelity", 0.7)),
    "generate_shadow":    lambda url, p, _: editing_service.generate_shadow(url, p.get("direction", "bottom")),
    "relight":            lambda url, p, _: editing_service.relight_image(url, p.get("direction", "top"), p.get("intensity", 1.0)),
    "replace_background": lambda url, p, mask: editing_service.replace_background(url, mask or "", p.get("prompt", "")),
    "remove_object":      lambda url, p, mask: editing_service.remove_object(url, mask or ""),
    "insert_object":      lambda url, p, mask: editing_service.insert_object(url, mask or "", p.get("prompt", "")),
    "generative_fill":    lambda url, p, mask: editing_service.generative_fill(url, mask or "", p.get("prompt", "")),
    "smart_erase":        lambda url, p, mask: editing_service.smart_erase(url, mask or ""),
}


class AiCommandRequest(BaseModel):
    command: str
    history: list[dict] = []
    mask_base64: Optional[str] = None


async def _upload_mask(mask_base64: str, org_id: uuid.UUID) -> str:
    b64 = mask_base64
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    data = base64.b64decode(b64)
    key = f"masks/{uuid.uuid4().hex}.png"
    return await upload_bytes(data, key, "image/png")


@router.post("/{image_id}/ai-command", response_model=ImageOut)
async def ai_command(image_id: uuid.UUID, body: AiCommandRequest, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(GeneratedImage).where(
            GeneratedImage.id == image_id,
            GeneratedImage.org_id == current_user.org_id,
        )
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")

    parsed = await parse_ai_command_steps(body.command, body.history, current_user.org_id, db, locale=await project_locale(source.project_id, db))

    if "error" in parsed:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, parsed["error"])

    steps = parsed.get("steps", [])
    for step in steps:
        if step.get("operation") not in _DISPATCH:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown operation: {step.get('operation')}")

    mask_url = None
    if body.mask_base64:
        mask_url = await _upload_mask(body.mask_base64, current_user.org_id)

    # Chain the operations — each runs on the previous step's result.
    current_url = source.image_url or ""
    applied: list[str] = []
    for step in steps:
        operation = step["operation"]
        params = step.get("params", {}) or {}
        fn = _DISPATCH[operation]
        edit_result = await fn(current_url, params, mask_url)
        if not edit_result.get("ok"):
            detail = edit_result.get("error", "Edit failed")
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                f"Step '{operation}' failed: {detail}" if applied else detail,
            )
        current_url = edit_result["image_url"]
        applied.append(operation)

    new_image = GeneratedImage(
        org_id=current_user.org_id,
        project_id=source.project_id,
        prompt=source.prompt,
        style=source.style,
        usage=source.usage,
        image_url=current_url,
        status=ImageStatus.ready,
        source_image_id=source.id,
        edit_operation=" + ".join(applied),
    )
    db.add(new_image)
    await db.flush()
    await db.refresh(new_image)
    await db.commit()
    return ImageOut.model_validate(new_image)
