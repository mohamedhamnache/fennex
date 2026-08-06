import io
import httpx
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from PIL import Image as PILImage
from app.services.editing_service import crop_image, resize_image, rotate_image, adjust_image, apply_filter


def _stored(url, width=64, height=48):
    """finalize/_upload_result now report the size they stored, not just a URL."""
    from app.services.image_output import StoredImage
    return StoredImage(url, width, height)



def _make_test_png(w=200, h=200, color=(255, 0, 0)) -> bytes:
    img = PILImage.new("RGB", (w, h), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def mock_download_and_upload(monkeypatch):
    """Replace HTTP download and S3 upload with in-memory mocks."""
    test_png = _make_test_png()
    monkeypatch.setattr(
        "app.services.editing_service._download",
        AsyncMock(return_value=test_png),
    )
    monkeypatch.setattr(
        "app.services.editing_service._upload_result",
        AsyncMock(return_value=_stored("https://storage.example.com/result.png")),
    )


@pytest.mark.asyncio
async def test_crop_image(mock_download_and_upload):
    result = await crop_image("https://example.com/img.png", x=0, y=0, w=100, h=100)
    assert result["ok"] is True
    assert result["image_url"] == "https://storage.example.com/result.png"


@pytest.mark.asyncio
async def test_resize_image_keep_aspect(mock_download_and_upload):
    result = await resize_image("https://example.com/img.png", width=100, height=100, keep_aspect=True)
    assert result["ok"] is True


@pytest.mark.asyncio
async def test_rotate_image(mock_download_and_upload):
    result = await rotate_image("https://example.com/img.png", angle=90, fill_color="#FFFFFF")
    assert result["ok"] is True


@pytest.mark.asyncio
async def test_adjust_image(mock_download_and_upload):
    result = await adjust_image("https://example.com/img.png", brightness=20, contrast=-10)
    assert result["ok"] is True


@pytest.mark.asyncio
async def test_apply_filter_grayscale(mock_download_and_upload):
    result = await apply_filter("https://example.com/img.png", filter_name="grayscale")
    assert result["ok"] is True


@pytest.mark.asyncio
async def test_apply_filter_unknown(mock_download_and_upload):
    result = await apply_filter("https://example.com/img.png", filter_name="bogus")
    assert result["ok"] is False
    assert "Unknown filter" in result["error"]


async def test_relight_pins_a_version_and_sends_the_models_real_field_names():
    """zsxkib/ic-light has no hot deployment, so calling it without `version=`
    hits /v1/models/{owner}/{name}/predictions and returns a bare 404 -- the
    exact failure a user hit asking Mirage to add light to a photo.

    Pinning the version alone is not enough: the model requires `subject_image`
    (not `image`) and has no `multiplier` field at all, so the old payload would
    have turned the 404 into a 422.
    """
    from app.services import editing_service

    run = AsyncMock(return_value="https://replicate.delivery/out.webp")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png_bytes())), \
         patch("app.services.editing_service.finalize",
               AsyncMock(return_value=_stored("https://cdn/out.png"))):
        result = await editing_service.relight_image("https://cdn/in.png", "left", 1.0)

    assert result["ok"] is True
    (model, params), kwargs = run.call_args
    assert model == "zsxkib/ic-light"
    assert kwargs["version"] == editing_service._IC_LIGHT_VERSION
    assert params["subject_image"] == "https://cdn/in.png"
    assert "image" not in params        # not the model's field name
    assert "multiplier" not in params   # field does not exist on this model
    assert params["prompt"]


async def test_relight_maps_direction_onto_the_light_source_enum():
    """light_source is an enum: None | Left Light | Right Light | Top Light |
    Bottom Light. A free-form direction string is silently ignored by the model."""
    from app.services import editing_service

    valid = {"None", "Left Light", "Right Light", "Top Light", "Bottom Light"}
    for direction, expected in [
        ("top", "Top Light"), ("bottom", "Bottom Light"),
        ("left", "Left Light"), ("right", "Right Light"),
    ]:
        run = AsyncMock(return_value="https://replicate.delivery/out.webp")
        with patch("app.services.editing_service._replicate_run", run), \
             patch("app.services.editing_service._download", AsyncMock(return_value=_png_bytes())), \
             patch("app.services.editing_service.finalize",
               AsyncMock(return_value=_stored("https://cdn/out.png"))):
            await editing_service.relight_image("https://cdn/in.png", direction)
        (_, params), _ = run.call_args
        assert params["light_source"] == expected
        assert params["light_source"] in valid


