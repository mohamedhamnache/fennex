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
from app.services import chain_resume
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
    # knows which position to fill next). ABSOLUTE across the whole chain,
    # on a fresh request AND on a resume_token request alike: entry N is
    # always the Nth mask-requiring step's mask, exactly matching the
    # (also absolute) step_index a mask_confirm_required 422 reports. A
    # resume request does NOT rebase this list relative to wherever
    # execution stopped -- doing that previously caused an infinite, billed
    # confirm loop, since the client writes an approved mask at the
    # absolute index the 422 gave it, and a rebased lookup on the server
    # would find nothing there and call the paid segmenter again. See
    # _merge_resume_mask_queue for how a resume request's queue is combined
    # with the one cached in its snapshot. The Nth mask-requiring step in the
    # chain consumes queue[N]; a step beyond the queue's length auto-resolves
    # normally. A `null` ENTRY (as opposed to the whole field being null)
    # means "no client-supplied mask for this position" -- e.g. a
    # product-tier step that never needed confirmation but still occupies a
    # position -- and that position auto-resolves too. A non-null entry is
    # fetched server-side, so it must be validated with is_own_storage_url
    # before use -- see _resolve_mask_queue.
    mask_urls: Optional[list[Optional[str]]] = None
    # Set by the client on the round trip that follows a mask_confirm_required
    # 422 (see chain_resume.py and the resume branch in ai_command below).
    # When present, the router loads the cached plan from that stopped
    # request instead of re-planning via parse_ai_command_steps and instead
    # of re-executing steps that already ran -- both of which are what made
    # a compound command like "replace the background... and remove the
    # person on the left" double-charge and, on a reordered/shorter replan,
    # apply the approved mask to the wrong operation.
    resume_token: Optional[str] = None


async def _resolve_mask_queue(body: "AiCommandRequest") -> list[Optional[str]]:
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
        confirmation round trips. Each non-null entry is fetched server-side
        by whichever mask-requiring operation consumes it, so every non-null
        entry must pass is_own_storage_url before use -- an unvalidated
        client-supplied URL is a request-forgery primitive. Validated
        EAGERLY for the whole resulting queue before any step runs: an
        invalid entry anywhere must abort the request up front rather than
        letting an earlier step's own (valid-looking) resolution run first
        on a queue that turns out to be broken further along.

    A `null` ENTRY INSIDE the list (as opposed to the whole field being
    null) is not an error -- it means "no client-supplied mask for this
    position, auto-resolve it". This matters for a compound command like
    "replace the background and remove the person on the left": the first
    step is product-tier and auto-resolves without ever needing
    confirmation, so it never contributes a mask, yet it still occupies a
    queue position because indexing counts every mask-requiring step (see
    _next_step_mask). A client accumulating masks only for steps that
    actually asked for confirmation ends up with a JS sparse array whose
    unconfirmed holes -- including position 0 here -- serialise to `null`
    via JSON.stringify. Rejecting that `null` would make this exact compound
    command, the one auto-masking exists to serve, permanently
    unsatisfiable. This is NOT the falsy-fallthrough bug Task 4 hit: that
    bug was a single SCALAR field where a falsy value meant "field absent"
    and silently triggered a second paid segmenter call. Here `null` at
    position N is an explicit, unambiguous statement about position N
    specifically -- the position is still consumed, nothing shifts, and the
    step still runs auto-resolution exactly as if no queue existed for it.
    An empty string `""` is different: a correct client never produces one
    (only a JS sparse-array hole legitimately serialises to `null`), so it
    remains a hard rejection.

    Raises ValueError on the first invalid entry -- including a
    present-but-empty whole-field value ("mask_urls": [] or null, supplied
    explicitly) or a present-but-empty string element ("" inside the list)
    -- so the caller surfaces a 422 instead of silently falling through to
    auto-masking. Auto-masking would apply a mask the user never approved,
    and for the prompted tier, spend a second time on a call the client
    thought it had already paid for.

    Checks presence via model_fields_set rather than truthiness for the
    WHOLE field: this is the same class of bug Task 4 hit for the
    single-mask case, where a falsy value fell through and triggered a
    second paid segmenter call. That check is unaffected by the null-entry
    handling above, which operates one level down, per list element.

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
            # masks supplied, auto-resolve everything". (This is the WHOLE
            # field being empty/null, not a null ENTRY inside a non-empty
            # list -- that case is handled per-element below.)
            raise ValueError("mask_urls is present but empty.")
        queue = list(urls)

    overwrites_first_entry = bool(body.mask_base64)
    for index, url in enumerate(queue):
        if overwrites_first_entry and index == 0:
            continue
        if url is None:
            # Explicit "no client-supplied mask for this step" -- left as
            # None in the returned queue so _next_step_mask's lookup treats
            # it as an unconfirmed position and auto-resolves via
            # resolve_mask, exactly as if the queue were shorter here.
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


