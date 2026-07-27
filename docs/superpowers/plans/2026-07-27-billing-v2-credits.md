# Billing v2 — Credits, Full-Cost Metering & Plan Reduction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meter image generation, Replicate, and all DataForSEO usage into the ledger so AI credits reflect true cost; add a second SEO credit bucket; reduce plan limits (Starter to 1 project / 1 seat); hard-stop at 100%; show both balances in the customer app header.

**Architecture:** Fennex ALREADY has an AI credit system and it is canonical: `1 credit = $0.00105` (`CREDIT_MICROS`), allowances in `PLAN_CREDITS`, served by `GET /usage/summary`, rendered on the settings page. AI credits are **derived, not stored** — computed from accumulated cost via `credits_from_micros()`. This plan keeps that unit and that endpoint, and makes three previously-invisible cost sources flow into it (image generation, Replicate, full DataForSEO coverage). SEO gets a parallel **counted** bucket (1 DataForSEO task = 1 credit, weighted). New meter functions attach at each service's single chokepoint and resolve the org from the existing ambient contextvar (`app/core/metering_context.py`) — the pattern that made LLM metering universal.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, pytest (host in-memory SQLite), Next.js 14 + TanStack Query + Tailwind (apps/web, apps/admin).

**Spec:** `docs/superpowers/specs/2026-07-27-billing-v2-credits-design.md`

## Global Constraints

- **Never use emoji** in code, UI text, comments, or commit messages.
- Money is **micro-dollars** (integer, `$1 = 1_000_000`).
- **The credit unit is `CREDIT_MICROS = 1_050` ($0.00105/credit) and MUST NOT change** — users already see these numbers. AI credits are derived from cost with `credits_from_micros()`; they are never stored as a counter. SEO credits ARE stored as a counter (whole credits).
- **AI bucket** = `usage_events.kind in AI_KINDS` (`llm`, `image`, `edit`). **SEO bucket** = `kind == "seo"`.
- Credits are served from **`GET /usage/summary`** (the existing endpoint the settings page consumes). Do NOT introduce credit fields on `/billing/usage`.
- **No grandfathering:** the new plan limits apply to ALL orgs immediately, including existing subscribers.
- Commit style `feat(scope): …` / `fix(scope):`; every commit ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Metering is **best-effort**: wrap in `try/except`, never break the user-facing action if metering fails.
- Tests: host in-memory SQLite (`sqlite+aiosqlite:///:memory:`), `asyncio_mode="auto"` (NO `@pytest.mark.asyncio`), each test file owns its engine + autouse `setup_db`. Router tests use httpx `ASGITransport` + `app.dependency_overrides[get_db]`.
- Known pre-existing failures (NOT regressions): `test_edit_model.py`, 9x `test_strands_runtime.py`.
- Alembic: head is `r5scaletier1`. New revisions use a **random** revision id chained on the current head.
- Frontend: CSS-variable tokens only (no hex/rgb), Lucide icons, strings via `t()` in apps/web, `apiClient` (never raw `fetch`), TanStack Query.

---

### Task 1: Credit constants and conversions — COMPLETE

Delivered in commits `c7f6d2e` + `8e0a185`. `app/core/credits.py` exposes the canonical AI unit (`CREDIT_MICROS`, `PLAN_CREDITS`, `credits_from_micros`, `credit_allowance`), `AI_KINDS = ("llm","image","edit")`, and the SEO bucket (`SEO_CREDIT_WEIGHT`, `SEO_PLAN_CREDITS`, `seo_credits_for`, `seo_credit_allowance`). 7 tests pass in `apps/api/tests/test_credits.py`, including a COGS-vs-price margin guard.

---

### Task 2: Split AI cost from SEO cost on OrgUsage

**Files:**
- Modify: `apps/api/app/models/billing.py` (2 new `OrgUsage` columns)
- Modify: `apps/api/app/services/metering/meter.py` (`record_llm` bumps `ai_cost_micros`)
- Create: `apps/api/alembic/versions/<random_id>_org_usage_credit_split.py`
- Test: `apps/api/tests/test_org_usage_credit_split.py`

