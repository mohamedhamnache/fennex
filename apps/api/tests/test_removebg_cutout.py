import io
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from PIL import Image as PILImage

from app.services import editing_service


def _rgba_png(size=(8, 8)) -> bytes:
    """An RGBA PNG whose left half is opaque and right half transparent."""
    img = PILImage.new("RGBA", size, (255, 0, 0, 255))
    for x in range(size[0] // 2, size[0]):
        for y in range(size[1]):
            img.putpixel((x, y), (0, 0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_removebg_cutout_returns_rgba_preserving_alpha():
    resp = httpx.Response(200, content=_rgba_png(),
                          request=httpx.Request("POST", "https://api.remove.bg/v1.0/removebg"))
    with patch("app.services.editing_service._download", AsyncMock(return_value=b"src")), \
         patch("httpx.AsyncClient.post", AsyncMock(return_value=resp)):
        img = await editing_service._removebg_cutout("https://cdn/x.png")

    assert img.mode == "RGBA"
    assert img.getpixel((0, 0))[3] == 255   # opaque half
    assert img.getpixel((7, 0))[3] == 0     # transparent half


@pytest.mark.asyncio
async def test_removebg_cutout_raises_on_http_error():
    resp = httpx.Response(402, text="quota exceeded",
                          request=httpx.Request("POST", "https://api.remove.bg/v1.0/removebg"))
    with patch("app.services.editing_service._download", AsyncMock(return_value=b"src")), \
         patch("httpx.AsyncClient.post", AsyncMock(return_value=resp)):
        with pytest.raises(httpx.HTTPStatusError):
            await editing_service._removebg_cutout("https://cdn/x.png")


@pytest.mark.asyncio
async def test_remove_background_still_returns_an_uploaded_url():
    """The public wrapper keeps its dict contract after the extraction."""
    resp = httpx.Response(200, content=_rgba_png(),
                          request=httpx.Request("POST", "https://api.remove.bg/v1.0/removebg"))
    with patch("app.services.editing_service._download", AsyncMock(return_value=b"src")), \
         patch("httpx.AsyncClient.post", AsyncMock(return_value=resp)), \
         patch("app.services.editing_service._upload_result",
               AsyncMock(return_value="https://cdn/out.png")):
        result = await editing_service.remove_background("https://cdn/x.png")

    assert result == {"ok": True, "image_url": "https://cdn/out.png"}
