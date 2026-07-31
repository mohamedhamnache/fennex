import io
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from PIL import Image as PILImage

from app.services import editing_service


def _stored(url, width=64, height=48):
    """finalize/_upload_result now report the size they stored, not just a URL."""
    from app.services.image_output import StoredImage
    return StoredImage(url, width, height)



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
               AsyncMock(return_value=_stored("https://cdn/out.png"))):
        result = await editing_service.remove_background("https://cdn/x.png")

    # width/height are additive: ops now report the size they actually stored.
    assert result["ok"] is True
    assert result["image_url"] == "https://cdn/out.png"
    assert (result["width"], result["height"]) == (64, 48)


@pytest.mark.asyncio
async def test_the_remove_background_button_is_metered():
    """It was not. record_removebg was called only from auto-masking, so every
    click of the user-facing button made a PAID Remove.bg call billed to nobody.
    Metering now sits at the supplier chokepoint so every caller is covered."""
    import uuid as _uuid

    org = _uuid.uuid4()
    recorded = {}

    async def _fake_record(db, *, org_id, project_id, feature=None):
        recorded["org_id"], recorded["feature"] = org_id, feature
        return 200_000

    resp = httpx.Response(200, content=_rgba_png(),
                          request=httpx.Request("POST", "https://api.remove.bg/v1.0/removebg"))
    with patch("app.services.editing_service._download", AsyncMock(return_value=b"src")), \
         patch("httpx.AsyncClient.post", AsyncMock(return_value=resp)), \
         patch("app.core.metering_context.get_metering_org", lambda: org), \
         patch("app.services.metering.meter.record_removebg", _fake_record), \
         patch("app.services.editing_service._upload_result",
               AsyncMock(return_value=_stored("https://cdn/out.png"))):
        result = await editing_service.remove_background("https://cdn/x.png")

    assert result["ok"] is True
    assert recorded["org_id"] == org
    assert recorded["feature"] == "background_removal"


@pytest.mark.asyncio
async def test_auto_masking_meters_once_not_twice():
    """mask_service used to meter explicitly AND now goes through the chokepoint;
    doing both would bill the same supplier call twice."""
    import uuid as _uuid

    calls = []

    async def _fake_record(db, *, org_id, project_id, feature=None):
        calls.append(feature)
        return 200_000

    resp = httpx.Response(200, content=_rgba_png(),
                          request=httpx.Request("POST", "https://api.remove.bg/v1.0/removebg"))
    with patch("app.services.editing_service._download", AsyncMock(return_value=b"src")), \
         patch("httpx.AsyncClient.post", AsyncMock(return_value=resp)), \
         patch("app.core.metering_context.get_metering_org", lambda: _uuid.uuid4()), \
         patch("app.services.metering.meter.record_removebg", _fake_record):
        await editing_service._removebg_cutout("https://cdn/x.png", feature="auto_mask")

    assert calls == ["auto_mask"], f"expected exactly one charge, got {calls}"


@pytest.mark.asyncio
async def test_a_metering_failure_never_breaks_the_edit():
    resp = httpx.Response(200, content=_rgba_png(),
                          request=httpx.Request("POST", "https://api.remove.bg/v1.0/removebg"))
    with patch("app.services.editing_service._download", AsyncMock(return_value=b"src")), \
         patch("httpx.AsyncClient.post", AsyncMock(return_value=resp)), \
         patch("app.core.metering_context.get_metering_org",
               lambda: (_ for _ in ()).throw(RuntimeError("boom"))), \
         patch("app.services.editing_service._upload_result",
               AsyncMock(return_value=_stored("https://cdn/out.png"))):
        result = await editing_service.remove_background("https://cdn/x.png")
    assert result["ok"] is True
