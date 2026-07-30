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
import json
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.v1.routers import editing
from app.core.database import Base, get_db
from app.core.dependencies import get_current_user
from app.main import app
from app.models.billing import OrgUsage  # noqa: F401 -- register with Base.metadata
from app.models.image import GeneratedImage, ImageStatus
from app.models.organization import Organization
from app.models.project import Project
from app.models.user import User, UserRole
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


@pytest.mark.asyncio
async def test_resolve_mask_url_rejects_a_present_but_empty_mask_url():
    """params={"mask_url": ""} must be rejected, not treated as absent --
    truthiness would silently fall through to auto-resolution and spend on a
    second paid segmenter call plus another confirmation round trip."""
    with pytest.raises(ValueError):
        await editing._resolve_mask_url({"mask_url": ""})


@pytest.mark.asyncio
async def test_resolve_mask_url_rejects_a_present_but_none_mask_url():
    with pytest.raises(ValueError):
        await editing._resolve_mask_url({"mask_url": None})


@pytest.mark.asyncio
async def test_mask_for_does_not_auto_resolve_when_mask_url_is_present_but_empty():
    """Same guarantee at the _mask_for level: an empty mask_url must surface
    as an error, never silently reach resolve_mask."""
    resolve = AsyncMock()
    with patch("app.api.v1.routers.editing.resolve_mask", resolve):
        res = await editing._mask_for(
            "replace_background", {"mask_url": ""}, "https://cdn/x.png", uuid.uuid4(), None,
        )

    assert res.ok is False
    assert res.needs_confirmation is False
    assert res.error
    resolve.assert_not_awaited()


# ---- route-level: POST /images/{image_id}/edit --------------------------
#
# The unit tests above pin _mask_for and _resolve_mask_url in isolation, but
# nothing above exercises edit_image itself -- so a bug in how the route
# reads a MaskResolution back (branch order, or how the mask is handed to the
# service function) could ship green anyway. Two regressions this section
# specifically targets:
#
#   (a) branch order: `if res.needs_confirmation` must be checked BEFORE
#       `if not res.ok`. The prompted tier deliberately returns ok=False, so
#       swapping the order would fall the prompted-tier case into the plain
#       error branch (error=None, needs_target=False) and the confirmation
#       UI would never appear.
#   (b) keyword passing: `kwargs["mask_url"] = res.mask_url` must stay a
#       keyword assignment. A sibling router (ai_command.py) shipped exactly
#       a positional prompt/mask swap recently; test_keyword_passing below
#       asserts the mask lands under the "mask_url" keyword with the correct
#       value, not merged into "prompt" or passed positionally.
#
# Harness follows tests/test_product_showcase.py and tests/test_credit_enforcement.py:
# in-memory SQLite + get_db/get_current_user dependency overrides.

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
_route_test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
_RouteTestSessionLocal = async_sessionmaker(_route_test_engine, expire_on_commit=False, class_=AsyncSession)

_ROUTE_SQLITE_TABLES = ["organizations", "users", "projects", "generated_images", "org_usage", "api_keys"]

_ROUTE_ORG_ID = uuid.uuid4()
_ROUTE_USER_ID = uuid.uuid4()
_ROUTE_PROJECT_ID = uuid.uuid4()
_ROUTE_IMAGE_ID = uuid.uuid4()

_route_fake_user = User(
    id=_ROUTE_USER_ID, org_id=_ROUTE_ORG_ID, email="mask-route-test@fennex.ai",
    hashed_password="hashed", full_name="Mask Route Test", role=UserRole.OWNER, is_active=True,
)


async def _route_override_get_db():
    async with _RouteTestSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def _route_override_get_current_user():
    return _route_fake_user


@pytest.fixture
async def mask_route_client():
    tables = [Base.metadata.tables[name] for name in _ROUTE_SQLITE_TABLES if name in Base.metadata.tables]
    async with _route_test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=tables)

    async with _RouteTestSessionLocal() as session:
        session.add(Organization(id=_ROUTE_ORG_ID, slug="mask-route-org", name="Mask Route Org"))
        session.add(Project(id=_ROUTE_PROJECT_ID, org_id=_ROUTE_ORG_ID, name="Site", domain="site.example"))
        session.add(GeneratedImage(
            id=_ROUTE_IMAGE_ID, org_id=_ROUTE_ORG_ID, project_id=_ROUTE_PROJECT_ID,
            prompt="a red fox", status=ImageStatus.ready, image_url="https://cdn/x.png",
        ))
        await session.commit()

    app.dependency_overrides[get_db] = _route_override_get_db
    app.dependency_overrides[get_current_user] = _route_override_get_current_user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()
        async with _route_test_engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all, tables=tables)


