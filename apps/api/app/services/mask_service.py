"""Derive an edit mask from an image, so mask-requiring operations can run
without the user hand-painting a selection.

POLARITY -- the single most important invariant here: white marks the region to
be REPLACED. Getting this backwards inverts every edit and fails silently (the
model happily inpaints the wrong half), so the polarity table below is asserted
by tests/test_mask_service.py rather than trusted. Verified against flux-fill's
live schema: "Black areas will be preserved while white areas will be
inpainted."

Two tiers, selected purely on whether a `target` was named:
  - product  (no target): thresholds the alpha channel of a Remove.bg cutout.
    Costs one Remove.bg call, no new model. Trusted enough to apply directly.
  - prompted (target given): segments the named object on Replicate. Returned
    for CONFIRMATION, never applied straight away -- see below.

Tier selection deliberately does NOT sniff keywords out of the target text --
"the background" would route to the paid segmenter for a case the free tier
already handles. Instead the planner is instructed to OMIT target for default
regions (see app/services/ai_command_service.py), which keeps this rule
trivially predictable.

WHY THE PROMPTED TIER ASKS FIRST: the segmenter has no no-match signal. Probed
with "elephant" against an elephant-free photo it returned a confident mask
over a car covering a perfectly plausible 12.61% of the frame, so neither a
confidence threshold nor a mask-area guard can tell a hit from a hallucination.
The only reliable judge is the user, so the prompted tier hands back
ok=False / needs_confirmation=True with the mask attached for approval.
"""
import io
import uuid
from dataclasses import dataclass
from typing import Optional

from PIL import Image as PILImage, ImageOps

from app.core.storage import _public_url, _s3_configured, upload_bytes
from app.services.editing_service import _download, _removebg_cutout, _replicate_run
from app.services.metering.meter import record_removebg

# Pinned in Task 0 against Replicate's live API. Do not edit from memory.
_SEGMENTER_MODEL = "tmappdev/lang-segment-anything"
_SEGMENTER_VERSION: Optional[str] = "891411c38a6ed2d44c004b7b9e44217df7a5b07848f29ddefd2e28bc7cbf93bc"
_SEGMENTER_IMAGE_FIELD = "image"
_SEGMENTER_PROMPT_FIELD = "text_prompt"
# True when the segmenter returns white for the region to KEEP, so its output
# must be inverted to match this module's white-is-replaced convention.
_SEGMENTER_INVERTS = False

# Alpha at or above this counts as opaque subject.
_ALPHA_THRESHOLD = 128

MASK_OPERATIONS = frozenset({
    "replace_background", "remove_object", "insert_object",
    "generative_fill", "smart_erase",
})

# Operations with no derivable default region: "put a bottle in the frame" does
# not say where. These ask instead of guessing.
AMBIGUOUS_WITHOUT_TARGET = frozenset({"insert_object", "generative_fill"})

AMBIGUITY_QUESTION = (
    "Tell me which part to change -- for example 'the background' or 'the bottle'."
)

# White = the region to be replaced. For the product tier the subject is the
# opaque alpha, so operations acting on the BACKGROUND invert it.
_INVERT_FOR_PRODUCT_TIER = frozenset({"replace_background"})

# Key prefix every mask this module uploads lives under. is_own_storage_url
# refuses anything outside it.
_MASK_KEY_PREFIX = "masks/"


@dataclass
class MaskResolution:
    ok: bool
    mask_url: Optional[str] = None
    question: Optional[str] = None
    error: Optional[str] = None
    tier: Optional[str] = None
    # True when a mask WAS derived but must be shown to the user for approval
    # before it is applied. Always paired with ok=False and a populated
    # mask_url -- the caller round-trips that URL back in on confirmation.
    needs_confirmation: bool = False


