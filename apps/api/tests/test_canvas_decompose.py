"""Convert to Canvas runs on detection models, not on a language model's guess.

The endpoint used to ask Claude (or GPT-4o) to return, as JSON, the pixel
coordinates of every text element and object in the image, then cut the masks
with a local rembg (u2net). Vision-language models are weak at precise
localisation and u2net loses fine strands, so both halves of the result were
approximations -- and none of it was metered, so every conversion was unbilled
supplier spend.

These tests pin the replacement:
  - lucataco/florence-2-large runs TWICE, once per task mode, for text boxes
    and object boxes;
  - men1scus/birefnet runs ONCE, supplying the alpha that `_build_layers`
    splits into objects;
  - the endpoint is gated by require_credits("ai") like every sibling image
    operation.

Every assertion names the model AND its version string. That is deliberate:
a hallucinated model identifier has reached production in this codebase
before, and only a literal comparison catches one.
"""
import base64
import io
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient, ASGITransport
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.v1.routers import images as images_router
from app.core.billing import current_billing_period_start
from app.core.credits import PLAN_CREDITS
from app.core.database import Base, get_db
from app.core.dependencies import get_current_user
from app.main import app
from app.models.billing import OrgUsage
from app.models.image import GeneratedImage, ImageStatus, ImageStyle, ImageUsage
from app.models.organization import Organization, PlanTier
from app.models.project import Project
from app.models.user import User, UserRole

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

SQLITE_COMPATIBLE_TABLES = [
    "organizations", "users", "projects", "generated_images", "org_usage",
]

FAKE_ORG_ID = uuid.uuid4()
FAKE_USER_ID = uuid.uuid4()
FAKE_PROJECT_ID = uuid.uuid4()
FAKE_IMAGE_ID = uuid.uuid4()

fake_user = User(
    id=FAKE_USER_ID, org_id=FAKE_ORG_ID, email="canvas-test@fennex.ai",
    hashed_password="hashed", full_name="Canvas Test", role=UserRole.OWNER, is_active=True,
)

# Small enough that the real scipy diffusion inpaint runs in milliseconds, big
# enough that percentage conversion is not degenerate.
IMG_W, IMG_H = 96, 96


def _png(size=(IMG_W, IMG_H), mode="RGB", color=(30, 40, 60)) -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, color if mode == "RGB" else (*color, 255)).save(buf, format="PNG")
    return buf.getvalue()


def _cutout_png(size=(IMG_W, IMG_H)) -> bytes:
    """An RGBA cutout with one solid blob, the shape BiRefNet returns."""
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    for y in range(40, 90):
        for x in range(8, 80):
            img.putpixel((x, y), (200, 100, 50, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# Florence-2 returns {"img": uri, "text": "<python-literal string>"}; the text
# is a repr of the HuggingFace post-processed result, keyed by task token.
# Shapes taken from the model's own default example on Replicate.
OCR_TEXT = (
    "{'<OCR_WITH_REGION>': {'quad_boxes': "
    "[[10.0, 12.0, 50.0, 12.0, 50.0, 30.0, 10.0, 30.0]], "
    "'labels': ['</s>SALE']}}"
)
OD_TEXT = (
    "{'<OD>': {'bboxes': [[8.0, 40.0, 80.0, 90.0]], 'labels': ['sneaker']}}"
)


def _replicate_stub():
    """Stands in for the single supplier chokepoint, dispatching on the model."""
    async def run(model, params, version=None):
        if model == images_router._FLORENCE_MODEL:
            task = params["task_input"]
            if task == images_router._FLORENCE_TASK_OCR:
                return {"text": OCR_TEXT, "img": "https://replicate/ocr.png"}
            return {"text": OD_TEXT, "img": "https://replicate/od.png"}
        return "https://replicate/birefnet.png"
    return AsyncMock(side_effect=run)


def _download_stub():
    async def download(url):
        return _cutout_png() if "birefnet" in url else _png()
    return AsyncMock(side_effect=download)


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


async def _seed(ai_credits_used: int = 0):
    tables = [Base.metadata.tables[n] for n in SQLITE_COMPATIBLE_TABLES if n in Base.metadata.tables]
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=tables)
    async with TestSessionLocal() as session:
        session.add(Organization(id=FAKE_ORG_ID, slug="canvas-org", name="Canvas Org",
                                 plan_tier=PlanTier.STARTER))
        session.add(Project(id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, name="Site", domain="site.example"))
        session.add(GeneratedImage(
            id=FAKE_IMAGE_ID, org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID,
            prompt="a sneaker", style=ImageStyle.professional, usage=ImageUsage.custom,
            status=ImageStatus.ready, width=IMG_W, height=IMG_H,
            image_url="data:image/png;base64," + base64.b64encode(_png()).decode(),
        ))
        session.add(OrgUsage(org_id=FAKE_ORG_ID, period_start=current_billing_period_start(),
                             ai_credits_used=ai_credits_used))
        await session.commit()


async def _teardown():
    tables = [Base.metadata.tables[n] for n in SQLITE_COMPATIBLE_TABLES if n in Base.metadata.tables]
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all, tables=tables)


