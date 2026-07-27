# Billing v2 — Credits, Full-Cost Metering & Plan Reduction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meter image generation, Replicate, and all DataForSEO usage into the ledger; introduce cost-based AI-credit and SEO-credit buckets; reduce plan allowances; hard-stop at 100%; show the balance in the customer app header.

**Architecture:** Credits are derived from real supplier cost in micro-dollars (`$1 = 1_000_000`). `1 AI credit = $0.01 of cost`, stored internally as milli-credits (integer) so sub-cent calls accumulate exactly. `1 SEO credit = 1 DataForSEO task` (weighted for heavy endpoints). New meter functions (`record_image`, `record_replicate`) attach at each service's single chokepoint and resolve the org from the existing ambient contextvar (`app/core/metering_context.py`), the same pattern that made LLM metering universal. Enforcement is a FastAPI dependency mirroring the existing `check_usage_limit`.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, pytest (host in-memory SQLite), Next.js 14 + TanStack Query + Tailwind (apps/web, apps/admin).

**Spec:** `docs/superpowers/specs/2026-07-27-billing-v2-credits-design.md`

## Global Constraints

- **Never use emoji** in code, UI text, comments, or commit messages.
- Money is **micro-dollars** (integer, `$1 = 1_000_000`). Credits: AI stored as **milli-credits** (integer, `credits * 1000`); SEO stored as **whole credits**.
- `AI_CREDIT_MICROS = 10_000` (1 AI credit = $0.01 of supplier cost).
- Commit style `feat(scope): …` / `fix(scope):` / `docs(scope):`; every commit ends with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Metering must be **best-effort**: wrap in `try/except`, never break the user-facing action if metering fails.
- Tests: host in-memory SQLite (`sqlite+aiosqlite:///:memory:`), `asyncio_mode="auto"` (NO `@pytest.mark.asyncio`), each test file owns its engine + autouse `setup_db` fixture. Router tests use httpx `ASGITransport` + `app.dependency_overrides[get_db]`.
- Known pre-existing test failures (do NOT treat as regressions): `test_edit_model.py` and 9x `test_strands_runtime.py`.
- Alembic: current head is `r5scaletier1`. New revisions MUST use a **random revision id** (never a sequential/guessable one) and chain on the current head.
- Frontend: CSS-variable tokens only (no hard-coded hex/rgb), Lucide icons, all user-visible strings via `t("key")` in apps/web, `apiClient` (never raw `fetch`), TanStack Query.

---

### Task 1: Credit constants and conversions

**Files:**
- Create: `apps/api/app/core/credits.py`
- Test: `apps/api/tests/test_credits.py`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces: `AI_CREDIT_MICROS: int`, `ai_credits_from_micros(cost_micros: int) -> int` (returns **milli-credits**), `milli_to_credits(milli: int) -> int`, `SEO_CREDIT_WEIGHT: dict[str, int]`, `seo_credits_for(unit: str | None, count: int) -> int`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_credits.py
from app.core.credits import (
    AI_CREDIT_MICROS, ai_credits_from_micros, milli_to_credits,
    seo_credits_for, SEO_CREDIT_WEIGHT,
)


def test_ai_credit_is_one_cent_of_cost():
    assert AI_CREDIT_MICROS == 10_000


def test_ai_credits_from_micros_returns_milli_credits():
    # $0.01 of cost == 1 credit == 1000 milli-credits
    assert ai_credits_from_micros(10_000) == 1_000
    # gpt-image-1 medium, $0.06 -> 6 credits
    assert ai_credits_from_micros(60_000) == 6_000
    # a sub-cent LLM call must NOT round to zero: $0.002 -> 0.2 credits
    assert ai_credits_from_micros(2_000) == 200
    assert ai_credits_from_micros(0) == 0


def test_milli_to_credits_rounds_for_display():
    assert milli_to_credits(1_000) == 1
    assert milli_to_credits(1_600) == 2
    assert milli_to_credits(0) == 0


def test_seo_credits_weighted_by_unit():
    assert seo_credits_for("serp", 3) == 3
    assert seo_credits_for("audit", 2) == 2 * SEO_CREDIT_WEIGHT["audit"]
    # unknown or missing unit falls back to 1x
    assert seo_credits_for("something_new", 4) == 4
    assert seo_credits_for(None, 5) == 5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_credits.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.core.credits'`

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/app/core/credits.py
"""Credit conversions. Money is micro-dollars ($1 = 1_000_000).

1 AI credit == $0.01 of real supplier cost. AI credits are accumulated as
*milli-credits* (credits * 1000) so that sub-cent calls -- a gpt-4o-mini turn
costs ~$0.002, i.e. 0.2 credits -- accumulate exactly instead of rounding to
zero on every call. Display divides by 1000.

1 SEO credit == one DataForSEO billable task; heavier endpoints are weighted.
"""

AI_CREDIT_MICROS = 10_000  # $0.01 per AI credit


