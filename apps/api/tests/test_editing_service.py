import io
import httpx
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from PIL import Image as PILImage
from app.services.editing_service import crop_image, resize_image, rotate_image, adjust_image, apply_filter


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
        AsyncMock(return_value="https://storage.example.com/result.png"),
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
         patch("app.services.editing_service._download_and_upload_url",
               AsyncMock(return_value="https://cdn/out.png")):
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
             patch("app.services.editing_service._download_and_upload_url",
                   AsyncMock(return_value="https://cdn/out.png")):
            await editing_service.relight_image("https://cdn/in.png", direction)
        (_, params), _ = run.call_args
        assert params["light_source"] == expected
        assert params["light_source"] in valid


async def test_relight_falls_back_to_a_valid_enum_for_an_unknown_direction():
    from app.services import editing_service

    run = AsyncMock(return_value="https://replicate.delivery/out.webp")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download_and_upload_url",
               AsyncMock(return_value="https://cdn/out.png")):
        await editing_service.relight_image("https://cdn/in.png", "top-right")
    (_, params), _ = run.call_args
    assert params["light_source"] in {"None", "Left Light", "Right Light", "Top Light", "Bottom Light"}


async def test_restore_face_pins_a_version():
    """sczhou/codeformer also has no hot deployment -- same 404 as ic-light."""
    from app.services import editing_service

    run = AsyncMock(return_value="https://replicate.delivery/out.png")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download_and_upload_url",
               AsyncMock(return_value="https://cdn/out.png")):
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
