# Image Operation Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make image AI operations preserve input resolution and make removal actually remove, instead of hallucinating a replacement object.

**Architecture:** One new module owns the output contract for every operation (pass bytes through untouched, never force RGBA, never resize implicitly, assert resolution). Removal moves from a prompted generative model to LaMa, which takes only an image and a mask, so inventing content becomes structurally impossible. Every AI-backed model is then verified against the live Replicate API.

**Tech Stack:** Python 3.11+, FastAPI, Pillow, httpx, pytest (asyncio auto mode), Replicate HTTP API.

## Global Constraints

- **Resolution parity.** Output dimensions equal input dimensions. Where a model makes that impossible, an explicit per-operation policy applies (upscale, or fail loudly). A silent downscale is never acceptable.
- **Never re-encode output that needed no transformation.** Bytes pass through untouched unless the operation is a local Pillow transform, the resolution policy requires an upscale, or the format is unservable.
- **Never force RGBA.** Alpha is added only by operations that genuinely produce transparency.
- **Removal must have no prompt channel.** Any model used for `remove_object` / `smart_erase` must be reconstructive, not generative.
- **No model ID, version hash, or input field name may be written from memory.** Every one comes from a live API response recorded in Task 0. Unverifiable values are recorded UNVERIFIED, never guessed.
- **No emoji** anywhere in code, comments, or commit messages.
- **Do not fix these 10 pre-existing failures** (they fail on a clean checkout, unrelated): `tests/test_edit_model.py::test_generated_image_has_source_image_id_column` and 9 in `tests/test_strands_runtime.py`. Any OTHER failure is a regression.
- Run tests from `apps/api/`. Load the Replicate key with:
  `export REPLICATE_API_KEY=$(grep -E '^REPLICATE_API_KEY=' /home/mhamnache/Startup/AI/claude/fennex/.env | cut -d= -f2- | tr -d '"'"'"' ')`
