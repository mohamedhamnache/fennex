"""Tests for Task 3, Part B: premium environments and photographic controls
for Product Showcase.

Two layers:
- Catalog tests against `product_service.PRODUCT_SCENES` directly (no DB).
- Endpoint tests against POST /product/product-scene, following the same
  in-memory-SQLite harness pattern as tests/test_images.py. `_run_flux_kontext`
  is mocked so no real Replicate/network call is made; `increment_usage` is
  patched out the same way test_images.py does it.
"""
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.core.config import settings
from app.main import app
from app.models.billing import OrgUsage  # noqa: F401 — register with Base.metadata
from app.models.organization import Organization
from app.models.project import Project
from app.models.user import User, UserRole
from app.services.product_service import PRODUCT_SCENES


def _stored(url, width=64, height=48):
    """finalize/_upload_result now report the size they stored, not just a URL."""
    from app.services.image_output import StoredImage
    return StoredImage(url, width, height)


# ── Catalog tests (no DB) ───────────────────────────────────────────────────

_ORIGINAL_11 = [
    "cafe_table", "marble_countertop", "outdoor_nature", "home_living_room",
    "athlete_action", "model_studio", "white_studio", "gradient_studio",
    "floating_shadow", "food_table_scene", "desk_setup",
]

_PREMIUM_15 = [
    "white_studio", "luxury_studio", "bathroom", "spa", "travertine",
    "marble", "limestone", "botanical", "mediterranean", "luxury_hotel",
    "editorial", "lifestyle", "minimal", "scandinavian", "dark_luxury",
]


def test_all_11_original_scene_ids_still_resolve():
    assert len(_ORIGINAL_11) == 11
    for scene_id in _ORIGINAL_11:
        assert scene_id in PRODUCT_SCENES
        assert PRODUCT_SCENES[scene_id].get("label")
        assert PRODUCT_SCENES[scene_id].get("prompt_template")


def test_all_15_premium_scene_ids_exist_with_category_premium():
    assert len(_PREMIUM_15) == 15
    for scene_id in _PREMIUM_15:
        assert scene_id in PRODUCT_SCENES, f"missing premium scene id: {scene_id}"
        scene = PRODUCT_SCENES[scene_id]
        assert scene["category"] == "premium", f"{scene_id} category is {scene['category']!r}, not 'premium'"
        assert scene.get("label")
        assert scene.get("prompt_template")


def test_marble_is_distinct_from_marble_countertop():
    assert "marble" in PRODUCT_SCENES
    assert "marble_countertop" in PRODUCT_SCENES
    assert PRODUCT_SCENES["marble"]["prompt_template"] != PRODUCT_SCENES["marble_countertop"]["prompt_template"]
    assert PRODUCT_SCENES["marble"]["category"] == "premium"
    assert PRODUCT_SCENES["marble_countertop"]["category"] == "lifestyle"


def test_lifestyle_scene_id_is_distinct_from_lifestyle_category():
    # "lifestyle" the scene id (premium) must not collide with the
    # pre-existing "lifestyle" category used by cafe_table etc.
    assert "lifestyle" in PRODUCT_SCENES
    assert PRODUCT_SCENES["lifestyle"]["category"] == "premium"
    lifestyle_category_ids = [k for k, v in PRODUCT_SCENES.items() if v["category"] == "lifestyle"]
    assert "lifestyle" not in lifestyle_category_ids
    assert "cafe_table" in lifestyle_category_ids


def test_scene_catalog_has_exactly_25_ids_no_duplicates_no_accidental_overwrite():
    all_ids = set(_ORIGINAL_11) | set(_PREMIUM_15)
    assert len(all_ids) == 25, "11 original + 15 premium, with white_studio shared, is 25 unique ids"
    assert len(PRODUCT_SCENES) == 25


# ── Endpoint tests (SQLite in-memory harness, mirroring test_images.py) ─────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

SQLITE_COMPATIBLE_TABLES = [
    "organizations",
    "users",
    "projects",
    "brand_kits",
    "api_keys",
    "generated_images",
    "org_usage",
]

