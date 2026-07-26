# Phase 1a — Usage Metering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure what Fennex spends per org on AI tokens and DataForSEO calls, so margins are visible and Phase-1b quota/overage can enforce them. Capture real provider usage at the two seams, price it from a `cost_rates` table, and record it to a durable `usage_events` ledger plus per-period `org_usage` rollup columns.

**Architecture:** `call_llm` currently returns only text and discards the provider `usage` object. This plan surfaces usage from the provider dispatch (`_call_openai`/`_call_anthropic`/`_call_google`) as an `LLMUsage`, adds a `UsageMeter` that prices usage from `cost_rates` and writes `usage_events` + upserts `org_usage`, and wires metering into `call_llm` via an **optional** meter context (default off → all 30+ existing callers keep working unchanged) plus the key discovery/agent callers. SEO metering is recorded at the callers that own `(org_id, db)`.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic, pytest (in-memory SQLite), pg `insert().on_conflict_do_update` for atomic counter upserts (mirrors `app/core/billing.py::increment_usage`).

## Global Constraints

- Backend Python 3.11+, async; models in `apps/api/app/models/`, services in `apps/api/app/services/`; register routers in `apps/api/app/api/v1/router.py`.
- Migrations: raw `op.execute(... IF NOT EXISTS ...)` style; `down_revision` chains from the current head **`e0t1u2v3w4x5`**. Keep the new revision ids exactly as given.
- Tests: HOST, in-memory SQLite (aiosqlite), `asyncio_mode="auto"` (no `@pytest.mark.asyncio`); each file stands up its own engine + `setup_db` autouse fixture (mirror `apps/api/tests/test_provider_registry.py`). New models MUST be import-registered in `apps/api/app/models/__init__.py`. **No JSONB / Vector columns** in new tables (SQLite compat). SQLAlchemy `default=` applies at flush.
- **Money as integers.** `usage_events.cost_micros` and `org_usage.cost_micros` are BIGINT **micro-dollars** ($1 = 1_000_000 micros). `cost_rates.micro_dollars_per_unit` is a float rate (micro-dollars per 1 token / per 1 call); event cost = `round(count * rate)`.
- **Backward compatibility is mandatory.** `call_llm(...) -> str` keeps its signature and return type; metering is opt-in via a new trailing keyword arg. The full suite must have NO new failures beyond the 10 known pre-existing (Postgres-auth `test_edit_model.py` + 9× `test_strands_runtime.py`).
- Cost-rate numbers are **representative and MUST be verified** against live OpenAI/DataForSEO pricing before trusting the margins; they live in data (`cost_rates`) so they change without code edits.
- Commit style: `feat(billing): …`. End every commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. No emoji.
- Branch: work on `feat/usage-metering` (do not commit to `main`).
- Spec: `docs/superpowers/specs/2026-07-25-reseller-billing-architecture.md` (§1.4 metering, §2.6 cost_rates, §2.7 usage_events, §2.8 org_usage). Out of scope (Phase 1b): quota enforcement, `model_catalog`/band routing, Stripe/overage.

## Provider usage field names (reference for Task 3)

- OpenAI (`chat.completions.create` response): `response.usage.prompt_tokens`, `response.usage.completion_tokens`; cached input at `response.usage.prompt_tokens_details.cached_tokens` when present.
- Anthropic (`messages.create` message): `message.usage.input_tokens`, `message.usage.output_tokens`, `message.usage.cache_read_input_tokens` (may be absent → 0).
- Google REST: no reliable token usage in the current call shape → record 0 tokens (cost 0) for google; acceptable for now.

---

### Task 1: `cost_rates` model + migration + seed

**Files:**
- Create: `apps/api/app/models/cost_rate.py`
- Modify: `apps/api/app/models/__init__.py` (export `CostRate`)
- Create: `apps/api/alembic/versions/f1u2v3w4x5y6_cost_rates.py`
- Test: `apps/api/tests/test_cost_rate_model.py`

**Interfaces:**
- Produces `CostRate(provider, unit, model, micro_dollars_per_unit, effective_from)` — `unit ∈ {input_token, output_token, cache_read_token, serp, keyword_ideas}`; `model` nullable (NULL for SEO units). Seeded rows for openai gpt-4o / gpt-4o-mini and dataforseo.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_cost_rate_model.py
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.cost_rate import CostRate

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_cost_rate_roundtrip():
    async with Session() as db:
        r = CostRate(provider="openai", unit="input_token", model="gpt-4o-mini",
                     micro_dollars_per_unit=0.15)
        db.add(r)
        await db.commit()
        await db.refresh(r)
        assert r.micro_dollars_per_unit == 0.15
        assert r.effective_from is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_cost_rate_model.py -v`
Expected: FAIL (`ModuleNotFoundError: app.models.cost_rate`)

- [ ] **Step 3: Write the model**

```python
# apps/api/app/models/cost_rate.py
from datetime import datetime
from sqlalchemy import String, Float, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class CostRate(Base):
    """Per-unit provider cost, used to price usage_events. Money is micro-dollars
    ($1 = 1_000_000). unit ∈ input_token|output_token|cache_read_token|serp|
    keyword_ideas. model is NULL for SEO units. Rates are versioned by
    effective_from so a price change never rewrites history."""
    __tablename__ = "cost_rates"

    provider: Mapped[str] = mapped_column(String(50), primary_key=True)
    unit: Mapped[str] = mapped_column(String(30), primary_key=True)
    model: Mapped[str] = mapped_column(String(80), primary_key=True, default="")
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True, server_default=func.now())
    micro_dollars_per_unit: Mapped[float] = mapped_column(Float, nullable=False)