- **Sequencing:** this plan touches `editing_service.py` heavily. The Mirage auto-masking plan (`2026-07-30-mirage-auto-masking.md`) must be finished and merged first, or the two will conflict.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/services/image_output.py` (create) | The output contract: byte pass-through, header-only dimension reads, resolution policy enforcement. |
| `app/services/editing_service.py` (modify) | Per-operation model calls. Loses the SD-inpaint fallback, `_analyze_background`, `_pillow_content_fill`. |
| `app/api/v1/routers/editing.py` (modify) | Drops the now-unused OpenAI key injection for removal ops. |
| `tests/test_image_output.py` (create) | Contract tests: pass-through, no RGBA forcing, resolution assertion. |
| `tests/test_removal_ops.py` (create) | LaMa wiring, no prompt channel, dead code gone. |
| `tests/test_editing_service.py` (modify) | Per-op model/field/param assertions. |
| `docs/superpowers/plans/2026-07-30-image-op-quality-task0-findings.md` (create) | Task 0 evidence. |

---

## Task 0: Model audit gate

**Produces a findings document, not code. Every later task depends on its values. Do not start Task 1 until this is reviewed.**

**Files:**
- Create: `docs/superpowers/plans/2026-07-30-image-op-quality-task0-findings.md`

- [ ] **Step 1: Verify the existing roster against the live API**

For each model below, record: does it exist; does the hot endpoint work; latest version id; exact input field names and defaults; output shape.

```bash
export REPLICATE_API_KEY=$(grep -E '^REPLICATE_API_KEY=' /home/mhamnache/Startup/AI/claude/fennex/.env | cut -d= -f2- | tr -d '"'"' ')
for m in black-forest-labs/flux-fill-pro allenhooo/lama nightmareai/real-esrgan sczhou/codeformer zsxkib/ic-light; do
  echo "=== $m ==="
  curl -s -H "Authorization: Token $REPLICATE_API_KEY" "https://api.replicate.com/v1/models/$m" -o /tmp/m.json
  python3 -c "
import json;d=json.load(open('/tmp/m.json'))
lv=d.get('latest_version') or {}
print(' version:', lv.get('id'))
s=(lv.get('openapi_schema') or {}).get('components',{}).get('schemas',{})
i=s.get('Input',{})
print(' required:', i.get('required'))
for k,v in (i.get('properties') or {}).items(): print(f'   {k:20} {str(v.get(\"type\")):8} default={v.get(\"default\")}')
print(' output:', json.dumps(s.get('Output'))[:160])
"
done
```

Hot-endpoint probe. **A 429 means throttled, NOT absent** — the rate limit fires before the model lookup, so retry with backoff until you get a non-429:

```bash
probe() {
  for a in 1 2 3 4 5 6; do
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Token $REPLICATE_API_KEY" \
      -H "Content-Type: application/json" -d '{"input":{}}' \
      "https://api.replicate.com/v1/models/$1/predictions")
    if [ "$code" != "429" ]; then echo "$code  $1"; return; fi
    sleep 12
  done
  echo "429(persistent)  $1"
}
```
404 = no deployment, must pass `version=`. 422 = deployment exists, input merely invalid.

- [ ] **Step 2: Decide the `generate_shadow` replacement**

`fal-ai/shadow-generation` does not exist (metadata 404s). Search for a real one and verify it the same way:

```bash
curl -s -X QUERY -H "Authorization: Token $REPLICATE_API_KEY" -H "Content-Type: text/plain" \
  -d "product shadow generation" "https://api.replicate.com/v1/models" -o /tmp/s.json
python3 -c "
import json;d=json.load(open('/tmp/s.json'))
for m in d.get('results',[])[:8]: print(f\"  {m['owner']}/{m['name']:32} runs={m.get('run_count',0):>9}  {str(m.get('description'))[:56]}\")
"
```

Record either a verified replacement (id, version, fields, output shape, deployment status) **or** an explicit recommendation to withdraw `generate_shadow` from the planner vocabulary and UI. Do not invent a model.

- [ ] **Step 3: Decide the `relight` resolution approach**

`zsxkib/ic-light` exposes `width`/`height` but the enum caps at 1024. Record the enum verbatim, then record ONE of:
- **Set dimensions** — parity holds for inputs <= 1024; state what happens above it.
- **Upscale pass** — relight at the cap, then `nightmareai/real-esrgan` back to input size.
- **Replace the model** — a verified alternative with no cap.

- [ ] **Step 4: Record the constants**

```
_MODEL_LAMA / _LAMA_VERSION / lama image field / lama mask field / lama output shape
FLUX_FILL_OUTPUT_FORMAT_PNG_SUPPORTED = <True|False>
SHADOW_MODEL = <owner/name or WITHDRAW>
SHADOW_VERSION / fields / output shape (if not WITHDRAW)
RELIGHT_STRATEGY = <set_dimensions|upscale_pass|replace_model>
RELIGHT_DIMENSION_ENUM = <verbatim>
```

Any value not confirmed from a real response: write `UNVERIFIED` and say so.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-07-30-image-op-quality-task0-findings.md
git commit -m "docs(image-quality): audit the Replicate model roster"
```

---

## Task 1: The output contract module

**Files:**
- Create: `app/services/image_output.py`
- Test: `tests/test_image_output.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class ResolutionPolicy(str, Enum)` with members `PRESERVE`, `UPSCALE`, `ALLOW_CHANGE`.
  - `def dimensions(data: bytes) -> tuple[int, int]` — header-only read, no full decode.
  - `class ResolutionMismatch(RuntimeError)`
  - `async def finalize(output_url: str, *, source_size: tuple[int, int] | None = None, policy: ResolutionPolicy = ResolutionPolicy.PRESERVE, folder: str = "edits") -> str`
  - `async def _download(url: str) -> bytes`, `async def _retry(coro_factory, attempts=3, base_delay=0.6)`, `_TRANSIENT_ERRORS` — **moved here from `editing_service.py`**.

**IMPORT DIRECTION — read before writing code.** `editing_service` imports from
`image_output`, never the reverse. `_download` currently lives in
`editing_service`, so leaving it there and importing it from `image_output`
would create a circular import that fails at startup. Move `_download`,
`_retry` and `_TRANSIENT_ERRORS` into `image_output.py`, then re-import them in
`editing_service.py` from there. Their behaviour is unchanged; only their home
moves.

- [ ] **Step 1: Write the failing test**

Create `tests/test_image_output.py`:

```python
import io
from unittest.mock import AsyncMock, patch

import pytest
from PIL import Image as PILImage

from app.services import image_output
from app.services.image_output import ResolutionMismatch, ResolutionPolicy, dimensions, finalize


def _png(size=(64, 48), mode="RGB") -> bytes:
    buf = io.BytesIO()
    PILImage.new(mode, size, (10, 20, 30) if mode == "RGB" else (10, 20, 30, 255)).save(buf, format="PNG")
    return buf.getvalue()


def _jpg(size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    PILImage.new("RGB", size, (10, 20, 30)).save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def test_dimensions_reads_the_header_without_decoding():
    assert dimensions(_png((123, 77))) == (123, 77)
    assert dimensions(_jpg((200, 100))) == (200, 100)


@pytest.mark.asyncio
async def test_matching_size_passes_the_original_bytes_through_untouched():
    """The single largest quality win: no decode, no re-encode, no mode change."""
    raw = _jpg((64, 48))
    up = AsyncMock(return_value="https://cdn/out.jpg")
    with patch("app.services.image_output._download", AsyncMock(return_value=raw)), \
         patch("app.services.image_output.upload_bytes", up):
        await finalize("https://replicate/out.jpg", source_size=(64, 48))

    sent = up.call_args.args[0]
    assert sent == raw  # byte-identical, not re-encoded


@pytest.mark.asyncio
async def test_rgb_output_is_not_converted_to_rgba():
    raw = _png((32, 32), mode="RGB")
    up = AsyncMock(return_value="https://cdn/out.png")
    with patch("app.services.image_output._download", AsyncMock(return_value=raw)), \
         patch("app.services.image_output.upload_bytes", up):
        await finalize("https://replicate/out.png", source_size=(32, 32))

    assert PILImage.open(io.BytesIO(up.call_args.args[0])).mode == "RGB"


@pytest.mark.asyncio
async def test_preserve_policy_raises_when_the_model_downscaled():
    """Today this silently returns a smaller image."""
    with patch("app.services.image_output._download", AsyncMock(return_value=_png((512, 640)))), \
         patch("app.services.image_output.upload_bytes", AsyncMock()):
        with pytest.raises(ResolutionMismatch) as exc:
            await finalize("https://replicate/out.png", source_size=(2000, 1500))
    assert "512x640" in str(exc.value) and "2000x1500" in str(exc.value)


@pytest.mark.asyncio
async def test_upscale_policy_resizes_back_to_the_source_size():
    up = AsyncMock(return_value="https://cdn/out.png")
    with patch("app.services.image_output._download", AsyncMock(return_value=_png((100, 50)))), \
         patch("app.services.image_output.upload_bytes", up):
        await finalize("https://replicate/out.png", source_size=(200, 100),
                       policy=ResolutionPolicy.UPSCALE)

    assert PILImage.open(io.BytesIO(up.call_args.args[0])).size == (200, 100)


@pytest.mark.asyncio
async def test_allow_change_policy_accepts_a_different_size_untouched():
    """For operations whose whole purpose is changing size (resize, upscale)."""
    raw = _png((400, 300))
    up = AsyncMock(return_value="https://cdn/out.png")
    with patch("app.services.image_output._download", AsyncMock(return_value=raw)), \
         patch("app.services.image_output.upload_bytes", up):
        await finalize("https://replicate/out.png", source_size=(100, 75),
                       policy=ResolutionPolicy.ALLOW_CHANGE)

    assert up.call_args.args[0] == raw


@pytest.mark.asyncio
async def test_no_source_size_skips_the_assertion_entirely():
    raw = _png((7, 7))
    up = AsyncMock(return_value="https://cdn/out.png")
    with patch("app.services.image_output._download", AsyncMock(return_value=raw)), \
         patch("app.services.image_output.upload_bytes", up):
        await finalize("https://replicate/out.png")
    assert up.call_args.args[0] == raw
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_image_output.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.image_output'`

- [ ] **Step 3: Write the module**

Create `app/services/image_output.py`:

```python
"""The output contract for every image operation.

The pipeline this replaces downloaded each model result, decoded it, forced it
to RGBA and re-encoded it as PNG -- a full lossy round-trip applied to output
that usually needed no transformation at all. Combined with flux-fill returning
jpg by default, results carried JPEG artifacts at PNG file size.

Rules here, in priority order:
  1. Pass the original bytes through untouched whenever nothing must change.
  2. Never force a colour mode. Alpha belongs only to operations that make it.
  3. Never resize unless the caller explicitly asked.
  4. Never silently return a smaller image than the input.
"""
import asyncio
import base64
import io
import uuid
from enum import Enum
from typing import Optional

import httpx
from PIL import Image as PILImage

from app.core.storage import upload_bytes

# Moved here from editing_service so the import graph runs one way only
# (editing_service -> image_output). Behaviour is unchanged.
_TRANSIENT_ERRORS = (
    httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadError,
    httpx.ReadTimeout, httpx.RemoteProtocolError, httpx.PoolTimeout,
)


async def _retry(coro_factory, attempts: int = 3, base_delay: float = 0.6):
    """Await coro_factory(), retrying on transient connection errors."""
    last: Exception | None = None
    for i in range(attempts):
        try:
            return await coro_factory()
        except _TRANSIENT_ERRORS as e:
            last = e
            if i < attempts - 1:
                await asyncio.sleep(base_delay * (2 ** i))
    raise last  # type: ignore[misc]


async def _download(url: str) -> bytes:
    if url.startswith("data:"):
        _, encoded = url.split(",", 1)
        return base64.b64decode(encoded)

    async def _do() -> bytes:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.content

    return await _retry(_do)


class ResolutionPolicy(str, Enum):
    """What to do when the model's output size differs from the input's."""
    PRESERVE = "preserve"        # sizes must match; mismatch is an error
    UPSCALE = "upscale"          # resize back up to the source size
    ALLOW_CHANGE = "allow_change"  # the operation's purpose IS changing size


class ResolutionMismatch(RuntimeError):
    """A model returned a different size than its input under PRESERVE."""


def dimensions(data: bytes) -> tuple[int, int]:
    """(width, height) from the image header. PIL.open is lazy -- it parses the
    header only, so this does not decode pixel data."""
    return PILImage.open(io.BytesIO(data)).size


_EXT = {"JPEG": ("jpg", "image/jpeg"), "PNG": ("png", "image/png"),
        "WEBP": ("webp", "image/webp"), "GIF": ("gif", "image/gif")}


async def finalize(output_url: str, *, source_size: Optional[tuple[int, int]] = None,
                   policy: ResolutionPolicy = ResolutionPolicy.PRESERVE,
                   folder: str = "edits") -> str:
    """Store a model's output, transforming it as little as possible."""
    data = await _download(output_url)
    fmt = (PILImage.open(io.BytesIO(data)).format or "PNG").upper()

    if source_size is not None and policy is not ResolutionPolicy.ALLOW_CHANGE:
        got = dimensions(data)
        if got != source_size:
            if policy is ResolutionPolicy.PRESERVE:
                raise ResolutionMismatch(
                    f"model returned {got[0]}x{got[1]} for a "
                    f"{source_size[0]}x{source_size[1]} input"
                )
            # UPSCALE: the only path that re-encodes, and only because the
            # pixels genuinely changed.
            img = PILImage.open(io.BytesIO(data))
            img = img.resize(source_size, PILImage.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            data, fmt = buf.getvalue(), "PNG"

    ext, content_type = _EXT.get(fmt, ("png", "image/png"))
    return await upload_bytes(data, f"{folder}/{uuid.uuid4().hex}.{ext}", content_type)
```

- [ ] **Step 4: Re-point editing_service at the moved helpers**

Delete `_TRANSIENT_ERRORS`, `_retry` and `_download` from
`app/services/editing_service.py` and import them instead:

```python
from app.services.image_output import _TRANSIENT_ERRORS, _download, _retry
```

`_create_prediction` and `_replicate_run` keep using `_retry` and `_download`
exactly as before. Confirm no other module imported them from `editing_service`:

```bash
grep -rn "from app.services.editing_service import" app/ tests/
```

Update any hit that pulls `_download`, `_retry` or `_TRANSIENT_ERRORS`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `python -m pytest tests/test_image_output.py tests/test_editing_service.py tests/test_removebg_cutout.py -q`
Expected: PASS (7 new, plus the existing files unbroken by the move)

- [ ] **Step 6: Commit**

```bash
git add app/services/image_output.py app/services/editing_service.py tests/test_image_output.py
git commit -m "feat(image): add the output contract module"
```

---

## Task 2: Move removal to LaMa and delete the generative path

**Files:**
- Modify: `app/services/editing_service.py`
- Modify: `app/api/v1/routers/editing.py`
- Test: `tests/test_removal_ops.py` (create)

**Interfaces:**
- Consumes: `image_output.finalize`, `ResolutionPolicy` (Task 1); the LaMa constants from Task 0.
- Produces: `remove_object(image_url, mask_url=None)` and `smart_erase(image_url, mask_url=None)` — both delegate to one private `_lama_erase(image_url, mask_url)`. Both LOSE their `openai_key` parameter.

- [ ] **Step 1: Write the failing test**

Create `tests/test_removal_ops.py`:

```python
from unittest.mock import AsyncMock, patch

import pytest

from app.services import editing_service


@pytest.mark.asyncio
@pytest.mark.parametrize("op", ["remove_object", "smart_erase"])
async def test_removal_sends_no_prompt_channel(op):
    """The whole point: a model with no prompt cannot invent a replacement
    object. If a prompt key ever appears here, hallucination is back."""
    run = AsyncMock(return_value="https://replicate/out.png")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service.finalize",
               AsyncMock(return_value="https://cdn/out.png")):
        result = await getattr(editing_service, op)("https://cdn/in.png", "https://cdn/mask.png")

    assert result["ok"] is True
    (model, params), kwargs = run.call_args
    assert model == editing_service._MODEL_LAMA
    assert kwargs["version"] == editing_service._LAMA_VERSION
    assert set(params) == {"image", "mask"}
    for forbidden in ("prompt", "negative_prompt", "guidance", "text_prompt"):
        assert forbidden not in params


@pytest.mark.asyncio
@pytest.mark.parametrize("op", ["remove_object", "smart_erase"])
async def test_removal_requires_a_mask(op):
    result = await getattr(editing_service, op)("https://cdn/in.png", None)
    assert result["ok"] is False
    assert "mask" in result["error"].lower()


@pytest.mark.asyncio
async def test_removal_no_longer_calls_the_background_describer():
    """_analyze_background built the prompt that caused the hallucination."""
    assert not hasattr(editing_service, "_analyze_background")


@pytest.mark.asyncio
async def test_the_sd_inpaint_fallback_is_gone():
    for dead in ("_sd_inpaint_size", "_MODEL_SD_INPAINT", "_SD_INPAINT_VERSION",
                 "_pillow_content_fill"):
        assert not hasattr(editing_service, dead), f"{dead} should have been deleted"


@pytest.mark.asyncio
async def test_removal_signatures_dropped_the_unused_openai_key():
    import inspect
    for op in ("remove_object", "smart_erase"):
        assert "openai_key" not in inspect.signature(getattr(editing_service, op)).parameters
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_removal_ops.py -q`
Expected: FAIL — `_MODEL_LAMA` does not exist; dead-code assertions fail.

- [ ] **Step 3: Replace both removal implementations**

In `app/services/editing_service.py`, add near the other model constants (use the Task 0 values verbatim):

```python
# Removal is RECONSTRUCTIVE, never generative. LaMa takes an image and a mask
# and nothing else -- there is no prompt channel, so inventing a replacement
# object is structurally impossible rather than something to tune against.
# The previous implementation described the background with GPT-4o-mini and fed
# that to flux-fill at guidance 60, which is exactly how a removal request
# turned into "paint a new scene here".
_MODEL_LAMA = "allenhooo/lama"
_LAMA_VERSION = "cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72"
```

Delete `_analyze_background`, `_sd_inpaint_size`, `_MODEL_SD_INPAINT`, `_SD_INPAINT_VERSION` and `_pillow_content_fill`. Replace both removal functions with:

```python
async def _lama_erase(image_url: str, mask_url: Optional[str]) -> dict:
    """Reconstruct whatever the mask covers from surrounding context."""
    if not mask_url:
        return {"ok": False, "error": "No mask provided."}
    try:
        src_size = dimensions(await _download(image_url))
        output = await _replicate_run(
            _MODEL_LAMA,
            {"image": image_url, "mask": mask_url},
            version=_LAMA_VERSION,
        )
        return {"ok": True, "image_url": await finalize(output, source_size=src_size)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


async def remove_object(image_url: str, mask_url: Optional[str] = None) -> dict:
    return await _lama_erase(image_url, mask_url)


# smart_erase and remove_object are the same intent -- reconstruct what is under
# the mask -- so they share one implementation. Both names are kept because the
# planner vocabulary and the UI reference them.
async def smart_erase(image_url: str, mask_url: Optional[str] = None) -> dict:
    return await _lama_erase(image_url, mask_url)
```

Add to the imports at the top of the file:

```python
from app.services.image_output import ResolutionPolicy, dimensions, finalize
```

- [ ] **Step 4: Drop the dead OpenAI key injection**

In `app/api/v1/routers/editing.py`, delete the block that decrypts and injects `openai_key` for `smart_erase` / `remove_object` (it sits just after the mask resolution and before the service call). `smart_erase` never used the key at all, and `remove_object` no longer takes one, so this decrypt was pure waste on every call.

- [ ] **Step 5: Run the tests**

Run: `python -m pytest tests/test_removal_ops.py tests/test_editing_service.py tests/test_mask_routing.py -q`
Expected: PASS. If a test referencing the deleted helpers fails, delete that test — it covers removed behaviour.

- [ ] **Step 6: Commit**

```bash
git add app/services/editing_service.py app/api/v1/routers/editing.py tests/test_removal_ops.py
git commit -m "fix(image): remove objects with LaMa instead of a prompted generator"
```

---

## Task 3: Wire the contract into the Replicate operations

**Files:**
- Modify: `app/services/editing_service.py`
- Test: `tests/test_editing_service.py`

**Interfaces:**
- Consumes: `finalize`, `ResolutionPolicy`, `dimensions` (Task 1).
- Produces: `_download_and_upload_url` is deleted; every Replicate op calls `finalize` with an explicit policy.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_editing_service.py`:

```python
async def test_flux_fill_requests_lossless_output():
    """output_format defaults to jpg -- a lossy round-trip on every mask op."""
    from app.services import editing_service
    run = AsyncMock(return_value="https://replicate/out.png")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png_bytes())), \
         patch("app.services.editing_service.finalize", AsyncMock(return_value="https://cdn/o.png")):
        await editing_service.replace_background("https://cdn/in.png", "green marble", "https://cdn/m.png")
    (_, params), _ = run.call_args
    assert params["output_format"] == "png"