async def test_relight_falls_back_to_a_valid_enum_for_an_unknown_direction():
    from app.services import editing_service

    run = AsyncMock(return_value="https://replicate.delivery/out.webp")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png_bytes())), \
         patch("app.services.editing_service.finalize",
               AsyncMock(return_value=_stored("https://cdn/out.png"))):
        await editing_service.relight_image("https://cdn/in.png", "top-right")
    (_, params), _ = run.call_args
    assert params["light_source"] in {"None", "Left Light", "Right Light", "Top Light", "Bottom Light"}


async def test_restore_face_pins_a_version():
    """sczhou/codeformer also has no hot deployment -- same 404 as ic-light."""
    from app.services import editing_service

    run = AsyncMock(return_value="https://replicate.delivery/out.png")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png_bytes())), \
         patch("app.services.editing_service.finalize",
               AsyncMock(return_value=_stored("https://cdn/out.png"))):
        await editing_service.restore_face("https://cdn/in.png", 0.7)

    (model, params), kwargs = run.call_args
    assert model == "sczhou/codeformer"
    assert kwargs["version"] == editing_service._CODEFORMER_VERSION
    assert params["image"] == "https://cdn/in.png"
    assert params["codeformer_fidelity"] == 0.7


def _replicate_429(retry_after: float = 0.001) -> httpx.Response:
    return httpx.Response(
        429,
        json={"detail": "Request was throttled.", "status": 429, "retry_after": retry_after},
        request=httpx.Request("POST", "https://api.replicate.com/v1/predictions"),
    )


def _replicate_created() -> httpx.Response:
    return httpx.Response(
        201,
        json={"id": "abc123", "urls": {"get": "https://api.replicate.com/v1/predictions/abc123"}},
        request=httpx.Request("POST", "https://api.replicate.com/v1/predictions"),
    )


@pytest.mark.asyncio
async def test_create_prediction_retries_past_a_burst_of_429s():
    """A low-credit Replicate account throttles bursts to 1 request -- a few
    concurrent scene generations should still succeed by honoring the
    `retry_after` Replicate returns, not fail the whole batch outright."""
    from app.services.editing_service import _create_prediction

    client = MagicMock()
    client.post = AsyncMock(side_effect=[_replicate_429(), _replicate_429(), _replicate_created()])

    resp = await _create_prediction(client, "https://api.replicate.com/v1/predictions", {}, {})

    assert resp.status_code == 201
    assert client.post.await_count == 3


@pytest.mark.asyncio
async def test_create_prediction_gives_up_after_repeated_429s():
    from app.services.editing_service import _create_prediction

    client = MagicMock()
    client.post = AsyncMock(return_value=_replicate_429())

    resp = await _create_prediction(client, "https://api.replicate.com/v1/predictions", {}, {}, attempts=3)

    assert resp.status_code == 429
    assert client.post.await_count == 3


def _png_bytes(size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    PILImage.new("RGB", size, (1, 2, 3)).save(buf, format="PNG")
    return buf.getvalue()


async def test_flux_fill_requests_lossless_output():
    """output_format defaults to jpg -- a lossy round-trip on every mask op."""
    from app.services import editing_service
    run = AsyncMock(return_value="https://replicate/out.png")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png_bytes())), \
         patch("app.services.editing_service.finalize",
               AsyncMock(return_value=_stored("https://cdn/o.png"))):
        await editing_service.replace_background("https://cdn/in.png", "green marble", "https://cdn/m.png")
    (_, params), _ = run.call_args
    assert params["output_format"] == "png"


async def test_download_and_upload_url_is_gone():
    """It forced RGBA and re-encoded every result."""
    from app.services import editing_service
    assert not hasattr(editing_service, "_download_and_upload_url")


