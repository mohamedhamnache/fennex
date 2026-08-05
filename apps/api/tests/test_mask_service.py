import io
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from PIL import Image as PILImage

from app.core import storage
from app.core.config import settings
from app.services import mask_service
from app.services.mask_service import MaskResolution, is_own_storage_url, resolve_mask


def _source_bytes(size=(8, 8)) -> bytes:
    """Source bytes for the dimension probe resolve_mask now performs. Matches
    _cutout()'s size so no resize is triggered in the existing assertions."""
    buf = io.BytesIO()
    PILImage.new("RGB", size, (9, 9, 9)).save(buf, format="PNG")
    return buf.getvalue()


def _cutout(size=(8, 8)) -> PILImage.Image:
    """RGBA cutout: left half opaque subject, right half transparent background."""
    img = PILImage.new("RGBA", size, (255, 0, 0, 255))
    for x in range(size[0] // 2, size[0]):
        for y in range(size[1]):
            img.putpixel((x, y), (0, 0, 0, 0))
    return img


def _uploaded_mask(mock_upload) -> PILImage.Image:
    """Reconstruct the L-mode mask handed to the uploader."""
    (img,), _ = mock_upload.call_args
    return img


# The greyscale probe masks below are one row of len(levels) pixels. Passing
# their own size as source_size keeps _fit_to_source a no-op, so the level
# assertions test binarisation rather than resampling.
_MASK_PROBE_SIZE = (3, 1)


def _png_bytes(levels) -> bytes:
    """Encode a 1-row greyscale PNG with one pixel per level."""
    img = PILImage.new("L", (len(levels), 1))
    for x, level in enumerate(levels):
        img.putpixel((x, 0), level)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ---- alpha -> binary mask -------------------------------------------------

def test_alpha_to_mask_marks_opaque_pixels_white():
    mask = mask_service._alpha_to_mask(_cutout())
    assert mask.mode == "L"
    assert mask.getpixel((0, 0)) == 255   # subject
    assert mask.getpixel((7, 0)) == 0     # background


def test_alpha_to_mask_thresholds_semi_transparent_pixels():
    img = PILImage.new("RGBA", (3, 1), (255, 0, 0, 0))
    img.putpixel((0, 0), (255, 0, 0, 10))    # nearly transparent -> black
    img.putpixel((1, 0), (255, 0, 0, 200))   # nearly opaque -> white
    img.putpixel((2, 0), (255, 0, 0, 128))   # exactly at threshold -> white
    mask = mask_service._alpha_to_mask(img)
    assert (mask.getpixel((0, 0)), mask.getpixel((1, 0)), mask.getpixel((2, 0))) == (0, 255, 255)


# ---- polarity table -------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("operation,expect_subject_white", [
    ("replace_background", False),  # white = background; the only product-tier op
])
async def test_product_tier_polarity(operation, expect_subject_white):
    upload = AsyncMock(return_value="https://cdn/mask.png")
    with patch("app.services.mask_service._download", AsyncMock(return_value=_source_bytes())), \
         patch("app.services.mask_service.birefnet_cutout", AsyncMock(return_value=_cutout())), \
         patch("app.services.mask_service._upload_mask", upload), \
         patch("app.services.metering.meter.record_replicate", AsyncMock(return_value=200_000)):
        res = await resolve_mask("https://cdn/x.png", operation, None, uuid.uuid4(), None)

    assert res.ok is True
    assert res.tier == "product"
    mask = _uploaded_mask(upload)
    subject_px, background_px = mask.getpixel((0, 0)), mask.getpixel((7, 0))
    assert (subject_px == 255) is expect_subject_white
    assert (background_px == 255) is (not expect_subject_white)


# ---- tier selection -------------------------------------------------------

@pytest.mark.asyncio
async def test_absent_target_uses_the_free_product_tier():
    segment = AsyncMock(return_value="https://cdn/seg.png")
    with patch("app.services.mask_service._download", AsyncMock(return_value=_source_bytes())), \
         patch("app.services.mask_service.birefnet_cutout", AsyncMock(return_value=_cutout())), \
         patch("app.services.mask_service._upload_mask", AsyncMock(return_value="https://cdn/m.png")), \
         patch("app.services.metering.meter.record_replicate", AsyncMock(return_value=0)), \
         patch("app.services.mask_service._segment_by_prompt", segment):
        res = await resolve_mask("https://cdn/x.png", "replace_background", None, uuid.uuid4(), None)

    assert res.tier == "product"
    segment.assert_not_awaited()


