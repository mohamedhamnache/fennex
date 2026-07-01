import io
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