async def test_upscale_allows_a_size_change_but_replace_background_does_not():
    from app.services import editing_service
    from app.services.image_output import ResolutionPolicy
    fin = AsyncMock(return_value=_stored("https://cdn/o.png"))
    run = AsyncMock(return_value="https://replicate/out.png")

    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png_bytes())), \
         patch("app.services.editing_service.finalize", fin):
        await editing_service.upscale_image("https://cdn/in.png", 2)
    assert fin.call_args.kwargs["policy"] is ResolutionPolicy.ALLOW_CHANGE

    fin.reset_mock()
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png_bytes())), \
         patch("app.services.editing_service.finalize", fin):
        await editing_service.replace_background("https://cdn/in.png", "marble", "https://cdn/m.png")
    assert fin.call_args.kwargs.get("policy", ResolutionPolicy.PRESERVE) is ResolutionPolicy.PRESERVE


async def test_every_replicate_op_passes_the_source_size_to_finalize():
    """Without source_size the resolution assertion is inert."""
    from app.services import editing_service
    fin = AsyncMock(return_value=_stored("https://cdn/o.png"))
    run = AsyncMock(return_value="https://replicate/out.png")
    cases = [
        (editing_service.replace_background, ("https://cdn/in.png", "p", "https://cdn/m.png")),
        (editing_service.insert_object, ("https://cdn/in.png", "p", "https://cdn/m.png")),
        (editing_service.generative_fill, ("https://cdn/in.png", "p", "https://cdn/m.png")),
        (editing_service.restore_face, ("https://cdn/in.png", 0.7)),
        (editing_service.upscale_image, ("https://cdn/in.png", 2)),
    ]
    for fn, args in cases:
        fin.reset_mock()
        with patch("app.services.editing_service._replicate_run", run), \
             patch("app.services.editing_service._download",
                   AsyncMock(return_value=_png_bytes((800, 600)))), \
             patch("app.services.editing_service.finalize", fin):
            await fn(*args)
        assert fin.call_args.kwargs["source_size"] == (800, 600), f"{fn.__name__} lost source_size"


async def test_relight_clamps_dimensions_to_the_ic_light_enum():
    """width/height are enums; an out-of-enum value is silently ignored and the
    model falls back to 512x640 -- which is how a large photo came back tiny."""
    from app.services import editing_service
    from app.services.image_output import ResolutionPolicy

    allowed = set(editing_service._IC_LIGHT_DIMS)
    fin = AsyncMock(return_value=_stored("https://cdn/o.png"))
    run = AsyncMock(return_value="https://replicate/out.webp")

    # Source below the 1024 cap: clamped down to the nearest allowed value, and
    # since that is not the source size the result is upscaled back.
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download",
               AsyncMock(return_value=_png_bytes((800, 600)))), \
         patch("app.services.editing_service.finalize", fin):
        await editing_service.relight_image("https://cdn/in.png", "left")
    (_, params), _ = run.call_args
    assert params["width"] in allowed and params["height"] in allowed
    assert params["width"] == 768 and params["height"] == 576
    assert fin.call_args.kwargs["source_size"] == (800, 600)
    assert fin.call_args.kwargs["policy"] is ResolutionPolicy.UPSCALE

    # Source ABOVE the cap: clamped to 1024, still upscaled back to the source.
    fin.reset_mock()
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download",
               AsyncMock(return_value=_png_bytes((4000, 3000)))), \
         patch("app.services.editing_service.finalize", fin):
        await editing_service.relight_image("https://cdn/in.png", "top")
    (_, params), _ = run.call_args
    assert params["width"] == 1024 and params["height"] == 1024
    assert fin.call_args.kwargs["policy"] is ResolutionPolicy.UPSCALE


async def test_relight_preserves_when_the_source_is_exactly_an_enum_size():
    from app.services import editing_service
    from app.services.image_output import ResolutionPolicy

    fin = AsyncMock(return_value=_stored("https://cdn/o.png"))
    with patch("app.services.editing_service._replicate_run",
               AsyncMock(return_value="https://replicate/out.webp")), \
         patch("app.services.editing_service._download",
               AsyncMock(return_value=_png_bytes((768, 512)))), \
         patch("app.services.editing_service.finalize", fin):
        await editing_service.relight_image("https://cdn/in.png", "right")
    assert fin.call_args.kwargs["policy"] is ResolutionPolicy.PRESERVE