async def _next_step_mask(step: dict, image_url: str, mask_queue: list[Optional[str]], mask_step_index: int,
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
    queue had an entry at that position -- a step beyond the supplied queue,
    OR a queue entry that is explicitly None (see _resolve_mask_queue for
    why a null entry is valid and distinct from an invalid one), simply
    auto-resolves via resolve_mask inside _mask_for_step exactly the same
    way.
    """
    operation = step["operation"]
    if operation not in MASK_OPERATIONS:
        return None, mask_step_index

    painted = mask_queue[mask_step_index] if mask_step_index < len(mask_queue) else None
    mask_url = await _mask_for_step(step, image_url, painted, org_id, db, step_index=mask_step_index)
    return mask_url, mask_step_index + 1


def _merge_resume_mask_queue(
    snapshot_queue: list[Optional[str]], fresh_queue: list[Optional[str]],
) -> list[Optional[str]]:
    """Combine the mask queue cached in a resume snapshot with the masks this
    resume request is supplying.

    mask_urls is ABSOLUTE across the whole chain on every request, fresh or
    resumed -- entry N is always the Nth mask-requiring step's mask, exactly
    matching the (also absolute) step_index a mask_confirm_required 422
    reports (see _mask_for_step). A resume request must NOT rebase its
    mask_urls relative to the step that stopped: the frontend accumulates
    confirmed masks by the absolute step_index the 422 gave it, so a rebased
    lookup here would find nothing at the position the client actually
    filled in and call resolve_mask (the paid segmenter) again -- an
    infinite, billed confirm loop, which is the exact failure the resume
    token exists to prevent.

    fresh_queue's entries simply overwrite snapshot_queue's at the SAME
    absolute position (extending it if fresh_queue reaches further) -- this
    lets a client resend only the newly confirmed entry (or entries) while
    still benefiting from whatever the snapshot already had at earlier,
    already-applied positions.
    """
    merged = list(snapshot_queue)
    for position, value in enumerate(fresh_queue):
        if position < len(merged):
            merged[position] = value
        else:
            merged.append(value)
    return merged


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

    try:
        request_mask_queue = await _resolve_mask_queue(body)
    except ValueError as e:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            {"code": "mask_url_invalid", "message": str(e)},
        )

    if body.resume_token:
        # Resuming a chain that already stopped once for confirmation. The
        # whole point: use the cached plan and cached progress VERBATIM --
        # never re-plan (that is what misbinds the approved mask to the
        # wrong step on a reordered/shorter replan) and never re-execute a
        # step that already ran (that is what double-charges Remove.bg /
        # flux-fill).
        snapshot = await chain_resume.load_snapshot(body.resume_token)
        if snapshot is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                {
                    "code": "resume_token_invalid",
                    "message": "This confirmation has expired. Please retry the command.",
                },
            )
        # SECURITY: an unguessable token is not itself proof of ownership --
        # verify the snapshot belongs to this org and this image before using
        # any of it, so one org can never resume (and thereby read the
        # intermediate image URLs of) another org's chain.
        if snapshot.org_id != str(current_user.org_id) or snapshot.image_id != str(image_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")

        # Single-use: this token is spent the moment it is loaded and
        # verified. If the resumed chain stops again, a fresh token is
        # minted below under store_snapshot -- this one is never reused.
        await chain_resume.delete_snapshot(body.resume_token)

        steps = snapshot.steps
        current_url = snapshot.current_url
        applied = list(snapshot.applied)
        start_index = snapshot.step_index
        mask_step_index = snapshot.mask_step_index
        mask_queue = _merge_resume_mask_queue(snapshot.mask_queue, request_mask_queue)
    else:
        parsed = await parse_ai_command_steps(body.command, body.history, current_user.org_id, db, locale=await project_locale(source.project_id, db))

        if "error" in parsed:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, parsed["error"])

        steps = parsed.get("steps", [])
        for step in steps:
            if step.get("operation") not in _DISPATCH:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown operation: {step.get('operation')}")

        current_url = source.image_url or ""
        applied = []
        start_index = 0
        mask_step_index = 0
        mask_queue = request_mask_queue

    # Chain the operations — each runs on the previous step's result. Each
    # mask-requiring step consumes its own position in mask_queue (see
    # _next_step_mask) rather than a single mask being reused across the
    # whole chain. start_index/current_url/applied/mask_step_index resume a
    # previously-stopped chain unchanged when body.resume_token was used.
    for index in range(start_index, len(steps)):
        step = steps[index]
        operation = step["operation"]
        params = step.get("params", {}) or {}
        try:
            step_mask, mask_step_index = await _next_step_mask(
                step, current_url, mask_queue, mask_step_index, current_user.org_id, db,
            )
        except HTTPException as exc:
            if isinstance(exc.detail, dict) and exc.detail.get("code") == "mask_confirm_required":
                # Snapshot progress BEFORE this step (it has not run yet) so
                # the next request can resume exactly here without redoing
                # any already-applied, already-paid-for step.
                try:
                    token = await chain_resume.store_snapshot(chain_resume.ChainSnapshot(
                        steps=steps,
                        current_url=current_url,
                        applied=applied,
                        step_index=index,
                        mask_step_index=mask_step_index,
                        mask_queue=mask_queue,
                        org_id=str(current_user.org_id),
                        image_id=str(image_id),
                    ))
                except Exception:
                    # Redis unavailable: degrade to the pre-resume-token
                    # behaviour rather than letting the store's exception
                    # replace this 422 with a raw 500. Re-raise the ORIGINAL
                    # exc, unchanged (no resume_token) -- the client still
                    # gets mask_confirm_required and can still confirm the
                    # mask, just by re-planning and re-executing earlier
                    # steps again, which is strictly better than mask
                    # confirmation being unavailable outright.
                    raise exc
                exc.detail = {**exc.detail, "resume_token": token}
            raise
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
