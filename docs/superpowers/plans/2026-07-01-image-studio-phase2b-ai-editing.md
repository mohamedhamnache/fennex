# Image Studio Phase 2B — AI Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Dependency:** This plan depends on Plan 2A (Brand Kit). Specifically: `app/core/storage.py` (Task 3 of Plan 2A), `boto3/Pillow/replicate` deps (Task 3 of Plan 2A), and `REMOVE_BG_API_KEY`/`REPLICATE_API_KEY` config settings (Task 3 of Plan 2A). Complete those before starting this plan.

**Goal:** Add non-destructive AI image editing to the studio — a dedicated edit page with a canvas (mask painting for generative ops), sidebar tool groups, dynamic controls, and a version strip showing the full edit chain.

**Architecture:** Each edit creates a new `GeneratedImage` record with `source_image_id` pointing at its source. Edits are applied by dispatching to `editing_service.py` (Pillow for basic ops, Remove.bg for background removal, Replicate predictions API for all generative AI ops). The edit page is a three-panel layout (tools sidebar | canvas | controls panel) with a version strip below the canvas. `EditCanvas` is a `forwardRef` component exposing `getMaskBase64()` via `useImperativeHandle` for mask-required operations.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, boto3, Pillow, Replicate predictions REST API, httpx, Next.js 14 App Router, React 18, TypeScript 5, TanStack Query v5, Tailwind CSS v3

## Global Constraints

- Python 3.11+, FastAPI, SQLAlchemy 2 async, Pydantic v2 — no sync DB calls
- Next.js 14 App Router, React 18, TypeScript 5
- Tailwind CSS v3 — CSS variables only (`bg-card`, `text-foreground`, `border-border`), never hard-code colors
- `cn()` from `@/lib/cn` for conditional classes; `@/` path aliases throughout
- TypeScript: 0 errors (`cd apps/web && npm run typecheck`)
- TDD: write failing test first, then implement
- Each edit is a new `GeneratedImage` row — never modify the source image (non-destructive)
- Alembic migration required for every DB column change; run `make db-migrate` after creating
- `REMOVE_BG_API_KEY` and `REPLICATE_API_KEY` must be in `.env` and `config.py` (added in Plan 2A Task 3)
- `upload_bytes()` from `app/core/storage.py` is available (added in Plan 2A Task 3)
- `boto3`, `Pillow`, `replicate` are installed (added in Plan 2A Task 3)

---

### Task 1: GeneratedImage model changes + migration

Add `source_image_id` (nullable FK to self) and `edit_operation` (nullable string) to the `GeneratedImage` model so every edit can trace its lineage.

**Files:**
- Modify: `apps/api/app/models/image.py`
- Create: `apps/api/alembic/versions/o3c4d5e6f7g8_image_edit_columns.py`
- Test: `apps/api/tests/test_edit_model.py`

**Interfaces:**
- Produces: `GeneratedImage.source_image_id`, `GeneratedImage.edit_operation` — consumed by Tasks 3, 4

- [ ] **Step 1: Write failing test**

```python
# apps/api/tests/test_edit_model.py
import pytest
from sqlalchemy import inspect
from app.core.database import async_engine


async def test_generated_image_has_source_image_id_column():
    async with async_engine.connect() as conn:
        insp = await conn.run_sync(inspect)
        cols = {c["name"] for c in insp.get_columns("generated_images")}
    assert "source_image_id" in cols
    assert "edit_operation" in cols
```

Run: `cd apps/api && pytest tests/test_edit_model.py -v`
Expected: FAIL (columns do not exist)

- [ ] **Step 2: Update GeneratedImage model**

```python
# apps/api/app/models/image.py — add to the GeneratedImage class, after existing columns:
from sqlalchemy import ForeignKey  # ensure this import exists

    source_image_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("generated_images.id", ondelete="SET NULL"), nullable=True
    )
    edit_operation: Mapped[str | None] = mapped_column(String(100), nullable=True)
```

- [ ] **Step 3: Generate migration**

```bash
docker compose exec api alembic revision --autogenerate -m "image_edit_columns"
```

Verify the generated file references both new columns. Check that `down_revision` is correct (should follow Plan 2A Brand Kit migration).

- [ ] **Step 4: Apply migration**

```bash
make db-migrate
```

Expected: `Running upgrade ... -> o3c4d5e6f7g8, image_edit_columns`

- [ ] **Step 5: Run test**

```bash
cd apps/api && pytest tests/test_edit_model.py -v
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/models/image.py apps/api/alembic/versions/o3c4d5e6f7g8_image_edit_columns.py apps/api/tests/test_edit_model.py
git commit -m "feat(editing): add source_image_id and edit_operation to GeneratedImage"
```

---

### Task 2: Basic editing service (Pillow)

Implement all non-AI editing operations using Pillow. Each function: download source image URL → apply transform → upload result to Supabase Storage → return public URL.

**Files:**
- Create: `apps/api/app/services/editing_service.py`
- Test: `apps/api/tests/test_editing_service.py`