FAKE_ORG_ID = uuid.uuid4()
FAKE_USER_ID = uuid.uuid4()
FAKE_PROJECT_ID = uuid.uuid4()

fake_user = User(
    id=FAKE_USER_ID,
    org_id=FAKE_ORG_ID,
    email="test@fennex.ai",
    hashed_password="hashed",
    full_name="Test User",
    role=UserRole.OWNER,
    is_active=True,
)


async def override_get_db():
    async with TestSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def override_get_current_user():
    return fake_user


@pytest.fixture(autouse=True)
async def setup_db():
    tables = [
        Base.metadata.tables[name]
        for name in SQLITE_COMPATIBLE_TABLES
        if name in Base.metadata.tables
    ]
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=tables)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all, tables=tables)


@pytest.fixture
async def db_session():
    async with TestSessionLocal() as session:
        yield session


@pytest.fixture
async def org_and_project(db_session):
    org = Organization(id=FAKE_ORG_ID, slug="test-org", name="Test Org")
    db_session.add(org)
    await db_session.flush()
    project = Project(id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, name="Test Project", domain="example.com")
    db_session.add(project)
    await db_session.commit()
    return org, project


@pytest.fixture
async def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    with patch("app.api.v1.routers.product.increment_usage", new=AsyncMock()):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac
    app.dependency_overrides.clear()


def _mock_flux_result():
    return AsyncMock(return_value={
        "ok": True,
        "image_url": "https://cdn.example.com/product-scene.png",
        "width": 1024,
        "height": 1024,
        "revised_prompt": None,
        "cost_usd": None,
    })


BASE_BODY = {
    "product_image_url": "https://cdn.example.com/product.png",
    "product_description": "a ceramic mug with a matte black finish",
    "scene_id": "cafe_table",
}