@pytest.mark.asyncio
async def test_present_target_uses_the_prompted_tier():
    cutout = AsyncMock(return_value=_cutout())
    segment = AsyncMock(return_value="https://cdn/seg.png")
    with patch("app.services.mask_service._download", AsyncMock(return_value=_source_bytes())), \
         patch("app.services.mask_service.birefnet_cutout", cutout), \
         patch("app.services.mask_service._segment_by_prompt", segment):
        res = await resolve_mask("https://cdn/x.png", "remove_object",
                                 "the person on the left", uuid.uuid4(), None)

    # The segmenter has no no-match signal, so the prompted tier never reports
    # success on its own -- the caller must show the mask for approval first.
    assert res.ok is False
    assert res.needs_confirmation is True
    assert res.tier == "prompted"
    assert res.mask_url == "https://cdn/seg.png"
    cutout.assert_not_awaited()  # never pays for the free tier it did not use
    # Both arguments are URL-ish strings, so transposing them still runs and
    # still returns a mask -- it just segments the wrong thing. Pin the order.
    segment.assert_awaited_once_with("https://cdn/x.png", "the person on the left", (8, 8))


@pytest.mark.asyncio
async def test_product_tier_does_not_need_confirmation():
    with patch("app.services.mask_service._download", AsyncMock(return_value=_source_bytes())), \
         patch("app.services.mask_service.birefnet_cutout", AsyncMock(return_value=_cutout())), \
         patch("app.services.mask_service._upload_mask", AsyncMock(return_value="https://cdn/m.png")), \
         patch("app.services.metering.meter.record_replicate", AsyncMock(return_value=0)):
        res = await resolve_mask("https://cdn/x.png", "replace_background", None,
                                 uuid.uuid4(), None)

    assert res.ok is True
    assert res.needs_confirmation is False


# ---- metering -------------------------------------------------------------

@pytest.mark.asyncio
async def test_product_tier_tags_its_removebg_call_as_auto_mask():
    """Metering itself now lives inside _replicate_run, at the supplier
    chokepoint, so every caller is covered and none is billed twice (see
    tests/test_metering_replicate.py). What this layer still owns is the TAG, which
    lets the cost dashboard separate auto-masking from the user-initiated
    background removals that share the removebg provider."""
    cutout = AsyncMock(return_value=_cutout())
    with patch("app.services.mask_service._download", AsyncMock(return_value=_source_bytes())), \
         patch("app.services.mask_service.birefnet_cutout", cutout), \
         patch("app.services.mask_service._upload_mask", AsyncMock(return_value="https://cdn/m.png")):
        res = await resolve_mask("https://cdn/x.png", "replace_background", None,
                                 uuid.uuid4(), object())

    assert res.ok is True
    assert cutout.call_args.kwargs["feature"] == "auto_mask"


@pytest.mark.asyncio
async def test_prompted_tier_does_not_meter_the_cutout_model():
    record = AsyncMock()
    with patch("app.services.mask_service._download", AsyncMock(return_value=_source_bytes())), \
         patch("app.services.mask_service._segment_by_prompt",
               AsyncMock(return_value="https://cdn/seg.png")), \
         patch("app.services.metering.meter.record_replicate", record):
        await resolve_mask("https://cdn/x.png", "remove_object", "the car",
                           uuid.uuid4(), None)

    record.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_failed_cutout_call_bills_nothing():
    """A supplier that raised did not process an image, so it must not bill.

    Holds only because metering happens inside _replicate_run's success branch,
    after the prediction succeeds; nothing but this test stops a refactor from
    billing a call that never produced anything.
    """
    record = AsyncMock()
    with patch("app.services.mask_service._download", AsyncMock(return_value=_source_bytes())), \
         patch("app.services.mask_service.birefnet_cutout",
               AsyncMock(side_effect=RuntimeError("replicate 422"))), \
         patch("app.services.metering.meter.record_replicate", record):
        res = await resolve_mask("https://cdn/x.png", "replace_background", None,
                                 uuid.uuid4(), None)

    assert res.ok is False
    record.assert_not_awaited()