**Interfaces:**
- Consumes: `credits_from_micros`, `seo_credits_for` (Task 1).
- Produces: `OrgUsage.ai_cost_micros` (BigInteger, default 0) — accumulated cost of AI-kind events only; `OrgUsage.seo_credits_used` (Integer, default 0) — counted SEO credits. `_bump_org_usage(db, org_id, **increments)` already takes raw column names, so no signature change.

**Why:** AI credits derive from cost, but `OrgUsage.cost_micros` is the TOTAL and now includes SEO. Deriving AI credits from the total would let SEO spend eat the AI bucket. `ai_cost_micros` is the AI-only subtotal; `cost_micros` stays the true total for margin reporting.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_org_usage_credit_split.py
import datetime as dt
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.credits import credits_from_micros
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


async def test_credit_split_columns_default_to_zero():
    org = uuid.uuid4()
    async with Session() as db:
        db.add(OrgUsage(org_id=org, period_start=dt.date(2026, 7, 1)))
        await db.commit()
        row = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert row.ai_cost_micros == 0
        assert row.seo_credits_used == 0


async def test_ai_credits_derive_from_ai_cost_not_total_cost():
    """SEO spend must not consume the AI bucket."""
    org = uuid.uuid4()
    async with Session() as db:
        db.add(OrgUsage(
            org_id=org, period_start=dt.date(2026, 7, 1),
            cost_micros=105_000,      # total: AI + SEO
            ai_cost_micros=52_500,    # AI only
            seo_credits_used=40,
        ))
        await db.commit()
        row = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert credits_from_micros(row.ai_cost_micros) == 50   # 52_500 / 1_050
        assert credits_from_micros(row.cost_micros) == 100     # the wrong bucket: double
        assert row.seo_credits_used == 40
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_org_usage_credit_split.py -v`
Expected: FAIL — `ai_cost_micros` is not a valid `OrgUsage` field.

- [ ] **Step 3: Add the columns**

In `apps/api/app/models/billing.py`, inside `class OrgUsage`, after `seo_keyword_analyses`:

```python
    # AI-only cost subtotal. AI credits derive from THIS, not cost_micros
    # (which is the true total and also carries SEO spend).
    ai_cost_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    # SEO credits are counted per DataForSEO task, not derived from cost.
    seo_credits_used: Mapped[int] = mapped_column(Integer, default=0)
```

- [ ] **Step 4: Make `record_llm` populate the AI subtotal**

In `apps/api/app/services/metering/meter.py`, in `record_llm`'s `_bump_org_usage(...)` call, add `ai_cost_micros=cost` alongside the existing `cost_micros=cost`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_org_usage_credit_split.py tests/test_metering_wired.py -v`
Expected: PASS (new tests plus the existing metering tests still green).

- [ ] **Step 6: Generate and fix the migration**

```bash
docker compose exec api alembic revision --autogenerate -m "org_usage credit split"
```

Edit the generated file: use a **random** revision id (e.g. `k4splitcred7`), `down_revision = "r5scaletier1"`, body:

```python
revision = "k4splitcred7"
down_revision = "r5scaletier1"

def upgrade() -> None:
    op.add_column("org_usage", sa.Column("ai_cost_micros", sa.BigInteger(),
                                         nullable=False, server_default="0"))
    op.add_column("org_usage", sa.Column("seo_credits_used", sa.Integer(),
                                         nullable=False, server_default="0"))

def downgrade() -> None:
    op.drop_column("org_usage", "seo_credits_used")
    op.drop_column("org_usage", "ai_cost_micros")
```

- [ ] **Step 7: Apply and verify a single head**

```bash
docker compose exec api alembic upgrade head
docker compose exec api alembic heads   # must print exactly ONE head
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/models/billing.py apps/api/app/services/metering/meter.py apps/api/alembic/versions/ apps/api/tests/test_org_usage_credit_split.py
git commit -m "feat(billing): split AI cost from SEO cost on org_usage"
```

---

### Task 3: Meter image generation

**Files:**
- Modify: `apps/api/app/services/metering/meter.py` (add `record_image`)
- Modify: `apps/api/app/services/image_service.py` (call it at the chokepoint)
- Test: `apps/api/tests/test_metering_image.py`