def ai_credits_from_micros(cost_micros: int) -> int:
    """Convert supplier cost (micro-dollars) to milli-credits."""
    return round(cost_micros * 1000 / AI_CREDIT_MICROS)


def milli_to_credits(milli: int) -> int:
    """Whole credits for display/enforcement."""
    return round(milli / 1000)


SEO_CREDIT_WEIGHT: dict[str, int] = {
    "serp": 1,
    "keyword_ideas": 1,
    "keyword_analysis": 1,
    "rank_check": 1,
    "backlinks": 3,
    "audit": 5,
}


def seo_credits_for(unit: str | None, count: int) -> int:
    return count * SEO_CREDIT_WEIGHT.get(unit or "", 1)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_credits.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/core/credits.py apps/api/tests/test_credits.py
git commit -m "feat(billing): credit conversions (AI milli-credits, SEO weights)"
```

---

### Task 2: OrgUsage credit columns + migration

**Files:**
- Modify: `apps/api/app/models/billing.py` (add 2 columns to `OrgUsage`)
- Create: `apps/api/alembic/versions/<random_id>_org_usage_credits.py`
- Test: `apps/api/tests/test_org_usage_credits.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `OrgUsage.ai_credits_used` (BigInteger, milli-credits, default 0), `OrgUsage.seo_credits_used` (Integer, whole credits, default 0). `_bump_org_usage(db, org_id, **increments)` already accepts raw column names, so no signature change is needed -- callers pass `ai_credits_used=...` / `seo_credits_used=...`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_org_usage_credits.py
import uuid
import datetime as dt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
import pytest

from app.core.database import Base
from app.models.billing import OrgUsage

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_org_usage_has_credit_columns_defaulting_to_zero():
    org = uuid.uuid4()
    async with Session() as db:
        db.add(OrgUsage(org_id=org, period_start=dt.date(2026, 7, 1)))
        await db.commit()
        row = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert row.ai_credits_used == 0
        assert row.seo_credits_used == 0


async def test_credit_columns_accumulate():
    org = uuid.uuid4()
    async with Session() as db:
        db.add(OrgUsage(org_id=org, period_start=dt.date(2026, 7, 1),
                        ai_credits_used=1_500, seo_credits_used=7))
        await db.commit()
        row = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert row.ai_credits_used == 1_500   # 1.5 credits, stored as milli
        assert row.seo_credits_used == 7
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_org_usage_credits.py -v`
Expected: FAIL with `AttributeError`/`TypeError` -- `ai_credits_used` is not a valid `OrgUsage` field.

- [ ] **Step 3: Add the columns**

In `apps/api/app/models/billing.py`, inside `class OrgUsage`, after `seo_keyword_analyses`:

```python
    # Credits. ai_credits_used is milli-credits (credits * 1000) so sub-cent
    # calls accumulate exactly; seo_credits_used is whole credits.
    ai_credits_used: Mapped[int] = mapped_column(BigInteger, default=0)
    seo_credits_used: Mapped[int] = mapped_column(Integer, default=0)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_org_usage_credits.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Generate the migration**

```bash
docker compose exec api alembic revision --autogenerate -m "org_usage credit columns"
```

Then EDIT the generated file: replace the auto-generated `revision` identifier with a **random** id (e.g. `c7k2credits9`), set `down_revision = "r5scaletier1"`, and verify the body is exactly the two `add_column` calls with `server_default="0"` plus their `drop_column` downgrades:

```python
revision = "c7k2credits9"
down_revision = "r5scaletier1"

def upgrade() -> None:
    op.add_column("org_usage", sa.Column("ai_credits_used", sa.BigInteger(),
                                         nullable=False, server_default="0"))
    op.add_column("org_usage", sa.Column("seo_credits_used", sa.Integer(),
                                         nullable=False, server_default="0"))

def downgrade() -> None:
    op.drop_column("org_usage", "seo_credits_used")
    op.drop_column("org_usage", "ai_credits_used")
```

- [ ] **Step 6: Apply and verify a single head**

