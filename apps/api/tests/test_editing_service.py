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