```
(Note: `model` is part of the PK, so use `""` — not NULL — for SEO units, since SQLite/PG treat NULL PK parts awkwardly. The meter looks up SEO rates with `model == ""`.)

- [ ] **Step 4: Export the model**

In `apps/api/app/models/__init__.py` add:
```python
from app.models.cost_rate import CostRate  # noqa: F401
```

- [ ] **Step 5: Write the migration (table + seed)**

```python
# apps/api/alembic/versions/f1u2v3w4x5y6_cost_rates.py
"""cost_rates table + seed

Revision ID: f1u2v3w4x5y6
Revises: e0t1u2v3w4x5
"""
from alembic import op

revision = "f1u2v3w4x5y6"
down_revision = "e0t1u2v3w4x5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS cost_rates (
            provider VARCHAR(50) NOT NULL,
            unit VARCHAR(30) NOT NULL,
            model VARCHAR(80) NOT NULL DEFAULT '',
            effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
            micro_dollars_per_unit DOUBLE PRECISION NOT NULL,
            PRIMARY KEY (provider, unit, model, effective_from)
        )
    """)
    # Representative rates (micro-dollars per unit). VERIFY vs live pricing.
    # gpt-4o-mini $0.15/$0.60 per 1M -> 0.15 / 0.60 micro-$ per token.
    # gpt-4o      $2.50/$10.0 per 1M -> 2.5  / 10.0 micro-$ per token.
    # dataforseo  serp ~$0.0015/call -> 1500 micro-$; keyword_ideas ~$0.02 -> 20000.
    op.execute("""
        INSERT INTO cost_rates (provider, unit, model, micro_dollars_per_unit) VALUES
          ('openai','input_token','gpt-4o-mini',0.15),
          ('openai','output_token','gpt-4o-mini',0.60),
          ('openai','cache_read_token','gpt-4o-mini',0.075),
          ('openai','input_token','gpt-4o',2.5),
          ('openai','output_token','gpt-4o',10.0),
          ('openai','cache_read_token','gpt-4o',1.25),
          ('dataforseo','serp','',1500),
          ('dataforseo','keyword_ideas','',20000)
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS cost_rates")
```

- [ ] **Step 6: Run test + migration**

Run: `cd apps/api && python -m pytest tests/test_cost_rate_model.py -v` → PASS
Run: `make db-migrate` → upgrades to `f1u2v3w4x5y6`

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/models/cost_rate.py apps/api/app/models/__init__.py apps/api/alembic/versions/f1u2v3w4x5y6_cost_rates.py apps/api/tests/test_cost_rate_model.py
git commit -m "feat(billing): cost_rates model, migration, seed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `usage_events` model + `org_usage` raw columns + migration

**Files:**
- Create: `apps/api/app/models/usage_event.py`
- Modify: `apps/api/app/models/__init__.py` (export `UsageEvent`)
- Modify: `apps/api/app/models/billing.py` (`OrgUsage` gains raw columns)
- Create: `apps/api/alembic/versions/g2v3w4x5y6z7_usage_events.py`
- Test: `apps/api/tests/test_usage_event_model.py`

**Interfaces:**
- Produces `UsageEvent(id, org_id, project_id, ts, kind, provider, model, feature, input_tokens, output_tokens, cache_read_tokens, seo_unit, seo_count, cost_micros)`.
- Produces new `OrgUsage` columns: `ai_input_tokens, ai_output_tokens, ai_requests, seo_serp, seo_keyword_analyses, cost_micros` (all BigInteger default 0).

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_usage_event_model.py
import uuid
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.usage_event import UsageEvent
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


async def test_usage_event_and_org_usage_columns():
    async with Session() as db:
        ev = UsageEvent(org_id=uuid.uuid4(), kind="llm", provider="openai",
                        model="gpt-4o-mini", input_tokens=1000, output_tokens=200,
                        cost_micros=270)
        db.add(ev)
        await db.commit()
        await db.refresh(ev)
        assert ev.id is not None
        assert ev.cost_micros == 270
    # org_usage raw columns exist and default to 0
    from datetime import date
    async with Session() as db:
        ou = OrgUsage(org_id=uuid.uuid4(), period_start=date(2026, 7, 1))
        db.add(ou)
        await db.commit()
        await db.refresh(ou)
        assert ou.ai_input_tokens == 0 and ou.cost_micros == 0 and ou.seo_serp == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_usage_event_model.py -v`
