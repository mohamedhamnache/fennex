"""Remove BG returns the source resolution, or fails loudly.

Measured against the production database on 2026-08-03, every user-facing
Remove BG result was exactly 0.25 megapixels -- remove.bg's preview tier,
reached because the call passed `size: "auto"` and the account's credits
resolved it to preview:

    2160x2160 -> 500x500      1024x1024 -> 500x500
    1080x1920 -> 408x612      1792x1024 -> 559x447

The customer paid 191 AI credits for a quarter-megapixel image, and nothing
noticed because `remove_background` uploaded its result directly with no
ResolutionPolicy at all.

These tests pin the fix: BiRefNet at the source frame, asserted, at
MIN_REPLICATE_CREDITS instead of $0.20 flat.

Remove.bg is now gone from the product entirely. mask_service was its last
caller and takes BiRefNet's alpha instead, measured on 2026-08-05 as the same
segmentation to within 0.1 percentage points of coverage -- so the last test
here holds that no code path reaches the supplier at all.
"""
import io
from unittest.mock import AsyncMock, patch

import pytest
from PIL import Image

from app.services import editing_service
from app.services.image_output import ResolutionMismatch, ResolutionPolicy, StoredImage


def _png(size=(1792, 1024), mode="RGB") -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, (10, 20, 30)).save(buf, format="PNG")
    return buf.getvalue()


def test_birefnet_identifier_is_the_one_verified_against_replicate():
    """Verified live against the Replicate API on 2026-08-03/04."""
    assert editing_service._MODEL_BIREFNET == "men1scus/birefnet"
    assert editing_service._BIREFNET_VERSION == (
        "f74986db0355b58403ed20963af156525e2891ea3c2d499bfbfb2a28cd87c5d7"
    )


@pytest.mark.asyncio
async def test_remove_background_calls_birefnet_not_removebg():
    run = AsyncMock(return_value="https://replicate/out.png")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png())), \
         patch("app.services.editing_service.finalize",
               AsyncMock(return_value=StoredImage("https://cdn/out.png", 1792, 1024))):
        result = await editing_service.remove_background("https://cdn/in.png")

    assert result["ok"] is True
    # There is no longer a Remove.bg helper to assert against -- see
    # test_masks_now_come_from_birefnet_too, which pins that it is gone.
    (model, params), kwargs = run.call_args
    assert model == editing_service._MODEL_BIREFNET
    assert kwargs["version"] == editing_service._BIREFNET_VERSION
    # The supplier is told the frame to produce; nothing is left to a default
    # that could resolve to a preview tier the way remove.bg's "auto" did.
    assert params["resolution"] == "1792x1024"
    assert result["width"] == 1792 and result["height"] == 1024


@pytest.mark.asyncio
async def test_remove_background_asserts_the_source_frame():
    """The size is measured from the source BYTES, never taken from the
    database row: two of the four measured parents carry a width/height that
    does not match their own stored file, so a row-derived assertion would
    fire on correct output and pass on wrong output."""
    fin = AsyncMock(return_value=StoredImage("https://cdn/out.png", 1080, 1920))
    with patch("app.services.editing_service._replicate_run",
               AsyncMock(return_value="https://replicate/out.png")), \
         patch("app.services.editing_service._download",
               AsyncMock(return_value=_png((1080, 1920)))), \
         patch("app.services.editing_service.finalize", fin):
        await editing_service.remove_background("https://cdn/in.png")

    assert fin.call_args.kwargs["source_size"] == (1080, 1920)
    assert fin.call_args.kwargs["policy"] is ResolutionPolicy.PRESERVE


@pytest.mark.asyncio
async def test_remove_background_does_not_take_a_source_size_from_the_caller():
    """The /edit router passes source_size to any operation that declares it,
    reading it off the database row. That row can be wrong (measured: a row
    saying 1792x1024 whose file is 2080x1664), so this operation must not
    accept one."""
    import inspect
    assert "source_size" not in inspect.signature(editing_service.remove_background).parameters


@pytest.mark.asyncio
async def test_a_resolution_mismatch_raises_instead_of_storing():
    """A silent downscale is exactly what hid this bug for weeks. Nothing may
    be uploaded when the supplier returns the wrong frame."""
    uploaded = AsyncMock(return_value="https://cdn/should-not-exist.png")
    with patch("app.services.editing_service._replicate_run",
               AsyncMock(return_value="https://replicate/out.png")), \
         patch("app.services.editing_service._download",
               AsyncMock(return_value=_png((1792, 1024)))), \
         patch("app.services.image_output._download",
               AsyncMock(return_value=_png((559, 447), mode="RGBA"))), \
         patch("app.services.image_output.upload_bytes", uploaded):
        with pytest.raises(ResolutionMismatch):
            await editing_service.remove_background("https://cdn/in.png")

    assert uploaded.await_count == 0, "a mismatched result must never be stored"


@pytest.mark.asyncio
async def test_a_storage_failure_is_still_a_soft_error():
    """finalize does two network operations -- it downloads the Replicate
    output and uploads to storage -- so a slow CDN or an S3 5xx runs through
    it. Only ResolutionMismatch is loud: everything else keeps the
    {"ok": False} contract the /edit router turns into EditOut(ok=False),
    rather than an unhandled 500."""
    with patch("app.services.editing_service._replicate_run",
               AsyncMock(return_value="https://replicate/out.png")), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png())), \
         patch("app.services.editing_service.finalize",
               AsyncMock(side_effect=RuntimeError("S3 503 Service Unavailable"))):
        result = await editing_service.remove_background("https://cdn/in.png")

    assert result["ok"] is False
    assert "503" in result["error"]


@pytest.mark.asyncio
async def test_masks_now_come_from_birefnet_too():
    """The last Remove.bg caller.

    mask_service's product tier used to derive its mask from Remove.bg's alpha.
    Measured on real images (2026-08-05) the two segmentations agree to within
    0.1 percentage points of coverage -- but Remove.bg returned 0.25 MP, so the
    mask was upscaled back with NEAREST and its boundary came out stair-stepped,
    at 191 credits against BiRefNet's 10. Nothing reaches the supplier now.
    """
    import inspect
    assert not hasattr(editing_service, "_removebg_cutout")
    src = inspect.getsource(editing_service)
    assert "api.remove.bg" not in src, "no code path may call Remove.bg"
