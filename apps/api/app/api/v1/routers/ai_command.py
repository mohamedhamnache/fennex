"""POST /images/{id}/ai-command — natural-language editing via LLM dispatch."""
import base64
import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.billing import require_credits
from app.core.dependencies import CurrentUser, DB
from app.core.storage import upload_bytes
from app.models.image import GeneratedImage, ImageStatus
from app.services.ai_command_service import parse_ai_command_steps
from app.services.llm_service import project_locale
from app.services import editing_service
from app.services.mask_service import MASK_OPERATIONS, is_own_storage_url, resolve_mask
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
    "replace_background": lambda url, p, mask: editing_service.replace_background(url, p.get("prompt", ""), mask or ""),
    "remove_object":      lambda url, p, mask: editing_service.remove_object(url, mask or ""),
    "insert_object":      lambda url, p, mask: editing_service.insert_object(url, p.get("prompt", ""), mask or ""),
    "generative_fill":    lambda url, p, mask: editing_service.generative_fill(url, p.get("prompt", ""), mask or ""),
    "smart_erase":        lambda url, p, mask: editing_service.smart_erase(url, mask or ""),
}


class AiCommandRequest(BaseModel):
    command: str
    history: list[dict] = []
    mask_base64: Optional[str] = None
    # A mask the client is re-submitting on the confirmation round trip (see
    # _mask_for_step's needs_confirmation branch). Fetched server-side, so it
    # must be validated with is_own_storage_url before use -- see
    # _resolve_mask_url.
    mask_url: Optional[str] = None


async def _resolve_mask_url(body: "AiCommandRequest") -> Optional[str]:
    """Resolve the request-level painted mask, in precedence order:

      - mask_base64: a freshly painted canvas mask, uploaded to storage. Wins
        over mask_url since it represents the most recent paint.
      - mask_url: a mask the client is re-submitting on the confirmation
        round trip (see _mask_for_step). This is fetched server-side by
        whichever mask-requiring operation runs next, so an unvalidated
        client-supplied URL would be a request-forgery primitive -- it must
        pass is_own_storage_url before use.

    Raises ValueError if mask_url is present but fails validation, so the
    caller surfaces an error instead of silently falling through to
    auto-masking (which would apply a mask -- and spend on a second paid
    segmenter call -- that the user never approved).

    Checks presence via model_fields_set rather than truthiness: a
    present-but-empty mask_url ("" or None supplied explicitly) must be
    rejected as invalid too, not treated as "no mask supplied" -- that would
    fall through to auto-resolution and silently trigger a second paid
    segmenter call plus another needs_confirmation round trip.
    """
    if body.mask_base64:
        b64 = body.mask_base64
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        data = base64.b64decode(b64)
        key = f"masks/{uuid.uuid4().hex}.png"
        return await upload_bytes(data, key, "image/png")

    if "mask_url" in body.model_fields_set:
        url = body.mask_url
        if not is_own_storage_url(url):
            raise ValueError("mask_url is not a valid storage URL.")
        return url

    return None


async def _mask_for_step(step: dict, image_url: str, painted_mask_url: Optional[str],
                          org_id: uuid.UUID, db) -> Optional[str]:
    """Resolve this step's mask, or None for operations that do not take one.

    Resolution runs per step against the EVOLVING image, so step N masks
    against step N-1's output rather than the original -- that is what makes
    a chained request like "replace the background, then upscale" mask the
    right frame.

    Unlike editing.py's _mask_for (which hands a MaskResolution back to a
    single-operation route that can turn needs_confirmation/question/error
    into a 200 with an appropriate flag), a step here sits inside a chain --
    there is no partial-success shape to return mid-chain, so every non-ok
    outcome raises a structured 422 that aborts the whole request.
    """
    operation = step["operation"]
    if operation not in MASK_OPERATIONS:
        return None
    if painted_mask_url:
        return painted_mask_url

    params = step.get("params", {}) or {}
    resolution = await resolve_mask(image_url, operation, params.get("target"), org_id, db)
    if resolution.needs_confirmation:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            {
                "code": "mask_confirm_required",
                "message": "Confirm the highlighted area before applying.",
                "mask_url": resolution.mask_url,
            },
        )
    if resolution.ok:
        return resolution.mask_url
    if resolution.question:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            {"code": "mask_target_required", "message": resolution.question},
        )
    raise HTTPException(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        {"code": "mask_unavailable", "message": resolution.error or "Could not work out which area to change."},
    )


@router.post("/{image_id}/ai-command", response_model=ImageOut)
async def ai_command(
    image_id: uuid.UUID, body: AiCommandRequest, current_user: CurrentUser, db: DB,
    _: Annotated[None, Depends(require_credits("ai"))],
):
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

    try:
        mask_url = await _resolve_mask_url(body)
    except ValueError as e:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            {"code": "mask_url_invalid", "message": str(e)},
        )

    # Chain the operations — each runs on the previous step's result.
    current_url = source.image_url or ""
    applied: list[str] = []
    for step in steps:
        operation = step["operation"]
        params = step.get("params", {}) or {}
        step_mask = await _mask_for_step(step, current_url, mask_url, current_user.org_id, db)
        fn = _DISPATCH[operation]
        edit_result = await fn(current_url, params, step_mask)
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
