# Mirage Auto-Masking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let mask-requiring image edits run without the user hand-painting a mask, by deriving the mask automatically from the image.

**Architecture:** One new service, `app/services/mask_service.py`, exposing `resolve_mask(...)`. Both the manual edit router (`editing.py`) and the conversational AI-command router (`ai_command.py`) call it when a mask-requiring operation arrives with no painted mask. Two tiers inside: a free "product tier" that thresholds the alpha channel of a Remove.bg cutout, and a paid "prompted tier" that segments a named object on Replicate. Painting always wins when present.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2 async, Pillow, httpx, pytest (pytest-asyncio in auto mode), Alembic.

## Global Constraints

- **Mask polarity: white = the region to be replaced.** Every mask this code produces or consumes follows this. Getting it backwards inverts every edit silently.
- **Painting wins.** Auto-masking fires only when no painted mask was supplied. Never override a deliberate user selection.
- **Tier selection is on `target` presence only** — no keyword sniffing of the target text.
- **No new masks are cached.** Out of scope for v1.
- **Do not fix the 10 pre-existing test failures** in `tests/test_strands_runtime.py` (9) and `tests/test_edit_model.py::test_generated_image_has_source_image_id_column` (1). They fail on an unmodified checkout and are unrelated. Never let them mask a new regression: always compare against this known-failing set.
- **Alembic:** hand-write migration bodies. Never use `--autogenerate` (it emits destructive DROPs against this schema). Current single head is `z7persecond4`.
- **No emoji** anywhere in code, comments, commit messages, or UI copy.
- Run tests from `apps/api/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/services/mask_service.py` (create) | Mask derivation. `resolve_mask()` plus the two tier implementations and the polarity table. |
| `app/services/editing_service.py` (modify) | Extract `_removebg_cutout()` so the alpha channel is reachable without a re-download. |
| `app/services/metering/meter.py` (modify) | Add `record_removebg()` — the Remove.bg supplier call is unmetered today. |
| `alembic/versions/<rev>_removebg_cost_rate.py` (create) | Seed the `removebg/run` cost rate. |
| `app/api/v1/routers/editing.py` (modify) | Call `resolve_mask` when no painted mask; replace the "paint the area first" dead-end. |
| `app/api/v1/routers/ai_command.py` (modify) | Same, plus pass `target` through from the planner and raise 422 on ambiguity. |
| `app/services/ai_command_service.py` (modify) | Invert the planner instructions; add the `target` param to mask ops. |
| `tests/test_mask_service.py` (create) | Alpha→mask conversion, polarity table, tier selection, ambiguity gate. |
| `tests/test_mask_routing.py` (create) | Both routers: painting wins, auto-resolution fires, ambiguity surfaces. |
| `tests/test_metering_removebg.py` (create) | Remove.bg metering. |
| `tests/test_ai_command_planner.py` (create) | Planner omits `target` for default-region phrasings. |

---

## Task 0: Verify the two unproven assumptions

**This task produces a written findings file, not code. Every later task depends on its answers. Do not start Task 1 until this is done and reviewed.**

The spec flags two assumptions that would invalidate dependent work if wrong. Both must be checked against reality, not recalled from memory.

**Files:**
- Create: `docs/superpowers/plans/2026-07-30-mirage-auto-masking-task0-findings.md`

- [ ] **Step 1: Verify flux-fill's mask polarity**

The spec's polarity table is inferred from a comment in `_pillow_content_fill` (`app/services/editing_service.py`), which describes a *local Pillow* helper — not necessarily the convention `black-forest-labs/flux-fill-pro` uses on Replicate.

Fetch the model's input schema:

```bash
curl -s -H "Authorization: Token $REPLICATE_API_KEY" \
  https://api.replicate.com/v1/models/black-forest-labs/flux-fill-pro \
  | python -m json.tool > /tmp/fluxfill.json
python - <<'PY'
import json
d = json.load(open("/tmp/fluxfill.json"))
props = d["latest_version"]["openapi_schema"]["components"]["schemas"]["Input"]["properties"]
print(json.dumps(props.get("mask", {}), indent=2))
PY
```

Record in the findings file: the exact `mask` description string, and whether it states white/light = the inpainted area. If the schema is ambiguous, run one real prediction with a half-white/half-black mask and record which half changed.

- [ ] **Step 2: Find and pin a text-prompted segmenter**

Search Replicate for a model that takes an image plus a text prompt and returns a mask:

```bash
curl -s -H "Authorization: Token $REPLICATE_API_KEY" \
  "https://api.replicate.com/v1/models?query=segment+text+prompt" \
  | python -m json.tool | head -100
```

Record in the findings file, for the chosen model:
- `owner/name`
- whether it has an active hot deployment (if yes, `_replicate_run` is called without a `version`; if no, pin the version SHA and pass `version=`)
- the exact input field names (image field, prompt field) and the output shape (URL string, list, or mapping)
- whether the returned mask is white-on-black for the matched object, and whether it needs inverting to match this codebase's convention

Cross-check the output shape against `_replicate_run`'s contract in `app/services/editing_service.py`: a list returns `output[0]`, a `Mapping` returns as-is, anything else is `str()`-ed.

