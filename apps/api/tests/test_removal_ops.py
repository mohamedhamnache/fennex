from unittest.mock import AsyncMock, patch

import pytest

from app.services import editing_service


@pytest.mark.asyncio
@pytest.mark.parametrize("op", ["remove_object", "smart_erase"])
async def test_removal_sends_no_prompt_channel(op):
    """The whole point: a model with no prompt cannot invent a replacement
    object. If a prompt key ever appears here, hallucination is back."""
    run = AsyncMock(return_value="https://replicate/out.png")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png_bytes())), \
         patch("app.services.editing_service.finalize",
               AsyncMock(return_value="https://cdn/out.png")):
        result = await getattr(editing_service, op)("https://cdn/in.png", "https://cdn/mask.png")

    assert result["ok"] is True
    (model, params), kwargs = run.call_args
    assert model == editing_service._MODEL_LAMA
    assert kwargs["version"] == editing_service._LAMA_VERSION
    assert set(params) == {"image", "mask"}
    for forbidden in ("prompt", "negative_prompt", "guidance", "text_prompt"):
        assert forbidden not in params


@pytest.mark.asyncio
@pytest.mark.parametrize("op", ["remove_object", "smart_erase"])
async def test_removal_requires_a_mask(op):
    result = await getattr(editing_service, op)("https://cdn/in.png", None)
    assert result["ok"] is False
    assert "mask" in result["error"].lower()


@pytest.mark.asyncio
@pytest.mark.parametrize("op", ["remove_object", "smart_erase"])
async def test_removal_asserts_resolution_parity(op):
    """LaMa is resolution-robust; a size change means something is wrong."""
    from app.services.image_output import ResolutionPolicy

    fin = AsyncMock(return_value="https://cdn/out.png")
    with patch("app.services.editing_service._replicate_run",
               AsyncMock(return_value="https://replicate/out.png")), \
         patch("app.services.editing_service._download",
               AsyncMock(return_value=_png_bytes((800, 600)))), \
         patch("app.services.editing_service.finalize", fin):
        await getattr(editing_service, op)("https://cdn/in.png", "https://cdn/mask.png")

    assert fin.call_args.kwargs["source_size"] == (800, 600)
    assert fin.call_args.kwargs.get("policy", ResolutionPolicy.PRESERVE) is ResolutionPolicy.PRESERVE


def test_removal_no_longer_calls_the_background_describer():
    """_analyze_background built the prompt that caused the hallucination."""
    assert not hasattr(editing_service, "_analyze_background")


def test_the_sd_inpaint_fallback_is_gone():
    for dead in ("_sd_inpaint_size", "_MODEL_SD_INPAINT", "_SD_INPAINT_VERSION",
                 "_pillow_content_fill"):
        assert not hasattr(editing_service, dead), f"{dead} should have been deleted"


def test_removal_signatures_dropped_the_unused_openai_key():
    import inspect
    for op in ("remove_object", "smart_erase"):
        assert "openai_key" not in inspect.signature(getattr(editing_service, op)).parameters


def _png_bytes(size=(64, 48)) -> bytes:
    import io

    from PIL import Image as PILImage

    buf = io.BytesIO()
    PILImage.new("RGB", size, (1, 2, 3)).save(buf, format="PNG")
    return buf.getvalue()