async def test_pillow_ops_preserve_the_source_colour_mode(monkeypatch):
    """_open forced RGBA, so an RGB photo came back as a bloated RGBA PNG."""
    from app.services import editing_service
    captured = {}

    async def _fake_upload(img, folder="edits"):
        captured["mode"] = img.mode
        return _stored("https://cdn/out.png", img.width, img.height)

    monkeypatch.setattr(editing_service, "_download", AsyncMock(return_value=_png_bytes()))
    monkeypatch.setattr(editing_service, "_upload_result", _fake_upload)

    await editing_service.crop_image("https://cdn/in.png", 0, 0, 10, 10)
    assert captured["mode"] == "RGB"


async def test_upload_result_never_writes_lossy_jpeg(monkeypatch):
    from app.services import editing_service
    sent = {}

    async def _fake_upload_bytes(data, key, content_type):
        sent["key"], sent["ct"] = key, content_type
        return "https://cdn/x"

    monkeypatch.setattr(editing_service, "upload_bytes", _fake_upload_bytes)
    await editing_service._upload_result(PILImage.new("RGB", (8, 8)))
    assert sent["key"].endswith(".png")
    assert sent["ct"] == "image/png"


async def test_rgba_sources_keep_their_alpha(monkeypatch):
    """Preserving the mode must not strip alpha from images that have it."""
    from app.services import editing_service
    captured = {}

    async def _fake_upload(img, folder="edits"):
        captured["mode"] = img.mode
        return _stored("https://cdn/out.png", img.width, img.height)

    buf = io.BytesIO()
    PILImage.new("RGBA", (32, 32), (1, 2, 3, 128)).save(buf, format="PNG")
    monkeypatch.setattr(editing_service, "_download", AsyncMock(return_value=buf.getvalue()))
    monkeypatch.setattr(editing_service, "_upload_result", _fake_upload)

    await editing_service.crop_image("https://cdn/in.png", 0, 0, 10, 10)
    assert captured["mode"] == "RGBA"


async def test_rotate_keeps_rgb_for_a_solid_fill_but_promotes_for_transparency(monkeypatch):
    """expand=True creates new corners. A solid fill works in RGB; a transparent
    one is impossible without an alpha channel."""
    from app.services import editing_service
    captured = {}

    async def _fake_upload(img, folder="edits"):
        captured["mode"] = img.mode
        return _stored("https://cdn/out.png", img.width, img.height)

    monkeypatch.setattr(editing_service, "_download", AsyncMock(return_value=_png_bytes()))
    monkeypatch.setattr(editing_service, "_upload_result", _fake_upload)

    r = await editing_service.rotate_image("https://cdn/in.png", 45, fill_color="#ffffff")
    assert r["ok"] is True
    assert captured["mode"] == "RGB"

    r = await editing_service.rotate_image("https://cdn/in.png", 45)
    assert r["ok"] is True
    assert captured["mode"] == "RGBA"


async def test_generate_shadow_uses_a_model_that_actually_exists():
    """fal-ai/shadow-generation does not exist on Replicate, so this operation
    could never succeed. Every field the old code sent was wrong too."""
    from app.services import editing_service
    from app.services.image_output import ResolutionPolicy

    run = AsyncMock(return_value="https://replicate/out.png")
    fin = AsyncMock(return_value=_stored("https://cdn/o.png"))
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download",
               AsyncMock(return_value=_png_bytes((800, 600)))), \
         patch("app.services.editing_service.finalize", fin):
        result = await editing_service.generate_shadow("https://cdn/in.png", "bottom")

    assert result["ok"] is True
    (model, params), kwargs = run.call_args
    assert model == editing_service._MODEL_SHADOW
    assert model != "fal-ai/shadow-generation"
    assert kwargs["version"] == editing_service._SHADOW_VERSION
    # the real field names, verified against the live schema
    assert params["image"] == "https://cdn/in.png"
    assert "foreground_image" not in params
    assert "shadow_direction" not in params
    assert params["shadow_type"] in {"regular", "float"}
    assert params["shadow_type"] != "natural_shadow"
    assert fin.call_args.kwargs["source_size"] == (800, 600)
    # ALLOW_CHANGE, not PRESERVE: a real prediction showed this model extends the
    # canvas to fit the shadow. See test_generate_shadow_allows_the_canvas_to_grow.
    assert fin.call_args.kwargs["policy"] is ResolutionPolicy.ALLOW_CHANGE