- [ ] **Step 3: Record the resulting constants**

Write the concrete values later tasks will use:

```
_SEGMENTER_MODEL = "<owner/name>"
_SEGMENTER_VERSION = "<sha or None>"
_SEGMENTER_IMAGE_FIELD = "<field>"
_SEGMENTER_PROMPT_FIELD = "<field>"
_SEGMENTER_INVERTS = <True|False>
FLUX_FILL_WHITE_IS_FILL = <True|False>
```

If `FLUX_FILL_WHITE_IS_FILL` turns out `False`, stop and flag it — the spec's polarity table and every test in Task 3 invert, and the design needs re-approval before proceeding.

- [ ] **Step 4: Commit the findings**

```bash
git add docs/superpowers/plans/2026-07-30-mirage-auto-masking-task0-findings.md
git commit -m "docs(mirage): verify flux-fill polarity and pin the segmenter"
```

---

## Task 1: Extract the Remove.bg cutout helper

`remove_background()` fetches an RGBA cutout then immediately uploads it, discarding the alpha channel. The mask service needs that alpha. Extract a helper so the alpha is reachable without re-downloading the uploaded result.

**Files:**
- Modify: `app/services/editing_service.py:245-262`
- Test: `tests/test_removebg_cutout.py` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `async def _removebg_cutout(image_url: str) -> PILImage.Image` — returns an RGBA `PIL.Image.Image`. Raises on HTTP failure (does not swallow). Used by Task 3.

- [ ] **Step 1: Write the failing test**

Create `tests/test_removebg_cutout.py`:

```python
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_removebg_cutout.py -q`
Expected: FAIL — `AttributeError: module 'app.services.editing_service' has no attribute '_removebg_cutout'`

- [ ] **Step 3: Extract the helper**

In `app/services/editing_service.py`, replace the body of `remove_background` (currently lines 245-262) with:

```python
async def _removebg_cutout(image_url: str) -> PILImage.Image:
    """Fetch the Remove.bg cutout as an RGBA image.

    The alpha channel IS a foreground segmentation, which is what
    app.services.mask_service derives the product-tier mask from. Kept separate
    from remove_background() so that caller does not have to re-download its own
    uploaded result to recover the alpha. Raises rather than returning an error
    dict -- callers that want the dict contract wrap it.
    """
    data = await _download(image_url)
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.remove.bg/v1.0/removebg",
            data={"size": "auto"},
            files={"image_file": ("image.png", data, "image/png")},
            headers={"X-Api-Key": settings.REMOVE_BG_API_KEY},
        )
        resp.raise_for_status()
    return PILImage.open(io.BytesIO(resp.content)).convert("RGBA")


async def remove_background(image_url: str) -> dict:
    """Background removal via Remove.bg API."""
    try:
        img = await _removebg_cutout(image_url)
        url = await _upload_result(img)
        return {"ok": True, "image_url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest tests/test_removebg_cutout.py -q`
Expected: PASS (3 passed)

- [ ] **Step 5: Run the neighbouring suite for regressions**

Run: `python -m pytest tests/test_editing_service.py -q`
Expected: PASS (8 passed)

- [ ] **Step 6: Commit**

```bash
git add app/services/editing_service.py tests/test_removebg_cutout.py
git commit -m "refactor(editing): expose the Remove.bg cutout so its alpha is reusable"
```

---

## Task 2: Meter the Remove.bg supplier call

Remove.bg is unmetered today: the Replicate path records usage inside `_replicate_run`, the Remove.bg path records nothing. Auto-masking turns it from a deliberate button press into a per-edit call, so it needs a ledger entry before Task 3 starts calling it.

**Files:**
- Modify: `app/services/metering/meter.py` (add after `record_image`, which ends at line 100)
- Create: `alembic/versions/r7removebg3_removebg_cost_rate.py`
- Test: `tests/test_metering_removebg.py` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `async def record_removebg(db, *, org_id: uuid.UUID, project_id, feature: str | None = None) -> int` — writes one `UsageEvent(kind="edit", provider="removebg", model="removebg")`, bumps `OrgUsage`, commits, returns cost in micro-dollars. Used by Task 3.

- [ ] **Step 1: Write the failing test**

Create `tests/test_metering_removebg.py`:

