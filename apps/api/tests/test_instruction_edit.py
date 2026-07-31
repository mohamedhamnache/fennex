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


def _stored(url, width=64, height=48):
    """finalize/_upload_result now report the size they stored, not just a URL."""
    from app.services.image_output import StoredImage
    return StoredImage(url, width, height)



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
         patch("app.services.editing_service.finalize",
               AsyncMock(return_value=_stored("https://cdn/o.png"))):
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
         patch("app.services.editing_service.finalize",
               AsyncMock(return_value=_stored("https://cdn/o.png"))):
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


# ── local-edit compositing ───────────────────────────────────────────────────

def _scene(bg=(200, 180, 150), obj=(40, 150, 60), obj_box=(60, 40, 110, 90),
           size=(200, 150), shift=0) -> bytes:
    """A background with one object. `shift` brightens EVERY pixel, standing in
    for the global lighting drift an instruction model introduces."""
    img = PILImage.new("RGB", size, tuple(min(255, c + shift) for c in bg))
    d = __import__("PIL.ImageDraw", fromlist=["ImageDraw"]).Draw(img)
    if obj:
        d.rectangle(list(obj_box), fill=tuple(min(255, c + shift) for c in obj))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_global_lighting_drift_alone_is_discarded_entirely():
    """Reported: "it just changed the image light a bit". If the model only
    re-graded the frame and changed nothing else, the original IS the answer."""
    original = _scene()
    drifted = _scene(shift=6)          # every pixel nudged, nothing edited
    assert editing_service._composite_local_edit(original, drifted) is original


def test_the_edited_region_is_taken_but_the_rest_is_preserved_exactly():
    original = _scene()
    # object removed AND the whole frame re-graded, as these models do
    edited = _scene(obj=None, shift=6)

    merged = editing_service._composite_local_edit(original, edited)
    m = PILImage.open(io.BytesIO(merged)).convert("RGB")
    src = PILImage.open(io.BytesIO(original)).convert("RGB")

    # where the object was: it is gone (background-ish, not the object's green)
    r, g, b = m.getpixel((85, 65))
    assert not (g > r and g > b), f"object should be gone, got {(r, g, b)}"

    # far from the edit: pixel-identical to the original, drift discarded
    for probe in ((5, 5), (195, 145), (5, 145), (195, 5)):
        assert m.getpixel(probe) == src.getpixel(probe), \
            f"drift leaked at {probe}: {m.getpixel(probe)} != {src.getpixel(probe)}"


def test_compositing_handles_a_differently_sized_model_output():
    """nano-banana matches the input ASPECT, not its exact pixels."""
    original = _scene(size=(200, 150))
    edited = _scene(obj=None, size=(400, 300))
    merged = editing_service._composite_local_edit(original, edited)
    assert PILImage.open(io.BytesIO(merged)).size == (200, 150)


@pytest.mark.asyncio
async def test_local_operations_are_composited_but_background_replacement_is_not():
    """replace_background is SUPPOSED to change most of the frame, so
    compositing it would fight the user's intent."""
    calls = {}

    def _fake_composite(original, edited):
        calls["composited"] = True
        return original

    with patch("app.services.editing_service._replicate_run",
               AsyncMock(return_value="https://replicate/out.png")), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png())), \
         patch("app.services.editing_service._composite_local_edit", _fake_composite), \
         patch("app.services.editing_service.upload_bytes",
               AsyncMock(return_value="https://cdn/merged.png")), \
         patch("app.services.editing_service.finalize",
               AsyncMock(return_value=_stored("https://cdn/whole.png"))):

        for op in ("remove_object", "smart_erase", "insert_object", "generative_fill"):
            calls.clear()
            r = await editing_service.instruction_edit("https://cdn/i.png", "do it", op)
            assert r["image_url"] == "https://cdn/merged.png", op
            assert calls.get("composited") is True, f"{op} must be composited"

        calls.clear()
        r = await editing_service.instruction_edit("https://cdn/i.png", "new bg",
                                                   "replace_background")
        assert r["image_url"] == "https://cdn/whole.png"
        assert "composited" not in calls


# ── the user's own words reach the model ─────────────────────────────────────

_TEETH_REQUEST = (
    "Apply the Algerian flag exclusively to the visible upper teeth. The flag "
    "must be perfectly aligned across the teeth: left half green, right half "
    "white, with the red crescent and five-pointed star centered across the two "
    "front incisors. Preserve the natural shape, texture, reflections, enamel "
    "details, and tooth separation. Do not modify the lips, gums, skin, "
    "lighting, expression, composition, or background. Do not add any paint "
    "outside the teeth."
)


def test_a_single_step_request_is_sent_verbatim():
    """The planner reduced this to {target, prompt} and build_instruction rebuilt
    it as "Replace the visible upper teeth with the Algerian flag." -- every
    constraint discarded before the model saw it, and it painted the whole face.
    """
    got = build_instruction(
        "generative_fill",
        {"target": "the visible upper teeth", "prompt": "the Algerian flag"},
        user_command=_TEETH_REQUEST,
    )
    assert got == _TEETH_REQUEST
    # the constraints that were being thrown away
    assert "exclusively" in got
    assert "Do not add any paint outside the teeth" in got
    assert "Do not modify the lips" in got


def test_a_multi_step_chain_still_gets_a_synthesized_step_instruction():
    """One sentence covering several operations cannot be handed whole to each
    step, so those keep the phrased form."""
    got = build_instruction("remove_object", {"target": "the mint"}, user_command=None)
    assert got is not None
    assert "the mint" in got
    assert got != _TEETH_REQUEST


def test_deterministic_operations_ignore_the_user_command():
    """A raw sentence must not turn crop or upscale into an instruction edit."""
    for op in ("crop", "resize", "rotate", "upscale", "restore_face", "relight",
               "generate_shadow", "remove_background", "flip", "adjust"):
        assert build_instruction(op, {}, user_command=_TEETH_REQUEST) is None, op


@pytest.mark.asyncio
async def test_the_verbatim_request_reaches_the_model_with_the_preserve_clause():
    run = AsyncMock(return_value="https://replicate/out.png")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png())), \
         patch("app.services.editing_service._composite_local_edit", lambda a, b: a), \
         patch("app.services.editing_service.upload_bytes",
               AsyncMock(return_value="https://cdn/o.png")):
        await editing_service.instruction_edit("https://cdn/i.png", _TEETH_REQUEST,
                                               "generative_fill")

    (_, params), _ = run.call_args
    assert _TEETH_REQUEST in params["prompt"]
    assert "exactly as it is" in params["prompt"].lower()


def test_removal_needs_no_target_on_the_chat_path():
    """The "removal must name a target" rule guards the SEGMENTER, which will
    otherwise cut out the wrong thing. Nothing on this path uses a segmenter --
    the model reads the whole sentence, and extracting a target from it only
    throws context away."""
    got = build_instruction("remove_object", {}, user_command="supprime la menthe")
    assert got == "supprime la menthe"

    got = build_instruction("generative_fill", {},
                            user_command="fill the crack in the wall with matching plaster")
    assert got == "fill the crack in the wall with matching plaster"


def test_the_planner_extraction_is_ignored_entirely_for_a_single_step():
    """Even a confident, wrong extraction cannot override what the user said."""
    got = build_instruction(
        "replace_background",
        {"target": "the bottle", "prompt": "something the planner invented"},
        user_command="make the background a warm sunset",
    )
    assert got == "make the background a warm sunset"
    assert "invented" not in got
    assert "the bottle" not in got