```bash
docker compose exec api alembic upgrade head
docker compose exec api alembic heads   # must print exactly ONE head
```
Expected: one head, `c7k2credits9`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/models/billing.py apps/api/alembic/versions/ apps/api/tests/test_org_usage_credits.py
git commit -m "feat(billing): org_usage AI/SEO credit columns + migration"
```

---

### Task 3: Meter image generation

**Files:**
- Modify: `apps/api/app/services/metering/meter.py` (add `record_image`)
- Modify: `apps/api/app/services/image_service.py` (call it at the chokepoint)
- Test: `apps/api/tests/test_metering_image.py`

**Interfaces:**
- Consumes: `ai_credits_from_micros` (Task 1), `OrgUsage.ai_credits_used` (Task 2), `_bump_org_usage` + `UsageEvent` (existing), `app.core.metering_context.get_metering_org` (existing).
- Produces: `meter.record_image(db, *, org_id, project_id, model, cost_usd, feature=None) -> int` (returns cost_micros).

**Context:** `image_service.generate_image_dalle` already computes `cost_usd` from size/quality and returns it in its result dict. That value is authoritative -- do NOT re-derive cost from a rate table. `usage_events.kind` gains the value `"image"`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_metering_image.py
import uuid
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.billing import OrgUsage
from app.models.usage_event import UsageEvent
from app.services.metering import meter

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_record_image_writes_event_and_credits():
    org = uuid.uuid4()
    async with Session() as db:
        cost = await meter.record_image(
            db, org_id=org, project_id=None, model="gpt-image-1",
            cost_usd=0.06, feature="article_cover",
        )
        # $0.06 -> 60_000 micros -> 6 credits -> 6000 milli-credits
        assert cost == 60_000

        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.kind == "image"
        assert ev.provider == "openai"
        assert ev.model == "gpt-image-1"
        assert ev.feature == "article_cover"
        assert ev.cost_micros == 60_000

        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.cost_micros == 60_000
        assert ou.ai_credits_used == 6_000
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_metering_image.py -v`
Expected: FAIL with `AttributeError: module 'app.services.metering.meter' has no attribute 'record_image'`

- [ ] **Step 3: Implement `record_image`**

In `apps/api/app/services/metering/meter.py`, add the import `from app.core.credits import ai_credits_from_micros, seo_credits_for` at the top, then:

```python
async def record_image(db, *, org_id: uuid.UUID, project_id, model: str,
                       cost_usd: float, feature: str | None = None) -> int:
    """Price an image generation from the cost the image service already
    computed (authoritative -- it knows the size/quality that was billed)."""
    cost = round(cost_usd * 1_000_000)
    db.add(UsageEvent(
        org_id=org_id, project_id=project_id, kind="image", provider="openai",
        model=model, feature=feature, cost_micros=cost,
    ))
    await _bump_org_usage(db, org_id, cost_micros=cost,
                          ai_credits_used=ai_credits_from_micros(cost))
    await db.commit()
    return cost
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_metering_image.py -v`
Expected: PASS

- [ ] **Step 5: Wire into the image service chokepoint**

In `apps/api/app/services/image_service.py`, at the end of `generate_image_dalle`, right before it returns the success dict, add a best-effort ambient-context record (mirroring how `llm_service.call_llm` does it):

```python
    # Best-effort metering: attribute to the ambient org (set at the auth
    # boundary and at provider-key resolution). Never break image generation.
    try:
        from app.core.metering_context import get_metering_org
        _org = get_metering_org()
        if _org is not None:
            from app.core.database import async_session_factory
            from app.services.metering import meter as _meter
            async with async_session_factory() as _db:
                await _meter.record_image(
                    _db, org_id=_org, project_id=None, model="gpt-image-1",
                    cost_usd=cost_usd, feature=usage,
                )
    except Exception:  # noqa: BLE001
        logger.warning("image usage metering failed", exc_info=True)
```

If `image_service.py` has no module logger, add `logger = logging.getLogger(__name__)` (and `import logging`) at the top.

- [ ] **Step 6: Run the full suite**

Run: `cd apps/api && python -m pytest -q`
Expected: no NEW failures (the 10 known pre-existing failures remain).

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/services/metering/meter.py apps/api/app/services/image_service.py apps/api/tests/test_metering_image.py
git commit -m "feat(metering): meter image generation into the usage ledger"
```

---

### Task 4: Meter Replicate usage

**Files:**
- Modify: `apps/api/app/services/metering/meter.py` (add `record_replicate`)
- Modify: `apps/api/app/services/editing_service.py` (call it inside `_replicate_run`)
- Test: `apps/api/tests/test_metering_replicate.py`

**Interfaces:**
- Consumes: `rate(db, provider, unit, model)` (existing in meter.py), `ai_credits_from_micros` (Task 1).
- Produces: `meter.record_replicate(db, *, org_id, project_id, model, feature=None) -> int`.

**Context:** `editing_service._replicate_run(model, input_params, version=None)` is the SINGLE chokepoint for every Replicate call (background removal, upscale, etc.). Cost comes from a `cost_rate` row `(provider="replicate", unit="run", model=<slug>)`, falling back to the default row with `model=""` when the specific model has no rate. `usage_events.kind` gains the value `"edit"`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_metering_replicate.py
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
        db.add_all([
            CostRate(provider="replicate", unit="run",
                     model="852-labs/background-remover", micro_dollars_per_unit=10_000),
            CostRate(provider="replicate", unit="run", model="", micro_dollars_per_unit=5_000),
        ])
        await db.commit()
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_record_replicate_prices_from_model_rate():
    org = uuid.uuid4()
    async with Session() as db:
        cost = await meter.record_replicate(
            db, org_id=org, project_id=None,
            model="852-labs/background-remover", feature="background_removal",
        )
        assert cost == 10_000  # $0.01 -> 1 credit

        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.kind == "edit"
        assert ev.provider == "replicate"
        assert ev.model == "852-labs/background-remover"
        assert ev.cost_micros == 10_000

        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_credits_used == 1_000  # 1 credit


async def test_record_replicate_falls_back_to_default_rate():
    org = uuid.uuid4()
    async with Session() as db:
        cost = await meter.record_replicate(
            db, org_id=org, project_id=None, model="some/unpriced-model",
        )
        assert cost == 5_000
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_metering_replicate.py -v`
Expected: FAIL -- `meter` has no attribute `record_replicate`.