```python
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.billing import OrgUsage
from app.models.cost_rate import CostRate
from app.models.usage_event import UsageEvent
from app.services.metering import meter

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as db:
        db.add(CostRate(provider="removebg", unit="run", model="",
                        micro_dollars_per_unit=200_000))
        await db.commit()
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_record_removebg_writes_a_ledger_row_and_bumps_usage():
    org = uuid.uuid4()
    async with Session() as db:
        cost = await meter.record_removebg(db, org_id=org, project_id=None,
                                           feature="auto_mask")
        assert cost == 200_000

        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.kind == "edit"
        assert ev.provider == "removebg"
        assert ev.feature == "auto_mask"
        assert ev.cost_micros == 200_000

        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.cost_micros == 200_000
        assert ou.ai_cost_micros == 200_000


async def test_record_removebg_bills_at_least_the_replicate_floor():
    """Remove.bg is a paid supplier call; a priced run never bills zero credits."""
    org = uuid.uuid4()
    async with Session() as db:
        await meter.record_removebg(db, org_id=org, project_id=None, feature="auto_mask")
        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_credits_used >= 10


async def test_record_removebg_with_no_rate_costs_nothing_and_bills_nothing():
    """An unseeded rate must not silently bill the floor for a free call."""
    org = uuid.uuid4()
    async with Session() as db:
        await db.execute(CostRate.__table__.delete())
        await db.commit()
        cost = await meter.record_removebg(db, org_id=org, project_id=None)
        assert cost == 0

        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_credits_used == 0
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_metering_removebg.py -q`
Expected: FAIL — `AttributeError: module 'app.services.metering.meter' has no attribute 'record_removebg'`

- [ ] **Step 3: Add the metering function**

In `app/services/metering/meter.py`, insert after `record_image` (which ends at line 100):

```python
async def record_removebg(db, *, org_id: uuid.UUID, project_id,
                          feature: str | None = None) -> int:
    """Price one Remove.bg call.

    Remove.bg bills a flat rate per processed image, so there is no duration to
    price from -- unlike Replicate (record_replicate). Recorded as kind="edit"
    because it is an image-editing supplier cost, same bucket as the Replicate
    edits, so the cost dashboard does not need a new category.

    Gets the same credit floor as Replicate: a priced supplier call that cost
    real money never bills zero credits. A run with no seeded rate costs 0 and
    bills 0 -- replicate_operation_credits returns 0 for a zero cost, so an
    unpriced call is never silently floored up to 10.
    """
    cost = round(await rate(db, "removebg", "run", ""))
    db.add(UsageEvent(
        org_id=org_id, project_id=project_id, kind="edit", provider="removebg",
        model="removebg", feature=feature, cost_micros=cost,
    ))
    await _bump_org_usage(db, org_id, cost_micros=cost, ai_cost_micros=cost,
                          ai_credits_used=replicate_operation_credits(cost))
    await db.commit()
    return cost
```

Verify `replicate_operation_credits` is already imported at the top of the file. If it is not, add it to the existing `from app.core.credits import ...` line.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest tests/test_metering_removebg.py -q`
Expected: PASS (3 passed)

- [ ] **Step 5: Write the cost-rate migration**

Create `alembic/versions/r7removebg3_removebg_cost_rate.py`:

```python
"""cost_rates: seed the Remove.bg per-run rate

Revision ID: r7removebg3
Revises: z7persecond4

Auto-masking (app/services/mask_service.py) calls Remove.bg on every
background-level edit that arrives without a painted mask, so the supplier call
stops being a deliberate button press and becomes per-edit volume. Without a
cost_rates row, meter.rate() returns 0.0 and every auto-mask would look free.

CONFIDENCE -- PLACEHOLDER, read before trusting this for margin reporting:
  Remove.bg's published pricing is credit-based (one credit per processed image
  at full resolution), with the credit price varying by bundle size -- roughly
  $0.20/image on small bundles down to well under that on large subscriptions.
  This seeds 200000 micro-$ ($0.20/image), the small-bundle list price, rather
  than a padded estimate.

  WHY NOT PAD IT: cost_micros drives BOTH margin reporting AND what the customer
  is billed, since AI credits derive from cost. Over-estimating an unknown rate
  is only conservative when it affects margin alone; on a rate that bills users
  it simply overcharges them.

  TO CORRECT: reconcile against the actual Remove.bg invoice once there is real
  volume, then insert ANOTHER versioned row at a later effective_from -- never
  UPDATE this one, that destroys the audit trail of what was charged when.
"""
from alembic import op

revision = "r7removebg3"
down_revision = "z7persecond4"
branch_labels = None
depends_on = None

# Fixed, deterministic effective_from so the migration is reproducible and
# testable rather than depending on wall-clock apply time.
_EFFECTIVE_FROM = "2026-07-30 00:00:00+00"
_MICROS = 200_000


def upgrade() -> None:
    op.execute(
        "INSERT INTO cost_rates (provider, unit, model, effective_from, micro_dollars_per_unit) "
        "VALUES ('removebg', 'run', '', '%s', %d) ON CONFLICT DO NOTHING"
        % (_EFFECTIVE_FROM, _MICROS)
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM cost_rates WHERE provider = 'removebg' AND unit = 'run' "
        "AND model = '' AND effective_from = '%s'" % _EFFECTIVE_FROM
    )
```

- [ ] **Step 6: Verify the migration chain has a single head**

Run: `python -m alembic heads`
Expected: exactly one head, `r7removebg3`. If more than one head prints, stop — do not proceed with a branched chain.

- [ ] **Step 7: Commit**

```bash
git add app/services/metering/meter.py tests/test_metering_removebg.py \
        alembic/versions/r7removebg3_removebg_cost_rate.py