Expected: FAIL (`ModuleNotFoundError: app.models.usage_event`)

- [ ] **Step 3: Write `UsageEvent`**

```python
# apps/api/app/models/usage_event.py
import uuid
from datetime import datetime
from sqlalchemy import String, BigInteger, Integer, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class UsageEvent(Base):
    """Append-only ledger of one metered AI or SEO action. Source of truth for
    reconciliation and the cost dashboard; never mutated."""
    __tablename__ = "usage_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    project_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)      # 'llm' | 'seo'
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    feature: Mapped[str | None] = mapped_column(String(60), nullable=True)
    input_tokens: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    cache_read_tokens: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    seo_unit: Mapped[str | None] = mapped_column(String(30), nullable=True)
    seo_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cost_micros: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
```

- [ ] **Step 4: Add raw columns to `OrgUsage`**

In `apps/api/app/models/billing.py`, add `BigInteger` to the sqlalchemy import and append to `OrgUsage`:
```python
    ai_input_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    ai_output_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    ai_requests: Mapped[int] = mapped_column(BigInteger, default=0)
    seo_serp: Mapped[int] = mapped_column(BigInteger, default=0)
    seo_keyword_analyses: Mapped[int] = mapped_column(BigInteger, default=0)
    cost_micros: Mapped[int] = mapped_column(BigInteger, default=0)
```

- [ ] **Step 5: Export `UsageEvent`**

In `apps/api/app/models/__init__.py` add:
```python
from app.models.usage_event import UsageEvent  # noqa: F401
```

- [ ] **Step 6: Write the migration**

```python
# apps/api/alembic/versions/g2v3w4x5y6z7_usage_events.py
"""usage_events + org_usage raw columns

Revision ID: g2v3w4x5y6z7
Revises: f1u2v3w4x5y6
"""
from alembic import op

revision = "g2v3w4x5y6z7"
down_revision = "f1u2v3w4x5y6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS usage_events (
            id BIGSERIAL PRIMARY KEY,
            org_id UUID NOT NULL,
            project_id UUID,
            ts TIMESTAMPTZ NOT NULL DEFAULT now(),
            kind VARCHAR(10) NOT NULL,
            provider VARCHAR(50) NOT NULL,
            model VARCHAR(80),
            feature VARCHAR(60),
            input_tokens BIGINT NOT NULL DEFAULT 0,
            output_tokens BIGINT NOT NULL DEFAULT 0,
            cache_read_tokens BIGINT NOT NULL DEFAULT 0,
            seo_unit VARCHAR(30),
            seo_count INTEGER NOT NULL DEFAULT 0,
            cost_micros BIGINT NOT NULL DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_usage_events_org_ts ON usage_events (org_id, ts)")
    for col in ("ai_input_tokens", "ai_output_tokens", "ai_requests",
                "seo_serp", "seo_keyword_analyses", "cost_micros"):
        op.execute(f"ALTER TABLE org_usage ADD COLUMN IF NOT EXISTS {col} BIGINT NOT NULL DEFAULT 0")


def downgrade() -> None:
    for col in ("ai_input_tokens", "ai_output_tokens", "ai_requests",
                "seo_serp", "seo_keyword_analyses", "cost_micros"):
        op.execute(f"ALTER TABLE org_usage DROP COLUMN IF EXISTS {col}")
    op.execute("DROP TABLE IF EXISTS usage_events")
```

- [ ] **Step 7: Run test + migration**

Run: `cd apps/api && python -m pytest tests/test_usage_event_model.py -v` → PASS
Run: `make db-migrate` → upgrades to `g2v3w4x5y6z7`

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/models/usage_event.py apps/api/app/models/billing.py apps/api/app/models/__init__.py apps/api/alembic/versions/g2v3w4x5y6z7_usage_events.py apps/api/tests/test_usage_event_model.py
git commit -m "feat(billing): usage_events ledger + org_usage raw columns

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Surface provider token usage from the LLM dispatch

**Files:**
- Modify: `apps/api/app/services/llm_service.py`
- Test: `apps/api/tests/test_llm_usage_capture.py`

**Interfaces:**
- Produces:
  - `LLMUsage` dataclass: `provider, model, input_tokens, output_tokens, cache_read_tokens`.
  - `async def call_llm_usage(provider, model, api_key, system_prompt, user_prompt, locale="en", max_tokens=DEFAULT_MAX_TOKENS) -> tuple[str, LLMUsage]` — returns text AND usage.
  - `call_llm(...) -> str` unchanged (now delegates to `call_llm_usage` and returns only the text), so all existing callers are untouched.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_llm_usage_capture.py
import pytest
from app.services import llm_service