- [ ] **Step 3: Implement `record_replicate`**

```python
async def record_replicate(db, *, org_id: uuid.UUID, project_id, model: str,
                           feature: str | None = None) -> int:
    """Price one Replicate prediction. Falls back to the default
    (provider='replicate', unit='run', model='') rate when the specific
    model has no row."""
    per_run = await rate(db, "replicate", "run", model)
    if not per_run:
        per_run = await rate(db, "replicate", "run", "")
    cost = round(per_run)
    db.add(UsageEvent(
        org_id=org_id, project_id=project_id, kind="edit", provider="replicate",
        model=model, feature=feature, cost_micros=cost,
    ))
    await _bump_org_usage(db, org_id, cost_micros=cost,
                          ai_credits_used=ai_credits_from_micros(cost))
    await db.commit()
    return cost
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_metering_replicate.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire into `_replicate_run`**

In `apps/api/app/services/editing_service.py`, inside `_replicate_run`, after the prediction completes successfully and before returning, add the same best-effort ambient block as Task 3 Step 5, calling:

```python
                await _meter.record_replicate(
                    _db, org_id=_org, project_id=None, model=model, feature="image_edit",
                )
```

- [ ] **Step 6: Run the full suite**

Run: `cd apps/api && python -m pytest -q`
Expected: no NEW failures.

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/services/metering/meter.py apps/api/app/services/editing_service.py apps/api/tests/test_metering_replicate.py
git commit -m "feat(metering): meter Replicate predictions into the usage ledger"
```

---

### Task 5: SEO credits + full DataForSEO coverage

**Files:**
- Modify: `apps/api/app/services/metering/meter.py` (`record_seo` bumps `seo_credits_used`)
- Modify: DataForSEO call sites that bypass metering (audit the list below)
- Test: `apps/api/tests/test_metering_seo_credits.py`

**Interfaces:**
- Consumes: `seo_credits_for` (Task 1), `OrgUsage.seo_credits_used` (Task 2).
- Produces: unchanged `record_seo` signature; it now additionally increments `seo_credits_used`.

**Context:** `record_seo(db, *, org_id, project_id, unit, count, provider="dataforseo", feature=None)` already exists and writes a `kind="seo"` event plus `_SEO_COLUMN` counters. It must ALSO bump `seo_credits_used` by `seo_credits_for(unit, count)`.

Call sites that use DataForSEO (audit each; any that performs a billable DFS task and does not reach `record_seo` must be wired through it):
`app/services/serp_service.py`, `app/services/providers/registry.py`, `app/services/rank_tracking_service.py`, `app/services/checks_service.py`, `app/services/analytics_service.py`, `app/services/agents/skills/oasis.py`, `app/services/discovery_service.py`, `app/services/discovery/competitors.py`, `app/services/discovery/synthesis.py`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_metering_seo_credits.py
import uuid
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.billing import OrgUsage
from app.models.cost_rate import CostRate
from app.services.metering import meter

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as db:
        db.add_all([
            CostRate(provider="dataforseo", unit="serp", model="", micro_dollars_per_unit=600),
            CostRate(provider="dataforseo", unit="audit", model="", micro_dollars_per_unit=3_000),
        ])
        await db.commit()
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_record_seo_bumps_seo_credits_one_per_task():
    org = uuid.uuid4()
    async with Session() as db:
        await meter.record_seo(db, org_id=org, project_id=None, unit="serp", count=3)
        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.seo_credits_used == 3
        assert ou.cost_micros == 1_800


async def test_heavy_units_are_weighted():
    org = uuid.uuid4()
    async with Session() as db:
        await meter.record_seo(db, org_id=org, project_id=None, unit="audit", count=2)
        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.seo_credits_used == 10  # 2 * weight 5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_metering_seo_credits.py -v`
Expected: FAIL -- `seo_credits_used` stays 0.

- [ ] **Step 3: Bump SEO credits in `record_seo`**

In `record_seo`, where `increments = {"cost_micros": cost}` is built, add:

```python
    increments["seo_credits_used"] = seo_credits_for(unit, count)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_metering_seo_credits.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Audit DataForSEO call-site coverage**

For each file in the list above, confirm every billable DFS request reaches `record_seo` with the correct `unit`. Where a call site issues a DFS task without metering, add the best-effort ambient metering block (same shape as Task 3 Step 5) calling `record_seo` with the matching unit (`serp`, `keyword_ideas`, `keyword_analysis`, `rank_check`, `backlinks`, `audit`). Prefer wiring at the shared client/registry chokepoint over each caller when one exists. Write the audit result (file -> metered yes/no -> action taken) into the task report.

- [ ] **Step 6: Run the full suite**

Run: `cd apps/api && python -m pytest -q`
Expected: no NEW failures.

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/services apps/api/tests/test_metering_seo_credits.py
git commit -m "feat(metering): SEO credits and full DataForSEO coverage"
```

