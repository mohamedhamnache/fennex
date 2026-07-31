"""POST /images/{image_id}/edit — dispatch to editing_service operations."""
import base64
import inspect
import uuid
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.billing import require_credits
from app.core.dependencies import CurrentUser, DB
from app.core.storage import upload_bytes
from app.models.image import GeneratedImage, ImageStatus
from app.services import editing_service
from app.services.mask_service import MASK_OPERATIONS, MaskResolution, is_own_storage_url, resolve_mask

router = APIRouter()

# Operations that accept a mask. Sourced from mask_service so the router and the
# resolver cannot drift apart.
_MASK_OPS = MASK_OPERATIONS

# Maps operation name → (service function, required param keys, optional param keys)
# mask_url for Replicate ops is resolved at runtime by _mask_for -- from
# mask_base64, from a validated params["mask_url"], or by auto-resolution
# via mask_service.resolve_mask; not listed here.
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
    # Replicate AI — mask_url resolved by _mask_for (see above)
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
    """Resolve a user-supplied mask, in precedence order:

      - mask_base64: a freshly painted canvas mask, uploaded to storage. Wins
        over mask_url since it represents the most recent paint.
      - mask_url: a mask the client is re-submitting on the confirmation
        round trip (see _mask_for). This is fetched server-side by whichever
        Replicate operation runs next, so an unvalidated client-supplied URL
        would be a request-forgery primitive -- it must pass
        is_own_storage_url before use.

    Raises ValueError if mask_url is present but fails validation, so the
    caller surfaces an error instead of silently falling through to
    auto-masking (which would apply a mask the user never approved).

    Checks `"mask_url" in params` rather than truthiness: a present-but-empty
    value (`""` or `None`, e.g. a client re-submitting a stale or cleared
    field) must be rejected as invalid too, not treated as "no mask
    supplied" -- that would fall through to auto-resolution and silently
    trigger a second paid segmenter call plus another needs_confirmation
    round trip.
    """
    b64 = params.get("mask_base64")
    if b64:
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        data = base64.b64decode(b64)
        key = f"masks/{uuid.uuid4().hex}.png"
        return await upload_bytes(data, key, "image/png")

    if "mask_url" in params:
        url = params["mask_url"]
        if not is_own_storage_url(url):
            raise ValueError("mask_url is not a valid storage URL.")
        return url

    return None


async def _mask_for(operation: str, params: dict, image_url: str, org_id, db) -> MaskResolution:
    """Resolve the mask for a mask-requiring operation.

    Always returns a MaskResolution. A painted or previously-confirmed mask
    always wins; auto-resolution via mask_service.resolve_mask runs only when
    neither was supplied -- replacing the previous behaviour of refusing the
    edit outright with "paint the area first", which made every mask
    operation unreachable from a plain natural-language request.

    A resolution from resolve_mask is passed through untouched, including its
    needs_confirmation state: the prompted tier hands back a good mask that
    still needs the user's sign-off (ok=False, needs_confirmation=True), which
    is neither a painted selection nor an error and must not be collapsed
    into one.
    """
    try:
        supplied = await _resolve_mask_url(params)
    except ValueError as e:
        return MaskResolution(ok=False, error=str(e))
    if supplied:
        return MaskResolution(ok=True, mask_url=supplied, tier="painted")

    return await resolve_mask(image_url, operation, params.get("target"), org_id, db)


class EditRequest(BaseModel):
    operation: str
    params: Optional[dict[str, Any]] = None


class EditOut(BaseModel):
    ok: bool
    image_url: Optional[str] = None
    image_id: Optional[uuid.UUID] = None
    error: Optional[str] = None
    # True when the edit stopped because Mirage needs to know which region to
    # act on -- the client should re-ask rather than treat this as a failure.
    needs_target: bool = False
    # True when a mask WAS derived but needs the user's approval before it is
    # applied. The client shows mask_url as a highlight overlay and, on
    # approval, re-submits the same edit with params["mask_url"] set to it.
    needs_confirmation: bool = False
    mask_url: Optional[str] = None


@router.post("/{image_id}/edit", response_model=EditOut)
async def edit_image(
    image_id: uuid.UUID,
    body: EditRequest,
    current_user: CurrentUser,
    db: DB,
    _: Annotated[None, Depends(require_credits("ai"))],
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

    # For Replicate masked operations: use the painted mask, else derive one.
    if body.operation in _MASK_OPS:
        res = await _mask_for(body.operation, params, image.image_url, current_user.org_id, db)
        if res.needs_confirmation:
            return EditOut(ok=False, needs_confirmation=True, mask_url=res.mask_url,
                           error="Confirm the highlighted area before applying.")
        if not res.ok:
            return EditOut(ok=False, error=res.question or res.error,
                           needs_target=bool(res.question))
        kwargs["mask_url"] = res.mask_url

    # Removal no longer needs an OpenAI key. It used to decrypt one here so
    # remove_object could describe the background with GPT-4o-mini and feed that
    # to a generative model -- the cause of removals producing a new object.
    # LaMa takes only an image and a mask. smart_erase never used the key at all,
    # so this decrypt was pure waste on every call.

    # The record already carries the source dimensions, so hand them to the
    # operation rather than making it download the whole file again just to read
    # a header -- several megabytes per edit on a large photo.
    #
    # Only the operations that declare the parameter get it: the Pillow ops
    # (crop, rotate, filter and friends) never take one, and passing it blindly
    # would raise TypeError on every one of them.
    if image.width and image.height and "source_size" in inspect.signature(fn).parameters:
        kwargs["source_size"] = (image.width, image.height)

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
        # The size the operation ACTUALLY stored, not the source's. Copying the
        # source's meant that after an upscale, relight or shadow the file was
        # one size and the record claimed another. Falls back to the source only
        # for operations that do not report a size (the Pillow ops, which never
        # change it except resize/crop -- see below).
        width=edit_result.get("width") or image.width,
        height=edit_result.get("height") or image.height,
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