class _FakeUsage:
    prompt_tokens = 1000
    completion_tokens = 200
    prompt_tokens_details = None


class _FakeChoice:
    class message:
        content = "hello"


class _FakeResp:
    choices = [_FakeChoice()]
    usage = _FakeUsage()


class _FakeOpenAI:
    def __init__(self, api_key):
        self.chat = self
        self.completions = self

    async def create(self, **kw):
        return _FakeResp()


async def test_call_llm_usage_captures_tokens(monkeypatch):
    monkeypatch.setattr(llm_service, "AsyncOpenAI", _FakeOpenAI)
    text, usage = await llm_service.call_llm_usage(
        "openai", "gpt-4o-mini", "k", "sys", "user")
    assert text == "hello"
    assert usage.input_tokens == 1000
    assert usage.output_tokens == 200
    assert usage.provider == "openai" and usage.model == "gpt-4o-mini"


async def test_call_llm_still_returns_str(monkeypatch):
    monkeypatch.setattr(llm_service, "AsyncOpenAI", _FakeOpenAI)
    out = await llm_service.call_llm("openai", "gpt-4o-mini", "k", "sys", "user")
    assert out == "hello"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_llm_usage_capture.py -v`
Expected: FAIL (`AttributeError: module has no attribute 'call_llm_usage'`)

- [ ] **Step 3: Add `LLMUsage` + usage-returning dispatch**

At the top of `apps/api/app/services/llm_service.py` (after imports) add:
```python
from dataclasses import dataclass


@dataclass
class LLMUsage:
    provider: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
```

Add usage-returning provider helpers and `call_llm_usage`; change `call_llm` to delegate. Insert these (keep the existing `_call_anthropic`/`_call_openai`/`_call_google` if other code imports them, but route `call_llm_usage` through the usage-aware versions below):
```python
async def _openai_usage(model, api_key, system_prompt, user_prompt, max_tokens):
    client = AsyncOpenAI(api_key=api_key)
    resp = await client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system_prompt},
                  {"role": "user", "content": user_prompt}],
        max_tokens=max_tokens,
    )
    u = getattr(resp, "usage", None)
    cached = 0
    details = getattr(u, "prompt_tokens_details", None) if u else None
    if details is not None:
        cached = getattr(details, "cached_tokens", 0) or 0
    usage = LLMUsage("openai", model,
                     input_tokens=getattr(u, "prompt_tokens", 0) or 0,
                     output_tokens=getattr(u, "completion_tokens", 0) or 0,
                     cache_read_tokens=cached)
    return resp.choices[0].message.content, usage