**Interfaces:**
- Produces: `crop_image`, `resize_image`, `rotate_image`, `adjust_image`, `apply_filter`, `denoise_image`, `sharpen_image`
- Each function signature: `async (image_url: str, **params) -> dict` returning `{"ok": True, "image_url": str}` or `{"ok": False, "error": str}`
- Consumed by: Tasks 3 (extended), 4 (router dispatch)

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_editing_service.py
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
```

Run: `cd apps/api && pytest tests/test_editing_service.py -v`
Expected: FAIL (module not found)

- [ ] **Step 2: Create editing_service.py (basic ops)**

```python
# apps/api/app/services/editing_service.py
"""Image editing operations — Pillow (basic), Remove.bg, Replicate (AI/Advanced)."""
import asyncio
import io
import uuid
import httpx
from PIL import Image as PILImage, ImageEnhance, ImageFilter, ImageOps
from app.core.storage import upload_bytes


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _download(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.content


async def _upload_result(img: PILImage.Image, folder: str = "edits") -> str:
    buf = io.BytesIO()
    fmt = "PNG" if img.mode == "RGBA" else "JPEG"
    img.save(buf, format=fmt, quality=95)
    buf.seek(0)
    content_type = "image/png" if fmt == "PNG" else "image/jpeg"
    ext = "png" if fmt == "PNG" else "jpg"
    key = f"{folder}/{uuid.uuid4().hex}.{ext}"
    return await upload_bytes(buf.read(), key, content_type)


def _open(data: bytes) -> PILImage.Image:
    return PILImage.open(io.BytesIO(data)).convert("RGBA")


def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


# ── Basic ops (Pillow) ────────────────────────────────────────────────────────

async def crop_image(image_url: str, x: int, y: int, w: int, h: int) -> dict:
    try:
        data = await _download(image_url)
        img = _open(data)
        cropped = img.crop((x, y, x + w, y + h))
        url = await _upload_result(cropped)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def resize_image(image_url: str, width: int, height: int, keep_aspect: bool = True) -> dict:
    try:
        data = await _download(image_url)
        img = _open(data)
        if keep_aspect:
            img.thumbnail((width, height), PILImage.LANCZOS)
        else:
            img = img.resize((width, height), PILImage.LANCZOS)
        url = await _upload_result(img)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def rotate_image(image_url: str, angle: float, fill_color: str = "#000000") -> dict:
    try:
        data = await _download(image_url)
        img = _open(data)
        fill_rgb = _hex_to_rgb(fill_color)
        rotated = img.rotate(-angle, expand=True, fillcolor=fill_rgb + (255,))
        url = await _upload_result(rotated)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def adjust_image(image_url: str, brightness: float = 0, contrast: float = 0) -> dict:
    try:
        data = await _download(image_url)
        img = _open(data)
        if brightness != 0:
            factor = 1.0 + brightness / 100.0
            img = ImageEnhance.Brightness(img).enhance(max(0.0, factor))
        if contrast != 0:
            factor = 1.0 + contrast / 100.0
            img = ImageEnhance.Contrast(img).enhance(max(0.0, factor))
        url = await _upload_result(img)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


_FILTER_MAP = {
    "grayscale": lambda img: ImageOps.grayscale(img.convert("RGB")).convert("RGBA"),
    "sepia": _sepia := None,  # defined below
    "warm": lambda img: _color_shift(img, r=+20, g=+5, b=-10),
    "cool": lambda img: _color_shift(img, r=-10, g=+5, b=+20),
    "vivid": lambda img: ImageEnhance.Color(img).enhance(1.8),
}


def _color_shift(img: PILImage.Image, r: int = 0, g: int = 0, b: int = 0) -> PILImage.Image:
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    r_ch, g_ch, b_ch, a_ch = img.split()
    r_ch = r_ch.point(lambda x: min(255, max(0, x + r)))
    g_ch = g_ch.point(lambda x: min(255, max(0, x + g)))
    b_ch = b_ch.point(lambda x: min(255, max(0, x + b)))
    return PILImage.merge("RGBA", (r_ch, g_ch, b_ch, a_ch))


def _sepia_fn(img: PILImage.Image) -> PILImage.Image:
    grayscale = img.convert("L").convert("RGB")
    sepia = grayscale.convert("RGBA")
    sepia = _color_shift(sepia, r=+30, g=+10, b=-20)
    return sepia


_FILTER_MAP["sepia"] = _sepia_fn


async def apply_filter(image_url: str, filter_name: str) -> dict:
    if filter_name not in _FILTER_MAP:
        return {"ok": False, "error": f"Unknown filter: {filter_name}"}
    try:
        data = await _download(image_url)
        img = _open(data)
        result = _FILTER_MAP[filter_name](img)
        url = await _upload_result(result)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def denoise_image(image_url: str, strength: float = 0.5) -> dict:
    try:
        data = await _download(image_url)
        img = _open(data)
        passes = max(1, round(strength * 5))
        for _ in range(passes):
            img = img.filter(ImageFilter.MedianFilter(size=3))
        url = await _upload_result(img)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def sharpen_image(image_url: str, strength: float = 0.5) -> dict:
    try:
        data = await _download(image_url)
        img = _open(data)
        factor = 1.0 + strength * 3
        img = ImageEnhance.Sharpness(img).enhance(factor)
        url = await _upload_result(img)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}
```

- [ ] **Step 3: Run tests**

```bash
cd apps/api && pytest tests/test_editing_service.py -v
```

Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/app/services/editing_service.py apps/api/tests/test_editing_service.py
git commit -m "feat(editing): add basic editing service (Pillow: crop, resize, rotate, filters)"
```

---

### Task 3: AI editing service (Remove.bg + Replicate)

Extend `editing_service.py` with Remove.bg background removal and Replicate-powered generative operations. All Replicate calls use the predictions REST API with async polling.

**Files:**
- Modify: `apps/api/app/services/editing_service.py`
- Modify: `apps/api/tests/test_editing_service.py`

**Interfaces:**
- Consumes: `_download`, `_upload_result` helpers (Task 2)
- Produces:
  - `remove_background(image_url) -> dict`
  - `replace_background(image_url, mask_url, prompt) -> dict`
  - `remove_object(image_url, mask_url) -> dict`
  - `insert_object(image_url, mask_url, prompt) -> dict`
  - `generative_fill(image_url, mask_url, prompt) -> dict`
  - `smart_erase(image_url, mask_url) -> dict`
  - `generate_shadow(image_url, direction) -> dict`
  - `relight_image(image_url, direction, intensity) -> dict`
  - `restore_face(image_url, fidelity) -> dict`
  - `upscale_image(image_url, scale) -> dict`
- Consumed by: Task 4 (router dispatch)

- [ ] **Step 1: Write failing tests**

Add to `apps/api/tests/test_editing_service.py`:

```python
from unittest.mock import patch, AsyncMock
from app.services.editing_service import remove_background, upscale_image


@pytest.mark.asyncio
async def test_remove_background_success(monkeypatch):
    monkeypatch.setattr(
        "app.services.editing_service._download",
        AsyncMock(return_value=b"fakepng"),
    )
    monkeypatch.setattr(
        "app.services.editing_service._upload_result",
        AsyncMock(return_value="https://storage.example.com/nobg.png"),
    )

    async def fake_post(*args, **kwargs):
        class R:
            status_code = 200
            content = _make_test_png()
            def raise_for_status(self): pass
        return R()

    with patch("httpx.AsyncClient.post", fake_post):
        result = await remove_background("https://example.com/img.png")
    assert result["ok"] is True
    assert "nobg.png" in result["image_url"]


@pytest.mark.asyncio
async def test_upscale_image_polls_until_succeeded(monkeypatch):
    monkeypatch.setattr(
        "app.services.editing_service._download",
        AsyncMock(return_value=b"fakepng"),
    )
    monkeypatch.setattr(
        "app.services.editing_service._upload_result",
        AsyncMock(return_value="https://storage.example.com/upscaled.png"),
    )

    call_count = [0]

    async def fake_replicate_request(self, method, url, **kwargs):
        class R:
            status_code = 200
            def raise_for_status(self): pass
            def json(self):
                if method == "POST":
                    return {"id": "pred_abc", "status": "starting", "urls": {"get": "https://api.replicate.com/v1/predictions/pred_abc"}}
                call_count[0] += 1
                if call_count[0] < 2:
                    return {"id": "pred_abc", "status": "processing", "output": None}
                return {"id": "pred_abc", "status": "succeeded", "output": ["https://replicate.delivery/output.png"]}
        return R()

    with patch("httpx.AsyncClient.request", fake_replicate_request):
        with patch("asyncio.sleep", AsyncMock()):
            result = await upscale_image("https://example.com/img.png", scale=2)
    assert result["ok"] is True
```