def _alpha_to_mask(cutout: PILImage.Image) -> PILImage.Image:
    """RGBA cutout -> binary L-mode mask, white where the subject is opaque."""
    alpha = cutout.convert("RGBA").getchannel("A")
    return alpha.point(lambda a: 255 if a >= _ALPHA_THRESHOLD else 0, mode="L")


def _binarise(mask: PILImage.Image) -> PILImage.Image:
    """Force an L-mode mask to strictly two levels, 0 and 255.

    The segmenter greys one level per matched instance (0/211/255 observed for
    a two-car image). flux-fill reads a grey pixel as partial alpha and returns
    a half-blended ghost of the original, so every non-black pixel has to be
    pushed all the way to 255.
    """
    return mask.point(lambda v: 255 if v > 0 else 0, mode="L")


async def _upload_mask(mask: PILImage.Image) -> str:
    buf = io.BytesIO()
    mask.save(buf, format="PNG")
    buf.seek(0)
    return await upload_bytes(buf.read(), f"{_MASK_KEY_PREFIX}{uuid.uuid4().hex}.png", "image/png")


async def _segment_by_prompt(image_url: str, target: str) -> str:
    """Segment the named object on Replicate and return the uploaded mask URL."""
    output = await _replicate_run(
        _SEGMENTER_MODEL,
        {_SEGMENTER_IMAGE_FIELD: image_url, _SEGMENTER_PROMPT_FIELD: target},
        # This model has no hot deployment, so the pinned version is mandatory.
        version=_SEGMENTER_VERSION,
    )
    mask = PILImage.open(io.BytesIO(await _download(output))).convert("L")
    if _SEGMENTER_INVERTS:
        mask = ImageOps.invert(mask)
    # Binarise LAST: inverting a grey level yields another grey level.
    return await _upload_mask(_binarise(mask))


def is_own_storage_url(url: str) -> bool:
    """True only for a mask URL this deployment itself produced.

    Tasks 4 and 5 accept a client-supplied `mask_url` on the confirmation
    round-trip and then fetch it server-side, which is a request-forgery
    primitive unless the target is constrained. Two shapes are ours: the
    base64 `data:` URL upload_bytes falls back to when S3 is unconfigured, and
    a key under `masks/` on our own bucket. Anything else -- another host, or
    our own bucket outside `masks/` -- is refused.
    """
    if not url or not isinstance(url, str):
        return False
    if url.startswith("data:"):
        return True
    if not _s3_configured():
        # Unconfigured storage makes _public_url("") degenerate to a prefix
        # with an empty bucket, which would match far too much. Nothing but a
        # data: URL can be ours in that configuration.
        return False
    prefix = _public_url("")
    if not url.startswith(prefix):
        return False
    return url[len(prefix):].startswith(_MASK_KEY_PREFIX)


async def resolve_mask(image_url: str, operation: str, target: Optional[str],
                       org_id, db) -> MaskResolution:
    """Derive a mask for `operation` on `image_url`.

    Callers must only reach here when no painted mask was supplied -- a
    deliberate user selection always wins over an inferred one.
    """
    if not target and operation in AMBIGUOUS_WITHOUT_TARGET:
        # Ask BEFORE spending anything: no supplier call has happened yet.
        return MaskResolution(ok=False, question=AMBIGUITY_QUESTION)

    try:
        if target:
            # ok=False on purpose: the segmenter cannot say "no match", so the
            # user confirms the region before a paid edit runs on it.
            return MaskResolution(ok=False, needs_confirmation=True, tier="prompted",
                                  mask_url=await _segment_by_prompt(image_url, target))

        cutout = await _removebg_cutout(image_url)
        await record_removebg(db, org_id=org_id, project_id=None, feature="auto_mask")
        mask = _alpha_to_mask(cutout)
        if operation in _INVERT_FOR_PRODUCT_TIER:
            mask = ImageOps.invert(mask)
        return MaskResolution(ok=True, tier="product", mask_url=await _upload_mask(mask))
    except Exception as e:  # noqa: BLE001
        return MaskResolution(ok=False, error=str(e))