---

### Task 6: Plan restructure + credit enforcement

**Files:**
- Modify: `apps/api/app/core/billing.py` (`PLAN_LIMITS`, new `require_credits`, credit-aware `get_billing_usage`)
- Test: `apps/api/tests/test_credit_enforcement.py`

**Interfaces:**
- Consumes: `milli_to_credits` (Task 1), `OrgUsage` credit columns (Task 2).
- Produces: `PLAN_LIMITS[tier]["ai_credits"]` / `["seo_credits"]`, `require_credits(bucket: str)` FastAPI dependency, `get_billing_usage` returning `ai_credits` / `seo_credits` entries in whole credits.

**Approved plan table (use these exact numbers):**

| resource | free | starter | pro | agency | scale |
|---|---|---|---|---|---|
| projects | 1 | 1 | 5 | 15 | 50 |
| seats | 1 | 1 | 3 | 10 | 25 |
| ai_credits | 50 | 800 | 2700 | 8500 | 22000 |
| seo_credits | 20 | 300 | 1500 | 4000 | 12000 |
| articles | 4 | 25 | 120 | 500 | -1 |
| images | 5 | 40 | 200 | 800 | -1 |
| social | 10 | 50 | 200 | -1 | -1 |
| keywords | 50 | 500 | 2500 | 10000 | 40000 |
| brand_voices | 1 | 3 | 10 | -1 | -1 |
| audits | 1 | 5 | 20 | -1 | -1 |
| backlinks | 1 | 5 | 20 | -1 | -1 |

`PLAN_PRICE_USD` is UNCHANGED (free 0, starter 29, pro 99, agency 299, scale 799).

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_credit_enforcement.py
import pytest
from fastapi import HTTPException

from app.core.billing import PLAN_LIMITS


def test_starter_is_one_project_one_seat():
    assert PLAN_LIMITS["starter"]["projects"] == 1
    assert PLAN_LIMITS["starter"]["seats"] == 1


def test_every_tier_has_finite_credit_buckets():
    for tier, limits in PLAN_LIMITS.items():
        assert "ai_credits" in limits, tier
        assert "seo_credits" in limits, tier
        # credits are the governing meter -- never unlimited
        assert limits["ai_credits"] > 0, tier
        assert limits["seo_credits"] > 0, tier


def test_credit_grants_match_approved_table():
    assert [PLAN_LIMITS[t]["ai_credits"] for t in ("free", "starter", "pro", "agency", "scale")] \
        == [50, 800, 2700, 8500, 22000]
    assert [PLAN_LIMITS[t]["seo_credits"] for t in ("free", "starter", "pro", "agency", "scale")] \
        == [20, 300, 1500, 4000, 12000]


def test_cogs_stays_under_a_third_of_price():
    """Guards the ~68-70% margin the pricing was designed around. Worst tier is
    agency: 8500*0.01 + 4000*0.002 = $93.00 against $299 (68.9% margin)."""
    from app.core.billing import PLAN_PRICE_USD
    for tier in ("starter", "pro", "agency", "scale"):
        cogs = PLAN_LIMITS[tier]["ai_credits"] * 0.01 + PLAN_LIMITS[tier]["seo_credits"] * 0.002
        assert cogs <= PLAN_PRICE_USD[tier] * 0.32, (tier, cogs)
```

Add an enforcement test using the existing router-test harness (httpx `ASGITransport` + `app.dependency_overrides[get_db]`, mirroring `tests/test_admin_orgs.py`): seed a Starter org whose `OrgUsage.ai_credits_used` is at 100% of the grant (`800 * 1000` milli), assert a request to an endpoint guarded by `require_credits("ai")` returns **429** with `detail["error"] == "credit_limit_reached"`; seed one at 85% and assert the response carries an `X-Usage-Warning` header and succeeds.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_credit_enforcement.py -v`
Expected: FAIL -- `PLAN_LIMITS["starter"]["projects"] == 3`, and no `ai_credits` key.

- [ ] **Step 3: Restructure `PLAN_LIMITS` and add `require_credits`**

Update `PLAN_LIMITS` to the approved table above. Then add, next to `check_usage_limit`:

