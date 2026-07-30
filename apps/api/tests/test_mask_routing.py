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