Run: `cd apps/api && pytest tests/test_editing_service.py::test_remove_background_success tests/test_editing_service.py::test_upscale_image_polls_until_succeeded -v`
Expected: FAIL (functions not defined)

- [ ] **Step 2: Add Remove.bg function to editing_service.py**

```python
# apps/api/app/services/editing_service.py — append after sharpen_image:
from app.core.config import settings

# ── Remove.bg ─────────────────────────────────────────────────────────────────

async def remove_background(image_url: str) -> dict:
    """Background removal via Remove.bg API."""
    try:
        data = await _download(image_url)
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.remove.bg/v1.0/removebg",
                data={"size": "auto"},
                files={"image_file": ("image.png", data, "image/png")},
                headers={"X-Api-Key": settings.REMOVE_BG_API_KEY},
            )
            resp.raise_for_status()
            result_bytes = resp.content
        img = PILImage.open(io.BytesIO(result_bytes)).convert("RGBA")
        url = await _upload_result(img)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}
```

- [ ] **Step 3: Add Replicate helpers + AI ops to editing_service.py**

```python
# apps/api/app/services/editing_service.py — append after remove_background:
import base64
import time

# ── Replicate ─────────────────────────────────────────────────────────────────

_REPLICATE_API = "https://api.replicate.com/v1"
_POLL_INTERVAL = 3  # seconds
_POLL_TIMEOUT = 300  # 5 minutes


async def _replicate_run(model: str, input_params: dict) -> str:
    """Create a Replicate prediction and poll until succeeded. Returns output URL."""
    headers = {"Authorization": f"Token {settings.REPLICATE_API_KEY}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=60) as client:
        create_resp = await client.post(
            f"{_REPLICATE_API}/predictions",
            json={"version": model, "input": input_params},
            headers=headers,
        )
        create_resp.raise_for_status()
        prediction = create_resp.json()
        pred_id = prediction["id"]
        poll_url = prediction.get("urls", {}).get("get") or f"{_REPLICATE_API}/predictions/{pred_id}"

        deadline = time.monotonic() + _POLL_TIMEOUT
        while time.monotonic() < deadline:
            await asyncio.sleep(_POLL_INTERVAL)
            poll_resp = await client.get(poll_url, headers=headers)
            poll_resp.raise_for_status()
            status_data = poll_resp.json()
            status = status_data.get("status")
            if status == "succeeded":
                output = status_data.get("output")
                if isinstance(output, list):
                    return output[0]
                return str(output)
            if status in ("failed", "canceled"):
                raise RuntimeError(f"Replicate prediction {pred_id} {status}: {status_data.get('error')}")

        raise TimeoutError(f"Replicate prediction {pred_id} timed out after {_POLL_TIMEOUT}s")


async def _download_and_upload_url(url: str) -> str:
    """Download a result URL and re-upload to our own storage."""
    data = await _download(url)
    img = PILImage.open(io.BytesIO(data)).convert("RGBA")
    return await _upload_result(img)


# Replicate model slugs — verify latest version hashes at https://replicate.com/models
# before deploying. Format: "owner/name:version-hash"
_MODEL_FLUX_FILL = "black-forest-labs/flux-fill-pro"
_MODEL_REMOVE_OBJECT = "zylim0702/remove-object"
_MODEL_SD_INPAINT = "stability-ai/stable-diffusion-inpainting"
_MODEL_SHADOW = "fal-ai/shadow-generation"
_MODEL_IC_LIGHT = "zsxkib/ic-light"
_MODEL_CODEFORMER = "sczhou/codeformer"
_MODEL_REAL_ESRGAN = "nightmareai/real-esrgan"


async def replace_background(image_url: str, mask_url: str, prompt: str) -> dict:
    try:
        output = await _replicate_run(_MODEL_FLUX_FILL, {"image": image_url, "mask": mask_url, "prompt": prompt})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def remove_object(image_url: str, mask_url: str) -> dict:
    try:
        output = await _replicate_run(_MODEL_REMOVE_OBJECT, {"image": image_url, "mask": mask_url})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def insert_object(image_url: str, mask_url: str, prompt: str) -> dict:
    try:
        output = await _replicate_run(_MODEL_SD_INPAINT, {"image": image_url, "mask": mask_url, "prompt": prompt})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def generative_fill(image_url: str, mask_url: str, prompt: str) -> dict:
    try:
        output = await _replicate_run(_MODEL_FLUX_FILL, {"image": image_url, "mask": mask_url, "prompt": prompt})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def smart_erase(image_url: str, mask_url: str) -> dict:
    try:
        output = await _replicate_run(_MODEL_REMOVE_OBJECT, {"image": image_url, "mask": mask_url})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def generate_shadow(image_url: str, direction: str = "bottom") -> dict:
    try:
        output = await _replicate_run(_MODEL_SHADOW, {"image": image_url, "shadow_direction": direction})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def relight_image(image_url: str, direction: str = "top", intensity: float = 1.0) -> dict:
    try:
        output = await _replicate_run(_MODEL_IC_LIGHT, {"image": image_url, "light_direction": direction, "light_intensity": intensity})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def restore_face(image_url: str, fidelity: float = 0.7) -> dict:
    try:
        output = await _replicate_run(_MODEL_CODEFORMER, {"image": image_url, "codeformer_fidelity": fidelity})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def upscale_image(image_url: str, scale: int = 2) -> dict:
    try:
        output = await _replicate_run(_MODEL_REAL_ESRGAN, {"image": image_url, "scale": scale})
        url = await _download_and_upload_url(output)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}
```

- [ ] **Step 4: Run tests**

```bash
cd apps/api && pytest tests/test_editing_service.py -v
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/editing_service.py apps/api/tests/test_editing_service.py
git commit -m "feat(editing): add Remove.bg and Replicate AI editing operations"
```

---