async def _post_edit(client, operation: str, params: dict):
    return await client.post(
        f"/api/v1/images/{_ROUTE_IMAGE_ID}/edit",
        json={"operation": operation, "params": params},
    )


@pytest.mark.asyncio
async def test_route_painted_mask_succeeds_and_passes_mask_by_keyword(mask_route_client):
    """Regression (b): the mask must reach the service function under the
    "mask_url" keyword, with the prompt intact under its own keyword -- a
    positional append (the sibling-router bug) would either swap the two or
    raise a duplicate-argument TypeError."""
    mock_fn = AsyncMock(return_value={"ok": True, "image_url": "https://cdn/edited.png"})
    with patch.dict(editing._DISPATCH, {"replace_background": (mock_fn, ["prompt"], [])}), \
         patch("app.api.v1.routers.editing.upload_bytes",
               AsyncMock(return_value="https://cdn/masks/painted.png")):
        resp = await _post_edit(mask_route_client, "replace_background", {
            "prompt": "a marble backdrop",
            "mask_base64": "data:image/png;base64,AAAA",
        })

    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["image_url"] == "https://cdn/edited.png"

    mock_fn.assert_awaited_once()
    _, kwargs = mock_fn.call_args
    assert kwargs["mask_url"] == "https://cdn/masks/painted.png"
    assert kwargs["prompt"] == "a marble backdrop"