@pytest.mark.asyncio
async def test_an_ambiguous_request_meters_nothing():
    record = AsyncMock()
    with patch("app.services.metering.meter.record_replicate", record):
        res = await resolve_mask("https://cdn/x.png", "insert_object", None,
                                 uuid.uuid4(), None)

    assert res.ok is False
    record.assert_not_awaited()


# ---- segmenter output binarisation ----------------------------------------

@pytest.mark.asyncio
async def test_segmenter_output_is_binarised():
    """The segmenter greys one level per matched instance (observed 0/211/255).

    flux-fill reads grey as partial alpha and returns a half-blended ghost, so
    every non-black pixel has to be pushed to a full 255.
    """
    upload = AsyncMock(return_value="https://cdn/seg.png")
    with patch("app.services.mask_service._replicate_run", AsyncMock(return_value="https://cdn/raw.png")), \
         patch("app.services.mask_service._download", AsyncMock(return_value=_png_bytes([0, 211, 255]))), \
         patch("app.services.mask_service._upload_mask", upload):
        url = await mask_service._segment_by_prompt("https://cdn/x.png", "the car", _MASK_PROBE_SIZE)

    assert url == "https://cdn/seg.png"
    mask = _uploaded_mask(upload)
    levels = [mask.getpixel((x, 0)) for x in range(3)]
    assert set(levels) == {0, 255}
    assert levels == [0, 255, 255]


@pytest.mark.asyncio
async def test_segmenter_output_is_binarised_after_inverting(monkeypatch):
    """Pin the ORDER of the invert and binarise steps, not just their presence.

    At the live _SEGMENTER_INVERTS = False the invert branch never runs, so the
    test above passes whichever side of the `if` _binarise sits on. Forcing the
    invert on separates the two orderings by exact value:

      invert -> binarise:  [0, 211, 255] -> [255, 44, 0]  -> [255, 255, 0]
      binarise -> invert:  [0, 211, 255] -> [0, 255, 255] -> [255, 0, 0]

    Both are two-level, so only the exact pixels distinguish them. The module
    mandates invert-then-binarise; [255, 255, 0] is that.

    Note this also shows why the mandated order is only sound for a segmenter
    whose output is already binary when it inverts -- here the background has
    gone white and one matched instance has gone black. See the constraint
    comment in _segment_by_prompt before flipping _SEGMENTER_INVERTS.
    """
    monkeypatch.setattr(mask_service, "_SEGMENTER_INVERTS", True)
    upload = AsyncMock(return_value="https://cdn/seg.png")
    with patch("app.services.mask_service._replicate_run", AsyncMock(return_value="https://cdn/raw.png")), \
         patch("app.services.mask_service._download", AsyncMock(return_value=_png_bytes([0, 211, 255]))), \
         patch("app.services.mask_service._upload_mask", upload):
        await mask_service._segment_by_prompt("https://cdn/x.png", "the car", _MASK_PROBE_SIZE)

    mask = _uploaded_mask(upload)
    levels = [mask.getpixel((x, 0)) for x in range(3)]
    assert set(levels) == {0, 255}
    assert levels == [255, 255, 0]


@pytest.mark.asyncio
async def test_segmenter_is_called_with_the_pinned_version():
    run = AsyncMock(return_value="https://cdn/raw.png")
    with patch("app.services.mask_service._replicate_run", run), \
         patch("app.services.mask_service._download", AsyncMock(return_value=_png_bytes([0, 255]))), \
         patch("app.services.mask_service._upload_mask", AsyncMock(return_value="https://cdn/seg.png")):
        await mask_service._segment_by_prompt("https://cdn/x.png", "the car", _MASK_PROBE_SIZE)

    args, kwargs = run.call_args
    assert args[0] == mask_service._SEGMENTER_MODEL
    assert args[1] == {
        mask_service._SEGMENTER_IMAGE_FIELD: "https://cdn/x.png",
        mask_service._SEGMENTER_PROMPT_FIELD: "the car",
    }
    # No hot deployment for this model, so the version hash is mandatory.
    assert kwargs["version"] == mask_service._SEGMENTER_VERSION
    assert mask_service._SEGMENTER_VERSION


