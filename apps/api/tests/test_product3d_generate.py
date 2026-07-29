"""Tests for app.services.product3d.generate -- Trellis output-shape handling
(fix-round-1, Fixes 3 and 4).

Fix 3: `firtoz/trellis` returns an OBJECT (`model_file`, `color_video`,
`gaussian_ply`), not a bare url. Before this fix, `_replicate_run`'s
str(output) fallback turned that object into a Python dict-repr string that
`_download` could never fetch, so every Product-to-3D job failed -- AFTER
Replicate had already billed a successful prediction (metering fires on
`_replicate_run`'s "succeeded" branch, before the caller ever tries to
download anything). `_extract_glb_url` now resolves `output["model_file"]`
for a dict/mapping output, and passes a string output through unchanged (the
shape used by every non-Trellis model, and Trellis's own shape prior to this
fix).

Fix 4: Trellis's documented Replicate schema has no `prompt`/
`negative_prompt` input (it is image-conditioned only) -- `generate_glb` no
longer forwards those keys, and no longer calls `PromptBuilder.build_product_3d`
since nothing would read its output.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app.services.product3d.generate import _extract_glb_url, generate_glb

_FAKE_GLB_BYTES = b"glTF-fake-binary-payload"
_FAKE_GLB_URL = "https://replicate.delivery/pbxt/abc123/model.glb"


def test_extract_glb_url_from_dict_shaped_trellis_output():
    """The real firtoz/trellis output shape: a mapping with model_file among
    its keys, not a bare url."""
    output = {
        "model_file": _FAKE_GLB_URL,
        "color_video": "https://replicate.delivery/pbxt/abc123/color.mp4",
        "gaussian_ply": "https://replicate.delivery/pbxt/abc123/gaussian.ply",
    }
    assert _extract_glb_url(output) == _FAKE_GLB_URL


def test_extract_glb_url_from_string_output_unchanged():
    """The old/generic shape -- a bare url string -- still passes straight
    through, proving the fix does not regress non-Trellis (or a future
    Trellis deployment that returns a plain string) callers."""
    assert _extract_glb_url(_FAKE_GLB_URL) == _FAKE_GLB_URL


async def test_generate_glb_downloads_from_dict_shaped_output():
    mock_replicate = AsyncMock(return_value={
        "model_file": "data:model/gltf-binary;base64,Z2xURi1mYWtlLWJpbmFyeS1wYXlsb2Fk",
        "color_video": "https://replicate.delivery/pbxt/abc123/color.mp4",
    })
    with patch("app.services.product3d.generate._replicate_run", mock_replicate):
        result = await generate_glb("https://cdn.fennex.ai/products/sneaker.png", "high", "2K")
    assert result == _FAKE_GLB_BYTES
    mock_replicate.assert_awaited_once()


async def test_generate_glb_downloads_from_string_output():
    import base64
    data_url = "data:model/gltf-binary;base64," + base64.b64encode(_FAKE_GLB_BYTES).decode()
    mock_replicate = AsyncMock(return_value=data_url)
    with patch("app.services.product3d.generate._replicate_run", mock_replicate):
        result = await generate_glb("https://cdn.fennex.ai/products/sneaker.png", "high", "2K")
    assert result == _FAKE_GLB_BYTES


async def test_generate_glb_sends_only_documented_trellis_inputs():
    """Fix 4: no prompt/negative_prompt keys forwarded -- only what Trellis's
    Replicate schema documents (image + the quality/texture knobs)."""
    mock_replicate = AsyncMock(return_value="data:model/gltf-binary;base64,Z2xURi1mYWtlLWJpbmFyeS1wYXlsb2Fk")
    with patch("app.services.product3d.generate._replicate_run", mock_replicate):
        await generate_glb("https://cdn.fennex.ai/products/sneaker.png", "ultra", "4K")

    mock_replicate.assert_awaited_once()
    model, input_params = mock_replicate.call_args.args
    assert model == "firtoz/trellis"
    assert "prompt" not in input_params
    assert "negative_prompt" not in input_params
    assert input_params["image"] == "https://cdn.fennex.ai/products/sneaker.png"
    assert input_params["texture_size"] == 2048  # 4K
    assert input_params["ss_sampling_steps"] == 24  # ultra
    assert input_params["slat_sampling_steps"] == 24