async def test_generate_shadow_maps_direction_onto_offsets():
    """The model has no direction field; direction is an offset pair."""
    from app.services import editing_service

    seen = {}
    for direction in ("bottom", "bottom-right", "bottom-left", "right", "left"):
        run = AsyncMock(return_value="https://replicate/out.png")
        with patch("app.services.editing_service._replicate_run", run), \
             patch("app.services.editing_service._download", AsyncMock(return_value=_png_bytes())), \
             patch("app.services.editing_service.finalize",
               AsyncMock(return_value=_stored("https://cdn/o.png"))):
            await editing_service.generate_shadow("https://cdn/in.png", direction)
        (_, params), _ = run.call_args
        seen[direction] = (params["shadow_offset_x"], params["shadow_offset_y"])

    assert seen["bottom"][0] == 0 and seen["bottom"][1] > 0
    assert seen["bottom-right"][0] > 0 and seen["bottom-right"][1] > 0
    assert seen["bottom-left"][0] < 0 and seen["bottom-left"][1] > 0
    assert seen["right"][0] > 0 and seen["right"][1] == 0
    assert seen["left"][0] < 0 and seen["left"][1] == 0
    # every direction must produce a distinct placement
    assert len(set(seen.values())) == len(seen)


async def test_generate_shadow_falls_back_to_a_valid_offset_for_an_unknown_direction():
    from app.services import editing_service

    run = AsyncMock(return_value="https://replicate/out.png")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png_bytes())), \
         patch("app.services.editing_service.finalize",
               AsyncMock(return_value=_stored("https://cdn/o.png"))):
        result = await editing_service.generate_shadow("https://cdn/in.png", "sideways")

    assert result["ok"] is True
    (_, params), _ = run.call_args
    assert isinstance(params["shadow_offset_x"], int)
    assert isinstance(params["shadow_offset_y"], int)


def _img_bytes(mode, size=(32, 32), fmt="PNG") -> bytes:
    buf = io.BytesIO()
    PILImage.new(mode, size).save(buf, format=fmt)
    return buf.getvalue()


async def test_restore_face_pins_upscale_so_it_does_not_resize(monkeypatch):
    """codeformer's `upscale` DEFAULTS TO 2. Left unset, the output is 2x the
    input and the PRESERVE assertion rejects every call."""
    from app.services import editing_service
    run = AsyncMock(return_value="https://replicate/out.png")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png_bytes())), \
         patch("app.services.editing_service.finalize",
               AsyncMock(return_value=_stored("https://cdn/o.png"))):
        await editing_service.restore_face("https://cdn/in.png", 0.7)
    (_, params), _ = run.call_args
    assert params["upscale"] == 1


async def test_generate_shadow_supports_every_direction_the_ui_offers():
    """The UI offers top/bottom/left/right. A direction missing from the map
    silently falls back to bottom, so Top rendered a bottom shadow."""
    from app.services import editing_service
    for d in ("top", "bottom", "left", "right"):
        assert d in editing_service._SHADOW_OFFSETS, f"UI offers {d} but the map lacks it"
    assert editing_service._SHADOW_OFFSETS["top"][1] < 0
    assert editing_service._SHADOW_OFFSETS["bottom"][1] > 0


@pytest.mark.parametrize("mode,fmt", [
    ("CMYK", "JPEG"),   # cannot be written as PNG at all
    ("P", "PNG"),       # palette: filters raise "cannot filter palette images"
    ("L", "PNG"),       # grayscale: adjust/rotate fill raise
    ("LA", "PNG"),      # grayscale + alpha
])
async def test_pillow_ops_handle_exotic_source_modes(monkeypatch, mode, fmt):
    """_open must normalise the modes downstream cannot take. Dropping that
    entirely broke CMYK JPEGs, palette PNGs and grayscale sources."""
    from app.services import editing_service
    monkeypatch.setattr(editing_service, "_download",
                        AsyncMock(return_value=_img_bytes(mode, fmt=fmt)))
    monkeypatch.setattr(editing_service, "_upload_result",
                        AsyncMock(return_value=_stored("https://cdn/out.png")))

    for coro in (
        editing_service.crop_image("u", 0, 0, 8, 8),
        editing_service.sharpen_image("u", 0.5),
        editing_service.denoise_image("u", 0.5),
        editing_service.adjust_image("u", brightness=10),
        editing_service.rotate_image("u", 45, fill_color="#ffffff"),
        editing_service.rotate_image("u", 45),
    ):
        result = await coro
        assert result["ok"] is True, f"{mode} failed: {result.get('error')}"