# ---- ambiguity gate -------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["insert_object", "generative_fill"])
async def test_ambiguous_operations_ask_and_spend_nothing(operation):
    cutout, segment = AsyncMock(), AsyncMock()
    with patch("app.services.mask_service._download", AsyncMock(return_value=_source_bytes())), \
         patch("app.services.mask_service.birefnet_cutout", cutout), \
         patch("app.services.mask_service._segment_by_prompt", segment):
        res = await resolve_mask("https://cdn/x.png", operation, None, uuid.uuid4(), None)

    assert res.ok is False
    assert res.question == mask_service.AMBIGUITY_QUESTION
    cutout.assert_not_awaited()
    segment.assert_not_awaited()


@pytest.mark.asyncio
async def test_ambiguous_operation_with_a_target_resolves_normally():
    with patch("app.services.mask_service._download", AsyncMock(return_value=_source_bytes())), \
         patch("app.services.mask_service._segment_by_prompt",
               AsyncMock(return_value="https://cdn/seg.png")):
        res = await resolve_mask("https://cdn/x.png", "insert_object",
                                 "the empty shelf", uuid.uuid4(), None)
    assert res.ok is False
    assert res.needs_confirmation is True
    assert res.mask_url == "https://cdn/seg.png"


# ---- failure -------------------------------------------------------------

@pytest.mark.asyncio
async def test_supplier_failure_returns_an_error_not_an_exception():
    with patch("app.services.mask_service._download", AsyncMock(return_value=_source_bytes())), \
         patch("app.services.mask_service.birefnet_cutout",
               AsyncMock(side_effect=RuntimeError("replicate 422"))):
        res = await resolve_mask("https://cdn/x.png", "replace_background", None,
                                 uuid.uuid4(), None)
    assert res.ok is False
    assert res.question is None
    assert "replicate 422" in res.error


# ---- own-storage URL guard ------------------------------------------------

@pytest.fixture
def s3_endpoint_storage(monkeypatch):
    """Configure the Supabase-style endpoint shape of _public_url."""
    monkeypatch.setattr(settings, "S3_BUCKET", "fennex-media")
    monkeypatch.setattr(settings, "S3_ACCESS_KEY", "key")
    monkeypatch.setattr(settings, "S3_SECRET_KEY", "secret")
    monkeypatch.setattr(settings, "S3_ENDPOINT_URL", "https://abc.supabase.co/storage/v1/s3")


@pytest.fixture
def s3_aws_storage(monkeypatch):
    """Configure the plain-AWS shape of _public_url."""
    monkeypatch.setattr(settings, "S3_BUCKET", "fennex-media")
    monkeypatch.setattr(settings, "S3_ACCESS_KEY", "key")
    monkeypatch.setattr(settings, "S3_SECRET_KEY", "secret")
    monkeypatch.setattr(settings, "S3_REGION", "eu-west-3")
    monkeypatch.setattr(settings, "S3_ENDPOINT_URL", "")


def test_is_own_storage_url_accepts_a_generated_mask_url(s3_endpoint_storage):
    url = storage._public_url(f"masks/{uuid.uuid4().hex}.png")
    assert is_own_storage_url(url) is True


def test_is_own_storage_url_accepts_a_generated_mask_url_on_aws(s3_aws_storage):
    url = storage._public_url(f"masks/{uuid.uuid4().hex}.png")
    assert is_own_storage_url(url) is True


def test_is_own_storage_url_accepts_a_data_url():
    assert is_own_storage_url("data:image/png;base64,iVBORw0KGgo=") is True


def test_is_own_storage_url_rejects_an_external_host(s3_endpoint_storage):
    assert is_own_storage_url("https://evil.example.com/masks/x.png") is False
    # Server-side request forgery: the loopback target is the whole point.
    assert is_own_storage_url("http://169.254.169.254/latest/meta-data/") is False


def test_is_own_storage_url_rejects_same_prefix_outside_masks(s3_endpoint_storage):
    assert is_own_storage_url(storage._public_url("uploads/secret.png")) is False
    # A key that merely mentions masks/ deeper down is not under masks/.
    assert is_own_storage_url(storage._public_url("uploads/masks/secret.png")) is False