**Interfaces:**
- Consumes: `OrgUsage.ai_cost_micros` (Task 2), `_bump_org_usage` + `UsageEvent` (existing), `app.core.metering_context.get_metering_org` (existing).
- Produces: `meter.record_image(db, *, org_id, project_id, model, cost_usd, feature=None) -> int` (returns cost_micros).

**Context:** `image_service.generate_image_dalle` already computes `cost_usd` from size/quality and returns it in its result dict — that value is authoritative; do NOT re-derive it from a rate table. `usage_events.kind` gains `"image"`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_metering_image.py
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.credits import credits_from_micros
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


async def test_record_image_writes_event_and_consumes_ai_credits():
    org = uuid.uuid4()
    async with Session() as db:
        cost = await meter.record_image(
            db, org_id=org, project_id=None, model="gpt-image-1",
            cost_usd=0.06, feature="article_cover",
        )
        assert cost == 60_000

        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.kind == "image"
        assert ev.provider == "openai"
        assert ev.model == "gpt-image-1"
        assert ev.feature == "article_cover"
        assert ev.cost_micros == 60_000

        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.cost_micros == 60_000       # counts toward the true total
        assert ou.ai_cost_micros == 60_000    # and toward the AI bucket
        assert credits_from_micros(ou.ai_cost_micros) == 58
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_metering_image.py -v`
Expected: FAIL — `meter` has no attribute `record_image`.

- [ ] **Step 3: Implement `record_image`**

```python
async def record_image(db, *, org_id: uuid.UUID, project_id, model: str,
                       cost_usd: float, feature: str | None = None) -> int:
    """Price an image generation from the cost the image service already
    computed -- it knows the size/quality that was actually billed."""
    cost = round(cost_usd * 1_000_000)
    db.add(UsageEvent(
        org_id=org_id, project_id=project_id, kind="image", provider="openai",
        model=model, feature=feature, cost_micros=cost,
    ))
    await _bump_org_usage(db, org_id, cost_micros=cost, ai_cost_micros=cost)
    await db.commit()
    return cost
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_metering_image.py -v`
Expected: PASS

- [ ] **Step 5: Wire into the image service chokepoint**

In `apps/api/app/services/image_service.py`, at the end of `generate_image_dalle`, immediately before it returns the success dict:

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

If the module lacks a logger, add `import logging` and `logger = logging.getLogger(__name__)` at the top. Confirm the local names (`cost_usd`, `usage`) are actually in scope there; adapt if they differ.

- [ ] **Step 6: Run the full suite**

Run: `cd apps/api && python -m pytest -q`
Expected: no NEW failures (10 known pre-existing remain).

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
- Consumes: `rate(db, provider, unit, model)` (existing in meter.py), `OrgUsage.ai_cost_micros` (Task 2).
- Produces: `meter.record_replicate(db, *, org_id, project_id, model, feature=None) -> int`.

**Context:** `editing_service._replicate_run(model, input_params, version=None)` is the SINGLE chokepoint for every Replicate call. Cost comes from a `cost_rate` row `(provider="replicate", unit="run", model=<slug>)`, falling back to the default row with `model=""`. `usage_events.kind` gains `"edit"`.

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
        assert cost == 10_000

        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.kind == "edit"
        assert ev.provider == "replicate"
        assert ev.model == "852-labs/background-remover"
        assert ev.cost_micros == 10_000

        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_cost_micros == 10_000


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
Expected: FAIL — `meter` has no attribute `record_replicate`.

- [ ] **Step 3: Implement `record_replicate`**

```python
async def record_replicate(db, *, org_id: uuid.UUID, project_id, model: str,
                           feature: str | None = None) -> int:
    """Price one Replicate prediction, falling back to the default
    (provider='replicate', unit='run', model='') rate."""
    per_run = await rate(db, "replicate", "run", model)
    if not per_run:
        per_run = await rate(db, "replicate", "run", "")
    cost = round(per_run)
    db.add(UsageEvent(
        org_id=org_id, project_id=project_id, kind="edit", provider="replicate",
        model=model, feature=feature, cost_micros=cost,
    ))
    await _bump_org_usage(db, org_id, cost_micros=cost, ai_cost_micros=cost)
    await db.commit()
    return cost
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_metering_replicate.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire into `_replicate_run`**