@pytest.mark.asyncio
async def test_route_product_tier_auto_resolution_succeeds(mask_route_client):
    resolution = MaskResolution(ok=True, mask_url="https://cdn/masks/auto.png", tier="product")
    mock_fn = AsyncMock(return_value={"ok": True, "image_url": "https://cdn/edited.png"})
    with patch.dict(editing._DISPATCH, {"replace_background": (mock_fn, ["prompt"], [])}), \
         patch("app.api.v1.routers.editing.resolve_mask", AsyncMock(return_value=resolution)):
        resp = await _post_edit(mask_route_client, "replace_background", {"prompt": "a marble backdrop"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    _, kwargs = mock_fn.call_args
    assert kwargs["mask_url"] == "https://cdn/masks/auto.png"


@pytest.mark.asyncio
async def test_route_prompted_tier_returns_needs_confirmation_without_calling_the_service(mask_route_client):
    """Regression (a): if `if not res.ok` were checked before
    `if res.needs_confirmation`, this response would come back as a plain
    ok=False error with needs_confirmation defaulted to False and the
    confirmation UI would never appear."""
    resolution = MaskResolution(ok=False, needs_confirmation=True,
                                mask_url="https://cdn/masks/derived.png", tier="prompted")
    mock_fn = AsyncMock()
    with patch.dict(editing._DISPATCH, {"remove_object": (mock_fn, [], [])}), \
         patch("app.api.v1.routers.editing.resolve_mask", AsyncMock(return_value=resolution)):
        resp = await _post_edit(mask_route_client, "remove_object", {"target": "the red car"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is False
    assert data["needs_confirmation"] is True
    assert data["mask_url"] == "https://cdn/masks/derived.png"
    assert data["error"] == "Confirm the highlighted area before applying."
    assert data["needs_target"] is False
    mock_fn.assert_not_awaited()


@pytest.mark.asyncio
async def test_route_ambiguous_target_returns_needs_target(mask_route_client):
    resolution = MaskResolution(ok=False, question=AMBIGUITY_QUESTION)
    mock_fn = AsyncMock()
    with patch.dict(editing._DISPATCH, {"insert_object": (mock_fn, ["prompt"], [])}), \
         patch("app.api.v1.routers.editing.resolve_mask", AsyncMock(return_value=resolution)):
        resp = await _post_edit(mask_route_client, "insert_object", {"prompt": "a vase"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is False
    assert data["needs_target"] is True
    assert data["needs_confirmation"] is False
    assert data["error"] == AMBIGUITY_QUESTION
    mock_fn.assert_not_awaited()


@pytest.mark.asyncio
async def test_route_resolver_error_surfaces_without_needs_target(mask_route_client):
    resolution = MaskResolution(ok=False, error="remove.bg 402")
    mock_fn = AsyncMock()
    with patch.dict(editing._DISPATCH, {"replace_background": (mock_fn, ["prompt"], [])}), \
         patch("app.api.v1.routers.editing.resolve_mask", AsyncMock(return_value=resolution)):
        resp = await _post_edit(mask_route_client, "replace_background", {"prompt": "a marble backdrop"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is False
    assert data["needs_target"] is False
    assert data["needs_confirmation"] is False
    assert "remove.bg 402" in data["error"]
    mock_fn.assert_not_awaited()


# ---- Task 5: app.api.v1.routers.ai_command -------------------------------
#
# _mask_for_step is the ai-command chain's analogue of editing._mask_for: it
# resolves ONE step's mask against the EVOLVING image (step N masks against
# step N-1's output), and unlike editing.py's EditOut it cannot hand the
# needs_confirmation / needs_target states back as a 200 -- an intermediate
# step in a multi-step chain has no partial-success shape to return, so both
# become a structured 422 that aborts the whole chain.
#
# _resolve_mask_queue (ai_command's own copy, request-body-shaped rather than
# params-dict-shaped) is the request-level counterpart to editing.py's
# _resolve_mask_url: mask_base64 wins over the queue's first position, and a
# present-but-empty mask_urls (as a whole, or any single entry within it)
# must be rejected rather than silently treated as absent -- Task 4 hit
# exactly this bug (a falsy value fell through and triggered a second paid
# segmenter call).
#
# Review fix (finding 1): a single resolved mask used to be threaded into
# EVERY step of the chain unconditionally, so a mask confirmed for step 1
# was silently reused for step 2 instead of step 2 resolving its own region.
# mask_urls is now an ORDERED QUEUE: _next_step_mask hands the Nth
# mask-requiring step the Nth queue entry, counting only mask-requiring
# steps (a non-mask step in between does not consume a position), and a step
# beyond the queue's length auto-resolves normally via resolve_mask.

from fastapi import HTTPException

from app.api.v1.routers import ai_command


@pytest.mark.asyncio
async def test_ai_command_auto_resolves_when_no_mask_painted():
    with patch("app.api.v1.routers.ai_command.resolve_mask",
               AsyncMock(return_value=MaskResolution(ok=True, mask_url="https://cdn/auto.png",
                                                     tier="product"))):
        mask_url = await ai_command._mask_for_step(
            {"operation": "replace_background", "params": {"prompt": "marble"}},
            "https://cdn/x.png", None, uuid.uuid4(), None,
        )
    assert mask_url == "https://cdn/auto.png"


@pytest.mark.asyncio
async def test_ai_command_painted_mask_wins():
    resolve = AsyncMock()
    with patch("app.api.v1.routers.ai_command.resolve_mask", resolve):
        mask_url = await ai_command._mask_for_step(
            {"operation": "replace_background", "params": {}},
            "https://cdn/x.png", "https://cdn/painted.png", uuid.uuid4(), None,
        )
    assert mask_url == "https://cdn/painted.png"
    resolve.assert_not_awaited()


@pytest.mark.asyncio
async def test_ai_command_ambiguity_raises_422_with_a_structured_detail():
    with patch("app.api.v1.routers.ai_command.resolve_mask",
               AsyncMock(return_value=MaskResolution(ok=False, question=AMBIGUITY_QUESTION))):
        with pytest.raises(HTTPException) as exc:
            await ai_command._mask_for_step(
                {"operation": "insert_object", "params": {"prompt": "a vase"}},
                "https://cdn/x.png", None, uuid.uuid4(), None,
            )

    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "mask_target_required"
    assert exc.value.detail["message"] == AMBIGUITY_QUESTION


@pytest.mark.asyncio
async def test_ai_command_skips_resolution_for_maskless_operations():
    resolve = AsyncMock()
    with patch("app.api.v1.routers.ai_command.resolve_mask", resolve):
        mask_url = await ai_command._mask_for_step(
            {"operation": "upscale", "params": {"scale": 2}},
            "https://cdn/x.png", None, uuid.uuid4(), None,
        )
    assert mask_url is None
    resolve.assert_not_awaited()


@pytest.mark.asyncio
async def test_ai_command_needs_confirmation_raises_422_with_mask_url():
    """The prompted tier hands back a good mask that still needs the user's
    sign-off (ok=False, needs_confirmation=True) -- this is neither an
    ambiguity question nor an error and must not be collapsed into either."""
    derived = MaskResolution(ok=False, needs_confirmation=True,
                              mask_url="https://cdn/derived.png", tier="prompted")
    with patch("app.api.v1.routers.ai_command.resolve_mask", AsyncMock(return_value=derived)):
        with pytest.raises(HTTPException) as exc:
            await ai_command._mask_for_step(
                {"operation": "remove_object", "params": {"target": "the red car"}},
                "https://cdn/x.png", None, uuid.uuid4(), None,
            )

    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "mask_confirm_required"
    assert exc.value.detail["message"] == "Confirm the highlighted area before applying."
    assert exc.value.detail["mask_url"] == "https://cdn/derived.png"


@pytest.mark.asyncio
async def test_ai_command_resolver_error_raises_422_with_mask_unavailable():
    with patch("app.api.v1.routers.ai_command.resolve_mask",
               AsyncMock(return_value=MaskResolution(ok=False, error="remove.bg 402"))):
        with pytest.raises(HTTPException) as exc:
            await ai_command._mask_for_step(
                {"operation": "replace_background", "params": {}},
                "https://cdn/x.png", None, uuid.uuid4(), None,
            )

    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "mask_unavailable"
    assert "remove.bg 402" in exc.value.detail["message"]


@pytest.mark.asyncio
async def test_ai_command_needs_confirmation_carries_the_step_index():
    """Without step_index in the 422 detail, a client cannot tell which
    position in mask_urls to fill on the next confirmation round trip --
    this is what makes a two-confirmation chain usable at all."""
    derived = MaskResolution(ok=False, needs_confirmation=True,
                              mask_url="https://cdn/derived.png", tier="prompted")
    with patch("app.api.v1.routers.ai_command.resolve_mask", AsyncMock(return_value=derived)):
        with pytest.raises(HTTPException) as exc:
            await ai_command._mask_for_step(
                {"operation": "remove_object", "params": {"target": "the red car"}},
                "https://cdn/x.png", None, uuid.uuid4(), None, step_index=1,
            )

    assert exc.value.detail["step_index"] == 1


# ---- ai_command._resolve_mask_queue (request-level precedence + validation) --


@pytest.mark.asyncio
async def test_ai_command_resolve_mask_queue_uploads_a_painted_mask_base64():
    body = ai_command.AiCommandRequest(command="x", mask_base64="data:image/png;base64,AAAA")
    with patch("app.api.v1.routers.ai_command.upload_bytes",
               AsyncMock(return_value="https://cdn/masks/new.png")) as upload:
        result = await ai_command._resolve_mask_queue(body)

    assert result == ["https://cdn/masks/new.png"]
    upload.assert_awaited_once()


@pytest.mark.asyncio
async def test_ai_command_resolve_mask_queue_accepts_a_valid_own_storage_mask_url():
    # data: URLs are unconditionally "ours" per is_own_storage_url -- this
    # exercises the accept path without needing S3 config fixtures.
    own_url = "data:image/png;base64,iVBORw0KGgo="
    body = ai_command.AiCommandRequest(command="x", mask_urls=[own_url])
    with patch("app.api.v1.routers.ai_command.upload_bytes", AsyncMock()) as upload:
        result = await ai_command._resolve_mask_queue(body)

    assert result == [own_url]
    upload.assert_not_awaited()


@pytest.mark.asyncio
async def test_ai_command_resolve_mask_queue_preserves_multi_entry_order():
    urls = ["data:image/png;base64,AAA", "data:image/png;base64,BBB"]
    body = ai_command.AiCommandRequest(command="x", mask_urls=urls)
    result = await ai_command._resolve_mask_queue(body)

    assert result == urls


@pytest.mark.asyncio
async def test_ai_command_resolve_mask_queue_rejects_an_external_host_entry():
    body = ai_command.AiCommandRequest(command="x", mask_urls=["https://evil.example.com/masks/x.png"])
    with pytest.raises(ValueError):
        await ai_command._resolve_mask_queue(body)


@pytest.mark.asyncio
async def test_ai_command_resolve_mask_queue_rejects_an_invalid_entry_anywhere_in_the_list():
    """A bad entry NOT in the first position must still abort the whole
    request -- every entry is validated eagerly before any step runs."""
    body = ai_command.AiCommandRequest(command="x", mask_urls=[
        "data:image/png;base64,AAA",
        "https://evil.example.com/masks/x.png",
    ])
    with pytest.raises(ValueError):
        await ai_command._resolve_mask_queue(body)


@pytest.mark.asyncio
async def test_ai_command_resolve_mask_queue_mask_base64_overwrites_queue_position_zero():
    """mask_base64 (a freshly painted mask) takes precedence over the entry
    that would otherwise occupy the first mask-requiring step's position --
    the fresh paint should not be blocked by stale or bogus round-trip data,
    and applies only to that first position, leaving later entries intact."""
    body = ai_command.AiCommandRequest(
        command="x",
        mask_base64="data:image/png;base64,AAAA",
        mask_urls=["https://evil.example.com/masks/x.png", "data:image/png;base64,BBB"],
    )
    with patch("app.api.v1.routers.ai_command.upload_bytes",
               AsyncMock(return_value="https://cdn/masks/fresh.png")) as upload:
        result = await ai_command._resolve_mask_queue(body)

    assert result == ["https://cdn/masks/fresh.png", "data:image/png;base64,BBB"]
    upload.assert_awaited_once()


@pytest.mark.asyncio
async def test_ai_command_resolve_mask_queue_rejects_a_present_but_empty_list_entry():
    """A single "" entry inside the list must be rejected, not skipped over
    while the rest of the queue is used -- silently dropping it would shift
    every later entry onto the wrong step."""
    body = ai_command.AiCommandRequest(command="x", mask_urls=["data:image/png;base64,AAA", ""])
    with pytest.raises(ValueError):
        await ai_command._resolve_mask_queue(body)


@pytest.mark.asyncio
async def test_ai_command_resolve_mask_queue_rejects_an_explicit_null_mask_urls():
    """Regression test for finding 3: `{"mask_urls": null}` is PRESENT
    (model_fields_set contains it) but empty -- it must be rejected like any
    other present-but-empty value, not treated as "field omitted, all steps
    auto-resolve". This exercises the exact JSON-null path FastAPI produces
    for `body: AiCommandRequest` when a client sends a literal `null`."""
    body = ai_command.AiCommandRequest.model_validate(
        json.loads('{"command": "x", "mask_urls": null}')
    )
    assert "mask_urls" in body.model_fields_set
    assert body.mask_urls is None

    with pytest.raises(ValueError):
        await ai_command._resolve_mask_queue(body)


@pytest.mark.asyncio
async def test_ai_command_resolve_mask_queue_omitted_field_is_absent_not_null():
    """Companion to the explicit-null test above: omitting mask_urls
    entirely must NOT land in model_fields_set, and must resolve to an empty
    queue (every step auto-resolves) rather than raising."""
    body = ai_command.AiCommandRequest.model_validate(json.loads('{"command": "x"}'))
    assert "mask_urls" not in body.model_fields_set

    result = await ai_command._resolve_mask_queue(body)
    assert result == []


@pytest.mark.asyncio
async def test_ai_command_resolve_mask_queue_returns_empty_list_when_absent():
    body = ai_command.AiCommandRequest(command="x")
    with patch("app.api.v1.routers.ai_command.upload_bytes", AsyncMock()) as upload:
        result = await ai_command._resolve_mask_queue(body)

    assert result == []
    upload.assert_not_awaited()


# ---- ai_command._next_step_mask (per-chain-step queue consumption) --------
#
# Review fix (finding 1) coverage: a chain resolves one queue entry PER
# MASK-REQUIRING STEP, in order, not one mask reused for the whole chain.


@pytest.mark.asyncio
async def test_next_step_mask_one_supplied_first_step_uses_it_second_auto_resolves():
    """The exact scenario finding 1 flagged: with only one mask supplied for
    a two-mask-step chain, step 1 must use it and step 2 must resolve its
    OWN region rather than reusing step 1's mask."""
    resolve = AsyncMock(return_value=MaskResolution(ok=True, mask_url="https://cdn/auto-step2.png",
                                                     tier="product"))
    queue = ["https://cdn/painted-step1.png"]
    with patch("app.api.v1.routers.ai_command.resolve_mask", resolve):
        mask1, idx = await ai_command._next_step_mask(
            {"operation": "replace_background", "params": {}},
            "https://cdn/x.png", queue, 0, uuid.uuid4(), None,
        )
        resolve.assert_not_awaited()
        assert mask1 == "https://cdn/painted-step1.png"
        assert idx == 1

        mask2, idx = await ai_command._next_step_mask(
            {"operation": "remove_object", "params": {}},
            "https://cdn/step1-result.png", queue, idx, uuid.uuid4(), None,
        )
        resolve.assert_awaited_once()
        assert mask2 == "https://cdn/auto-step2.png"
        assert idx == 2


@pytest.mark.asyncio
async def test_next_step_mask_two_supplied_each_step_gets_its_own_in_order():
    resolve = AsyncMock()
    queue = ["https://cdn/mask-a.png", "https://cdn/mask-b.png"]
    with patch("app.api.v1.routers.ai_command.resolve_mask", resolve):
        mask1, idx = await ai_command._next_step_mask(
            {"operation": "replace_background", "params": {}},
            "https://cdn/x.png", queue, 0, uuid.uuid4(), None,
        )
        mask2, idx = await ai_command._next_step_mask(
            {"operation": "remove_object", "params": {}},
            "https://cdn/step1-result.png", queue, idx, uuid.uuid4(), None,
        )

    assert mask1 == "https://cdn/mask-a.png"
    assert mask2 == "https://cdn/mask-b.png"
    assert idx == 2
    resolve.assert_not_awaited()


@pytest.mark.asyncio
async def test_next_step_mask_indexing_counts_only_mask_requiring_steps():
    """A non-mask step ahead of a mask step must NOT consume a queue
    position -- indexing tracks mask-requiring steps only."""
    resolve = AsyncMock()
    queue = ["https://cdn/mask-a.png"]
    with patch("app.api.v1.routers.ai_command.resolve_mask", resolve):
        non_mask, idx = await ai_command._next_step_mask(
            {"operation": "upscale", "params": {"scale": 2}},
            "https://cdn/x.png", queue, 0, uuid.uuid4(), None,
        )
        assert non_mask is None
        assert idx == 0  # unchanged -- upscale never touches the queue

        mask_result, idx = await ai_command._next_step_mask(
            {"operation": "replace_background", "params": {}},
            "https://cdn/upscaled.png", queue, idx, uuid.uuid4(), None,
        )

    assert mask_result == "https://cdn/mask-a.png"
    assert idx == 1
    resolve.assert_not_awaited()


@pytest.mark.asyncio
async def test_next_step_mask_needs_confirmation_carries_the_correct_step_index():
    derived = MaskResolution(ok=False, needs_confirmation=True,
                              mask_url="https://cdn/derived.png", tier="prompted")
    with patch("app.api.v1.routers.ai_command.resolve_mask", AsyncMock(return_value=derived)):
        with pytest.raises(HTTPException) as exc:
            await ai_command._next_step_mask(
                {"operation": "replace_background", "params": {}},
                "https://cdn/x.png", [], 1, uuid.uuid4(), None,
            )

    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "mask_confirm_required"
    assert exc.value.detail["step_index"] == 1


# ---- route-level: an invalid entry anywhere in the queue aborts the whole
# request before any step (and any resolve_mask auto-resolution) runs -------


@pytest.mark.asyncio
async def test_ai_command_route_rejects_invalid_queue_entry_before_any_step_runs():
    """Exercises the real route function's try/except around
    _resolve_mask_queue -- a bad entry must surface as 422 mask_url_invalid
    and resolve_mask (auto-resolution) must never be reached for any step,
    even one whose own supplied entry was valid."""
    source = SimpleNamespace(
        id=uuid.uuid4(), project_id=uuid.uuid4(), prompt="p", style="s", usage="u",
        image_url="https://cdn/x.png",
    )
    db = AsyncMock()
    db.execute = AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: source))
    current_user = SimpleNamespace(org_id=uuid.uuid4())

    body = ai_command.AiCommandRequest(
        command="replace the background then remove the object",
        mask_urls=["data:image/png;base64,AAA", "https://evil.example.com/masks/x.png"],
    )

    resolve = AsyncMock()
    with patch("app.api.v1.routers.ai_command.parse_ai_command_steps", AsyncMock(return_value={
                   "steps": [
                       {"operation": "replace_background", "params": {"prompt": "marble"}},
                       {"operation": "remove_object", "params": {}},
                   ],
               })), \
         patch("app.api.v1.routers.ai_command.project_locale", AsyncMock(return_value="en")), \
         patch("app.api.v1.routers.ai_command.resolve_mask", resolve):
        with pytest.raises(HTTPException) as exc:
            await ai_command.ai_command(uuid.uuid4(), body, current_user, db, None)

    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "mask_url_invalid"
    resolve.assert_not_awaited()