def test_is_own_storage_url_rejects_path_traversal_out_of_masks(s3_aws_storage):
    """masks/../uploads/x.png starts with masks/ but does not stay there.

    httpx normalises the path away before the fetch, so the key that actually
    gets requested is uploads/x.png -- another tenant's object. Host
    confinement still holds, but the masks/ constraint is the whole point of
    the guard.
    """
    assert is_own_storage_url(
        "https://fennex-media.s3.eu-west-3.amazonaws.com/masks/../uploads/other-org.png"
    ) is False
    assert is_own_storage_url(storage._public_url("masks/../uploads/other-org.png")) is False
    # Percent-encoded traversal must not slip past a raw substring check.
    assert is_own_storage_url(storage._public_url("masks/%2e%2e/uploads/other-org.png")) is False
    assert is_own_storage_url(storage._public_url("masks/a/../../uploads/x.png")) is False


def test_is_own_storage_url_rejects_userinfo_and_bucket_prefix_confusion(s3_aws_storage):
    """Regressions the guard already resists -- keep them resisted."""
    # userinfo trick: the real host is evil.com.
    assert is_own_storage_url(
        "https://fennex-media.s3.eu-west-3.amazonaws.com@evil.com/masks/x.png"
    ) is False
    # A different bucket that merely shares our bucket's name as a prefix.
    assert is_own_storage_url(
        "https://fennex.s3.eu-west-3.amazonaws.com/masks/x.png"
    ) is False


def test_is_own_storage_url_rejects_junk(s3_endpoint_storage):
    assert is_own_storage_url("") is False
    assert is_own_storage_url(None) is False


def test_is_own_storage_url_rejects_non_data_urls_when_storage_is_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "S3_BUCKET", "")
    monkeypatch.setattr(settings, "S3_ACCESS_KEY", "")
    monkeypatch.setattr(settings, "S3_SECRET_KEY", "")
    # With no bucket the prefix degenerates to "https://.s3.../"; nothing but a
    # data: URL is ours in that configuration.
    assert is_own_storage_url("https://.s3.us-east-1.amazonaws.com/masks/x.png") is False
    assert is_own_storage_url("data:image/png;base64,iVBORw0KGgo=") is True


# ---- operation table ------------------------------------------------------

def test_mask_operations_table():
    assert mask_service.MASK_OPERATIONS == frozenset({
        "replace_background", "remove_object", "insert_object",
        "generative_fill", "smart_erase",
    })
    # Removal joined the ambiguous set: "remove the mint" with no target made the
    # product tier mask the main subject (the bottle) and erase it.
    assert mask_service.AMBIGUOUS_WITHOUT_TARGET == frozenset({
        "insert_object", "generative_fill", "remove_object", "smart_erase",
    })
    # replace_background is the ONLY operation with a derivable default region.
    assert mask_service.MASK_OPERATIONS - mask_service.AMBIGUOUS_WITHOUT_TARGET == \
        frozenset({"replace_background"})
    assert mask_service.AMBIGUOUS_WITHOUT_TARGET <= mask_service.MASK_OPERATIONS


def test_mask_resolution_defaults():
    res = MaskResolution(ok=True)
    assert (res.mask_url, res.question, res.error, res.tier) == (None, None, None, None)
    assert res.needs_confirmation is False


def test_fit_to_source_resizes_a_mismatched_mask():
    """A mask whose size differs from the image is not a soft error: LaMa
    accepts it, reports succeeded, and returns a NULL output. Verified against
    the live model (512x512 mask on an 800x600 image -> null output), which is
    exactly the "succeeded but returned no output" users hit."""
    mask = PILImage.new("L", (512, 512), 255)
    fitted = mask_service._fit_to_source(mask, (800, 600))
    assert fitted.size == (800, 600)


def test_fit_to_source_leaves_a_matching_mask_untouched():
    mask = PILImage.new("L", (800, 600), 255)
    assert mask_service._fit_to_source(mask, (800, 600)) is mask


def test_fit_to_source_keeps_the_mask_binary():
    """NEAREST, not LANCZOS: interpolation would introduce grey values and break
    the binary invariant _binarise exists to guarantee."""
    mask = PILImage.new("L", (4, 4), 0)
    mask.putpixel((1, 1), 255)
    mask.putpixel((2, 2), 255)
    fitted = mask_service._fit_to_source(mask, (37, 29))
    assert set(fitted.getdata()) <= {0, 255}