async def test_download_and_upload_url_is_gone():
    """It forced RGBA and re-encoded every result."""
    from app.services import editing_service
    assert not hasattr(editing_service, "_download_and_upload_url")


async def test_upscale_allows_a_size_change_but_replace_background_does_not():
    from app.services import editing_service
    from app.services.image_output import ResolutionPolicy
    fin = AsyncMock(return_value="https://cdn/o.png")
    run = AsyncMock(return_value="https://replicate/out.png")

    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png_bytes())), \
         patch("app.services.editing_service.finalize", fin):
        await editing_service.upscale_image("https://cdn/in.png", 2)
    assert fin.call_args.kwargs["policy"] is ResolutionPolicy.ALLOW_CHANGE

    fin.reset_mock()
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png_bytes())), \
         patch("app.services.editing_service.finalize", fin):
        await editing_service.replace_background("https://cdn/in.png", "marble", "https://cdn/m.png")
    assert fin.call_args.kwargs["policy"] is ResolutionPolicy.PRESERVE
```

Add this helper near the top of the file, beside `_make_test_png`:

```python
def _png_bytes(size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    PILImage.new("RGB", size, (1, 2, 3)).save(buf, format="PNG")
    return buf.getvalue()
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_editing_service.py -q -k "flux_fill_requests or download_and_upload or upscale_allows"`
Expected: FAIL

- [ ] **Step 3: Convert every Replicate operation**

Delete `_download_and_upload_url`. For each Replicate-backed operation, read the source image size once, call `finalize` with the right policy, and pass `output_format: "png"` to every flux-fill call.

Policy per operation:

| Operation | Policy |
|---|---|
| `replace_background`, `insert_object`, `generative_fill` | `PRESERVE` |
| `remove_object`, `smart_erase` | `PRESERVE` (already done in Task 2) |
| `restore_face` | `PRESERVE` |
| `upscale_image` | `ALLOW_CHANGE` |
| `relight_image` | per Task 0's `RELIGHT_STRATEGY` |
| `generate_shadow` | per Task 0 (skip entirely if WITHDRAW) |

Pattern for a PRESERVE operation:

```python
async def replace_background(image_url: str, prompt: str, mask_url: Optional[str] = None) -> dict:
    try:
        src_size = dimensions(await _download(image_url))
        output = await _replicate_run(_MODEL_FLUX_FILL, {
            "image": image_url, "mask": mask_url, "prompt": prompt,
            # jpg is the model default; png keeps the result lossless.
            "output_format": "png",
        })
        return {"ok": True, "image_url": await finalize(output, source_size=src_size)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}
```

Pattern for `ALLOW_CHANGE`:

```python
        return {"ok": True, "image_url": await finalize(
            output, source_size=src_size, policy=ResolutionPolicy.ALLOW_CHANGE)}
```

- [ ] **Step 4: Run the tests**

Run: `python -m pytest tests/test_editing_service.py tests/test_removal_ops.py tests/test_image_output.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/services/editing_service.py tests/test_editing_service.py
git commit -m "fix(image): stop re-encoding results and assert resolution parity"
```

---

## Task 4: Stop forcing RGBA in the Pillow operations

**Files:**
- Modify: `app/services/editing_service.py` (`_open`, `_upload_result`)
- Test: `tests/test_editing_service.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `_open(data)` preserves the source colour mode. `_upload_result(img, folder="edits")` encodes losslessly without a JPEG path.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_editing_service.py`:

```python
async def test_pillow_ops_preserve_the_source_colour_mode(monkeypatch):
    """_open forced RGBA, so an RGB photo came back as a bloated RGBA PNG."""
    from app.services import editing_service
    captured = {}

    async def _fake_upload(img, folder="edits"):
        captured["mode"] = img.mode
        return "https://cdn/out.png"

    monkeypatch.setattr(editing_service, "_download", AsyncMock(return_value=_png_bytes()))
    monkeypatch.setattr(editing_service, "_upload_result", _fake_upload)

    await editing_service.crop_image("https://cdn/in.png", 0, 0, 10, 10)
    assert captured["mode"] == "RGB"


async def test_upload_result_never_writes_lossy_jpeg(monkeypatch):
    from PIL import Image as _PIL
    from app.services import editing_service
    sent = {}

    async def _fake_upload_bytes(data, key, content_type):
        sent["key"], sent["ct"] = key, content_type
        return "https://cdn/x"

    monkeypatch.setattr(editing_service, "upload_bytes", _fake_upload_bytes)
    await editing_service._upload_result(_PIL.new("RGB", (8, 8)))
    assert sent["key"].endswith(".png")
    assert sent["ct"] == "image/png"
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_editing_service.py -q -k "preserve_the_source_colour or never_writes_lossy"`
Expected: FAIL — mode is `RGBA`, and `_upload_result` writes JPEG for non-RGBA input.

- [ ] **Step 3: Implement**

```python
def _open(data: bytes) -> PILImage.Image:
    """Preserve the source colour mode. Forcing RGBA here turned every RGB photo
    into a bloated RGBA PNG for no quality gain; operations that genuinely need
    alpha convert explicitly."""
    return PILImage.open(io.BytesIO(data))


async def _upload_result(img: PILImage.Image, folder: str = "edits") -> str:
    """Always lossless. The old JPEG-at-quality-95 branch silently degraded
    every non-RGBA result."""
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return await upload_bytes(buf.read(), f"{folder}/{uuid.uuid4().hex}.png", "image/png")
```

Then run the Pillow operations and fix any that assumed RGBA. `rotate_image` with a `fill_color`, and any op compositing with alpha, must call `.convert("RGBA")` explicitly at their own call site.

- [ ] **Step 4: Run the tests**

Run: `python -m pytest tests/test_editing_service.py -q`
Expected: PASS. Every Pillow op test must still pass — if one fails, that op needed an explicit RGBA conversion.

- [ ] **Step 5: Commit**

```bash
git add app/services/editing_service.py tests/test_editing_service.py
git commit -m "fix(image): preserve colour mode and encode losslessly in the Pillow ops"
```

---

## Task 5: Apply the Task 0 decisions for relight and shadow

**Files:**
- Modify: `app/services/editing_service.py`
- Modify: `app/services/ai_command_service.py` and `app/api/v1/routers/editing.py` (only if `generate_shadow` is withdrawn)
- Test: `tests/test_editing_service.py`

**Interfaces:**
- Consumes: `RELIGHT_STRATEGY`, `SHADOW_MODEL` and friends from the Task 0 findings.
- Produces: no new public names.

- [ ] **Step 1: Write the failing test for relight resolution**

```python
async def test_relight_meets_the_task0_resolution_strategy():
    """ic-light outputs 512x640 by default; anything larger was crushed."""
    from app.services import editing_service
    from app.services.image_output import ResolutionPolicy
    fin = AsyncMock(return_value="https://cdn/o.png")
    run = AsyncMock(return_value="https://replicate/out.webp")
    with patch("app.services.editing_service._replicate_run", run), \
         patch("app.services.editing_service._download", AsyncMock(return_value=_png_bytes((800, 600)))), \
         patch("app.services.editing_service.finalize", fin):
        await editing_service.relight_image("https://cdn/in.png", "left")

    (_, params), _ = run.call_args
    # set_dimensions strategy: the request carries the source size (capped).
    # upscale_pass strategy: finalize is called with UPSCALE.
    assert params.get("width") or fin.call_args.kwargs["policy"] is ResolutionPolicy.UPSCALE
```

If Task 0 chose `replace_model`, replace this test with one asserting the new model id, version and field names instead.

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_editing_service.py -q -k relight_meets`
Expected: FAIL

- [ ] **Step 3: Implement the relight strategy**

Apply the strategy Task 0 recorded.

For **`set_dimensions`**, add this helper to `editing_service.py`. `width` and
`height` are enums, and ic-light silently ignores a value outside them — which
is how the 512x640 default kept applying:

```python
# ic-light's width/height are enums; anything outside the list is ignored and
# the model falls back to its 512x640 default. Verified in Task 0.
_IC_LIGHT_DIMS = (256, 320, 384, 448, 512, 576, 640, 704, 768, 832, 896, 960, 1024)


def _clamp_to_ic_light_dims(width: int, height: int) -> tuple[int, int]:
    """Largest allowed dimension not exceeding each input side.

    The model caps at 1024, so a larger input cannot reach parity here -- the
    caller compensates per RELIGHT_STRATEGY. Returns the smallest allowed value
    when the input is below the enum's floor.
    """
    def _pick(v: int) -> int:
        allowed = [d for d in _IC_LIGHT_DIMS if d <= v]
        return allowed[-1] if allowed else _IC_LIGHT_DIMS[0]
    return _pick(width), _pick(height)
```

Use it in `relight_image`:

```python
        src_w, src_h = dimensions(await _download(image_url))
        w, h = _clamp_to_ic_light_dims(src_w, src_h)
```

and send `"width": w, "height": h` in the payload. If the source exceeded 1024
on either side, the clamp cannot reach parity, so finalize with
`ResolutionPolicy.UPSCALE`; otherwise `PRESERVE`.

For **`upscale_pass`**, skip the dimension parameters and call
`finalize(..., policy=ResolutionPolicy.UPSCALE)` unconditionally.

If Task 0 recorded a different enum than the tuple above, use Task 0's value —
it came from the live schema.

- [ ] **Step 4: Handle generate_shadow**

If Task 0 found a replacement: wire it with its verified version and field names, `PRESERVE` policy, and add a test asserting model, version and fields.

If Task 0 recommended withdrawal: delete `generate_shadow` from `editing_service.py`, from `_DISPATCH` in `editing.py` and `ai_command.py`, and from `_OPERATIONS_REFERENCE` in `ai_command_service.py`. Add a test asserting the operation is absent from every dispatch table, so the planner can no longer emit an operation that always fails.

- [ ] **Step 5: Run the tests**

Run: `python -m pytest tests/test_editing_service.py tests/test_ai_command_dispatch.py tests/test_ai_command_planner.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -u
git commit -m "fix(image): settle relight resolution and the shadow model"
```

---

## Task 6: Full verification

**Files:** none modified.

- [ ] **Step 1: Full backend suite**

Run: `python -m pytest -q 2>&1 | tail -20`

Expected: all pass EXCEPT exactly these 10 known pre-existing failures:

```
tests/test_edit_model.py::test_generated_image_has_source_image_id_column
tests/test_strands_runtime.py::test_an_employee_only_receives_the_tools_it_declared
tests/test_strands_runtime.py::test_a_tool_whose_permission_is_not_granted_is_never_offered
tests/test_strands_runtime.py::test_an_employee_only_gets_the_tools_it_declared
tests/test_strands_runtime.py::test_a_run_without_a_provider_fails_cleanly
tests/test_strands_runtime.py::test_an_unconfigured_mcp_server_is_never_offered
tests/test_strands_runtime.py::test_mcp_tools_degrade_to_nothing_rather_than_failing_a_turn
tests/test_strands_runtime.py::test_a_read_only_tool_is_not_called_twice_in_one_run
tests/test_strands_runtime.py::test_a_run_cannot_spend_more_than_its_tool_budget
tests/test_strands_runtime.py::test_an_unusable_model_choice_falls_back_to_the_tier
```

**Any OTHER failure is a regression from this work.** Do not fix the 10 above.

- [ ] **Step 2: Frontend typecheck**

Run from `apps/web`: `npm run typecheck`
Expected: clean. No frontend change is expected in this plan; a failure means a response shape changed.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "test(image): verify the suite after the quality pass"
```

---

## Manual verification — mandatory, not optional

Every automated test here mocks the supplier calls. They prove wiring and policy
selection; **they cannot tell you whether an edit looks good**, and they would
have passed on every defect that motivated this plan. Run each check on a real
image against real APIs before calling this done.

1. **remove_object / smart_erase** — mask an object and remove it. The object is
   gone and the area reads as plausible background. **If a NEW object appears,
   the removal model is wrong or the mask is inverted** — that is the exact
   symptom this plan exists to kill.
2. **replace_background** — only the background changes; the product is
   untouched. **If the product changed and the background did not, mask polarity
   is inverted.**
3. **relight** — output dimensions equal input dimensions on an image larger than
   1024px.
4. **upscale** — output is genuinely larger and sharper.
5. **restore_face** — face is cleaner, dimensions unchanged.
6. **Every operation** — compare input and output dimensions. They must match,
   except for `upscale` and `resize` whose purpose is changing them.
7. **File sanity** — outputs are not absurdly larger than their inputs. A modest
   PNG increase over a JPEG source is expected and acceptable.