### Task 4: Editing API router

**Files:**
- Create: `apps/api/app/api/v1/routers/editing.py`
- Modify: `apps/api/app/api/v1/router.py`
- Test: `apps/api/tests/test_editing_api.py`

**Interfaces:**
- Consumes: all editing service functions (Tasks 2, 3), `GeneratedImage` model (Task 1)
- Produces: `POST /api/v1/images/{image_id}/edit` → `ImageOut`

- [ ] **Step 1: Write failing tests**

```python
# apps/api/tests/test_editing_api.py
import pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient


async def test_edit_image_basic_crop(client: AsyncClient, auth_headers: dict, sample_image):
    with patch("app.api.v1.routers.editing.crop_image", AsyncMock(return_value={"ok": True, "image_url": "https://s3.example.com/cropped.png"})):
        response = await client.post(
            f"/api/v1/images/{sample_image.id}/edit",
            json={"operation": "crop", "params": {"x": 0, "y": 0, "w": 100, "h": 100}},
            headers=auth_headers,
        )
    assert response.status_code == 200
    data = response.json()
    assert data["source_image_id"] == str(sample_image.id)
    assert data["edit_operation"] == "crop"
    assert data["image_url"] == "https://s3.example.com/cropped.png"


async def test_edit_image_unknown_operation(client: AsyncClient, auth_headers: dict, sample_image):
    response = await client.post(
        f"/api/v1/images/{sample_image.id}/edit",
        json={"operation": "teleport", "params": {}},
        headers=auth_headers,
    )
    assert response.status_code == 400


async def test_edit_image_not_found(client: AsyncClient, auth_headers: dict):
    response = await client.post(
        "/api/v1/images/00000000-0000-0000-0000-000000000000/edit",
        json={"operation": "crop", "params": {"x": 0, "y": 0, "w": 100, "h": 100}},
        headers=auth_headers,
    )
    assert response.status_code == 404


async def test_edit_image_mask_required_without_mask(client: AsyncClient, auth_headers: dict, sample_image):
    response = await client.post(
        f"/api/v1/images/{sample_image.id}/edit",
        json={"operation": "remove_object", "params": {}},
        headers=auth_headers,
    )
    assert response.status_code == 400
    assert "mask" in response.json()["detail"].lower()
```

Run: `cd apps/api && pytest tests/test_editing_api.py -v`
Expected: FAIL (404 — endpoint not registered)

- [ ] **Step 2: Create editing router**

```python
# apps/api/app/api/v1/routers/editing.py
import base64
import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from app.core.dependencies import CurrentUser, DB
from app.core.storage import upload_bytes
from app.models.image import GeneratedImage
from app.services.editing_service import (
    crop_image, resize_image, rotate_image, adjust_image,
    apply_filter, denoise_image, sharpen_image,
    remove_background, replace_background, remove_object,
    insert_object, generative_fill, smart_erase,
    generate_shadow, relight_image, restore_face, upscale_image,
)

router = APIRouter()

# Operations that require a mask
_MASK_REQUIRED = {
    "replace_background", "remove_object", "insert_object",
    "generative_fill", "smart_erase",
}

# Dispatch table: operation name → async callable
_DISPATCH = {
    "crop": lambda url, p, _mask: crop_image(url, **p),
    "resize": lambda url, p, _mask: resize_image(url, **p),
    "rotate": lambda url, p, _mask: rotate_image(url, **p),
    "adjust": lambda url, p, _mask: adjust_image(url, **p),
    "filter": lambda url, p, _mask: apply_filter(url, **p),
    "denoise": lambda url, p, _mask: denoise_image(url, **p),
    "sharpen": lambda url, p, _mask: sharpen_image(url, **p),
    "background_removal": lambda url, p, _mask: remove_background(url),
    "replace_background": lambda url, p, mask: replace_background(url, mask, p.get("prompt", "")),
    "remove_object": lambda url, p, mask: remove_object(url, mask),
    "insert_object": lambda url, p, mask: insert_object(url, mask, p.get("prompt", "")),
    "generative_fill": lambda url, p, mask: generative_fill(url, mask, p.get("prompt", "")),
    "smart_erase": lambda url, p, mask: smart_erase(url, mask),
    "shadow": lambda url, p, _mask: generate_shadow(url, p.get("direction", "bottom")),
    "relight": lambda url, p, _mask: relight_image(url, p.get("direction", "top"), p.get("intensity", 1.0)),
    "restore_face": lambda url, p, _mask: restore_face(url, p.get("fidelity", 0.7)),
    "upscale": lambda url, p, _mask: upscale_image(url, p.get("scale", 2)),
}


class EditImageRequest(BaseModel):
    operation: str
    params: dict = {}
    mask_base64: Optional[str] = None


class ImageEditOut(BaseModel):
    id: uuid.UUID
    image_url: Optional[str] = None
    source_image_id: Optional[uuid.UUID] = None
    edit_operation: Optional[str] = None
    status: str
    model_config = ConfigDict(from_attributes=True)


async def _upload_mask(mask_b64: str, org_id: uuid.UUID) -> str:
    mask_bytes = base64.b64decode(mask_b64)
    key = f"masks/{org_id}/{uuid.uuid4().hex}.png"
    return await upload_bytes(mask_bytes, key, "image/png")


@router.post("/{image_id}/edit", response_model=ImageEditOut)
async def edit_image(image_id: uuid.UUID, body: EditImageRequest, current_user: CurrentUser, db: DB):
    if body.operation not in _DISPATCH:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown operation: {body.operation}")

    if body.operation in _MASK_REQUIRED and not body.mask_base64:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A mask is required for this operation")

    result = await db.execute(
        select(GeneratedImage).where(
            GeneratedImage.id == image_id,
            GeneratedImage.org_id == current_user.org_id,
        )
    )
    source = result.scalar_one_or_none()
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")

    mask_url = None
    if body.mask_base64:
        mask_url = await _upload_mask(body.mask_base64, current_user.org_id)

    fn = _DISPATCH[body.operation]
    edit_result = await fn(source.image_url or "", body.params, mask_url)

    if not edit_result.get("ok"):
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, edit_result.get("error", "Edit failed"))

    new_image = GeneratedImage(
        org_id=current_user.org_id,
        project_id=source.project_id,
        prompt=source.prompt,
        style=source.style,
        usage=source.usage,
        image_url=edit_result["image_url"],
        status="ready",
        source_image_id=source.id,
        edit_operation=body.operation,
    )
    db.add(new_image)
    await db.flush()
    await db.refresh(new_image)
    await db.commit()
    return ImageEditOut.model_validate(new_image)
```

