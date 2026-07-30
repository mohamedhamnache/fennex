"""Natural-language edits go to an instruction model, not the mask pipeline.

Producing a pixel-accurate mask of a described object is the hard, failure-prone
part of mask-based editing. Asked to "supprime la menthe" on a photo of a
lemonade bottle, the mask path masked the main subject and erased the bottle
while the mint sat untouched. An instruction model does the whole edit in one
call with no mask, no segmenter and no confirmation round trip.

The MANUAL editor keeps the mask pipeline: there the user paints a region
deliberately, and a mask is genuinely the better tool.
"""
import io
from unittest.mock import AsyncMock, patch

import pytest
from PIL import Image as PILImage

from app.services import editing_service
from app.services.editing_service import build_instruction


def _png(size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    PILImage.new("RGB", size, (1, 2, 3)).save(buf, format="PNG")
    return buf.getvalue()


# ── instruction phrasing ─────────────────────────────────────────────────────

def test_removal_instruction_names_the_target():
    for op in ("remove_object", "smart_erase"):
        got = build_instruction(op, {"target": "la menthe"})
        assert "la menthe" in got
        assert got.lower().startswith("remove")


def test_removal_without_a_target_is_not_an_instruction_edit():
    """Removal with no target must reach the ambiguity gate and ask, not be
    turned into a vague instruction the model would guess at."""
    for op in ("remove_object", "smart_erase"):
        assert build_instruction(op, {}) is None
        assert build_instruction(op, {"target": "   "}) is None


def test_background_and_fill_instructions_carry_their_prompt():
    assert "green marble" in build_instruction("replace_background", {"prompt": "green marble"})
    assert "a vase" in build_instruction("insert_object", {"prompt": "a vase"})
    assert "wood grain" in build_instruction("generative_fill",
                                             {"prompt": "wood grain", "target": "the panel"})


def test_insert_uses_the_target_as_a_location_when_given():
    got = build_instruction("insert_object", {"prompt": "a vase", "target": "the empty shelf"})
    assert "a vase" in got and "the empty shelf" in got


def test_deterministic_operations_are_not_instruction_edits():
    """An instruction model is a worse, costlier way to rotate an image."""
    for op in ("crop", "resize", "rotate", "upscale", "restore_face", "relight",
               "generate_shadow", "remove_background", "flip", "adjust"):
        assert build_instruction(op, {"prompt": "x", "target": "y"}) is None, op


# ── the model call ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_instruction_edit_sends_the_verified_input_shape():
    run = AsyncMock(return_value="https://replicate/out.png")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png())), \
         patch("app.services.editing_service.finalize", AsyncMock(return_value="https://cdn/o.png")):
        result = await editing_service.instruction_edit("https://cdn/in.png", "Remove the mint")

    assert result["ok"] is True
    (model, params), kwargs = run.call_args
    assert model == editing_service._MODEL_NANO_BANANA
    assert kwargs["version"] == editing_service._NANO_BANANA_VERSION
    # image_input is an ARRAY; a bare string is silently ignored by the model.
    assert params["image_input"] == ["https://cdn/in.png"]
    assert isinstance(params["image_input"], list)
    # defaults to jpg, so the result would arrive already lossy
    assert params["output_format"] == "png"
    assert params["aspect_ratio"] == "match_input_image"
    assert "Remove the mint" in params["prompt"]
    # no mask anywhere -- that is the entire point
    assert "mask" not in params


@pytest.mark.asyncio
async def test_the_instruction_tells_the_model_to_leave_everything_else_alone():
    """Without this, these models re-render the whole frame -- the difference
    between "remove the mint" and "here is a new picture that also has no mint"."""
    run = AsyncMock(return_value="https://replicate/out.png")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png())), \
         patch("app.services.editing_service.finalize", AsyncMock(return_value="https://cdn/o.png")):
        await editing_service.instruction_edit("https://cdn/in.png", "Remove the mint")

    (_, params), _ = run.call_args
    prompt = params["prompt"].lower()
    assert "exactly as it is" in prompt
    assert "framing" in prompt and "lighting" in prompt


@pytest.mark.asyncio
async def test_instruction_edit_restores_the_source_resolution():
    """The model matches the input ASPECT, not necessarily its exact pixels."""
    from app.services.image_output import ResolutionPolicy

    fin = AsyncMock(return_value="https://cdn/o.png")
    with patch("app.services.editing_service._replicate_run",
               AsyncMock(return_value="https://replicate/out.png")), \
         patch("app.services.editing_service._download",
               AsyncMock(return_value=_png((1600, 1200)))), \
         patch("app.services.editing_service.finalize", fin):
        await editing_service.instruction_edit("https://cdn/in.png", "Remove the mint")

    assert fin.call_args.kwargs["source_size"] == (1600, 1200)
    assert fin.call_args.kwargs["policy"] is ResolutionPolicy.UPSCALE


@pytest.mark.asyncio
async def test_an_empty_instruction_is_refused_without_spending():
    run = AsyncMock()
    with patch("app.services.editing_service._replicate_run", run):
        for bad in ("", "   ", None):
            result = await editing_service.instruction_edit("https://cdn/in.png", bad)
            assert result["ok"] is False
    run.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_model_failure_is_returned_not_raised():
    with patch("app.services.editing_service._replicate_run",
               AsyncMock(side_effect=RuntimeError("nano-banana exploded"))), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png())):
        result = await editing_service.instruction_edit("https://cdn/in.png", "Remove the mint")
    assert result["ok"] is False
    assert "nano-banana exploded" in result["error"]
