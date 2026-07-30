import io
from unittest.mock import AsyncMock, patch

import pytest
from PIL import Image as PILImage

from app.services import image_output
from app.services.image_output import ResolutionMismatch, ResolutionPolicy, dimensions, finalize


def _png(size=(64, 48), mode="RGB") -> bytes:
    buf = io.BytesIO()
    PILImage.new(mode, size, (10, 20, 30) if mode == "RGB" else (10, 20, 30, 255)).save(buf, format="PNG")
    return buf.getvalue()


def _jpg(size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    PILImage.new("RGB", size, (10, 20, 30)).save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def test_dimensions_reads_the_header_without_decoding():
    assert dimensions(_png((123, 77))) == (123, 77)
    assert dimensions(_jpg((200, 100))) == (200, 100)


@pytest.mark.asyncio
async def test_matching_size_passes_the_original_bytes_through_untouched():
    """The single largest quality win: no decode, no re-encode, no mode change."""
    raw = _jpg((64, 48))
    up = AsyncMock(return_value="https://cdn/out.jpg")
    with patch("app.services.image_output._download", AsyncMock(return_value=raw)), \
         patch("app.services.image_output.upload_bytes", up):
        await finalize("https://replicate/out.jpg", source_size=(64, 48))

    sent = up.call_args.args[0]
    assert sent == raw  # byte-identical, not re-encoded


@pytest.mark.asyncio
async def test_rgb_output_is_not_converted_to_rgba():
    raw = _png((32, 32), mode="RGB")
    up = AsyncMock(return_value="https://cdn/out.png")
    with patch("app.services.image_output._download", AsyncMock(return_value=raw)), \
         patch("app.services.image_output.upload_bytes", up):
        await finalize("https://replicate/out.png", source_size=(32, 32))

    assert PILImage.open(io.BytesIO(up.call_args.args[0])).mode == "RGB"


@pytest.mark.asyncio
async def test_preserve_policy_raises_when_the_model_downscaled():
    """Today this silently returns a smaller image."""
    with patch("app.services.image_output._download", AsyncMock(return_value=_png((512, 640)))), \
         patch("app.services.image_output.upload_bytes", AsyncMock()):
        with pytest.raises(ResolutionMismatch) as exc:
            await finalize("https://replicate/out.png", source_size=(2000, 1500))
    assert "512x640" in str(exc.value) and "2000x1500" in str(exc.value)


@pytest.mark.asyncio
async def test_upscale_policy_resizes_back_to_the_source_size():
    up = AsyncMock(return_value="https://cdn/out.png")
    with patch("app.services.image_output._download", AsyncMock(return_value=_png((100, 50)))), \
         patch("app.services.image_output.upload_bytes", up):
        await finalize("https://replicate/out.png", source_size=(200, 100),
                       policy=ResolutionPolicy.UPSCALE)

    assert PILImage.open(io.BytesIO(up.call_args.args[0])).size == (200, 100)


@pytest.mark.asyncio
async def test_allow_change_policy_accepts_a_different_size_untouched():
    """For operations whose whole purpose is changing size (resize, upscale)."""
    raw = _png((400, 300))
    up = AsyncMock(return_value="https://cdn/out.png")
    with patch("app.services.image_output._download", AsyncMock(return_value=raw)), \
         patch("app.services.image_output.upload_bytes", up):
        await finalize("https://replicate/out.png", source_size=(100, 75),
                       policy=ResolutionPolicy.ALLOW_CHANGE)

    assert up.call_args.args[0] == raw


@pytest.mark.asyncio
async def test_no_source_size_skips_the_assertion_entirely():
    raw = _png((7, 7))
    up = AsyncMock(return_value="https://cdn/out.png")
    with patch("app.services.image_output._download", AsyncMock(return_value=raw)), \
         patch("app.services.image_output.upload_bytes", up):
        await finalize("https://replicate/out.png")
    assert up.call_args.args[0] == raw


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["", "   ", "None", "masks/abc.png", None, 123])
async def test_download_rejects_non_urls_with_a_message_naming_the_value(bad):
    """httpx's own error ("Request URL is missing an 'http://' or 'https://'
    protocol") names neither the value nor the caller, which sent a user
    chasing a mask bug that was really a bad URL."""
    with pytest.raises(ValueError) as exc:
        await image_output._download(bad)
    assert "URL" in str(exc.value)


@pytest.mark.asyncio
async def test_download_still_accepts_the_three_valid_shapes():
    raw = _png((8, 8))
    with patch("app.services.image_output.httpx.AsyncClient") as client:
        client.return_value.__aenter__.return_value.get = AsyncMock(
            return_value=type("R", (), {"content": raw, "raise_for_status": lambda self: None})())
        assert await image_output._download("https://cdn/x.png") == raw
    import base64 as _b64
    assert await image_output._download(
        "data:image/png;base64," + _b64.b64encode(raw).decode()) == raw