- [ ] **Step 3: Register router**

```python
# apps/api/app/api/v1/router.py — add import:
from app.api.v1.routers import editing

# Add after images router line:
api_router.include_router(editing.router, prefix="/images", tags=["editing"])
```

- [ ] **Step 4: Run tests**

```bash
cd apps/api && pytest tests/test_editing_api.py -v
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/api/v1/routers/editing.py apps/api/app/api/v1/router.py apps/api/tests/test_editing_api.py
git commit -m "feat(editing): add image editing API router (POST /images/{id}/edit)"
```

---

### Task 5: Frontend API client + ResultCard Edit button

**Files:**
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/components/studio/ResultCard.tsx`

**Interfaces:**
- Produces: `editImage()` in `lib/api.ts`; "Edit" button on ResultCard linking to edit page

- [ ] **Step 1: Add editImage to api.ts**

```typescript
// apps/web/lib/api.ts — add after getBrandKit functions:

export async function editImage(
  imageId: string,
  operation: string,
  params: Record<string, unknown>,
  maskBase64?: string,
): Promise<GeneratedImage> {
  return apiClient.post<GeneratedImage>(`/images/${imageId}/edit`, {
    operation,
    params,
    mask_base64: maskBase64 ?? null,
  });
}
```

- [ ] **Step 2: Add Edit button to ResultCard**

Open `apps/web/components/studio/ResultCard.tsx`. Locate the action buttons row (Download, Regenerate, etc.).

```tsx
// Add import at top:
import Link from "next/link";
import { PencilLine } from "lucide-react";

// Add useParams to get projectId (if not already imported):
import { useParams } from "next/navigation";

// Inside the component, add:
  const params = useParams<{ projectId: string }>();

// In the buttons row, add Edit button alongside existing buttons:
        <Link
          href={`/${params.projectId}/images/edit/${image.id}`}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
          title="Edit image"
        >
          <PencilLine className="h-3.5 w-3.5" />
          Edit
        </Link>
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/api.ts apps/web/components/studio/ResultCard.tsx
git commit -m "feat(editing): add editImage API client function and Edit button to ResultCard"
```

---

### Task 6: Edit page shell

**Files:**
- Create: `apps/web/app/(dashboard)/[projectId]/images/edit/[imageId]/page.tsx`

**Interfaces:**
- Consumes: `editImage`, `GeneratedImage` types from `lib/api.ts`
- Produces: page shell, `activeImageId` state, `activeOperation` state, `handleApply()` callback, `handleVersionSelect()` callback — passed as props to child components (Tasks 7–10)

- [ ] **Step 1: Create page**

```tsx
// apps/web/app/(dashboard)/[projectId]/images/edit/[imageId]/page.tsx
"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiClient, editImage } from "@/lib/api";
import type { GeneratedImage } from "@/lib/api";
import { EditToolsSidebar } from "@/components/studio/edit/EditToolsSidebar";
import { EditCanvas } from "@/components/studio/edit/EditCanvas";
import type { EditCanvasHandle } from "@/components/studio/edit/EditCanvas";
import { EditControlsPanel } from "@/components/studio/edit/EditControlsPanel";
import { VersionStrip } from "@/components/studio/edit/VersionStrip";