In `apps/api/app/services/editing_service.py`, inside `_replicate_run`, after the prediction succeeds and before returning, add the same best-effort ambient block as Task 3 Step 5, calling:

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
- Modify: DataForSEO call sites that bypass metering
- Test: `apps/api/tests/test_metering_seo_credits.py`

**Interfaces:**
- Consumes: `seo_credits_for` (Task 1), `OrgUsage.seo_credits_used` (Task 2).
- Produces: unchanged `record_seo` signature; it now also increments `seo_credits_used`. `record_seo` must NOT touch `ai_cost_micros`.

**Call sites to audit** (any billable DataForSEO task that does not reach `record_seo` must be wired through it): `app/services/serp_service.py`, `app/services/providers/registry.py`, `app/services/rank_tracking_service.py`, `app/services/checks_service.py`, `app/services/analytics_service.py`, `app/services/agents/skills/oasis.py`, `app/services/discovery_service.py`, `app/services/discovery/competitors.py`, `app/services/discovery/synthesis.py`.

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


async def test_record_seo_counts_one_credit_per_task():
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


async def test_seo_spend_does_not_consume_the_ai_bucket():
    org = uuid.uuid4()
    async with Session() as db:
        await meter.record_seo(db, org_id=org, project_id=None, unit="serp", count=5)
        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_cost_micros == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_metering_seo_credits.py -v`
Expected: FAIL — `seo_credits_used` stays 0.

- [ ] **Step 3: Bump SEO credits in `record_seo`**

Where `record_seo` builds `increments = {"cost_micros": cost}`, add:

```python
    increments["seo_credits_used"] = seo_credits_for(unit, count)
```

Import `seo_credits_for` from `app.core.credits`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_metering_seo_credits.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Audit DataForSEO call-site coverage**

For each file listed above, confirm every billable DataForSEO request reaches `record_seo` with the correct `unit` (`serp`, `keyword_ideas`, `keyword_analysis`, `rank_check`, `backlinks`, `audit`). Where one does not, add the best-effort ambient metering block (same shape as Task 3 Step 5) calling `record_seo`. Prefer wiring at the shared client/registry chokepoint over per-caller. Record the audit result (file -> metered before? -> action taken) in the task report.

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
- Modify: `apps/api/app/core/billing.py` (`PLAN_LIMITS`, new `require_credits`)
- Modify: the AI/SEO-consuming routers (attach the dependency)
- Test: `apps/api/tests/test_credit_enforcement.py`

**Interfaces:**
- Consumes: `credits_from_micros`, `credit_allowance`, `seo_credit_allowance` (Task 1); `ai_cost_micros` / `seo_credits_used` (Task 2).
- Produces: `require_credits(bucket: str)` FastAPI dependency; `current_credits(db, org, bucket) -> tuple[int, int]`.

**Approved plan table — use these EXACT numbers.** Credit allowances stay at their `PLAN_CREDITS` / `SEO_PLAN_CREDITS` values in `credits.py` (Task 1); `PLAN_LIMITS` governs the structural and fair-use caps:

| resource | free | starter | pro | agency | scale |
|---|---|---|---|---|---|
| projects | 1 | **1** | 5 | 15 | 50 |
| seats | 1 | **1** | 3 | 10 | 25 |
| articles | 4 | 25 | 120 | 500 | -1 |
| images | 5 | 40 | 200 | 800 | -1 |
| social | 10 | 50 | 200 | -1 | -1 |
| keywords | 50 | 500 | 2500 | 10000 | 40000 |
| brand_voices | 1 | 3 | 10 | -1 | -1 |
| audits | 1 | 5 | 20 | -1 | -1 |
| backlinks | 1 | 5 | 20 | -1 | -1 |

`PLAN_PRICE_USD` is UNCHANGED. Credit allowances are NOT added to `PLAN_LIMITS` — they are read via `credit_allowance()` / `seo_credit_allowance()`.

**No grandfathering:** these limits apply to every org immediately.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_credit_enforcement.py
from app.core.billing import PLAN_LIMITS


def test_starter_is_one_project_one_seat():
    assert PLAN_LIMITS["starter"]["projects"] == 1
    assert PLAN_LIMITS["starter"]["seats"] == 1


def test_structural_caps_match_approved_table():
    assert PLAN_LIMITS["free"]["projects"] == 1
    assert PLAN_LIMITS["pro"]["projects"] == 5
    assert PLAN_LIMITS["pro"]["seats"] == 3
    assert PLAN_LIMITS["agency"]["projects"] == 15
    assert PLAN_LIMITS["scale"]["projects"] == 50


def test_fair_use_caps_match_approved_table():
    assert [PLAN_LIMITS[t]["articles"] for t in ("free", "starter", "pro", "agency", "scale")] \
        == [4, 25, 120, 500, -1]
    assert [PLAN_LIMITS[t]["images"] for t in ("free", "starter", "pro", "agency", "scale")] \
        == [5, 40, 200, 800, -1]
```

