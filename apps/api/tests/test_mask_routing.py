"""Task 4: wire the manual edit router to mask_service.resolve_mask.

_mask_for is the single seam between the router and mask_service. It always
returns a MaskResolution -- for a painted (or previously confirmed) mask it
synthesises one itself; otherwise it forwards resolve_mask's own result
untouched, including the needs_confirmation state that flux-fill-prompted
masks require before they can be applied.

_resolve_mask_url is the router's own boundary for user-supplied masks: a
freshly painted mask_base64, or a mask_url the client is re-submitting on the
confirmation round trip. The latter is fetched server-side, so it must be
validated with is_own_storage_url first -- an unvalidated client URL is a
request-forgery primitive.
"""
import uuid
from unittest.mock import AsyncMock, patch

import pytest

from app.api.v1.routers import editing
from app.services.mask_service import AMBIGUITY_QUESTION, MaskResolution


# ---- _mask_for --------------------------------------------------------


@pytest.mark.asyncio
async def test_painted_mask_wins_over_auto_resolution():
    """A deliberate user selection is never overridden."""
    resolve = AsyncMock()
    with patch("app.api.v1.routers.editing.resolve_mask", resolve), \
         patch("app.api.v1.routers.editing._resolve_mask_url",
               AsyncMock(return_value="https://cdn/painted.png")):
        res = await editing._mask_for(
            "replace_background", {"mask_base64": "data:image/png;base64,AAA"},
            "https://cdn/x.png", uuid.uuid4(), None,
        )

    assert res.ok is True
    assert res.mask_url == "https://cdn/painted.png"
    assert res.error is None
    assert res.needs_confirmation is False
    resolve.assert_not_awaited()


@pytest.mark.asyncio
async def test_missing_mask_falls_back_to_auto_resolution():
    with patch("app.api.v1.routers.editing._resolve_mask_url", AsyncMock(return_value=None)), \
         patch("app.api.v1.routers.editing.resolve_mask",
               AsyncMock(return_value=MaskResolution(ok=True, mask_url="https://cdn/auto.png",
                                                     tier="product"))):
        res = await editing._mask_for(
            "replace_background", {}, "https://cdn/x.png", uuid.uuid4(), None,
        )

    assert res.ok is True
    assert res.mask_url == "https://cdn/auto.png"
    assert res.tier == "product"
    assert res.needs_confirmation is False


@pytest.mark.asyncio
async def test_target_param_is_forwarded_to_the_resolver():
    resolve = AsyncMock(return_value=MaskResolution(ok=True, mask_url="https://cdn/a.png"))
    with patch("app.api.v1.routers.editing._resolve_mask_url", AsyncMock(return_value=None)), \
         patch("app.api.v1.routers.editing.resolve_mask", resolve):
        await editing._mask_for("remove_object", {"target": "the person on the left"},
                                "https://cdn/x.png", uuid.uuid4(), None)

    args, _ = resolve.call_args
    assert args[2] == "the person on the left"


@pytest.mark.asyncio
async def test_ambiguous_resolution_is_passed_through_with_its_question():
    with patch("app.api.v1.routers.editing._resolve_mask_url", AsyncMock(return_value=None)), \
         patch("app.api.v1.routers.editing.resolve_mask",
               AsyncMock(return_value=MaskResolution(ok=False, question=AMBIGUITY_QUESTION))):
        res = await editing._mask_for(
            "insert_object", {"prompt": "a vase"}, "https://cdn/x.png", uuid.uuid4(), None,
        )

    assert res.ok is False
    assert res.question == AMBIGUITY_QUESTION
    assert res.needs_confirmation is False
    assert res.mask_url is None


@pytest.mark.asyncio
async def test_resolver_failure_is_passed_through_without_a_question():
    """A supplier outage is not a question -- the client must not re-prompt the
    user for a target they already gave (or that was never the problem)."""
    with patch("app.api.v1.routers.editing._resolve_mask_url", AsyncMock(return_value=None)), \
         patch("app.api.v1.routers.editing.resolve_mask",
               AsyncMock(return_value=MaskResolution(ok=False, error="remove.bg 402"))):
        res = await editing._mask_for(
            "replace_background", {}, "https://cdn/x.png", uuid.uuid4(), None,
        )

    assert res.ok is False
    assert res.question is None
    assert "remove.bg 402" in res.error
    assert res.needs_confirmation is False


@pytest.mark.asyncio
async def test_prompted_tier_confirmation_is_passed_through_unmodified():
    """The prompted tier hands back a good mask that still needs the user's
    sign-off -- ok=False here is not an error, and _mask_for must not collapse
    it into one."""
    derived = MaskResolution(ok=False, needs_confirmation=True,
                              mask_url="https://cdn/derived.png", tier="prompted")
    with patch("app.api.v1.routers.editing._resolve_mask_url", AsyncMock(return_value=None)), \
         patch("app.api.v1.routers.editing.resolve_mask", AsyncMock(return_value=derived)):
        res = await editing._mask_for(
            "remove_object", {"target": "the red car"}, "https://cdn/x.png", uuid.uuid4(), None,
        )

    assert res is derived
    assert res.needs_confirmation is True
    assert res.mask_url == "https://cdn/derived.png"


@pytest.mark.asyncio
async def test_invalid_mask_url_is_an_error_and_never_reaches_auto_resolution():
    """A rejected client-supplied mask_url must not silently fall through to
    auto-masking -- that would apply a mask the user never approved."""
    resolve = AsyncMock()
    with patch("app.api.v1.routers.editing.resolve_mask", resolve):
        res = await editing._mask_for(
            "replace_background", {"mask_url": "https://evil.example.com/masks/x.png"},
            "https://cdn/x.png", uuid.uuid4(), None,
        )

    assert res.ok is False
    assert res.needs_confirmation is False
    assert res.error
    resolve.assert_not_awaited()


# ---- _resolve_mask_url --------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_mask_url_uploads_a_painted_mask_base64():
    with patch("app.api.v1.routers.editing.upload_bytes",
               AsyncMock(return_value="https://cdn/masks/new.png")) as upload:
        result = await editing._resolve_mask_url({"mask_base64": "data:image/png;base64,AAAA"})

    assert result == "https://cdn/masks/new.png"
    upload.assert_awaited_once()


@pytest.mark.asyncio
async def test_resolve_mask_url_accepts_a_valid_own_storage_mask_url():
    # data: URLs are unconditionally "ours" per is_own_storage_url -- this
    # exercises the accept path without needing S3 config fixtures.
    own_url = "data:image/png;base64,iVBORw0KGgo="
    with patch("app.api.v1.routers.editing.upload_bytes", AsyncMock()) as upload:
        result = await editing._resolve_mask_url({"mask_url": own_url})

    assert result == own_url
    upload.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolve_mask_url_rejects_an_external_host_mask_url():
    with pytest.raises(ValueError):
        await editing._resolve_mask_url({"mask_url": "https://evil.example.com/masks/x.png"})


@pytest.mark.asyncio
async def test_resolve_mask_url_mask_base64_wins_over_mask_url():
    """mask_base64 (a freshly painted mask) takes precedence even when an
    invalid mask_url is also present -- the fresh paint should not be blocked
    by stale or bogus round-trip data."""
    with patch("app.api.v1.routers.editing.upload_bytes",
               AsyncMock(return_value="https://cdn/masks/fresh.png")) as upload:
        result = await editing._resolve_mask_url({
            "mask_base64": "data:image/png;base64,AAAA",
            "mask_url": "https://evil.example.com/masks/x.png",
        })

    assert result == "https://cdn/masks/fresh.png"
    upload.assert_awaited_once()