git commit -m "feat(metering): price the Remove.bg supplier call"
```

---

## Task 3: The mask service

The core of the feature. Derives a mask from an image, choosing between the free product tier and the paid prompted tier.

**Files:**
- Create: `app/services/mask_service.py`
- Test: `tests/test_mask_service.py` (create)

**Interfaces:**
- Consumes: `editing_service._removebg_cutout` (Task 1), `meter.record_removebg` (Task 2), the Task 0 findings constants.
- Produces:
  - `MASK_OPERATIONS: frozenset[str]` — the five operations that need a mask.
  - `AMBIGUOUS_WITHOUT_TARGET: frozenset[str]` — `{"insert_object", "generative_fill"}`.
  - `AMBIGUITY_QUESTION: str` — the user-facing question.
  - `@dataclass MaskResolution` with fields `ok: bool`, `mask_url: str | None = None`, `question: str | None = None`, `error: str | None = None`, `tier: str | None = None`.
  - `async def resolve_mask(image_url: str, operation: str, target: str | None, org_id, db) -> MaskResolution`

- [ ] **Step 1: Write the failing test**

Create `tests/test_mask_service.py`:

```python
import io
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from PIL import Image as PILImage

from app.services import mask_service
from app.services.mask_service import MaskResolution, resolve_mask


def _cutout(size=(8, 8)) -> PILImage.Image:
    """RGBA cutout: left half opaque subject, right half transparent background."""
    img = PILImage.new("RGBA", size, (255, 0, 0, 255))
    for x in range(size[0] // 2, size[0]):
        for y in range(size[1]):
            img.putpixel((x, y), (0, 0, 0, 0))
    return img


def _uploaded_mask(mock_upload) -> PILImage.Image:
    """Reconstruct the L-mode mask handed to the uploader."""
    (img,), _ = mock_upload.call_args
    return img


# ---- alpha -> binary mask -------------------------------------------------

def test_alpha_to_mask_marks_opaque_pixels_white():
    mask = mask_service._alpha_to_mask(_cutout())
    assert mask.mode == "L"
    assert mask.getpixel((0, 0)) == 255   # subject
    assert mask.getpixel((7, 0)) == 0     # background


def test_alpha_to_mask_thresholds_semi_transparent_pixels():
    img = PILImage.new("RGBA", (3, 1), (255, 0, 0, 0))
    img.putpixel((0, 0), (255, 0, 0, 10))    # nearly transparent -> black
    img.putpixel((1, 0), (255, 0, 0, 200))   # nearly opaque -> white
    img.putpixel((2, 0), (255, 0, 0, 128))   # exactly at threshold -> white
    mask = mask_service._alpha_to_mask(img)
    assert (mask.getpixel((0, 0)), mask.getpixel((1, 0)), mask.getpixel((2, 0))) == (0, 255, 255)


# ---- polarity table -------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("operation,expect_subject_white", [
    ("replace_background", False),  # white = background
    ("remove_object", True),        # white = subject
    ("smart_erase", True),          # white = subject
])
async def test_product_tier_polarity(operation, expect_subject_white):
    upload = AsyncMock(return_value="https://cdn/mask.png")
    with patch("app.services.mask_service._removebg_cutout", AsyncMock(return_value=_cutout())), \
         patch("app.services.mask_service._upload_mask", upload), \
         patch("app.services.mask_service.record_removebg", AsyncMock(return_value=200_000)):
        res = await resolve_mask("https://cdn/x.png", operation, None, uuid.uuid4(), None)

    assert res.ok is True
    assert res.tier == "product"
    mask = _uploaded_mask(upload)
    subject_px, background_px = mask.getpixel((0, 0)), mask.getpixel((7, 0))
    assert (subject_px == 255) is expect_subject_white
    assert (background_px == 255) is (not expect_subject_white)


# ---- tier selection -------------------------------------------------------

@pytest.mark.asyncio
async def test_absent_target_uses_the_free_product_tier():
    segment = AsyncMock(return_value="https://cdn/seg.png")
    with patch("app.services.mask_service._removebg_cutout", AsyncMock(return_value=_cutout())), \
         patch("app.services.mask_service._upload_mask", AsyncMock(return_value="https://cdn/m.png")), \
         patch("app.services.mask_service.record_removebg", AsyncMock(return_value=0)), \
         patch("app.services.mask_service._segment_by_prompt", segment):
        res = await resolve_mask("https://cdn/x.png", "replace_background", None, uuid.uuid4(), None)

    assert res.tier == "product"
    segment.assert_not_awaited()


@pytest.mark.asyncio
async def test_present_target_uses_the_prompted_tier():
    cutout = AsyncMock(return_value=_cutout())
    with patch("app.services.mask_service._removebg_cutout", cutout), \
         patch("app.services.mask_service._segment_by_prompt",
               AsyncMock(return_value="https://cdn/seg.png")):
        res = await resolve_mask("https://cdn/x.png", "remove_object",
                                 "the person on the left", uuid.uuid4(), None)

    assert res.ok is True
    assert res.tier == "prompted"
    assert res.mask_url == "https://cdn/seg.png"
    cutout.assert_not_awaited()  # never pays for the free tier it did not use


