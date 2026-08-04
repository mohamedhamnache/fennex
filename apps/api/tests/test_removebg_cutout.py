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
async def test_removebg_cutout_keeps_its_own_dict_free_contract():
    """The cutout returns an image and raises on failure; mask_service depends
    on that. remove_background no longer wraps it -- the user-facing button
    moved to BiRefNet (see tests/test_remove_background_birefnet.py) because
    remove.bg's `size: "auto"` was resolving to a 0.25 MP preview -- so this
    file now covers the cutout alone."""
    resp = httpx.Response(200, content=_rgba_png(),
                          request=httpx.Request("POST", "https://api.remove.bg/v1.0/removebg"))
    with patch("app.services.editing_service._download", AsyncMock(return_value=b"src")), \
         patch("httpx.AsyncClient.post", AsyncMock(return_value=resp)):
        img = await editing_service._removebg_cutout("https://cdn/x.png")

    assert (img.width, img.height) == (8, 8)


@pytest.mark.asyncio
async def test_every_removebg_call_is_metered_at_the_chokepoint():
    """The user-facing button used not to be metered at all: record_removebg
    was called only from auto-masking, so every click made a PAID supplier
    call billed to nobody. Metering now sits at the supplier chokepoint, so
    every caller is covered -- including the default feature label."""
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
         patch("app.services.metering.meter.record_removebg", _fake_record):
        await editing_service._removebg_cutout("https://cdn/x.png")

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
               lambda: (_ for _ in ()).throw(RuntimeError("boom"))):
        img = await editing_service._removebg_cutout("https://cdn/x.png")
    assert img.mode == "RGBA"