```python
CREDIT_BUCKETS = {"ai": ("ai_credits", "ai_credits_used"),
                  "seo": ("seo_credits", "seo_credits_used")}


async def current_credits(db, org, bucket: str) -> tuple[int, int]:
    """Return (used, limit) in WHOLE credits for the current period."""
    limit_key, used_key = CREDIT_BUCKETS[bucket]
    tier = org.plan_tier if isinstance(org.plan_tier, str) else org.plan_tier.value
    limit = PLAN_LIMITS.get(tier, PLAN_LIMITS["free"])[limit_key]
    result = await db.execute(
        select(OrgUsage).where(OrgUsage.org_id == org.id,
                               OrgUsage.period_start == current_billing_period_start())
    )
    row = result.scalar_one_or_none()
    raw = getattr(row, used_key, 0) if row else 0
    used = milli_to_credits(raw) if bucket == "ai" else raw
    return used, limit


def require_credits(bucket: str):
    """Hard-stop dependency: 429 at >=100% of the bucket for EVERY plan;
    sets X-Usage-Warning at >=80%."""
    async def _dep(response: Response, current_user: CurrentUser, db: DB) -> None:
        org = await _get_org(current_user, db)
        used, limit = await current_credits(db, org, bucket)
        if limit <= 0:
            return
        pct = used / limit
        if pct >= 1.0:
            raise HTTPException(status_code=429, detail={
                "error": "credit_limit_reached", "bucket": bucket,
                "used": used, "limit": limit,
            })
        if pct >= 0.8:
            response.headers["X-Usage-Warning"] = json.dumps({
                "bucket": bucket, "used": used, "limit": limit, "pct": round(pct, 2),
            })
    return _dep
```

Import `milli_to_credits` from `app.core.credits`.

- [ ] **Step 4: Make `get_billing_usage` credit-aware**

`get_billing_usage` already reads `getattr(row, f"{resource}_used", 0)`, so `ai_credits` -> `ai_credits_used` resolves automatically. Add the milli conversion so the API reports whole credits:

```python
        used_val = getattr(row, f"{resource}_used", 0) if row else 0
        if resource == "ai_credits":
            used_val = milli_to_credits(used_val)
```

- [ ] **Step 5: Attach the dependency to consuming endpoints**

Add `Depends(require_credits("ai"))` to AI-consuming routes (article generation, image generation, image editing/ai_command, chat/agent runs) and `Depends(require_credits("seo"))` to SEO routes (SERP, keyword research, audits, rank tracking, backlinks), following the existing `check_usage_limit` usage pattern. List every endpoint touched in the task report.

- [ ] **Step 6: Run the tests**

Run: `cd apps/api && python -m pytest tests/test_credit_enforcement.py -q && python -m pytest -q`
Expected: new tests PASS; no NEW failures elsewhere. NOTE: tightening `PLAN_LIMITS` may legitimately break existing tests that assert old limits (e.g. starter projects == 3) -- update those assertions to the new table and say so in the report.

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/core/billing.py apps/api/app/api apps/api/tests
git commit -m "feat(billing): credit buckets in plans + hard-stop enforcement"
```

---

### Task 7: Cost-rate seed + credit backfill

**Files:**
- Create: `apps/api/scripts/backfill_credits.py`
- Modify/Create: the cost-rate seed (follow the existing seeding approach used for LLM/SEO rates; if a seed module exists under `apps/api/app/services/metering/` or `apps/api/scripts/`, extend it)
- Test: `apps/api/tests/test_backfill_credits.py`

**Interfaces:**
- Consumes: `ai_credits_from_micros`, `seo_credits_for` (Task 1), credit columns (Task 2).
- Produces: `backfill_credits(db, period_start: date) -> int` (returns orgs updated).

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_backfill_credits.py
import uuid, datetime as dt
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.billing import OrgUsage
from app.models.usage_event import UsageEvent
from scripts.backfill_credits import backfill_credits

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_backfill_computes_both_buckets_from_events():
    org = uuid.uuid4()
    period = dt.date(2026, 7, 1)
    ts = dt.datetime(2026, 7, 10, tzinfo=dt.timezone.utc)
    async with Session() as db:
        db.add_all([
            UsageEvent(org_id=org, ts=ts, kind="llm", provider="openai",
                       model="gpt-4o-mini", cost_micros=2_000),      # 0.2 cr
            UsageEvent(org_id=org, ts=ts, kind="image", provider="openai",
                       model="gpt-image-1", cost_micros=60_000),      # 6 cr
            UsageEvent(org_id=org, ts=ts, kind="edit", provider="replicate",
                       model="x/y", cost_micros=10_000),              # 1 cr
            UsageEvent(org_id=org, ts=ts, kind="seo", provider="dataforseo",
                       seo_unit="serp", seo_count=4, cost_micros=2_400),
        ])
        await db.commit()

        updated = await backfill_credits(db, period)
        assert updated == 1

        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_credits_used == 7_200   # (2_000+60_000+10_000)/10 milli-credits
        assert ou.seo_credits_used == 4
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_backfill_credits.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.backfill_credits'`

- [ ] **Step 3: Implement the backfill**

`apps/api/scripts/backfill_credits.py` -- aggregate `usage_events` in `[period_start, next month)` per org: AI milli-credits = `ai_credits_from_micros(sum(cost_micros))` over `kind in ('llm','image','edit')`; SEO = `sum(seo_credits_for(seo_unit, seo_count))` over `kind='seo'`. Upsert into the org's `OrgUsage` row for that period (create it if missing), then `commit`. Include an `if __name__ == "__main__":` entry point that runs it for the current period using `async_session_factory`. Ensure `apps/api/scripts/` is importable (add `__init__.py` if the package lacks one).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_backfill_credits.py -v`
Expected: PASS