Add an enforcement test with the router harness (httpx `ASGITransport` + `app.dependency_overrides[get_db]`, mirroring an existing router test): seed a Starter org whose `OrgUsage.ai_cost_micros` equals `PLAN_CREDITS["starter"] * CREDIT_MICROS` (bucket exactly full) and assert an endpoint guarded by `require_credits("ai")` returns **429** with `detail["error"] == "credit_limit_reached"`; seed one at ~85% and assert it succeeds AND sets the `X-Usage-Warning` header. Repeat once for the `seo` bucket using `seo_credits_used`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_credit_enforcement.py -v`
Expected: FAIL — starter projects is 3, and `require_credits` does not exist.

- [ ] **Step 3: Update `PLAN_LIMITS` and add `require_credits`**

Apply the table above, then add next to `check_usage_limit`:

```python
async def current_credits(db, org, bucket: str) -> tuple[int, int]:
    """Return (used, allowance) in whole credits for the current period."""
    tier = org.plan_tier if isinstance(org.plan_tier, str) else org.plan_tier.value
    result = await db.execute(
        select(OrgUsage).where(OrgUsage.org_id == org.id,
                               OrgUsage.period_start == current_billing_period_start())
    )
    row = result.scalar_one_or_none()
    if bucket == "ai":
        used = credits_from_micros(getattr(row, "ai_cost_micros", 0) if row else 0)
        return used, credit_allowance(tier)
    used = (getattr(row, "seo_credits_used", 0) if row else 0)
    return used, seo_credit_allowance(tier)


def require_credits(bucket: str):
    """Hard-stop dependency: 429 at >=100% of the bucket for EVERY plan;
    sets X-Usage-Warning at >=80%."""
    async def _dep(response: Response, current_user: CurrentUser, db: DB) -> None:
        org = await _get_org(current_user, db)
        used, allowance = await current_credits(db, org, bucket)
        if allowance <= 0:
            return
        pct = used / allowance
        if pct >= 1.0:
            raise HTTPException(status_code=429, detail={
                "error": "credit_limit_reached", "bucket": bucket,
                "used": used, "limit": allowance,
            })
        if pct >= 0.8:
            response.headers["X-Usage-Warning"] = json.dumps({
                "bucket": bucket, "used": used, "limit": allowance, "pct": round(pct, 2),
            })
    return _dep
```

Import `credits_from_micros`, `credit_allowance`, `seo_credit_allowance` from `app.core.credits`.

- [ ] **Step 4: Attach the dependency to consuming endpoints**

Add `Depends(require_credits("ai"))` to AI-consuming routes (article generation, image generation, image editing / `ai_command`, chat and agent runs) and `Depends(require_credits("seo"))` to SEO routes (SERP, keyword research, audits, rank tracking, backlinks), following the existing `check_usage_limit` usage pattern. List every endpoint touched in the task report.

- [ ] **Step 5: Run the tests**

Run: `cd apps/api && python -m pytest tests/test_credit_enforcement.py -q && python -m pytest -q`
Expected: new tests PASS. NOTE: tightening `PLAN_LIMITS` will legitimately break existing tests asserting old limits (e.g. starter projects == 3) — update those assertions to the new table and list every one you changed in the report.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/core/billing.py apps/api/app/api apps/api/tests
git commit -m "feat(billing): reduce plan limits and hard-stop on credit exhaustion"
```

---

### Task 7: Cost-rate seed + AI-cost backfill