async def _anthropic_usage(model, api_key, system_prompt, user_prompt, max_tokens):
    client = AsyncAnthropic(api_key=api_key)
    message = await client.messages.create(
        model=model, max_tokens=max_tokens, system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    u = getattr(message, "usage", None)
    usage = LLMUsage("anthropic", model,
                     input_tokens=getattr(u, "input_tokens", 0) or 0,
                     output_tokens=getattr(u, "output_tokens", 0) or 0,
                     cache_read_tokens=getattr(u, "cache_read_input_tokens", 0) or 0)
    return message.content[0].text, usage


async def call_llm_usage(
    provider: str, model: str, api_key: str, system_prompt: str, user_prompt: str,
    locale: str | None = "en", max_tokens: int = DEFAULT_MAX_TOKENS,
) -> tuple[str, "LLMUsage"]:
    """Like call_llm but also returns an LLMUsage (token counts). google has no
    reliable token usage in the current call shape -> zeros."""
    system_prompt = system_prompt + language_directive(locale)
    if provider == "anthropic":
        return await _anthropic_usage(model, api_key, system_prompt, user_prompt, max_tokens)
    if provider == "openai":
        return await _openai_usage(model, api_key, system_prompt, user_prompt, max_tokens)
    if provider == "google":
        text = await _call_google(model, api_key, system_prompt, user_prompt)
        return text, LLMUsage("google", model)
    raise ValueError(f"Unknown provider: {provider}")
```

Then replace `call_llm`'s body so it delegates (signature unchanged):
```python
async def call_llm(
    provider: str, model: str, api_key: str, system_prompt: str, user_prompt: str,
    locale: str | None = "en", max_tokens: int = DEFAULT_MAX_TOKENS,
) -> str:
    text, _ = await call_llm_usage(provider, model, api_key, system_prompt,
                                   user_prompt, locale=locale, max_tokens=max_tokens)
    return text
```
(Note: `call_llm_usage` applies `language_directive`; delete the now-duplicate `system_prompt = system_prompt + language_directive(locale)` line from the old `call_llm` body so the directive isn't appended twice.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && python -m pytest tests/test_llm_usage_capture.py -v` → PASS

- [ ] **Step 5: Regression**

Run: `cd apps/api && python -m pytest -q` → no new failures beyond the 10 known pre-existing. (Any test exercising `call_llm` must still pass — the return type is unchanged.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/services/llm_service.py apps/api/tests/test_llm_usage_capture.py
git commit -m "feat(billing): surface LLM token usage via call_llm_usage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `UsageMeter` — price usage, write the ledger, roll up

**Files:**
- Create: `apps/api/app/services/metering/__init__.py` (empty)
- Create: `apps/api/app/services/metering/meter.py`
- Test: `apps/api/tests/test_usage_meter.py`

**Interfaces:**
- Consumes: `CostRate`, `UsageEvent`, `OrgUsage`, `LLMUsage`, `app.core.billing.current_billing_period_start`.
- Produces:
  - `async def rate(db, provider, unit, model="") -> float` — latest `micro_dollars_per_unit` for `(provider, unit, model)` by `effective_from` desc; 0.0 if none.
  - `async def record_llm(db, *, org_id, project_id, usage: LLMUsage, feature=None) -> int` — computes `cost_micros`, inserts a `UsageEvent`, upserts `org_usage` (`ai_input_tokens += in`, `ai_output_tokens += out`, `ai_requests += 1`, `cost_micros += cost`); returns cost_micros.
  - `async def record_seo(db, *, org_id, project_id, unit, count, provider="dataforseo", feature=None) -> int` — cost from rate(unit); inserts event; upserts `org_usage` (`seo_serp` or `seo_keyword_analyses` += count, `cost_micros += cost`); returns cost_micros.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_usage_meter.py
import uuid
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.core.billing import current_billing_period_start
from app.models.cost_rate import CostRate
from app.models.usage_event import UsageEvent
from app.models.billing import OrgUsage
from app.services.llm_service import LLMUsage
from app.services.metering import meter

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as db:
        db.add_all([
            CostRate(provider="openai", unit="input_token", model="gpt-4o-mini", micro_dollars_per_unit=0.15),
            CostRate(provider="openai", unit="output_token", model="gpt-4o-mini", micro_dollars_per_unit=0.60),
            CostRate(provider="dataforseo", unit="serp", model="", micro_dollars_per_unit=1500),
        ])
        await db.commit()
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_record_llm_prices_and_rolls_up():
    org = uuid.uuid4()
    async with Session() as db:
        usage = LLMUsage("openai", "gpt-4o-mini", input_tokens=1000, output_tokens=200)
        cost = await meter.record_llm(db, org_id=org, project_id=None, usage=usage, feature="article")
        # 1000*0.15 + 200*0.60 = 150 + 120 = 270 micro-dollars
        assert cost == 270
        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.kind == "llm" and ev.cost_micros == 270 and ev.input_tokens == 1000
        ou = (await db.execute(select(OrgUsage).where(
            OrgUsage.org_id == org, OrgUsage.period_start == current_billing_period_start()
        ))).scalar_one()
        assert ou.ai_input_tokens == 1000 and ou.ai_output_tokens == 200
        assert ou.ai_requests == 1 and ou.cost_micros == 270


async def test_record_seo_prices_and_rolls_up():
    org = uuid.uuid4()
    async with Session() as db:
        cost = await meter.record_seo(db, org_id=org, project_id=None, unit="serp", count=3, feature="discovery")
        assert cost == 4500  # 3 * 1500
        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.seo_serp == 3 and ou.cost_micros == 4500


async def test_record_llm_accumulates_across_calls():
    org = uuid.uuid4()
    async with Session() as db:
        u = LLMUsage("openai", "gpt-4o-mini", input_tokens=100, output_tokens=0)
        await meter.record_llm(db, org_id=org, project_id=None, usage=u)
        await meter.record_llm(db, org_id=org, project_id=None, usage=u)
        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_requests == 2 and ou.ai_input_tokens == 200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_usage_meter.py -v`
Expected: FAIL (`ModuleNotFoundError: app.services.metering.meter`)

- [ ] **Step 3: Write the meter**

```python
# apps/api/app/services/metering/meter.py
"""Price provider usage from cost_rates, append it to the usage_events ledger,
and roll it into the current org_usage period. All money is micro-dollars."""
import uuid

from sqlalchemy import select

from app.core.billing import current_billing_period_start
from app.models.billing import OrgUsage
from app.models.cost_rate import CostRate
from app.models.usage_event import UsageEvent
from app.services.llm_service import LLMUsage


async def rate(db, provider: str, unit: str, model: str = "") -> float:
    row = (await db.execute(
        select(CostRate.micro_dollars_per_unit).where(
            CostRate.provider == provider, CostRate.unit == unit, CostRate.model == (model or "")
        ).order_by(CostRate.effective_from.desc()).limit(1)
    )).scalar_one_or_none()
    return float(row) if row is not None else 0.0


async def _bump_org_usage(db, org_id, **increments) -> None:
    """Portable (SQLite + Postgres) select-then-increment-or-insert of the
    current-period rollup. Metering is best-effort and wrapped in try/except by
    the seam, so a rare concurrent-insert race (unique on org_id+period_start)
    is non-fatal -- the usage_events ledger stays the source of truth."""
    period = current_billing_period_start()
    row = (await db.execute(select(OrgUsage).where(
        OrgUsage.org_id == org_id, OrgUsage.period_start == period
    ))).scalar_one_or_none()
    if row is None:
        row = OrgUsage(org_id=org_id, period_start=period)
        db.add(row)
        await db.flush()
    for k, v in increments.items():
        setattr(row, k, (getattr(row, k) or 0) + v)


async def record_llm(db, *, org_id: uuid.UUID, project_id, usage: LLMUsage, feature: str | None = None) -> int:
    in_rate = await rate(db, usage.provider, "input_token", usage.model)
    out_rate = await rate(db, usage.provider, "output_token", usage.model)
    cache_rate = await rate(db, usage.provider, "cache_read_token", usage.model)
    cost = round(usage.input_tokens * in_rate
                 + usage.output_tokens * out_rate
                 + usage.cache_read_tokens * cache_rate)
    db.add(UsageEvent(
        org_id=org_id, project_id=project_id, kind="llm", provider=usage.provider,
        model=usage.model, feature=feature, input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens, cache_read_tokens=usage.cache_read_tokens,
        cost_micros=cost,
    ))
    await _bump_org_usage(db, org_id, ai_input_tokens=usage.input_tokens,
                          ai_output_tokens=usage.output_tokens, ai_requests=1, cost_micros=cost)
    await db.commit()
    return cost


_SEO_COLUMN = {"serp": "seo_serp", "keyword_ideas": "seo_keyword_analyses"}


async def record_seo(db, *, org_id: uuid.UUID, project_id, unit: str, count: int,
                     provider: str = "dataforseo", feature: str | None = None) -> int:
    cost = round(count * await rate(db, provider, unit, ""))
    db.add(UsageEvent(
        org_id=org_id, project_id=project_id, kind="seo", provider=provider,
        feature=feature, seo_unit=unit, seo_count=count, cost_micros=cost,
    ))
    increments = {"cost_micros": cost}
    col = _SEO_COLUMN.get(unit)
    if col:
        increments[col] = count
    await _bump_org_usage(db, org_id, **increments)
    await db.commit()
    return cost
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && python -m pytest tests/test_usage_meter.py -v` → PASS (all 3)

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/metering/__init__.py apps/api/app/services/metering/meter.py apps/api/tests/test_usage_meter.py
git commit -m "feat(billing): UsageMeter prices usage, writes ledger, rolls up org_usage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Wire metering into the LLM seam + the discovery/competitor callers

**Files:**
- Modify: `apps/api/app/services/llm_service.py` (`call_llm` gains an optional meter context)
- Modify: `apps/api/app/services/discovery_service.py` (synthesis call passes meter ctx)
- Modify: `apps/api/app/services/discovery/competitors.py` (record SEO serp usage)
- Test: `apps/api/tests/test_metering_wired.py`

**Interfaces:**
- Consumes: `meter.record_llm`, `meter.record_seo`, `call_llm_usage`.
- Produces: `call_llm(..., meter=None)` where `meter` is an optional dict `{"db":…, "org_id":…, "project_id":…, "feature":…}`; when present, the call records LLM usage after completion. Return type stays `str`. Existing callers (no `meter`) are unmetered and unchanged.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_metering_wired.py
import uuid
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.cost_rate import CostRate
from app.models.billing import OrgUsage
from app.services import llm_service

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class _FakeUsage:
    prompt_tokens = 500
    completion_tokens = 100
    prompt_tokens_details = None
class _Msg:
    content = "ok"
class _Choice:
    message = _Msg()
class _Resp:
    choices = [_Choice()]
    usage = _FakeUsage()
class _FakeOpenAI:
    def __init__(self, api_key): self.chat = self; self.completions = self
    async def create(self, **kw): return _Resp()


@pytest.fixture(autouse=True)
async def setup_db(monkeypatch):
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as db:
        db.add_all([
            CostRate(provider="openai", unit="input_token", model="gpt-4o-mini", micro_dollars_per_unit=0.15),
            CostRate(provider="openai", unit="output_token", model="gpt-4o-mini", micro_dollars_per_unit=0.60),
        ])
        await db.commit()
    monkeypatch.setattr(llm_service, "AsyncOpenAI", _FakeOpenAI)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_call_llm_with_meter_records_usage():
    org = uuid.uuid4()
    async with Session() as db:
        out = await llm_service.call_llm(
            "openai", "gpt-4o-mini", "k", "sys", "user",
            meter={"db": db, "org_id": org, "project_id": None, "feature": "test"},
        )
        assert out == "ok"
        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_requests == 1 and ou.ai_input_tokens == 500
        # cost = 500*0.15 + 100*0.60 = 75 + 60 = 135
        assert ou.cost_micros == 135


async def test_call_llm_without_meter_records_nothing():
    org = uuid.uuid4()
    async with Session() as db:
        out = await llm_service.call_llm("openai", "gpt-4o-mini", "k", "sys", "user")
        assert out == "ok"
        rows = (await db.execute(select(OrgUsage))).scalars().all()
        assert rows == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_metering_wired.py -v`
Expected: FAIL (`call_llm() got an unexpected keyword argument 'meter'`)

- [ ] **Step 3: Add the optional meter context to `call_llm`**

Replace `call_llm` in `apps/api/app/services/llm_service.py` with:
```python
async def call_llm(
    provider: str, model: str, api_key: str, system_prompt: str, user_prompt: str,
    locale: str | None = "en", max_tokens: int = DEFAULT_MAX_TOKENS,
    meter: dict | None = None,
) -> str:
    """Return the provider's text. When `meter` is given ({'db','org_id',
    'project_id','feature'}), record token usage/cost after the call. Metering
    failures never break the call."""
    text, usage = await call_llm_usage(provider, model, api_key, system_prompt,
                                       user_prompt, locale=locale, max_tokens=max_tokens)
    if meter is not None:
        try:
            from app.services.metering import meter as _m
            await _m.record_llm(meter["db"], org_id=meter["org_id"],
                                project_id=meter.get("project_id"), usage=usage,
                                feature=meter.get("feature"))
        except Exception:
            logger.exception("usage metering failed (non-fatal)")
    return text
```
(Ensure a module `logger` exists in `llm_service.py`; if not, add `import logging` + `logger = logging.getLogger(__name__)` near the top.)

- [ ] **Step 4: Run the wired test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_metering_wired.py -v` → PASS (both)

- [ ] **Step 5: Meter the discovery synthesis call**

In `apps/api/app/services/discovery/synthesis.py`, the `synthesise(...)` call to `call_llm` should pass a meter context so real discovery runs are metered. `synthesise` is called from `discovery_service.run_discovery_pipeline` which holds `org_id`; thread an optional `meter` through. Minimal, self-contained change: in `discovery_service.py` where it calls `synthesis.synthesise(...)`, open a session and pass `meter`. Concretely, in `synthesis.synthesise(...)`, change its internal `call_llm(...)` to accept and forward a `meter` kwarg (default None), and in `discovery_service.run_discovery_pipeline` pass `meter={"db": <a fresh session>, "org_id": org_id, "project_id": None, "feature": "discovery"}`.

Because `synthesise` currently builds its own args, the smallest correct edit is: add a `meter: dict | None = None` parameter to `synthesise` and forward it into its `call_llm(...)` call; then in `discovery_service.py` wrap the synthesise call in `async with async_session_factory() as mdb:` and pass `meter={"db": mdb, "org_id": org_id, "project_id": None, "feature": "discovery"}`. Keep the existing behavior identical when `meter` is None.

- [ ] **Step 6: Meter SEO serp usage in competitor discovery**

In `apps/api/app/services/discovery/competitors.py`, `discover_competitors(...)` already has `db` and `org_id` and calls `provider.serp_batch(keywords, ...)`. After a successful `serp_batch`, record the SEO usage:
```python
        from app.services.metering import meter as _m
        try:
            await _m.record_seo(db, org_id=org_id, project_id=None, unit="serp",
                                count=len(keywords), feature="discovery")
        except Exception:
            logger.info("seo metering skipped")
```
(Place it right after `serps = await provider.serp_batch(...)` succeeds; `org_id` is the function's arg, `keywords` is already computed. Use the module `logger`.)

- [ ] **Step 7: Regression + commit**

Run: `cd apps/api && python -m pytest tests/test_metering_wired.py tests/test_discovery_competitors.py tests/test_discovery_service.py -q` → PASS
Run: `cd apps/api && python -m pytest -q` → no new failures beyond the 10 known pre-existing.
```bash
git add apps/api/app/services/llm_service.py apps/api/app/services/discovery_service.py apps/api/app/services/discovery/synthesis.py apps/api/app/services/discovery/competitors.py apps/api/tests/test_metering_wired.py
git commit -m "feat(billing): meter LLM calls (opt-in) and discovery SEO usage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Cost/usage summary endpoint (admin dashboard data)

**Files:**
- Create: `apps/api/app/api/v1/routers/usage.py`
- Modify: `apps/api/app/api/v1/router.py` (register)
- Test: `apps/api/tests/test_usage_router.py`

**Interfaces:**
- Produces `GET /api/v1/usage/summary` (auth required) → the caller's org current-period rollup: `{ period_start, ai_input_tokens, ai_output_tokens, ai_requests, seo_serp, seo_keyword_analyses, cost_micros, cost_usd }` where `cost_usd = cost_micros / 1_000_000`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_usage_router.py
import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.core.billing import current_billing_period_start
from app.core.dependencies import get_current_user, get_db
from app.main import app as fastapi_app
from app.models.organization import Organization
from app.models.user import User, UserRole
from app.models.billing import OrgUsage

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
ORG = uuid.uuid4()


async def override_get_db():
    async with Session() as s:
        try:
            yield s
            await s.commit()
        except Exception:
            await s.rollback()
            raise


def _user():
    return User(id=uuid.uuid4(), org_id=ORG, email="u@x.com", hashed_password="x",
                full_name="U", role=UserRole.OWNER, is_active=True)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as s:
        s.add(Organization(id=ORG, slug="o", name="Org"))
        s.add(OrgUsage(org_id=ORG, period_start=current_billing_period_start(),
                       ai_input_tokens=1000, ai_requests=2, cost_micros=2_500_000))
        await s.commit()
    fastapi_app.dependency_overrides[get_db] = override_get_db
    fastapi_app.dependency_overrides[get_current_user] = _user
    yield
    fastapi_app.dependency_overrides.clear()
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as ac:
        yield ac


async def test_usage_summary(client):
    r = await client.get("/api/v1/usage/summary")
    assert r.status_code == 200
    body = r.json()
    assert body["ai_input_tokens"] == 1000
    assert body["ai_requests"] == 2
    assert body["cost_micros"] == 2_500_000
    assert body["cost_usd"] == 2.5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_usage_router.py -v`
Expected: FAIL (404 — router not registered)

- [ ] **Step 3: Write the router**

```python
# apps/api/app/api/v1/routers/usage.py
from fastapi import APIRouter
from sqlalchemy import select
from app.core.dependencies import CurrentUser, DB
from app.core.billing import current_billing_period_start
from app.models.billing import OrgUsage

router = APIRouter()


@router.get("/summary")
async def usage_summary(current_user: CurrentUser, db: DB) -> dict:
    period = current_billing_period_start()
    row = (await db.execute(select(OrgUsage).where(
        OrgUsage.org_id == current_user.org_id, OrgUsage.period_start == period
    ))).scalar_one_or_none()
    cost_micros = int(getattr(row, "cost_micros", 0) or 0)
    return {
        "period_start": period.isoformat(),
        "ai_input_tokens": int(getattr(row, "ai_input_tokens", 0) or 0),
        "ai_output_tokens": int(getattr(row, "ai_output_tokens", 0) or 0),
        "ai_requests": int(getattr(row, "ai_requests", 0) or 0),
        "seo_serp": int(getattr(row, "seo_serp", 0) or 0),
        "seo_keyword_analyses": int(getattr(row, "seo_keyword_analyses", 0) or 0),
        "cost_micros": cost_micros,
        "cost_usd": round(cost_micros / 1_000_000, 4),
    }
```

- [ ] **Step 4: Register the router**

In `apps/api/app/api/v1/router.py`, add `usage` to the `from app.api.v1.routers import (...)` list and:
```python
api_router.include_router(usage.router, prefix="/usage", tags=["usage"])
```

- [ ] **Step 5: Run test + commit**

Run: `cd apps/api && python -m pytest tests/test_usage_router.py -v` → PASS
Run: `cd apps/api && python -m pytest -q` → no new failures.
```bash
git add apps/api/app/api/v1/routers/usage.py apps/api/app/api/v1/router.py apps/api/tests/test_usage_router.py
git commit -m "feat(billing): usage/summary endpoint (per-org period COGS)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Full backend suite: `cd apps/api && python -m pytest -q` → only the known pre-existing failures remain.
- [ ] Migrations applied: `make db-migrate` shows head `g2v3w4x5y6z7`.
- [ ] Manual smoke: run onboarding discovery for an org (with a platform OpenAI key), then `GET /api/v1/usage/summary` for that org → non-zero `ai_requests`/`cost_micros` and a plausible `cost_usd`. Restart the worker after code changes (`docker compose restart worker`).

## Notes for the implementer

- **Backward compatibility is non-negotiable.** `call_llm` keeps returning `str`; metering is opt-in via the `meter=` kwarg. Do not change existing call sites except the discovery ones named in Task 5.
- **Metering must never break a request.** Every `record_*` call from a seam is wrapped in try/except and logged; a metering failure returns the LLM/SEO result normally.
- **Money is integer micro-dollars.** Rates are floats (micro-dollars per unit); event cost is `round(count*rate)`. `cost_usd = cost_micros / 1_000_000`.
- **Rates are representative** — verify OpenAI (`gpt-4o`/`gpt-4o-mini`) and DataForSEO prices and update `cost_rates` before trusting the dashboard.
- **Out of scope (Phase 1b):** quota/rate/concurrency enforcement, `model_catalog` + capability-band routing + `tiers.py` re-map, Stripe/overage/add-ons. Do not add them here.
- Match existing test fixtures — mirror `tests/test_provider_registry.py` (SQLite) and `tests/test_onboarding_router.py` (client/dep-override).