- [ ] **Step 5: Seed the new cost rates**

Add rows: `replicate/run/` (default, e.g. 5_000 micro-dollars) plus the specific Replicate models the code calls; `dataforseo/audit/` and `dataforseo/backlinks/` if absent; `openai/image/gpt-image-1` as a documented fallback. Follow the existing rate-seeding mechanism.

- [ ] **Step 6: Run the full suite and the backfill against dev**

```bash
cd apps/api && python -m pytest -q
docker compose exec api python -m scripts.backfill_credits
```
Expected: no NEW test failures; the backfill prints the number of orgs updated.

- [ ] **Step 7: Commit**

```bash
git add apps/api/scripts apps/api/tests/test_backfill_credits.py
git commit -m "feat(billing): cost-rate seed and current-period credit backfill"
```

---

### Task 8: Expose credits on the usage endpoint

**Files:**
- Modify: `apps/api/app/api/v1/routers/billing.py` (`GET /usage`)
- Test: `apps/api/tests/test_billing_usage_credits.py`

**Interfaces:**
- Consumes: credit-aware `get_billing_usage` (Task 6).
- Produces: `GET /api/v1/billing/usage` response `usage` object contains `ai_credits: {used, limit, pct}` and `seo_credits: {used, limit, pct}` (whole credits), alongside the existing resources.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_billing_usage_credits.py
# Mirror the fixture/auth harness of an existing router test (e.g.
# tests/test_billing_router.py): in-memory SQLite engine, autouse setup_db,
# httpx ASGITransport, app.dependency_overrides[get_db], bearer token for the
# seeded user. Seed: a Starter org + its OrgUsage row for the current period.
import datetime as dt

from app.core.billing import current_billing_period_start
from app.models.billing import OrgUsage


async def test_usage_endpoint_reports_credits_in_whole_credits(client, db, org, auth_headers):
    db.add(OrgUsage(
        org_id=org.id,
        period_start=current_billing_period_start(),
        ai_credits_used=620_000,   # 620 credits, stored as milli-credits
        seo_credits_used=90,
    ))
    await db.commit()

    resp = await client.get("/api/v1/billing/usage", headers=auth_headers)
    assert resp.status_code == 200
    usage = resp.json()["usage"]

    # AI is converted from milli-credits to whole credits for the API
    assert usage["ai_credits"] == {"used": 620, "limit": 800, "pct": 0.78}
    assert usage["seo_credits"]["used"] == 90
    assert usage["seo_credits"]["limit"] == 300


async def test_usage_endpoint_requires_auth(client):
    resp = await client.get("/api/v1/billing/usage")
    assert resp.status_code == 401
```

Adapt the fixture names (`client`, `db`, `org`, `auth_headers`) to whatever the existing billing router test in this repo uses -- do not invent a new harness.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_billing_usage_credits.py -v`
Expected: FAIL -- `ai_credits` absent, or `used` reported in milli-credits.

- [ ] **Step 3: Implement**

If Task 6 Step 4 is correct, `ai_credits`/`seo_credits` already appear (they are `PLAN_LIMITS` keys and are not in `SKIP_RESOURCES`). Verify `SKIP_RESOURCES` does NOT exclude them and that the milli conversion is applied. Adjust only what the test demands.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_billing_usage_credits.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/api/v1/routers/billing.py apps/api/tests/test_billing_usage_credits.py
git commit -m "feat(billing): expose AI/SEO credit balances on the usage endpoint"
```

---

### Task 9: Credit meter in the customer app header

**Files:**
- Create: `apps/web/components/billing/CreditMeter.tsx`
- Modify: `apps/web/components/layout/TopBar.tsx` (render it in the right-side actions cluster)
- Modify: `apps/web/public/locales/en/common.json` (+ other locales present) for new keys
- Modify: `apps/web/lib/api.ts` types if a usage type lives there

**Interfaces:**
- Consumes: `GET /api/v1/billing/usage` (Task 8) -> `usage.ai_credits` / `usage.seo_credits` = `{used, limit, pct}`.
- Produces: `<CreditMeter />`.

**Context:** `TopBar.tsx` renders a right-side actions cluster (`<div className="flex items-center gap-1">`, around line 115) containing the search button, `<LanguagePicker />`, and `<AlertsBell />`. `CreditMeter` goes in that cluster, before `<AlertsBell />`.

- [ ] **Step 1: Build the component**

```tsx
// apps/web/components/billing/CreditMeter.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { Sparkles, Search } from "lucide-react";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/cn";

type Bucket = { used: number; limit: number; pct: number };
type UsageResponse = { usage: Record<string, Bucket> };