# ---- ambiguity gate -------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["insert_object", "generative_fill"])
async def test_ambiguous_operations_ask_and_spend_nothing(operation):
    cutout, segment = AsyncMock(), AsyncMock()
    with patch("app.services.mask_service._removebg_cutout", cutout), \
         patch("app.services.mask_service._segment_by_prompt", segment):
        res = await resolve_mask("https://cdn/x.png", operation, None, uuid.uuid4(), None)

    assert res.ok is False
    assert res.question == mask_service.AMBIGUITY_QUESTION
    cutout.assert_not_awaited()
    segment.assert_not_awaited()


@pytest.mark.asyncio
async def test_ambiguous_operation_with_a_target_resolves_normally():
    with patch("app.services.mask_service._segment_by_prompt",
               AsyncMock(return_value="https://cdn/seg.png")):
        res = await resolve_mask("https://cdn/x.png", "insert_object",
                                 "the empty shelf", uuid.uuid4(), None)
    assert res.ok is True
    assert res.mask_url == "https://cdn/seg.png"


# ---- failure -------------------------------------------------------------

@pytest.mark.asyncio
async def test_supplier_failure_returns_an_error_not_an_exception():
    with patch("app.services.mask_service._removebg_cutout",
               AsyncMock(side_effect=RuntimeError("remove.bg 402"))):
        res = await resolve_mask("https://cdn/x.png", "replace_background", None,
                                 uuid.uuid4(), None)
    assert res.ok is False
    assert res.question is None
    assert "remove.bg 402" in res.error
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_mask_service.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.mask_service'`

- [ ] **Step 3: Write the mask service**

Create `app/services/mask_service.py`. Replace the four `_SEGMENTER_*` constants and `_SEGMENTER_INVERTS` with the values recorded in the Task 0 findings file.

```python
"""Derive an edit mask from an image, so mask-requiring operations can run
without the user hand-painting a selection.

POLARITY -- the single most important invariant here: white marks the region to
be REPLACED. Getting this backwards inverts every edit and fails silently (the
model happily inpaints the wrong half), so the polarity table below is asserted
by tests/test_mask_service.py rather than trusted.

Two tiers, selected purely on whether a `target` was named:
  - product  (no target): thresholds the alpha channel of a Remove.bg cutout.
    Costs one Remove.bg call, no new model.
  - prompted (target given): segments the named object on Replicate.

Tier selection deliberately does NOT sniff keywords out of the target text --
"the background" would route to the paid segmenter for a case the free tier
already handles. Instead the planner is instructed to OMIT target for default
regions (see app/services/ai_command_service.py), which keeps this rule
trivially predictable.
"""
import io
import uuid
from dataclasses import dataclass
from typing import Optional

from PIL import Image as PILImage, ImageOps

from app.core.storage import upload_bytes
from app.services.editing_service import _download, _removebg_cutout, _replicate_run
from app.services.metering.meter import record_removebg

# Pinned in Task 0 against Replicate's live API. Do not edit from memory.
_SEGMENTER_MODEL = "<from Task 0 findings>"
_SEGMENTER_VERSION: Optional[str] = None  # <from Task 0 findings>
_SEGMENTER_IMAGE_FIELD = "<from Task 0 findings>"
_SEGMENTER_PROMPT_FIELD = "<from Task 0 findings>"
# True when the segmenter returns white for the region to KEEP, so its output
# must be inverted to match this module's white-is-replaced convention.
_SEGMENTER_INVERTS = False  # <from Task 0 findings>

# Alpha at or above this counts as opaque subject.
_ALPHA_THRESHOLD = 128

MASK_OPERATIONS = frozenset({
    "replace_background", "remove_object", "insert_object",
    "generative_fill", "smart_erase",
})

# Operations with no derivable default region: "put a bottle in the frame" does
# not say where. These ask instead of guessing.
AMBIGUOUS_WITHOUT_TARGET = frozenset({"insert_object", "generative_fill"})

AMBIGUITY_QUESTION = (
    "Tell me which part to change -- for example 'the background' or 'the bottle'."
)

# White = the region to be replaced. For the product tier the subject is the
# opaque alpha, so operations acting on the BACKGROUND invert it.
_INVERT_FOR_PRODUCT_TIER = frozenset({"replace_background"})


@dataclass
class MaskResolution:
    ok: bool
    mask_url: Optional[str] = None
    question: Optional[str] = None
    error: Optional[str] = None
    tier: Optional[str] = None


def _alpha_to_mask(cutout: PILImage.Image) -> PILImage.Image:
    """RGBA cutout -> binary L-mode mask, white where the subject is opaque."""
    alpha = cutout.convert("RGBA").getchannel("A")
    return alpha.point(lambda a: 255 if a >= _ALPHA_THRESHOLD else 0, mode="L")


async def _upload_mask(mask: PILImage.Image) -> str:
    buf = io.BytesIO()
    mask.save(buf, format="PNG")
    buf.seek(0)
    return await upload_bytes(buf.read(), f"masks/{uuid.uuid4().hex}.png", "image/png")


async def _segment_by_prompt(image_url: str, target: str) -> str:
    """Segment the named object on Replicate and return the uploaded mask URL."""
    output = await _replicate_run(
        _SEGMENTER_MODEL,
        {_SEGMENTER_IMAGE_FIELD: image_url, _SEGMENTER_PROMPT_FIELD: target},
        version=_SEGMENTER_VERSION,
    )
    mask = PILImage.open(io.BytesIO(await _download(output))).convert("L")
    if _SEGMENTER_INVERTS:
        mask = ImageOps.invert(mask)
    return await _upload_mask(mask)


async def resolve_mask(image_url: str, operation: str, target: Optional[str],
                       org_id, db) -> MaskResolution:
    """Derive a mask for `operation` on `image_url`.

    Callers must only reach here when no painted mask was supplied -- a
    deliberate user selection always wins over an inferred one.
    """
    if not target and operation in AMBIGUOUS_WITHOUT_TARGET:
        # Ask BEFORE spending anything: no supplier call has happened yet.
        return MaskResolution(ok=False, question=AMBIGUITY_QUESTION)

    try:
        if target:
            return MaskResolution(ok=True, tier="prompted",
                                  mask_url=await _segment_by_prompt(image_url, target))

        cutout = await _removebg_cutout(image_url)
        await record_removebg(db, org_id=org_id, project_id=None, feature="auto_mask")
        mask = _alpha_to_mask(cutout)
        if operation in _INVERT_FOR_PRODUCT_TIER:
            mask = ImageOps.invert(mask)
        return MaskResolution(ok=True, tier="product", mask_url=await _upload_mask(mask))
    except Exception as e:  # noqa: BLE001
        return MaskResolution(ok=False, error=str(e))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest tests/test_mask_service.py -q`