@pytest.mark.asyncio
async def test_product_scene_with_only_old_fields_succeeds_with_defaults(client, org_and_project):
    """A request carrying only the pre-existing fields (no lighting/camera/
    aspect/creativity/etc.) must still succeed -- server-side defaults apply."""
    mock_run = _mock_flux_result()
    with patch.object(settings, "REPLICATE_API_KEY", "fake-key"), \
         patch("app.api.v1.routers.product._run_flux_kontext", mock_run):
        response = await client.post(
            "/api/v1/images/product-scene",
            json={**BASE_BODY, "project_id": str(FAKE_PROJECT_ID)},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    # Defaults applied: default aspect ratio 1:1 is what's forwarded to Replicate.
    mock_run.assert_awaited_once()
    _, kwargs = mock_run.call_args
    assert kwargs["aspect_ratio"] == "1:1"
    assert kwargs["seed"] is None
    assert data["seed"] is None


@pytest.mark.asyncio
async def test_product_scene_with_controls_puts_fragments_in_prompt(client, org_and_project):
    mock_run = _mock_flux_result()
    with patch.object(settings, "REPLICATE_API_KEY", "fake-key"), \
         patch("app.api.v1.routers.product._run_flux_kontext", mock_run):
        response = await client.post(
            "/api/v1/images/product-scene",
            json={
                **BASE_BODY,
                "project_id": str(FAKE_PROJECT_ID),
                "lighting": "golden_hour",
                "camera": "macro",
                "aspect_ratio": "16:9",
                "quality": "draft",
            },
        )
    assert response.status_code == 200
    data = response.json()
    assert "golden-hour" in data["prompt"] or "golden hour" in data["prompt"].lower()
    assert "macro close-up" in data["prompt"]
    assert "widescreen 16:9 aspect ratio" in data["prompt"]
    assert "draft quality" in data["prompt"]
    mock_run.assert_awaited_once()
    _, kwargs = mock_run.call_args
    assert kwargs["aspect_ratio"] == "16:9"


@pytest.mark.asyncio
async def test_product_scene_unknown_lighting_token_returns_422_not_500(client, org_and_project):
    response = await client.post(
        "/api/v1/images/product-scene",
        json={
            **BASE_BODY,
            "project_id": str(FAKE_PROJECT_ID),
            "lighting": "disco_ball",
        },
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_product_scene_unknown_scene_id_still_returns_400(client, org_and_project):
    response = await client.post(
        "/api/v1/images/product-scene",
        json={**BASE_BODY, "project_id": str(FAKE_PROJECT_ID), "scene_id": "not_a_real_scene"},
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_product_scene_seed_is_echoed_back(client, org_and_project):
    mock_run = _mock_flux_result()
    with patch.object(settings, "REPLICATE_API_KEY", "fake-key"), \
         patch("app.api.v1.routers.product._run_flux_kontext", mock_run):
        response = await client.post(
            "/api/v1/images/product-scene",
            json={**BASE_BODY, "project_id": str(FAKE_PROJECT_ID), "seed": 424242},
        )
    assert response.status_code == 200
    data = response.json()
    assert data["seed"] == 424242
    mock_run.assert_awaited_once()
    _, kwargs = mock_run.call_args
    assert kwargs["seed"] == 424242


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "aspect_ratio,stored_width,stored_height",
    [
        ("1:1", 1024, 1024),
        ("4:5", 816, 1024),
        ("3:2", 1024, 680),
        ("16:9", 1024, 576),
        ("9:16", 576, 1024),
    ],
)
async def test_run_flux_kontext_reports_the_size_it_actually_stored(
    aspect_ratio, stored_width, stored_height
):
    """Width/height were once hardcoded to 1024x1024 regardless of aspect_ratio,
    so a 16:9 image was persisted with the wrong dimensions. That was first fixed
    by deriving them from an aspect-ratio TABLE, which is still only a guess at
    what the model returned.

    They now come from the file actually stored, so the record cannot disagree
    with the bytes whatever the model does with the requested ratio.
    """
    from app.api.v1.routers.product import _run_flux_kontext

    with patch("app.api.v1.routers.product._replicate_run",
               AsyncMock(return_value="https://cdn.example.com/out.png")), \
         patch("app.api.v1.routers.product.finalize",
               AsyncMock(return_value=_stored("https://cdn.example.com/stored.png",
                                              stored_width, stored_height))):
        result = await _run_flux_kontext(
            "https://cdn.example.com/product.png", "a prompt", aspect_ratio=aspect_ratio
        )
    assert result["ok"] is True
    assert (result["width"], result["height"]) == (stored_width, stored_height)


@pytest.mark.asyncio
async def test_reported_dimensions_follow_the_file_not_the_aspect_table():
    """If the model returns something the requested ratio did not predict, the
    stored file wins -- the point of measuring instead of guessing."""
    from app.api.v1.routers.product import _run_flux_kontext

    with patch("app.api.v1.routers.product._replicate_run",
               AsyncMock(return_value="https://cdn.example.com/out.png")), \
         patch("app.api.v1.routers.product.finalize",
               AsyncMock(return_value=_stored("https://cdn.example.com/stored.png", 1536, 864))):
        result = await _run_flux_kontext(
            "https://cdn.example.com/product.png", "a prompt", aspect_ratio="1:1"
        )
    # 1:1 would have predicted 1024x1024; the file says otherwise and wins.
    assert (result["width"], result["height"]) == (1536, 864)


@pytest.mark.asyncio
async def test_premium_scene_id_generates_successfully(client, org_and_project):
    """A spot-check that a premium scene id (the frontend already ships
    against these) does not 400 and produces its curated environment text."""
    mock_run = _mock_flux_result()
    with patch.object(settings, "REPLICATE_API_KEY", "fake-key"), \
         patch("app.api.v1.routers.product._run_flux_kontext", mock_run):
        response = await client.post(
            "/api/v1/images/product-scene",
            json={**BASE_BODY, "project_id": str(FAKE_PROJECT_ID), "scene_id": "dark_luxury"},
        )
    assert response.status_code == 200
    data = response.json()
    assert "chiaroscuro" in data["prompt"] or "spotlight" in data["prompt"]