function tone(pct: number) {
  if (pct >= 1) return "text-destructive";
  if (pct >= 0.8) return "text-warning";
  return "text-muted-foreground";
}

function Meter({ icon: Icon, label, bucket }: {
  icon: typeof Sparkles; label: string; bucket: Bucket;
}) {
  const pct = Math.min(bucket.pct ?? 0, 1);
  return (
    <span className="flex items-center gap-1.5" title={`${label}: ${bucket.used}/${bucket.limit}`}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", tone(bucket.pct))} strokeWidth={1.9} />
      <span className="hidden font-mono text-xs tabular-nums text-muted-foreground lg:block">
        {bucket.used}/{bucket.limit}
      </span>
      <span aria-hidden className="hidden h-1 w-10 overflow-hidden rounded-full bg-muted lg:block">
        <span
          className={cn("block h-full rounded-full transition-all",
            bucket.pct >= 1 ? "bg-destructive" : bucket.pct >= 0.8 ? "bg-warning" : "bg-primary")}
          style={{ width: `${pct * 100}%` }}
        />
      </span>
    </span>
  );
}

export function CreditMeter() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["billing", "usage"],
    queryFn: () => apiClient.get<UsageResponse>("/billing/usage"),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  if (isLoading) return <span className="h-5 w-24 animate-pulse rounded bg-muted" />;
  if (isError || !data) return null;

  const ai = data.usage?.ai_credits;
  const seo = data.usage?.seo_credits;
  if (!ai || !seo) return null;

  return (
    <Link
      href="/settings/billing"
      aria-label={t("credits.ariaLabel")}
      className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Meter icon={Sparkles} label={t("credits.ai")} bucket={ai} />
      <Meter icon={Search} label={t("credits.seo")} bucket={seo} />
    </Link>
  );
}
```

Confirm the billing route path (`/settings/billing` above) matches the app's actual billing page; correct it if it differs.

- [ ] **Step 2: Add translation keys**

In `apps/web/public/locales/en/common.json` (and every other locale directory present, translated):

```json
"credits": {
  "ai": "AI credits",
  "seo": "SEO credits",
  "ariaLabel": "Credit balance -- view billing"
}
```

- [ ] **Step 3: Render it in TopBar**

Import `CreditMeter` and place `<CreditMeter />` inside the right-side actions cluster, immediately before `<AlertsBell />`. Keep the existing divider rhythm; the component hides its numeric/bar detail below `lg` so the narrow header stays clean.

- [ ] **Step 4: Verify**

```bash
cd apps/web && npm run typecheck && npm run build
```
Expected: both pass. No test framework in apps/web -- verification is typecheck + build.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/billing/CreditMeter.tsx apps/web/components/layout/TopBar.tsx apps/web/public/locales
git commit -m "feat(web): AI/SEO credit balance in the app header"
```

---

### Task 10: Credit columns in the admin console

**Files:**
- Modify: the admin org-usage/org-detail endpoint under `apps/api/app/api/v1/routers/` (admin orgs router)
- Modify: the corresponding admin page under `apps/admin/app/(console)/`
- Modify: `apps/admin/lib/admin-types.ts`

**Interfaces:**
- Consumes: `OrgUsage.ai_credits_used` / `seo_credits_used` (Task 2), `PLAN_LIMITS` credit keys (Task 6), `milli_to_credits` (Task 1).
- Produces: `ai_credits_used` / `ai_credits_limit` / `seo_credits_used` / `seo_credits_limit` on the admin org payload, surfaced in the admin UI.

- [ ] **Step 1: Extend the admin org payload**

Add the four fields (AI in WHOLE credits via `milli_to_credits`) to the admin org-detail/list response. Write a router test asserting the fields appear with correct values for a seeded org, and 401 without a token.

- [ ] **Step 2: Run the test**

Run: `cd apps/api && python -m pytest tests/<the new test file> -v`
Expected: RED then GREEN.

- [ ] **Step 3: Surface in the admin UI**

Add the credit usage to the admin org view: two compact used/limit meters matching the existing admin design system (CSS-variable tokens only, Lucide icons, `font-mono tabular-nums`, no emoji), consistent with the existing usage displays.

- [ ] **Step 4: Verify**

```bash
cd apps/admin && npm run typecheck && npm run build
cd ../api && python -m pytest -q
```
Expected: typecheck + build pass; no NEW test failures.

- [ ] **Step 5: Commit**

```bash
git add apps/api apps/admin
git commit -m "feat(admin): AI/SEO credit usage on org views"
```

---

## Execution Notes

**Ordering:** Tasks 1-8 are backend and mostly sequential (each builds on the prior). Task 9 (apps/web) and Task 10's UI half depend only on the documented response contracts and can run in an isolated worktree in parallel once Task 6's contract is fixed.

**Migrations must run in the main worktree** (`make db-migrate` / `docker compose exec api alembic` operate on the container that mounts the main tree).

**After all tasks:** run the backfill (`docker compose exec api python -m scripts.backfill_credits`) so existing orgs show correct current-period balances, and restart the API.