Expected: PASS (11 passed)

- [ ] **Step 5: Commit**

```bash
git add app/services/mask_service.py tests/test_mask_service.py
git commit -m "feat(mirage): derive edit masks automatically"
```

---

## Task 4: Wire the manual edit router

Replace the "please paint the area first" dead-end with auto-resolution.

**Files:**
- Modify: `app/api/v1/routers/editing.py:21`, `:62-72`, `:118-124`
- Test: `tests/test_mask_routing.py` (create)

**Interfaces:**
- Consumes: `mask_service.resolve_mask`, `MaskResolution`, `MASK_OPERATIONS`, `AMBIGUITY_QUESTION` (Task 3).
- Produces: `EditOut` gains `needs_target: bool = False`. Task 5 does not depend on this.

- [ ] **Step 1: Write the failing test**

Create `tests/test_mask_routing.py`:

```python
import uuid
from unittest.mock import AsyncMock, patch

import pytest

from app.api.v1.routers import editing
from app.services.mask_service import AMBIGUITY_QUESTION, MaskResolution


@pytest.mark.asyncio
async def test_painted_mask_wins_over_auto_resolution():
    """A deliberate user selection is never overridden."""
    resolve = AsyncMock()
    with patch("app.api.v1.routers.editing.resolve_mask", resolve), \
         patch("app.api.v1.routers.editing._resolve_mask_url",
               AsyncMock(return_value="https://cdn/painted.png")):
        mask_url, err, needs_target = await editing._mask_for(
            "replace_background", {"mask_base64": "data:image/png;base64,AAA"},
            "https://cdn/x.png", uuid.uuid4(), None,
        )

    assert mask_url == "https://cdn/painted.png"
    assert err is None
    assert needs_target is False
    resolve.assert_not_awaited()


@pytest.mark.asyncio
async def test_missing_mask_falls_back_to_auto_resolution():
    with patch("app.api.v1.routers.editing._resolve_mask_url", AsyncMock(return_value=None)), \
         patch("app.api.v1.routers.editing.resolve_mask",
               AsyncMock(return_value=MaskResolution(ok=True, mask_url="https://cdn/auto.png",
                                                     tier="product"))):
        mask_url, err, needs_target = await editing._mask_for(
            "replace_background", {}, "https://cdn/x.png", uuid.uuid4(), None,
        )

    assert mask_url == "https://cdn/auto.png"
    assert err is None
    assert needs_target is False


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
async def test_ambiguous_resolution_surfaces_the_question_and_flags_needs_target():
    with patch("app.api.v1.routers.editing._resolve_mask_url", AsyncMock(return_value=None)), \
         patch("app.api.v1.routers.editing.resolve_mask",
               AsyncMock(return_value=MaskResolution(ok=False, question=AMBIGUITY_QUESTION))):
        mask_url, err, needs_target = await editing._mask_for(
            "insert_object", {"prompt": "a vase"}, "https://cdn/x.png", uuid.uuid4(), None,
        )

    assert mask_url is None
    assert err == AMBIGUITY_QUESTION
    assert needs_target is True


@pytest.mark.asyncio
async def test_resolver_failure_surfaces_its_error_without_flagging_needs_target():
    """A supplier outage is not a question -- the client must not re-prompt the
    user for a target they already gave (or that was never the problem)."""
    with patch("app.api.v1.routers.editing._resolve_mask_url", AsyncMock(return_value=None)), \
         patch("app.api.v1.routers.editing.resolve_mask",
               AsyncMock(return_value=MaskResolution(ok=False, error="remove.bg 402"))):
        mask_url, err, needs_target = await editing._mask_for(
            "replace_background", {}, "https://cdn/x.png", uuid.uuid4(), None,
        )

    assert mask_url is None
    assert "remove.bg 402" in err
    assert needs_target is False
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_mask_routing.py -q`
Expected: FAIL — `AttributeError: module 'app.api.v1.routers.editing' has no attribute '_mask_for'`

