from unittest.mock import AsyncMock, patch

import pytest

from app.services import editing_service


def _stored(url, width=64, height=48):
    """finalize/_upload_result now report the size they stored, not just a URL."""
    from app.services.image_output import StoredImage
    return StoredImage(url, width, height)



@pytest.mark.asyncio
@pytest.mark.parametrize("op", ["remove_object", "smart_erase"])
async def test_removal_sends_no_prompt_channel(op):
    """The whole point: a model with no prompt cannot invent a replacement
    object. If a prompt key ever appears here, hallucination is back."""
    run = AsyncMock(return_value="https://replicate/out.png")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png_bytes())), \
         patch("app.services.editing_service.finalize",
               AsyncMock(return_value=_stored("https://cdn/out.png"))):
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


def _mask_bytes(size) -> bytes:
    import io
    from PIL import Image as PILImage
    buf = io.BytesIO()
    m = PILImage.new("L", size, 0)
    m.putpixel((size[0] // 2, size[1] // 2), 255)
    m.save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_a_painted_mask_is_resized_to_the_source_before_the_model_sees_it():
    """The manual editor sizes its mask canvas from the image's DISPLAYED size in
    CSS pixels, so a 1024px photo shown at 620px yields a 620px mask. LaMa takes
    a mismatched mask, reports succeeded, and returns NULL output -- verified
    against the live model."""
    uploaded = {}

    async def _fake_upload(data, key, content_type):
        uploaded["size"] = __import__("PIL.Image", fromlist=["Image"]).open(
            __import__("io").BytesIO(data)).size
        return "https://cdn/fitted-mask.png"

    async def _fake_download(url):
        return _png_bytes((1024, 768)) if "source" in url else _mask_bytes((620, 465))

    run = AsyncMock(return_value="https://replicate/out.png")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", _fake_download), \
         patch("app.services.editing_service.upload_bytes", _fake_upload), \
         patch("app.services.editing_service.finalize",
               AsyncMock(return_value=_stored("https://cdn/o.png"))):
        result = await editing_service.remove_object("https://cdn/source.png",
                                                     "https://cdn/painted-mask.png")

    assert result["ok"] is True
    assert uploaded["size"] == (1024, 768), "mask must be resized to the source"
    (_, params), _ = run.call_args
    assert params["mask"] == "https://cdn/fitted-mask.png"


@pytest.mark.asyncio
async def test_a_matching_mask_is_not_re_uploaded():
    """Avoid a pointless upload on the common path."""
    upload = AsyncMock()

    async def _fake_download(url):
        return _png_bytes((800, 600)) if "source" in url else _mask_bytes((800, 600))

    run = AsyncMock(return_value="https://replicate/out.png")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", _fake_download), \
         patch("app.services.editing_service.upload_bytes", upload), \
         patch("app.services.editing_service.finalize",
               AsyncMock(return_value=_stored("https://cdn/o.png"))):
        await editing_service.remove_object("https://cdn/source.png", "https://cdn/mask.png")

    upload.assert_not_awaited()
    (_, params), _ = run.call_args
    assert params["mask"] == "https://cdn/mask.png"


@pytest.mark.asyncio
async def test_a_null_output_reports_what_lama_was_actually_given():
    """LaMa reports `succeeded` with a NULL output and says nothing about why.
    Size mismatch is the known cause and is fixed, so a recurrence means
    something else -- the error must carry the evidence instead of leaving it
    to guesswork."""
    import io as _io

    from PIL import Image as _PIL

    buf = _io.BytesIO()
    m = _PIL.new("L", (620, 480), 0)
    for x in range(10, 30):
        for y in range(10, 30):
            m.putpixel((x, y), 255)
    m.save(buf, format="PNG")
    mask_bytes = buf.getvalue()

    async def _dl(url):
        return mask_bytes if "mask" in url else _png_bytes((800, 600))

    with patch("app.services.editing_service._replicate_run",
               AsyncMock(side_effect=RuntimeError(
                   "Replicate model allenhooo/lama succeeded but returned no output"))), \
         patch("app.services.editing_service._download", _dl), \
         patch("app.services.editing_service._fit_mask_to_image",
               AsyncMock(side_effect=lambda mu, ss: mu)):
        result = await editing_service.smart_erase("https://cdn/src.png", "https://cdn/mask.png")

    assert result["ok"] is False
    err = result["error"]
    assert "800x600" in err, err          # what image it had
    assert "620x480" in err, err          # what mask it had
    assert "400 white px" in err, err     # whether anything was marked


@pytest.mark.asyncio
async def test_other_failures_are_not_swallowed_by_the_diagnostic():
    with patch("app.services.editing_service._replicate_run",
               AsyncMock(side_effect=RuntimeError("Replicate create failed 429"))), \
         patch("app.services.editing_service._download",
               AsyncMock(return_value=_png_bytes((800, 600)))), \
         patch("app.services.editing_service._fit_mask_to_image",
               AsyncMock(side_effect=lambda mu, ss: mu)):
        result = await editing_service.smart_erase("https://cdn/src.png", "https://cdn/mask.png")

    assert result["ok"] is False
    assert "429" in result["error"]
    assert "white px" not in result["error"]