**Files:**
- Create: `apps/api/scripts/backfill_credit_split.py`
- Modify/Create: the cost-rate seed (extend the existing rate-seeding mechanism)
- Test: `apps/api/tests/test_backfill_credit_split.py`

**Interfaces:**
- Consumes: `AI_KINDS`, `seo_credits_for` (Task 1); the Task 2 columns.
- Produces: `backfill_credit_split(db, period_start: date) -> int` (orgs updated).

**Why:** existing orgs have `usage_events` but zero in the two new columns, so balances would read empty until the next event.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_backfill_credit_split.py
import datetime as dt
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.billing import OrgUsage
from app.models.usage_event import UsageEvent
from scripts.backfill_credit_split import backfill_credit_split

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_backfill_splits_ai_cost_and_counts_seo_credits():
    org = uuid.uuid4()
    period = dt.date(2026, 7, 1)
    ts = dt.datetime(2026, 7, 10, tzinfo=dt.timezone.utc)
    async with Session() as db:
        db.add_all([
            UsageEvent(org_id=org, ts=ts, kind="llm", provider="openai",
                       model="gpt-4o-mini", cost_micros=2_000),
            UsageEvent(org_id=org, ts=ts, kind="image", provider="openai",
                       model="gpt-image-1", cost_micros=60_000),
            UsageEvent(org_id=org, ts=ts, kind="edit", provider="replicate",
                       model="x/y", cost_micros=10_000),
            UsageEvent(org_id=org, ts=ts, kind="seo", provider="dataforseo",
                       seo_unit="serp", seo_count=4, cost_micros=2_400),
            UsageEvent(org_id=org, ts=ts, kind="seo", provider="dataforseo",
                       seo_unit="audit", seo_count=1, cost_micros=3_000),
        ])
        await db.commit()

        assert await backfill_credit_split(db, period) == 1

        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_cost_micros == 72_000   # llm + image + edit only
        assert ou.seo_credits_used == 9      # 4 serp + 1 audit (weight 5)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_backfill_credit_split.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.backfill_credit_split'`

- [ ] **Step 3: Implement the backfill**

`apps/api/scripts/backfill_credit_split.py`: for events in `[period_start, next month)`, per org compute `ai_cost_micros = sum(cost_micros where kind in AI_KINDS)` and `seo_credits_used = sum(seo_credits_for(seo_unit, seo_count) where kind == 'seo')`; upsert into that org's `OrgUsage` row for the period (create it when missing); commit. Add an `if __name__ == "__main__":` entry point running it for the current period via `async_session_factory`. Ensure `apps/api/scripts/` is an importable package (add `__init__.py` if absent).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_backfill_credit_split.py -v`
Expected: PASS

- [ ] **Step 5: Seed the new cost rates**

Add `cost_rate` rows: `replicate/run/` (default) plus each Replicate model the code calls; `dataforseo/audit/` and `dataforseo/backlinks/` if absent. Follow the existing rate-seeding mechanism. Use the spec's placeholder values and flag in the report that real supplier prices must be confirmed.

- [ ] **Step 6: Run the full suite and the backfill against dev**

```bash
cd apps/api && python -m pytest -q
docker compose exec api python -m scripts.backfill_credit_split
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/scripts apps/api/tests/test_backfill_credit_split.py
git commit -m "feat(billing): cost-rate seed and AI/SEO credit backfill"
```

---

### Task 8: Serve both buckets from /usage/summary

**Files:**
- Modify: `apps/api/app/api/v1/routers/usage.py`
- Test: `apps/api/tests/test_usage_summary_credits.py`

**Interfaces:**
- Consumes: `current_credits` (Task 6), or `credits_from_micros`/`credit_allowance`/`seo_credit_allowance` directly.
- Produces: `GET /usage/summary` gains `seo_credits_used`, `seo_credits_allowance`, `seo_credits_remaining`. Existing `credits_used` / `credits_allowance` / `credits_remaining` keep their names but now derive from `ai_cost_micros` (AI-only) instead of the total `cost_micros`.