async def test_exotic_modes_keep_alpha_when_they_have_it(monkeypatch):
    from app.services import editing_service
    captured = {}

    async def _fake_upload(img, folder="edits"):
        captured["mode"] = img.mode
        return _stored("https://cdn/out.png", img.width, img.height)

    monkeypatch.setattr(editing_service, "_download",
                        AsyncMock(return_value=_img_bytes("LA")))
    monkeypatch.setattr(editing_service, "_upload_result", _fake_upload)
    await editing_service.crop_image("u", 0, 0, 8, 8)
    assert captured["mode"] == "RGBA"


async def test_generate_shadow_allows_the_canvas_to_grow():
    """Verified with a real prediction: bria/product-shadow extends the canvas to
    fit the shadow (512x384 in -> 592x494 out). PRESERVE failed every call."""
    from app.services import editing_service
    from app.services.image_output import ResolutionPolicy

    fin = AsyncMock(return_value=_stored("https://cdn/o.png"))
    with patch("app.services.editing_service._replicate_run",
               AsyncMock(return_value="https://replicate/out.png")), \
         patch("app.services.editing_service._download",
               AsyncMock(return_value=_png_bytes((512, 384)))), \
         patch("app.services.editing_service.finalize", fin):
        result = await editing_service.generate_shadow("https://cdn/in.png", "bottom")

    assert result["ok"] is True
    assert fin.call_args.kwargs["policy"] is ResolutionPolicy.ALLOW_CHANGE


async def test_replicate_run_fails_loudly_on_an_empty_output():
    """A prediction can succeed with a null or empty output. str(None) handed the
    literal "None" to the downloader, so the failure surfaced deep in httpx as
    "Request URL is missing an 'http://' or 'https://' protocol" -- far from the
    real cause. Drives the real _replicate_run, not a mock of it."""
    from app.services import editing_service

    class _Resp:
        def __init__(self, payload, code=201):
            self._p, self.status_code = payload, code
            self.is_success = code < 400
            self.text = str(payload)

        def json(self):
            return self._p

        def raise_for_status(self):
            return None

    for output in (None, "", [], "   "):
        created = _Resp({"id": "p1", "urls": {"get": "https://api.replicate.com/v1/predictions/p1"}})
        polled = _Resp({"status": "succeeded", "output": output, "metrics": {}})

        class _Client:
            async def __aenter__(self_inner):
                return self_inner

            async def __aexit__(self_inner, *a):
                return False

            async def post(self_inner, *a, **k):
                return created

            async def get(self_inner, *a, **k):
                return polled

        with patch("app.services.editing_service.httpx.AsyncClient", lambda **k: _Client()), \
             patch("app.services.editing_service._POLL_INTERVAL", 0):
            with pytest.raises(RuntimeError) as exc:
                await editing_service._replicate_run("owner/model", {"image": "x"})
        msg = str(exc.value)
        assert "owner/model" in msg, f"error should name the model, got: {msg}"
        assert "output" in msg.lower(), f"error should mention output, got: {msg}"


async def test_ops_without_a_mask_use_the_callers_known_size():
    """The router already holds image.width/height, so downloading the whole
    source again just to read a header wasted megabytes per edit. Kept for the
    operations where a stale hint is harmless -- it only picks a policy."""
    from app.services import editing_service

    dl = AsyncMock(return_value=_png_bytes((800, 600)))
    fin = AsyncMock(return_value=_stored("https://cdn/o.png"))
    run = AsyncMock(return_value="https://replicate/out.png")

    cases = [
        (editing_service.restore_face, ("https://cdn/i.png", 0.7)),
        (editing_service.upscale_image, ("https://cdn/i.png", 2)),
        (editing_service.generate_shadow, ("https://cdn/i.png", "bottom")),
        (editing_service.relight_image, ("https://cdn/i.png", "left")),
        (editing_service.replace_background, ("https://cdn/i.png", "p", None)),
    ]
    for fn, args in cases:
        dl.reset_mock()
        with patch("app.services.editing_service._replicate_run", run), \
             patch("app.services.editing_service._download", dl), \
             patch("app.services.editing_service.finalize", fin):
            result = await fn(*args, source_size=(1600, 1200))
        assert result["ok"] is True, f"{fn.__name__}: {result.get('error')}"
        dl.assert_not_awaited(), f"{fn.__name__} refetched the source"
        assert fin.call_args.kwargs["source_size"] == (1600, 1200), fn.__name__