- [ ] **Step 3: Add the helper and use it**

In `app/api/v1/routers/editing.py`, add to the imports:

```python
from app.services.mask_service import MASK_OPERATIONS, resolve_mask
```

Replace the module-level `_MASK_OPS` (line 21) with an alias so there is one definition of the set:

```python
# Operations that accept a mask. Sourced from mask_service so the router and the
# resolver cannot drift apart.
_MASK_OPS = MASK_OPERATIONS
```

Add after `_resolve_mask_url` (which ends at line 59):

```python
async def _mask_for(operation: str, params: dict, image_url: str, org_id, db):
    """Resolve the mask for a mask-requiring operation.

    Returns (mask_url, error, needs_target). A painted mask always wins;
    auto-resolution runs only when the user painted nothing. Replaces the
    previous behaviour of refusing the edit outright with "paint the area
    first", which made every mask operation unreachable from a plain
    natural-language request.

    needs_target separates the two failure kinds: True means Mirage needs to be
    told which region to act on (the client should re-ask), False means the
    resolution itself broke -- a supplier outage is not a question, and
    re-prompting for a target the user already gave would be nonsense.
    """
    painted = await _resolve_mask_url(params)
    if painted:
        return painted, None, False

    resolution = await resolve_mask(image_url, operation, params.get("target"), org_id, db)
    if resolution.ok:
        return resolution.mask_url, None, False
    if resolution.question:
        return None, resolution.question, True
    return None, resolution.error or "Could not work out which area to change.", False
```

Replace the mask block (lines 118-124) with:

```python
    # For Replicate masked operations: use the painted mask, else derive one.
    if body.operation in _MASK_OPS:
        mask_url, mask_error, needs_target = await _mask_for(
            body.operation, params, image.image_url, current_user.org_id, db,
        )
        if mask_error:
            return EditOut(ok=False, error=mask_error, needs_target=needs_target)
        kwargs["mask_url"] = mask_url
```

Add the field to `EditOut` (line 67):

```python
class EditOut(BaseModel):
    ok: bool
    image_url: Optional[str] = None
    image_id: Optional[uuid.UUID] = None
    error: Optional[str] = None
    # True when the edit stopped because Mirage needs to know which region to
    # act on -- the client should re-ask rather than treat this as a failure.
    needs_target: bool = False
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest tests/test_mask_routing.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/routers/editing.py tests/test_mask_routing.py
git commit -m "feat(editing): auto-resolve the mask when none was painted"
```

---

## Task 5: Wire the AI-command router and invert the planner

**Files:**
- Modify: `app/api/v1/routers/ai_command.py:83-102`
- Modify: `app/services/ai_command_service.py:22-27`, `:53-54`
- Test: `tests/test_ai_command_planner.py` (create), `tests/test_mask_routing.py` (extend)

**Interfaces:**
- Consumes: `mask_service.resolve_mask`, `MASK_OPERATIONS`, `AMBIGUITY_QUESTION` (Task 3).
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_ai_command_planner.py`:

```python
from app.services import ai_command_service


def test_planner_no_longer_steers_away_from_mask_operations():
    """The old instruction made every mask op unreachable from plain text."""
    assert "Prefer operations that do NOT require a mask" not in ai_command_service._STEPS_SYSTEM
    assert "user must paint mask on canvas first" not in ai_command_service._OPERATIONS_REFERENCE


def test_operations_reference_documents_the_target_param():
    ref = ai_command_service._OPERATIONS_REFERENCE
    for op in ("replace_background", "remove_object", "smart_erase",
               "insert_object", "generative_fill"):
        line = next(ln for ln in ref.splitlines() if ln.strip().startswith(f"- {op}:"))
        assert "target" in line, f"{op} does not document target"


def test_default_region_operations_are_told_to_omit_target():
    """Emitting target='the background' would route the commonest, cheapest
    case through the paid segmenter instead of the free product tier."""
    ref = ai_command_service._OPERATIONS_REFERENCE
    for op in ("replace_background", "remove_object", "smart_erase"):
        line = next(ln for ln in ref.splitlines() if ln.strip().startswith(f"- {op}:"))
        assert "OMIT" in line, f"{op} does not tell the planner to omit target"


def test_insert_and_fill_require_a_target():
    ref = ai_command_service._OPERATIONS_REFERENCE
    for op in ("insert_object", "generative_fill"):
        line = next(ln for ln in ref.splitlines() if ln.strip().startswith(f"- {op}:"))
        assert "REQUIRED" in line, f"{op} does not mark target required"