**This is the contract the header meter (Task 9) consumes. Do NOT rename the existing AI fields.**

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_usage_summary_credits.py
# Mirror the fixture/auth harness of an existing router test: in-memory SQLite,
# autouse setup_db, httpx ASGITransport, app.dependency_overrides[get_db],
# bearer token for the seeded user. Adapt fixture names to that harness --
# do not invent a new one.
from app.core.billing import current_billing_period_start
from app.models.billing import OrgUsage


async def test_usage_summary_reports_both_buckets(client, db, org, auth_headers):
    # org is on starter: 5_000 AI credits, 300 SEO credits
    db.add(OrgUsage(
        org_id=org.id,
        period_start=current_billing_period_start(),
        cost_micros=1_155_000,     # total, incl. SEO
        ai_cost_micros=1_050_000,  # AI only -> exactly 1_000 credits
        seo_credits_used=90,
    ))
    await db.commit()

    body = (await client.get("/api/v1/usage/summary", headers=auth_headers)).json()

    # AI credits derive from ai_cost_micros, NOT from the larger total
    assert body["credits_used"] == 1_000
    assert body["credits_allowance"] == 5_000
    assert body["credits_remaining"] == 4_000

    assert body["seo_credits_used"] == 90
    assert body["seo_credits_allowance"] == 300
    assert body["seo_credits_remaining"] == 210
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_usage_summary_credits.py -v`
Expected: FAIL — no `seo_credits_*` keys, and `credits_used` derives from the total cost.

- [ ] **Step 3: Implement**

In `usage.py`, source the AI credits from `ai_cost_micros` and add the three SEO fields (`seo_credits_remaining = max(0, allowance - used)`, matching the existing AI pattern).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_usage_summary_credits.py -q && python -m pytest -q`
Expected: new tests PASS; no NEW failures.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/api/v1/routers/usage.py apps/api/tests/test_usage_summary_credits.py
git commit -m "feat(billing): serve AI and SEO credit balances from /usage/summary"
```

---

### Task 9: Credit meter in the customer app header — IN PROGRESS

Running in the isolated worktree `.worktrees/billing-v2-fe` on branch `feat/billing-v2-credits-fe`, re-targeted to the Task 8 contract (`GET /usage/summary`, existing `credits_*` fields plus optional `seo_credits_*`). The header meter must agree with the settings page, which already renders the same numbers.

---

### Task 10: Credit columns in the admin console

**Files:**
- Modify: the admin org list/detail endpoint under `apps/api/app/api/v1/routers/`
- Modify: the corresponding admin page under `apps/admin/app/(console)/`
- Modify: `apps/admin/lib/admin-types.ts`

**Interfaces:**
- Consumes: `credits_from_micros`, `credit_allowance`, `seo_credit_allowance` (Task 1); Task 2 columns.
- Produces: `ai_credits_used` / `ai_credits_allowance` / `seo_credits_used` / `seo_credits_allowance` on the admin org payload.

- [ ] **Step 1: Extend the admin org payload**

Add the four fields (whole credits, AI derived from `ai_cost_micros`). Write a router test asserting correct values for a seeded org and 401 without a token.

- [ ] **Step 2: Run the test**

Run: `cd apps/api && python -m pytest tests/<new test file> -v`
Expected: RED then GREEN.

- [ ] **Step 3: Surface in the admin UI**

Add two compact used/allowance meters to the admin org view, matching the existing admin design system (CSS-variable tokens only, Lucide icons, `font-mono tabular-nums`, no emoji).

- [ ] **Step 4: Verify**

```bash
cd apps/admin && npm run typecheck && npm run build
cd ../api && python -m pytest -q
```

- [ ] **Step 5: Commit**

```bash
git add apps/api apps/admin
git commit -m "feat(admin): AI/SEO credit usage on org views"
```

---

## Execution Notes

**Ordering:** Tasks 2-8 are backend and sequential. Task 9 (apps/web) runs in an isolated worktree against the Task 8 contract. Task 10 can follow Task 2.

**Migrations run in the main worktree** (`docker compose exec api alembic …` operates on the container that mounts it).

**After all tasks:** run `docker compose exec api python -m scripts.backfill_credit_split` so existing orgs show correct balances, then restart the API.

**Open item for the product owner:** the seeded Replicate and DataForSEO cost rates are placeholders until real supplier prices are confirmed.