@pytest.mark.asyncio
async def test_product_tier_fits_a_downscaled_cutout_back_to_the_source():
    """Remove.bg's size:"auto" downscales on lower tiers, so the cutout -- and
    therefore the derived mask -- can be smaller than the image it came from."""
    small = _cutout((16, 12))          # supplier returned a smaller cutout
    upload = AsyncMock(return_value="https://cdn/mask.png")
    with patch("app.services.mask_service._download",
               AsyncMock(return_value=_source_bytes((64, 48)))), \
         patch("app.services.mask_service.birefnet_cutout", AsyncMock(return_value=small)), \
         patch("app.services.mask_service._upload_mask", upload), \
         patch("app.services.metering.meter.record_replicate", AsyncMock(return_value=0)):
        res = await resolve_mask("https://cdn/x.png", "replace_background", None,
                                 uuid.uuid4(), None)

    assert res.ok is True
    (mask,), _ = upload.call_args
    assert mask.size == (64, 48), "mask must match the SOURCE, not the cutout"


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["remove_object", "smart_erase"])
async def test_untargeted_removal_asks_instead_of_erasing_the_main_subject(operation):
    """The reported disaster: "remove the mint" with no target made the product
    tier mask the BOTTLE (Remove.bg's alpha is the main subject) and erase it,
    leaving the mint untouched. Removal with no target must ask, not guess."""
    cutout, segment = AsyncMock(), AsyncMock()
    with patch("app.services.mask_service._download", AsyncMock(return_value=_source_bytes())), \
         patch("app.services.mask_service.birefnet_cutout", cutout), \
         patch("app.services.mask_service._segment_by_prompt", segment):
        res = await resolve_mask("https://cdn/x.png", operation, None, uuid.uuid4(), None)

    assert res.ok is False
    assert res.question == mask_service.AMBIGUITY_QUESTION
    cutout.assert_not_awaited()   # and it spends nothing while asking
    segment.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["remove_object", "smart_erase"])
async def test_targeted_removal_goes_to_the_segmenter_and_asks_for_confirmation(operation):
    with patch("app.services.mask_service._download", AsyncMock(return_value=_source_bytes())), \
         patch("app.services.mask_service._segment_by_prompt",
               AsyncMock(return_value="https://cdn/seg.png")):
        res = await resolve_mask("https://cdn/x.png", operation, "la menthe",
                                 uuid.uuid4(), None)

    assert res.tier == "prompted"
    assert res.needs_confirmation is True
    assert res.mask_url == "https://cdn/seg.png"


async def test_the_auto_mask_tag_survives_the_supplier_switch():
    """The product-tier mask must still be billed as `auto_mask`.

    _replicate_run tags everything `image_edit` by default, so moving the mask
    onto it would have silently merged an auto-derived mask into ordinary edit
    spend. The caller passes the tag explicitly; this pins that it arrives.
    """
    from unittest.mock import AsyncMock, patch

    seen: dict = {}

    async def fake_replicate(model, params, version=None, feature="image_edit"):
        seen["model"], seen["feature"] = model, feature
        return "https://example.com/cut.png"

    import io as _io
    from PIL import Image as _Image
    buf = _io.BytesIO()
    _Image.new("RGBA", (40, 30), (0, 0, 0, 255)).save(buf, format="PNG")
    png = buf.getvalue()

    with patch("app.services.editing_service._replicate_run", fake_replicate), \
         patch("app.services.editing_service._download", AsyncMock(return_value=png)):
        from app.services.editing_service import birefnet_cutout
        await birefnet_cutout("https://example.com/src.png", feature="auto_mask")

    assert seen["feature"] == "auto_mask", "the mask must not bill as a generic edit"
    assert "birefnet" in seen["model"], "the mask must come from BiRefNet, not Remove.bg"


async def test_remove_bg_is_gone_from_the_codebase():
    """No code path may reach Remove.bg.

    It was 191 credits a call against BiRefNet's 10, for a segmentation that
    measured the same, and its `size: "auto"` default silently returned a
    quarter-megapixel result for weeks. Leaving the helper in place would let
    it be reused with that default intact.
    """
    import app.services.editing_service as es
    import app.services.mask_service as ms

    assert not hasattr(es, "_removebg_cutout"), "the Remove.bg helper is deleted"
    for mod in (es, ms):
        src = __import__("inspect").getsource(mod)
        assert "api.remove.bg" not in src, f"{mod.__name__} still calls Remove.bg"