```

Append to `tests/test_mask_routing.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_ai_command_planner.py tests/test_mask_routing.py -q`
Expected: FAIL — planner assertions fail on the current strings; `ai_command` has no attribute `_mask_for_step`.

- [ ] **Step 3: Invert the planner instructions**

In `app/services/ai_command_service.py`, replace the mask block of `_OPERATIONS_REFERENCE` (lines 22-27) with:

```
Operations that act on a region of the image. Name the region in `target` ONLY
when the user singled out a specific object; OMIT target to use the operation's
default region, which is resolved automatically and costs less:
- replace_background: params: prompt(str describing new background), target(str, optional — OMIT for the background)
- remove_object: params: target(str, optional — OMIT for the main subject)
- insert_object: params: prompt(str describing object to insert), target(str, REQUIRED — where to insert)
- generative_fill: params: prompt(str describing fill content), target(str, REQUIRED — region to fill)
- smart_erase: params: target(str, optional — OMIT for the main subject)
```

In `_STEPS_SYSTEM` (lines 53-54), delete these two lines entirely:

```
    "Prefer operations that do NOT require a mask. Only include a mask operation if the user clearly refers "
    "to a painted selection. "
```

and put in their place:

```
    "Mask operations are fully available -- never refuse or avoid one because it needs a selection, "
    "and never ask the user to paint anything. "
```

- [ ] **Step 4: Add the per-step mask resolution**

In `app/api/v1/routers/ai_command.py`, add to the imports:

```python
from app.services.mask_service import MASK_OPERATIONS, resolve_mask
```

Add before the `ai_command` route handler:

```python
async def _mask_for_step(step: dict, image_url: str, painted_mask_url, org_id, db):
    """Resolve this step's mask, or None for operations that do not take one.

    Resolution runs per step against the EVOLVING image, so step N masks against
    step N-1's output rather than the original -- that is what makes a chained
    request like "replace the background, then upscale" mask the right frame.
    """
    operation = step["operation"]
    if operation not in MASK_OPERATIONS:
        return None
    if painted_mask_url:
        return painted_mask_url

    params = step.get("params", {}) or {}
    resolution = await resolve_mask(image_url, operation, params.get("target"), org_id, db)
    if resolution.ok:
        return resolution.mask_url
    if resolution.question:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            {"code": "mask_target_required", "message": resolution.question},
        )
    raise HTTPException(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        {"code": "mask_unavailable", "message": resolution.error or "Could not work out which area to change."},
    )
```

Replace the chain loop (lines 87-102) with:

```python
    # Chain the operations — each runs on the previous step's result.
    current_url = source.image_url or ""
    applied: list[str] = []
    for step in steps:
        operation = step["operation"]
        params = step.get("params", {}) or {}
        step_mask = await _mask_for_step(step, current_url, mask_url, current_user.org_id, db)
        fn = _DISPATCH[operation]
        edit_result = await fn(current_url, params, step_mask)
        if not edit_result.get("ok"):
            detail = edit_result.get("error", "Edit failed")
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                f"Step '{operation}' failed: {detail}" if applied else detail,
            )
        current_url = edit_result["image_url"]
        applied.append(operation)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/test_ai_command_planner.py tests/test_mask_routing.py -q`
Expected: PASS (13 passed)

- [ ] **Step 6: Run the AI-command dispatch regression suite**

Run: `python -m pytest tests/test_ai_command_dispatch.py -q`
Expected: PASS (5 passed) — the `_DISPATCH` argument order must still hold.

- [ ] **Step 7: Commit**

```bash
git add app/api/v1/routers/ai_command.py app/services/ai_command_service.py \
        tests/test_ai_command_planner.py tests/test_mask_routing.py
git commit -m "feat(mirage): auto-resolve masks in the AI-command chain"
```

---

## Task 6: Full-suite verification

**Files:** none modified.

- [ ] **Step 1: Run the whole backend suite**

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

**If any OTHER test fails, it is a regression from this work — fix it before continuing.** Do not fix the 10 above.

- [ ] **Step 2: Verify the migration applies**

Run: `python -m alembic heads`
Expected: one head, `r7removebg3`.

- [ ] **Step 3: Confirm no frontend change was needed**

Run from `apps/web`: `npm run typecheck`
Expected: clean. The 422 detail reaches the client through the existing `ApiError.detail` handling in `lib/api.ts`; `needs_target` is an additive optional field. If typecheck fails, a frontend type mirrors `EditOut` and needs the new optional field.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "test(mirage): verify the full suite after auto-masking"
```

---

## Manual verification

Automated tests mock every supplier call, so they prove wiring and polarity logic but never that a real mask produces a good edit. Before calling this done, run one real request per tier:

1. **Product tier.** Upload a product photo, then "replace the background with green marble". Confirm the product is untouched and only the background changed. **If the product changed and the background did not, the polarity is inverted** — revisit the Task 0 findings.
2. **Prompted tier.** On a photo with several objects, "remove the person on the left". Confirm the right object was removed.
3. **Ambiguity gate.** "Add a vase" with no further detail. Confirm Mirage asks which region rather than guessing, and that no credits were spent (check the usage meter before and after).
4. **Painting still wins.** Paint a mask, then run a mask operation. Confirm the painted region was used, not an auto-derived one.