@pytest.fixture
async def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


async def _decompose(client):
    run = _replicate_stub()
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", _download_stub()):
        resp = await client.post(f"/api/v1/images/{FAKE_IMAGE_ID}/decompose", json={})
    return resp, run


# ── Model identifiers ────────────────────────────────────────────────────────

def test_model_identifiers_are_the_ones_verified_against_replicate():
    """Verified live against the Replicate API on 2026-08-03/04. A version
    string recalled from memory instead of resolved is how a nonexistent model
    reached production here before."""
    assert images_router._FLORENCE_MODEL == "lucataco/florence-2-large"
    assert images_router._FLORENCE_VERSION == (
        "da53547e17d45b9cfb48174b2f18af8b83ca020fa76db62136bf9c6616762595"
    )
    # task_input is an enum on the model; these two strings are its members.
    assert images_router._FLORENCE_TASK_OCR == "OCR with Region"
    assert images_router._FLORENCE_TASK_OBJECTS == "Object Detection"


# ── Wiring ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_decompose_runs_florence_twice_and_birefnet_once(client):
    from app.services import editing_service

    await _seed()
    try:
        resp, run = await _decompose(client)
        assert resp.status_code == 200, resp.text
    finally:
        await _teardown()

    calls = [(c.args[0], c.args[1], c.kwargs.get("version")) for c in run.call_args_list]
    florence = [c for c in calls if c[0] == images_router._FLORENCE_MODEL]
    birefnet = [c for c in calls if c[0] == editing_service._MODEL_BIREFNET]

    assert len(florence) == 2, f"expected two Florence-2 calls, got {calls}"
    assert {c[1]["task_input"] for c in florence} == {
        images_router._FLORENCE_TASK_OCR, images_router._FLORENCE_TASK_OBJECTS
    }
    assert all(c[2] == images_router._FLORENCE_VERSION for c in florence)

    assert len(birefnet) == 1, f"expected one BiRefNet call, got {calls}"
    assert birefnet[0][2] == editing_service._BIREFNET_VERSION
    # Asked for the source frame explicitly, not left to the model's default.
    assert birefnet[0][1]["resolution"] == f"{IMG_W}x{IMG_H}"

    # Three supplier calls in total: nothing else may creep in unmetered.
    assert len(calls) == 3, calls


@pytest.mark.asyncio
async def test_decompose_text_boxes_come_from_florence_ocr(client):
    """The returned box is Florence's detected quad, converted to percentages
    of the source frame -- not a language model's estimate."""
    await _seed()
    try:
        resp, _ = await _decompose(client)
        assert resp.status_code == 200, resp.text
        data = resp.json()
    finally:
        await _teardown()

    assert len(data["text_elements"]) == 1
    el = data["text_elements"][0]
    assert el["text"] == "SALE"  # the '</s>' sentinel Florence emits is stripped
    assert el["x_pct"] == pytest.approx(10 / IMG_W * 100, abs=0.01)
    assert el["y_pct"] == pytest.approx(12 / IMG_H * 100, abs=0.01)
    assert el["width_pct"] == pytest.approx(40 / IMG_W * 100, abs=0.01)
    assert el["height_pct"] == pytest.approx(18 / IMG_H * 100, abs=0.01)


@pytest.mark.asyncio
async def test_decompose_names_objects_from_florence_detection_labels(client):
    await _seed()
    try:
        resp, _ = await _decompose(client)
        assert resp.status_code == 200, resp.text
        data = resp.json()
    finally:
        await _teardown()

    assert data["objects"], "BiRefNet's alpha should have yielded one blob"
    assert any(o["description"] == "sneaker" for o in data["objects"])
    assert data["background"]["image_width"] == IMG_W
    assert data["background"]["image_height"] == IMG_H
    assert data["background"]["image_data"].startswith("data:image/png;base64,")


@pytest.mark.asyncio
async def test_decompose_no_longer_calls_a_language_model(client):
    """The LLM path is gone entirely -- not merely unused. A leftover
    `_decompose_with_anthropic` would be dead code that can be re-wired by
    accident."""
    assert not hasattr(images_router, "_decompose_with_anthropic")
    assert not hasattr(images_router, "_decompose_with_openai")
    assert not hasattr(images_router, "_DECOMPOSE_PROMPT")


# ── Credit gate ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_decompose_is_gated_by_require_credits(client):
    """Three paid Replicate calls per conversion. An ungated endpoint is
    unbilled supplier spend, which is what this defect was."""
    await _seed(ai_credits_used=PLAN_CREDITS["starter"])
    try:
        resp, run = await _decompose(client)
        assert resp.status_code == 429, resp.text
        detail = resp.json()["detail"]
        assert detail["code"] == "LIMIT_REACHED"
        assert detail["bucket"] == "ai"
        assert run.call_count == 0, "no supplier may be called once the gate refuses"
    finally:
        await _teardown()