export default function EditPage() {
  const { projectId, imageId } = useParams<{ projectId: string; imageId: string }>();
  const [activeImageId, setActiveImageId] = useState(imageId);
  const [activeOperation, setActiveOperation] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [versions, setVersions] = useState<GeneratedImage[]>([]);
  const canvasRef = useRef<EditCanvasHandle>(null);

  const { data: currentImage } = useQuery<GeneratedImage>({
    queryKey: ["image", activeImageId],
    queryFn: () => apiClient.get<GeneratedImage>(`/images/${activeImageId}`),
    enabled: !!activeImageId,
  });

  const { data: sourceImage } = useQuery<GeneratedImage>({
    queryKey: ["image", imageId],
    queryFn: () => apiClient.get<GeneratedImage>(`/images/${imageId}`),
  });

  const handleApply = useCallback(
    async (operation: string, params: Record<string, unknown>) => {
      setIsApplying(true);
      setApplyError(null);
      try {
        const maskRequired = ["replace_background", "remove_object", "insert_object", "generative_fill", "smart_erase"];
        const maskBase64 = maskRequired.includes(operation)
          ? canvasRef.current?.getMaskBase64()
          : undefined;

        const result = await editImage(activeImageId, operation, params, maskBase64);
        setVersions((prev) => [...prev, result]);
        setActiveImageId(result.id);
      } catch (err) {
        setApplyError(err instanceof Error ? err.message : "Edit failed");
      } finally {
        setIsApplying(false);
      }
    },
    [activeImageId],
  );

  const handleVersionSelect = useCallback((img: GeneratedImage) => {
    setActiveImageId(img.id);
  }, []);

  const promptLabel = (sourceImage?.prompt ?? "").slice(0, 80);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link
          href={`/${projectId}/images/studio`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Studio
        </Link>
        {promptLabel && (
          <span className="text-xs text-muted-foreground border-l border-border pl-3 truncate max-w-xs">
            {promptLabel}
          </span>
        )}
      </div>

      {/* Three-panel body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tools sidebar */}
        <EditToolsSidebar
          activeOperation={activeOperation}
          onOperationSelect={setActiveOperation}
        />

        {/* Canvas + version strip */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <EditCanvas
            ref={canvasRef}
            imageUrl={currentImage?.image_url ?? null}
            isApplying={isApplying}
            showMask={["replace_background", "remove_object", "insert_object", "generative_fill", "smart_erase"].includes(activeOperation ?? "")}
          />
          <VersionStrip
            sourceImage={sourceImage ?? null}
            versions={versions}
            activeImageId={activeImageId}
            onSelect={handleVersionSelect}
          />
        </div>

        {/* Controls panel */}
        <EditControlsPanel
          activeOperation={activeOperation}
          isApplying={isApplying}
          error={applyError}
          onApply={handleApply}
          onClearMask={() => canvasRef.current?.clearMask()}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck** (will fail until Tasks 7–10 create the child components)

Skip typecheck here — it'll pass after Tasks 7–10 add the component files.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(dashboard)/[projectId]/images/edit/[imageId]/page.tsx"
git commit -m "feat(editing): add edit page shell with three-panel layout"
```

---

### Task 7: EditToolsSidebar component

**Files:**
- Create: `apps/web/components/studio/edit/EditToolsSidebar.tsx`

**Interfaces:**
- Consumes: `activeOperation: string | null`, `onOperationSelect: (op: string) => void`
- Produces: `<EditToolsSidebar>` — used by Task 6 page

- [ ] **Step 1: Create component**

```tsx
// apps/web/components/studio/edit/EditToolsSidebar.tsx
"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

interface ToolGroup {
  label: string;
  operations: { id: string; label: string }[];
}

const TOOL_GROUPS: ToolGroup[] = [
  {
    label: "Basic",
    operations: [
      { id: "crop", label: "Crop" },
      { id: "resize", label: "Resize" },
      { id: "rotate", label: "Rotate" },
      { id: "adjust", label: "Brightness / Contrast" },
      { id: "filter", label: "Filters" },
      { id: "denoise", label: "Denoise" },
      { id: "sharpen", label: "Sharpen" },
    ],
  },
  {
    label: "AI",
    operations: [
      { id: "background_removal", label: "Remove Background" },
      { id: "replace_background", label: "Replace Background" },
      { id: "remove_object", label: "Remove Object" },
      { id: "insert_object", label: "Insert Object" },
      { id: "generative_fill", label: "Generative Fill" },
      { id: "smart_erase", label: "Smart Eraser" },
      { id: "shadow", label: "Generate Shadow" },
    ],
  },
  {
    label: "Advanced",
    operations: [
      { id: "relight", label: "Relight" },
      { id: "restore_face", label: "Restore Face" },
      { id: "upscale", label: "Upscale" },
    ],
  },
];

interface EditToolsSidebarProps {
  activeOperation: string | null;
  onOperationSelect: (op: string) => void;
}

export function EditToolsSidebar({ activeOperation, onOperationSelect }: EditToolsSidebarProps) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ Basic: true });

  function toggleGroup(label: string) {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  return (
    <aside className="w-48 shrink-0 border-r border-border bg-card flex flex-col overflow-y-auto">
      <div className="px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Tools
      </div>
      {TOOL_GROUPS.map((group) => (
        <div key={group.label}>
          <button
            type="button"
            onClick={() => toggleGroup(group.label)}
            className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted/50 transition-colors"
          >
            {group.label}
            {openGroups[group.label] ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
          {openGroups[group.label] &&
            group.operations.map((op) => (
              <button
                key={op.id}
                type="button"
                onClick={() => onOperationSelect(op.id)}
                className={cn(
                  "w-full text-left px-4 py-1.5 text-xs transition-colors",
                  activeOperation === op.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                {op.label}
              </button>
            ))}
        </div>
      ))}
    </aside>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors (or only errors from still-missing Task 8–10 files)

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/studio/edit/EditToolsSidebar.tsx
git commit -m "feat(editing): add EditToolsSidebar with Basic/AI/Advanced tool groups"
```

---

### Task 8: EditCanvas component

**Files:**
- Create: `apps/web/components/studio/edit/EditCanvas.tsx`

**Interfaces:**
- Produces:
  - `EditCanvasHandle = { getMaskBase64: () => string | undefined; clearMask: () => void }`
  - `<EditCanvas ref={canvasRef} imageUrl showMask isApplying />` — used by Task 6 page
- The parent calls `canvasRef.current.getMaskBase64()` before dispatching a mask-required edit

- [ ] **Step 1: Create component**

```tsx
// apps/web/components/studio/edit/EditCanvas.tsx
"use client";

import { forwardRef, useImperativeHandle, useRef, useState, useCallback, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export interface EditCanvasHandle {
  getMaskBase64: () => string | undefined;
  clearMask: () => void;
}

interface EditCanvasProps {
  imageUrl: string | null;
  showMask: boolean;
  isApplying: boolean;
  className?: string;
}

export const EditCanvas = forwardRef<EditCanvasHandle, EditCanvasProps>(
  function EditCanvas({ imageUrl, showMask, isApplying, className }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [painting, setPainting] = useState(false);
    const [brushSize, setBrushSize] = useState(24);
    const [hasMask, setHasMask] = useState(false);

    useImperativeHandle(ref, () => ({
      getMaskBase64() {
        return canvasRef.current?.toDataURL("image/png").split(",")[1];
      },
      clearMask() {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setHasMask(false);
      },
    }));

    function syncCanvasSize() {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    const paint = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!painting || !showMask) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "rgba(239, 68, 68, 0.5)";
        ctx.beginPath();
        ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
        setHasMask(true);
      },
      [painting, showMask, brushSize],
    );

    if (!imageUrl) {
      return (
        <div className={cn("flex flex-1 items-center justify-center bg-muted/30", className)}>
          <p className="text-sm text-muted-foreground">No image loaded</p>
        </div>
      );
    }

    return (
      <div className={cn("relative flex flex-1 items-center justify-center overflow-hidden bg-muted/30", className)}>
        <div ref={containerRef} className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Editing canvas"
            className="block max-h-[calc(100vh-200px)] max-w-full object-contain select-none"
            onLoad={syncCanvasSize}
            draggable={false}
          />
          {showMask && (
            <canvas
              ref={canvasRef}
              className="absolute inset-0 cursor-crosshair"
              style={{ cursor: `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='${brushSize}' height='${brushSize}'><circle cx='${brushSize/2}' cy='${brushSize/2}' r='${brushSize/2-1}' fill='none' stroke='red' stroke-width='1.5'/></svg>") ${brushSize/2} ${brushSize/2}, crosshair` }}
              onMouseDown={() => setPainting(true)}
              onMouseUp={() => setPainting(false)}
              onMouseLeave={() => setPainting(false)}
              onMouseMove={paint}
            />
          )}
          {isApplying && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded">
              <Loader2 className="h-8 w-8 text-white animate-spin" />
            </div>
          )}
        </div>

        {showMask && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-lg bg-card border border-border px-4 py-2 shadow-lg">
            <span className="text-xs text-muted-foreground">Brush size</span>
            <input
              type="range"
              min={4}
              max={80}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-24 accent-primary"
            />
            <span className="text-xs text-muted-foreground w-6 text-center">{brushSize}</span>
          </div>
        )}
      </div>
    );
  },
);
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors (or only errors from still-missing Tasks 9–10 files)

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/studio/edit/EditCanvas.tsx
git commit -m "feat(editing): add EditCanvas with mask painting and forwardRef handle"
```

---

### Task 9: EditControlsPanel component

**Files:**
- Create: `apps/web/components/studio/edit/EditControlsPanel.tsx`

**Interfaces:**
- Consumes:
  - `activeOperation: string | null`
  - `isApplying: boolean`
  - `error: string | null`
  - `onApply: (operation: string, params: Record<string, unknown>) => Promise<void>`
  - `onClearMask: () => void`
- Produces: `<EditControlsPanel>` — used by Task 6 page

- [ ] **Step 1: Create component**

```tsx
// apps/web/components/studio/edit/EditControlsPanel.tsx
"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/cn";

interface EditControlsPanelProps {
  activeOperation: string | null;
  isApplying: boolean;
  error: string | null;
  onApply: (operation: string, params: Record<string, unknown>) => Promise<void>;
  onClearMask: () => void;
}

const FILTER_OPTIONS = ["grayscale", "sepia", "warm", "cool", "vivid"];
const SHADOW_DIRECTIONS = ["bottom", "bottom-right", "bottom-left", "right", "left"];
const LIGHT_DIRECTIONS = ["top", "top-right", "top-left", "left", "right"];

export function EditControlsPanel({
  activeOperation,
  isApplying,
  error,
  onApply,
  onClearMask,
}: EditControlsPanelProps) {
  const [params, setParams] = useState<Record<string, unknown>>({});

  useEffect(() => {
    setParams({});
  }, [activeOperation]);

  function set(key: string, value: unknown) {
    setParams((p) => ({ ...p, [key]: value }));
  }

  if (!activeOperation) {
    return (
      <aside className="w-64 shrink-0 border-l border-border bg-card flex items-center justify-center">
        <p className="text-xs text-muted-foreground px-4 text-center">Select a tool from the sidebar to get started</p>
      </aside>
    );
  }

  return (
    <aside className="w-64 shrink-0 border-l border-border bg-card flex flex-col overflow-y-auto">
      <div className="px-4 py-3 border-b border-border text-xs font-semibold text-foreground capitalize">
        {activeOperation.replace(/_/g, " ")}
      </div>

      <div className="flex flex-col gap-4 p-4 flex-1">
        {/* Crop */}
        {activeOperation === "crop" && (
          <>
            {(["x", "y", "w", "h"] as const).map((key) => (
              <div key={key}>
                <label className="block text-xs text-muted-foreground mb-1 uppercase">{key}</label>
                <input
                  type="number"
                  min={0}
                  value={(params[key] as number) ?? 0}
                  onChange={(e) => set(key, Number(e.target.value))}
                  className="w-full rounded-lg border border-border bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            ))}
          </>
        )}

        {/* Resize */}
        {activeOperation === "resize" && (
          <>
            {(["width", "height"] as const).map((key) => (
              <div key={key}>
                <label className="block text-xs text-muted-foreground mb-1 capitalize">{key} (px)</label>
                <input
                  type="number"
                  min={1}
                  value={(params[key] as number) ?? 512}
                  onChange={(e) => set(key, Number(e.target.value))}
                  className="w-full rounded-lg border border-border bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            ))}
            <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={(params.keep_aspect as boolean) ?? true}
                onChange={(e) => set("keep_aspect", e.target.checked)}
                className="accent-primary"
              />
              Keep aspect ratio
            </label>
          </>
        )}

        {/* Rotate */}
        {activeOperation === "rotate" && (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Angle (°)</label>
            <input
              type="range"
              min={-180}
              max={180}
              value={(params.angle as number) ?? 0}
              onChange={(e) => set("angle", Number(e.target.value))}
              className="w-full accent-primary"
            />
            <span className="text-xs text-muted-foreground">{(params.angle as number) ?? 0}°</span>
          </div>
        )}

        {/* Adjust */}
        {activeOperation === "adjust" && (
          <>
            {(["brightness", "contrast"] as const).map((key) => (
              <div key={key}>
                <label className="block text-xs text-muted-foreground mb-1 capitalize">{key}</label>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  value={(params[key] as number) ?? 0}
                  onChange={(e) => set(key, Number(e.target.value))}
                  className="w-full accent-primary"
                />
                <span className="text-xs text-muted-foreground">{(params[key] as number) ?? 0}</span>
              </div>
            ))}
          </>
        )}

        {/* Filter */}
        {activeOperation === "filter" && (
          <div>
            <label className="block text-xs text-muted-foreground mb-2">Filter</label>
            <div className="grid grid-cols-2 gap-2">
              {FILTER_OPTIONS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => set("filter_name", f)}
                  className={cn(
                    "rounded-lg border py-1.5 text-xs font-medium transition-colors capitalize",
                    params.filter_name === f
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Denoise / Sharpen */}
        {(activeOperation === "denoise" || activeOperation === "sharpen") && (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Strength</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={(params.strength as number) ?? 0.5}
              onChange={(e) => set("strength", Number(e.target.value))}
              className="w-full accent-primary"
            />
            <span className="text-xs text-muted-foreground">{((params.strength as number) ?? 0.5).toFixed(2)}</span>
          </div>
        )}

        {/* Prompt ops */}
        {["replace_background", "insert_object", "generative_fill"].includes(activeOperation) && (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Prompt</label>
            <textarea
              rows={3}
              placeholder="Describe what to generate…"
              value={(params.prompt as string) ?? ""}
              onChange={(e) => set("prompt", e.target.value)}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
          </div>
        )}

        {/* Mask-required: clear mask button */}
        {["replace_background", "remove_object", "insert_object", "generative_fill", "smart_erase"].includes(activeOperation) && (
          <button
            type="button"
            onClick={onClearMask}
            className="text-xs text-muted-foreground underline self-start hover:text-foreground"
          >
            Clear mask
          </button>
        )}

        {/* Shadow */}
        {activeOperation === "shadow" && (
          <div>
            <label className="block text-xs text-muted-foreground mb-2">Direction</label>
            <div className="grid grid-cols-2 gap-2">
              {SHADOW_DIRECTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => set("direction", d)}
                  className={cn(
                    "rounded-lg border py-1.5 text-xs font-medium transition-colors capitalize",
                    params.direction === d
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {d.replace("-", " ")}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Relight */}
        {activeOperation === "relight" && (
          <>
            <div>
              <label className="block text-xs text-muted-foreground mb-2">Light direction</label>
              <div className="grid grid-cols-2 gap-2">
                {LIGHT_DIRECTIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => set("direction", d)}
                    className={cn(
                      "rounded-lg border py-1.5 text-xs font-medium transition-colors capitalize",
                      params.direction === d
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {d.replace("-", " ")}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Intensity</label>
              <input
                type="range"
                min={0.1}
                max={2}
                step={0.1}
                value={(params.intensity as number) ?? 1.0}
                onChange={(e) => set("intensity", Number(e.target.value))}
                className="w-full accent-primary"
              />
              <span className="text-xs text-muted-foreground">{((params.intensity as number) ?? 1.0).toFixed(1)}</span>
            </div>
          </>
        )}

        {/* Restore face */}
        {activeOperation === "restore_face" && (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Fidelity</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={(params.fidelity as number) ?? 0.7}
              onChange={(e) => set("fidelity", Number(e.target.value))}
              className="w-full accent-primary"
            />
            <span className="text-xs text-muted-foreground">{((params.fidelity as number) ?? 0.7).toFixed(2)}</span>
          </div>
        )}

        {/* Upscale */}
        {activeOperation === "upscale" && (
          <div>
            <label className="block text-xs text-muted-foreground mb-2">Scale</label>
            <div className="flex gap-3">
              {[2, 4].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set("scale", s)}
                  className={cn(
                    "flex-1 rounded-lg border py-1.5 text-sm font-medium transition-colors",
                    params.scale === s
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Apply footer */}
      <div className="border-t border-border p-4 flex flex-col gap-2">
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button
          type="button"
          disabled={isApplying}
          onClick={() => onApply(activeOperation, params)}
          className="btn-primary w-full py-2 text-sm disabled:opacity-50"
        >
          {isApplying ? "Applying…" : "Apply"}
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors (or only from still-missing Task 10 VersionStrip)

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/studio/edit/EditControlsPanel.tsx
git commit -m "feat(editing): add EditControlsPanel with per-operation dynamic controls"
```

---

### Task 10: VersionStrip component + final integration

**Files:**
- Create: `apps/web/components/studio/edit/VersionStrip.tsx`

**Interfaces:**
- Consumes:
  - `sourceImage: GeneratedImage | null`
  - `versions: GeneratedImage[]`
  - `activeImageId: string`
  - `onSelect: (img: GeneratedImage) => void`
- Produces: `<VersionStrip>` — used by Task 6 page

After this component, run full typecheck and a visual browser test.

- [ ] **Step 1: Create component**

```tsx
// apps/web/components/studio/edit/VersionStrip.tsx
"use client";

import { cn } from "@/lib/cn";
import type { GeneratedImage } from "@/lib/api";

interface VersionStripProps {
  sourceImage: GeneratedImage | null;
  versions: GeneratedImage[];
  activeImageId: string;
  onSelect: (img: GeneratedImage) => void;
}

export function VersionStrip({ sourceImage, versions, activeImageId, onSelect }: VersionStripProps) {
  const all = sourceImage ? [sourceImage, ...versions] : versions;

  if (all.length === 0) return null;

  return (
    <div className="border-t border-border bg-card px-4 py-2 flex items-center gap-2 overflow-x-auto shrink-0">
      <span className="text-xs text-muted-foreground shrink-0">Versions</span>
      {all.map((img, i) => (
        <button
          key={img.id}
          type="button"
          onClick={() => onSelect(img)}
          title={img.edit_operation ? img.edit_operation.replace(/_/g, " ") : "Original"}
          className={cn(
            "relative shrink-0 h-12 w-12 rounded-md border-2 overflow-hidden transition-colors focus:outline-none",
            activeImageId === img.id ? "border-primary" : "border-transparent hover:border-border",
          )}
        >
          {img.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img.image_url}
              alt={`Version ${i + 1}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="h-full w-full bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
              {i + 1}
            </div>
          )}
          {i === 0 && (
            <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-[9px] text-white text-center py-0.5">
              Original
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Run full typecheck**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors

- [ ] **Step 3: Visual integration test**

```bash
cd apps/web && npm run dev
```

1. Open the studio, generate any image
2. Click the "Edit" button on a result card — should navigate to `/[projectId]/images/edit/[imageId]`
3. Confirm three-panel layout: tools sidebar | canvas showing image | empty controls panel
4. Select "Adjust" → Brightness/Contrast sliders appear in controls panel
5. Select "Remove Background" → Click Apply → canvas should show spinner
6. After apply (may fail without real credentials) — confirm version strip shows "Original" thumbnail
7. Select "Remove Object" → mask canvas overlay appears over image (red brush)
8. Draw a mask → "Clear mask" button works (mask disappears)
9. Select a version in VersionStrip → canvas updates to that version's image

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/studio/edit/VersionStrip.tsx
git commit -m "feat(editing): add VersionStrip and complete AI editing UI integration"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|---|---|
| `source_image_id`, `edit_operation` on `GeneratedImage` | Task 1 |
| Alembic migration for new columns | Task 1 |
| Basic editing: crop, resize, rotate, brightness/contrast, filters, denoise, sharpen | Task 2 |
| Remove.bg background removal | Task 3 |
| Replicate: replace_background, remove_object, insert_object, generative_fill, smart_erase, shadow, relight, restore_face, upscale | Task 3 |
| Replicate async polling (3s interval, 5min timeout) | Task 3 |
| `POST /images/{id}/edit` → new `GeneratedImage` with `source_image_id` set | Task 4 |
| Mask validation: mask required for generative ops | Task 4 |
| Operation allowlist | Task 4 |
| `editImage()` in `lib/api.ts` | Task 5 |
| "Edit" button (PencilLine) on ResultCard | Task 5 |
| Three-panel edit page (tools \| canvas \| controls) | Task 6 |
| Back button linking to studio | Task 6 |
| `EditToolsSidebar` — Basic/AI/Advanced collapsible groups | Task 7 |
| `EditCanvas` — `forwardRef` + `useImperativeHandle` with `getMaskBase64()` + `clearMask()` | Task 8 |
| Mask canvas overlay only for mask-required operations | Task 8 |
| Brush size slider | Task 8 |
| Spinner overlay during apply | Task 8 |
| `EditControlsPanel` — per-operation dynamic controls | Task 9 |
| Apply button → calls `onApply` | Task 9 |
| Error display below Apply | Task 9 |
| Clear mask button for mask operations | Task 9 |
| `VersionStrip` — original + all edits, active highlighted | Task 10 |
| Clicking version updates canvas in-place (no URL change) | Task 10 |

All requirements covered. ✓

**Dependencies satisfied:**
- `app/core/storage.py` → Plan 2A Task 3 ✓
- `boto3`, `Pillow`, `replicate` deps → Plan 2A Task 3 ✓
- `REMOVE_BG_API_KEY`, `REPLICATE_API_KEY` config → Plan 2A Task 3 ✓
- `GeneratedImage` base model → Plan 2A Task 0 (pre-existing) ✓