async def test_ops_WITH_a_mask_measure_the_real_file_and_ignore_the_hint():
    """A mask is resized to this size, so a stale database value is not a
    harmless imprecision -- it hands the model a mask that does not match its
    image, and LaMa answers `succeeded` with a NULL output."""
    from app.services import editing_service

    real = (1600, 1600)
    dl = AsyncMock(return_value=_png_bytes(real))
    fitted = {}

    async def _fake_fit(mask_url, source_size):
        fitted["size"] = source_size
        return mask_url

    for fn, args in [
        (editing_service.remove_object, ("https://cdn/i.png", "https://cdn/m.png")),
        (editing_service.replace_background, ("https://cdn/i.png", "p", "https://cdn/m.png")),
    ]:
        dl.reset_mock(); fitted.clear()
        with patch("app.services.editing_service._replicate_run",
                   AsyncMock(return_value="https://replicate/out.png")), \
             patch("app.services.editing_service._download", dl), \
             patch("app.services.editing_service._fit_mask_to_image", _fake_fit), \
             patch("app.services.editing_service.finalize",
                   AsyncMock(return_value=_stored("https://cdn/o.png"))):
            result = await fn(*args, source_size=(1792, 1024))  # the stale DB default
        assert result["ok"] is True, f"{fn.__name__}: {result.get('error')}"
        dl.assert_awaited(), f"{fn.__name__} trusted the stale hint"
        assert fitted["size"] == real, f"{fn.__name__} fitted the mask to {fitted['size']}"


async def test_ops_still_measure_when_the_caller_does_not_know_the_size():
    """Callers without the dimensions to hand must keep working unchanged."""
    from app.services import editing_service

    dl = AsyncMock(return_value=_png_bytes((800, 600)))
    with patch("app.services.editing_service._replicate_run",
               AsyncMock(return_value="https://replicate/out.png")), \
         patch("app.services.editing_service._download", dl), \
         patch("app.services.editing_service.finalize",
               AsyncMock(return_value=_stored("https://cdn/o.png"))):
        result = await editing_service.restore_face("https://cdn/i.png", 0.7)

    assert result["ok"] is True
    dl.assert_awaited()


async def test_cheap_cutout_uses_replicate_and_meters_it():
    """remove_background_cheap must go through Replicate's 851-labs/background-remover
    (which meters via _replicate_run at MIN_REPLICATE_CREDITS) rather than
    Remove.bg, which metered the same operation at 191 credits."""
    from app.services import editing_service
    from app.services.image_output import ResolutionPolicy

    run = AsyncMock(return_value="https://replicate/cutout.png")
    fin = AsyncMock(return_value=_stored("https://cdn.test/c.png", 800, 800))
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download",
               AsyncMock(return_value=_png_bytes((800, 800)))), \
         patch("app.services.editing_service.finalize", fin):
        out = await editing_service.remove_background_cheap("https://cdn.test/in.jpg")

    assert out["ok"] is True
    assert out["image_url"] == "https://cdn.test/c.png"
    assert out["width"] == 800
    assert out["height"] == 800
    (model, params), kwargs = run.call_args
    assert model == "851-labs/background-remover"
    assert kwargs["version"] == (
        "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc"
    )
    assert params["image"] == "https://cdn.test/in.jpg"
    # The frame is now MEASURED and reported. This path used to pass
    # ALLOW_CHANGE with no source_size at all, so nothing was ever compared --
    # and "expected to differ" was indistinguishable from "nobody looked",
    # which is what let remove.bg return quarter-megapixel images for weeks.
    assert fin.call_args.kwargs["source_size"] == (800, 800)
    assert fin.call_args.kwargs["policy"] is ResolutionPolicy.WARN
