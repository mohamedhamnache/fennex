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
    # An ORDERED QUEUE of masks the client is re-submitting on successive
    # confirmation round trips (see _next_step_mask / _mask_for_step's
    # needs_confirmation branch, which reports step_index so the client
    # knows which position to fill next). The Nth mask-requiring step in the
    # chain consumes queue[N]; a step beyond the queue's length auto-resolves
    # normally. Each entry is fetched server-side, so it must be validated
    # with is_own_storage_url before use -- see _resolve_mask_queue.
    mask_urls: Optional[list[str]] = None


async def _resolve_mask_queue(body: "AiCommandRequest") -> list[str]:
    """Resolve the ordered queue of confirmed/painted masks supplied on this
    request. The Nth mask-requiring step in the chain (see _next_step_mask)
    consumes queue[N]; a step beyond the queue's length auto-resolves.

    Precedence:
      - mask_base64: a freshly painted canvas mask, uploaded to storage.
        Applies ONLY to the first mask-requiring step -- it overwrites
        position 0 of the queue built from mask_urls (or seeds a one-entry
        queue if mask_urls was empty/absent), since a fresh paint always
        outranks whatever mask_urls[0] contained for that position. Later
        entries are left untouched.
      - mask_urls: masks the client is re-submitting on successive
        confirmation round trips. Each entry is fetched server-side by
        whichever mask-requiring operation consumes it, so every entry must
        pass is_own_storage_url before use -- an unvalidated client-supplied
        URL is a request-forgery primitive. Validated EAGERLY for the whole
        resulting queue before any step runs: an invalid entry anywhere must
        abort the request up front rather than letting an earlier step's own
        (valid-looking) resolution run first on a queue that turns out to be
        broken further along.

    Raises ValueError on the first invalid entry -- including a
    present-but-empty whole-field value ("mask_urls": [] or null, supplied
    explicitly) or a present-but-empty single element ("" or null inside the
    list) -- so the caller surfaces a 422 instead of silently falling
    through to auto-masking. Auto-masking would apply a mask the user never
    approved, and for the prompted tier, spend a second time on a call the
    client thought it had already paid for.

    Checks presence via model_fields_set rather than truthiness: this is the
    same class of bug Task 4 hit for the single-mask case, where a falsy
    value fell through and triggered a second paid segmenter call.

    A stale or garbage mask_urls[0] that mask_base64 is about to overwrite is
    skipped by validation -- it is never actually used, so it must not fail
    validation and block an otherwise-valid request. The freshly uploaded
    mask_base64 value itself is never validated either: it is our own
    upload_bytes output, not client-supplied, so is_own_storage_url would be
    redundant (and, since a mocked/relative storage backend need not satisfy
    is_own_storage_url's own-bucket check, actively wrong).
    """
    queue: list[str] = []
    if "mask_urls" in body.model_fields_set:
        urls = body.mask_urls
        if not urls:
            # Covers both an explicit `null` and an explicit `[]` -- both
            # are the client asserting a value here, not omitting the field,
            # so both must be rejected rather than silently treated as "no
            # masks supplied, auto-resolve everything".
            raise ValueError("mask_urls is present but empty.")
        queue = list(urls)

    overwrites_first_entry = bool(body.mask_base64)
    for index, url in enumerate(queue):
        if overwrites_first_entry and index == 0:
            continue
        if not url or not is_own_storage_url(url):
            raise ValueError("mask_urls contains an entry that is not a valid storage URL.")

    if body.mask_base64:
        b64 = body.mask_base64
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        data = base64.b64decode(b64)
        key = f"masks/{uuid.uuid4().hex}.png"
        uploaded = await upload_bytes(data, key, "image/png")
        if queue:
            queue[0] = uploaded
        else:
            queue = [uploaded]

    return queue


async def _mask_for_step(step: dict, image_url: str, painted_mask_url: Optional[str],
                          org_id: uuid.UUID, db, step_index: Optional[int] = None) -> Optional[str]:
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

    step_index (the position among mask-requiring steps only -- see
    _next_step_mask) is echoed into the mask_confirm_required detail so the
    client knows which queue position to fill with the approved mask on its
    next request; without it a chain with more than one confirmation is
    unusable, since nothing else tells the client which step it approved.
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
                "step_index": step_index,
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


async def _next_step_mask(step: dict, image_url: str, mask_queue: list[str], mask_step_index: int,
                           org_id: uuid.UUID, db) -> tuple[Optional[str], int]:
    """Determine which entry (if any) of the confirmed-mask queue applies to
    this step, and resolve the step's mask.

    Only mask-requiring steps consume a queue position -- mask_step_index
    counts mask-requiring steps in the chain, not steps overall, so a chain
    like [upscale, replace_background] hands replace_background queue
    position 0, not 1 (upscale never touches the queue).

    Returns the resolved mask alongside the NEXT index the caller should
    pass in for the following step: unchanged for a non-mask step,
    incremented by one for a mask-requiring step regardless of whether the
    queue had an entry at that position -- a step beyond the supplied queue
    simply auto-resolves via resolve_mask inside _mask_for_step.
    """
    operation = step["operation"]
    if operation not in MASK_OPERATIONS:
        return None, mask_step_index

    painted = mask_queue[mask_step_index] if mask_step_index < len(mask_queue) else None
    mask_url = await _mask_for_step(step, image_url, painted, org_id, db, step_index=mask_step_index)
    return mask_url, mask_step_index + 1


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
        mask_queue = await _resolve_mask_queue(body)
    except ValueError as e:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            {"code": "mask_url_invalid", "message": str(e)},
        )

    # Chain the operations — each runs on the previous step's result. Each
    # mask-requiring step consumes its own position in mask_queue (see
    # _next_step_mask) rather than a single mask being reused across the
    # whole chain.
    current_url = source.image_url or ""
    applied: list[str] = []
    mask_step_index = 0
    for step in steps:
        operation = step["operation"]
        params = step.get("params", {}) or {}
        step_mask, mask_step_index = await _next_step_mask(
            step, current_url, mask_queue, mask_step_index, current_user.org_id, db,
        )
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
