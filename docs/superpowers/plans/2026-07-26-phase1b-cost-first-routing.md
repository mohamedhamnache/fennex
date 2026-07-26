# Phase 1b — Cost-first LLM Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop routing work to expensive models by default — resolve every LLM call through a data-driven capability band, cap output, cache prompt prefixes, escalate only on proven failure, and run non-interactive jobs on the 50%-off Batch API.

**Architecture:** A `model_catalog` table maps three bands (`cheap`/`standard`/`premium`) to concrete `(provider, model)` rows in preference order. A process-local snapshot of that table makes band resolution synchronous, so the ~12 existing `resolve_model()` call sites keep their signatures. A feature→policy map decides which band a feature gets, how many output tokens it may spend, and whether it cascades. Premium is reachable only through an explicit org entitlement. All of it is COGS-side: no quota enforcement, no pricing change.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic (raw-SQL migrations), pytest (`asyncio_mode = "auto"`), arq, OpenAI SDK 2.x, Anthropic SDK, Next.js 14 + react-i18next for the one Settings toggle.

**Spec:** `docs/superpowers/specs/2026-07-26-phase1b-cost-first-routing-design.md`

## Global Constraints

- **Money is integer micro-dollars** ($1 = 1,000,000) everywhere except `cost_rates.micro_dollars_per_unit`, which is a FLOAT holding micro-$ per unit (e.g. `0.15` = $0.15 per 1M tokens).
- **Every active `model_catalog` row must have `cost_rates` rows** for `input_token`, `output_token`, `cache_read_token` and their `batch_` counterparts. A catalogued model without rates prices to $0 — this is the Phase 1a regression being guarded against.
- **No new columns of type JSONB in a model that tests touch.** `tests/conftest.py` strips JSONB tables out of `Base.metadata` for SQLite; use `sqlalchemy.JSON` in the model and `JSONB` only in the Postgres migration.
- **Migrations are hand-written raw SQL** with `IF NOT EXISTS` guards, following `alembic/versions/g2v3w4x5y6z7_*.py`. Current head: `h3w4x5y6z7a8`. Each task's migration sets `down_revision` to the previous task's revision.
- **No emoji** in code, comments, UI copy, or commit messages.
- **All user-visible frontend strings go through `t("key")`** with entries added to all six locales: `apps/web/public/locales/{en,fr,de,es,pt,ar}/common.json`.
- **Never hard-code colors** in the frontend; use the Tailwind CSS variables (`bg-card`, `text-muted-foreground`, ...).
- Run tests with `cd apps/api && python -m pytest`. Run frontend checks with `cd apps/web && npm run typecheck`.
- Commit after every task. Commit style: `feat(routing): ...`, `fix(billing): ...`.

---

### Task 1: `model_catalog` model, migration and seed

**Files:**
- Create: `apps/api/app/models/model_catalog.py`
- Create: `apps/api/alembic/versions/i4x5y6z7a8b9_model_catalog.py`
- Modify: `apps/api/app/models/__init__.py`
- Test: `apps/api/tests/test_model_catalog_model.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `app.models.model_catalog.ModelCatalog` with columns `band: str`, `provider: str`, `model: str`, `priority: int`, `supports: dict`, `is_active: bool`; composite PK `(band, provider, model)`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_model_catalog_model.py`:

```python
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.model_catalog import ModelCatalog

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_row_round_trips_with_supports_json():
    async with Session() as db:
        db.add(ModelCatalog(band="cheap", provider="openai", model="gpt-4o-mini",
                            priority=1, supports={"json_output": True, "tools": True}))
        await db.commit()
    async with Session() as db:
        row = (await db.execute(select(ModelCatalog))).scalar_one()
        assert (row.band, row.provider, row.model, row.priority) == ("cheap", "openai", "gpt-4o-mini", 1)
        assert row.supports["json_output"] is True
        assert row.is_active is True


async def test_same_model_can_serve_two_bands():
    """The PK is (band, provider, model), so one model may appear in two bands."""
    async with Session() as db:
        db.add_all([
            ModelCatalog(band="standard", provider="openai", model="gpt-4o", priority=1),
            ModelCatalog(band="premium", provider="openai", model="gpt-4o", priority=9),
        ])
        await db.commit()
        rows = (await db.execute(select(ModelCatalog))).scalars().all()
        assert len(rows) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_model_catalog_model.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.models.model_catalog'`

- [ ] **Step 3: Write the model**

Create `apps/api/app/models/model_catalog.py`:

```python
from sqlalchemy import String, Integer, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class ModelCatalog(Base):
    """Maps a capability band to concrete supplier models, in preference order.
    priority 1 is the primary; higher values are fallbacks. `supports` carries
    capability flags (json_output, vision, tools) so the resolver can skip a
    model that cannot serve a request. Bands are supplier-neutral: adding or
    repointing a supplier is a row change, not a code change."""
    __tablename__ = "model_catalog"

    band: Mapped[str] = mapped_column(String(20), primary_key=True)      # cheap|standard|premium
    provider: Mapped[str] = mapped_column(String(50), primary_key=True)  # openai|anthropic|google
    model: Mapped[str] = mapped_column(String(80), primary_key=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    # JSON, not JSONB: the SQLite test engine cannot create JSONB columns.
    supports: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
```

Add to `apps/api/app/models/__init__.py`, alongside the other model imports:

```python
from app.models.model_catalog import ModelCatalog  # noqa: F401
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_model_catalog_model.py -q`
Expected: 2 passed

- [ ] **Step 5: Write the migration**

Create `apps/api/alembic/versions/i4x5y6z7a8b9_model_catalog.py`:

```python
"""model_catalog table, band seed, and cost_rates for the new Anthropic models

Revision ID: i4x5y6z7a8b9
Revises: h3w4x5y6z7a8
"""
from alembic import op

revision = "i4x5y6z7a8b9"
down_revision = "h3w4x5y6z7a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS model_catalog (
            band VARCHAR(20) NOT NULL,
            provider VARCHAR(50) NOT NULL,
            model VARCHAR(80) NOT NULL,
            priority INTEGER NOT NULL DEFAULT 100,
            supports JSONB NOT NULL DEFAULT '{}'::jsonb,
            is_active BOOLEAN NOT NULL DEFAULT true,
            PRIMARY KEY (band, provider, model)
        )
    """)
    # Bands are capability tiers, not fixed models. OpenAI is the launch primary;
    # Anthropic rows are the fallbacks. Premium is Anthropic-only until an
    # OpenAI flagship reasoning model id and price are confirmed -- seeding an
    # unpriced model would silently bill it at $0.
    op.execute("""
        INSERT INTO model_catalog (band, provider, model, priority, supports) VALUES
          ('cheap','openai','gpt-4o-mini',1,'{"json_output":true,"tools":true,"vision":true}'::jsonb),
          ('cheap','anthropic','claude-haiku-4-5-20251001',2,'{"json_output":true,"tools":true,"vision":true}'::jsonb),
          ('standard','openai','gpt-4o',1,'{"json_output":true,"tools":true,"vision":true}'::jsonb),
          ('standard','anthropic','claude-sonnet-5',2,'{"json_output":true,"tools":true,"vision":true}'::jsonb),
          ('premium','anthropic','claude-opus-5',1,'{"json_output":true,"tools":true,"vision":true}'::jsonb)
        ON CONFLICT (band, provider, model) DO NOTHING
    """)
    # Every catalogued model must be priced. claude-sonnet-5 $3/$15 per 1M,
    # claude-opus-5 $5/$25 per 1M, cache reads ~0.1x of input.
    op.execute("""
        INSERT INTO cost_rates (provider, unit, model, micro_dollars_per_unit) VALUES
          ('anthropic','input_token','claude-sonnet-5',3.0),
          ('anthropic','output_token','claude-sonnet-5',15.0),
          ('anthropic','cache_read_token','claude-sonnet-5',0.3),
          ('anthropic','input_token','claude-opus-5',5.0),
          ('anthropic','output_token','claude-opus-5',25.0),
          ('anthropic','cache_read_token','claude-opus-5',0.5)
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM cost_rates
        WHERE provider = 'anthropic' AND model IN ('claude-sonnet-5', 'claude-opus-5')
    """)
    op.execute("DROP TABLE IF EXISTS model_catalog")
```

- [ ] **Step 6: Verify the migration chain has a single head**

Run: `cd apps/api && python -c "
import os, re
d = 'alembic/versions'
revs, downs = {}, set()
for f in os.listdir(d):
    if not f.endswith('.py'): continue
    s = open(os.path.join(d, f)).read()
    r = re.search(r'^revision(?::.*?)? = [\"\'](.+?)[\"\']', s, re.M)
    for m in re.finditer(r'^down_revision(?::.*?)? = (.+)$', s, re.M):
        downs.update(re.findall(r'[\"\'](.+?)[\"\']', m.group(1)))
    if r: revs[r.group(1)] = f
print('heads:', [f for r, f in revs.items() if r not in downs])
"`
Expected: exactly one head — `i4x5y6z7a8b9_model_catalog.py`

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/models/model_catalog.py apps/api/app/models/__init__.py \
        apps/api/alembic/versions/i4x5y6z7a8b9_model_catalog.py \
        apps/api/tests/test_model_catalog_model.py
git commit -m "feat(routing): model_catalog table with band seed"
```

---

### Task 2: Band resolver with a process-local snapshot

**Files:**
- Create: `apps/api/app/services/providers/catalog.py`
- Modify: `apps/api/app/services/providers/registry.py` (add the stale-refresh hook to `get_llm_keys`)
- Modify: `apps/api/app/main.py:19-27` (warm the snapshot in `lifespan`)
- Test: `apps/api/tests/test_catalog_resolver.py`

**Interfaces:**
- Consumes: `ModelCatalog` from Task 1.
- Produces:
  - `catalog.resolve_band(band: str, available: list[str], needs: dict | None = None) -> tuple[str, str]` — synchronous, returns `(provider, model)`.
  - `catalog.SEED: tuple[tuple[str, str, str, int, dict], ...]` — `(band, provider, model, priority, supports)`, the hardcoded fallback and the source of truth for the invariant test in Task 12.
  - `catalog.BANDS: tuple[str, ...]` = `("cheap", "standard", "premium")`, cheapest first.
  - `await catalog.refresh_snapshot(db) -> None` and `await catalog.refresh_if_stale(db) -> None`.
  - `catalog.invalidate_snapshot() -> None` — used by Task 12's admin CRUD.
  - `catalog.known_models() -> set[tuple[str, str]]` — every catalogued `(provider, model)`, used by Task 5 to replace the duplicate catalogue in the employee runtime.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_catalog_resolver.py`:

```python
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.cost_rate import CostRate
from app.models.model_catalog import ModelCatalog
from app.services.providers import catalog

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    catalog.invalidate_snapshot()
    yield
    catalog.invalidate_snapshot()
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


def test_empty_snapshot_falls_back_to_hardcoded_seed():
    """A fresh DB or a failed refresh must still route to the right models."""
    assert catalog.resolve_band("cheap", ["openai"]) == ("openai", "gpt-4o-mini")
    assert catalog.resolve_band("standard", ["openai"]) == ("openai", "gpt-4o")


def test_primary_wins_when_both_providers_available():
    assert catalog.resolve_band("standard", ["anthropic", "openai"]) == ("openai", "gpt-4o")


def test_falls_back_to_next_priority_when_primary_provider_missing():
    assert catalog.resolve_band("standard", ["anthropic"]) == ("anthropic", "claude-sonnet-5")


def test_unmet_capability_skips_the_row():
    assert catalog.resolve_band("premium", ["anthropic"]) == ("anthropic", "claude-opus-5")
    # no seeded model declares audio support, so no band has a usable row and
    # resolution runs out of candidates rather than returning an incapable model
    with pytest.raises(ValueError):
        catalog.resolve_band("premium", ["anthropic", "openai"], needs={"audio": True})


def test_band_with_no_usable_row_walks_down_not_raises():
    """A missing premium key must degrade to standard, never fail the request."""
    assert catalog.resolve_band("premium", ["openai"]) == ("openai", "gpt-4o")


def test_no_providers_raises():
    with pytest.raises(ValueError):
        catalog.resolve_band("cheap", [])


async def test_snapshot_overrides_the_seed():
    async with Session() as db:
        db.add(ModelCatalog(band="cheap", provider="openai", model="gpt-4o-mini-2",
                            priority=1, supports={}))
        await db.commit()
        await catalog.refresh_snapshot(db)
    assert catalog.resolve_band("cheap", ["openai"]) == ("openai", "gpt-4o-mini-2")


async def test_inactive_rows_are_ignored():
    async with Session() as db:
        db.add_all([
            ModelCatalog(band="cheap", provider="openai", model="broken", priority=1,
                         supports={}, is_active=False),
            ModelCatalog(band="cheap", provider="openai", model="good", priority=2, supports={}),
        ])
        await db.commit()
        await catalog.refresh_snapshot(db)
    assert catalog.resolve_band("cheap", ["openai"]) == ("openai", "good")


async def test_priority_tie_breaks_on_cost():
    """Equal priority -> the cheaper model by cost_rates wins (spec 3.4.3 #8)."""
    async with Session() as db:
        db.add_all([
            ModelCatalog(band="cheap", provider="openai", model="pricey", priority=1, supports={}),
            ModelCatalog(band="cheap", provider="anthropic", model="thrifty", priority=1, supports={}),
            CostRate(provider="openai", unit="input_token", model="pricey", micro_dollars_per_unit=5.0),
            CostRate(provider="openai", unit="output_token", model="pricey", micro_dollars_per_unit=15.0),
            CostRate(provider="anthropic", unit="input_token", model="thrifty", micro_dollars_per_unit=0.5),
            CostRate(provider="anthropic", unit="output_token", model="thrifty", micro_dollars_per_unit=1.5),
        ])
        await db.commit()
        await catalog.refresh_snapshot(db)
    assert catalog.resolve_band("cheap", ["openai", "anthropic"]) == ("anthropic", "thrifty")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_catalog_resolver.py -q`
Expected: FAIL with `ImportError: cannot import name 'catalog'`

- [ ] **Step 3: Write the resolver**

Create `apps/api/app/services/providers/catalog.py`:

```python
"""Band -> (provider, model) resolution over model_catalog.

Bands are capability tiers ('cheap' | 'standard' | 'premium'), not fixed models,
so repointing a supplier is a row change. Resolution is synchronous by design:
it reads a process-local snapshot of the (tiny, rarely changed) table, which is
what lets every existing resolve_model() call site keep its signature.
"""
import logging
import time

from sqlalchemy import select

from app.models.cost_rate import CostRate
from app.models.model_catalog import ModelCatalog

logger = logging.getLogger(__name__)

# Cheapest first. Resolution walks down this list when a band has no usable row.
BANDS = ("cheap", "standard", "premium")

_CAPS = {"json_output": True, "tools": True, "vision": True}

# Hardcoded mirror of the Task 1 migration seed. Used when the snapshot is empty
# (fresh process, fresh DB, failed refresh) so routing degrades to the right
# models instead of failing. Tuple shape: (band, provider, model, priority, supports).
SEED: tuple[tuple[str, str, str, int, dict], ...] = (
    ("cheap", "openai", "gpt-4o-mini", 1, _CAPS),
    ("cheap", "anthropic", "claude-haiku-4-5-20251001", 2, _CAPS),
    ("standard", "openai", "gpt-4o", 1, _CAPS),
    ("standard", "anthropic", "claude-sonnet-5", 2, _CAPS),
    ("premium", "anthropic", "claude-opus-5", 1, _CAPS),
)

_TTL_SECONDS = 300

# (band, provider, model, priority, supports, cost_hint)
_snapshot: list[tuple[str, str, str, int, dict, float]] | None = None
_loaded_at: float = 0.0


def _rows() -> list[tuple[str, str, str, int, dict, float]]:
    if _snapshot is not None:
        return _snapshot
    return [(b, p, m, prio, sup, 0.0) for b, p, m, prio, sup in SEED]


def known_models() -> set[tuple[str, str]]:
    """Every catalogued (provider, model). One source of truth for "is this a
    model we are allowed to run"."""
    return {(provider, model) for _b, provider, model, *_rest in _rows()}


def invalidate_snapshot() -> None:
    """Drop the cached snapshot so the next refresh reloads from the DB."""
    global _snapshot, _loaded_at
    _snapshot = None
    _loaded_at = 0.0


async def refresh_snapshot(db) -> None:
    """Reload the catalog and a per-model cost hint used for tie-breaking."""
    global _snapshot, _loaded_at
    try:
        rows = (await db.execute(
            select(ModelCatalog).where(ModelCatalog.is_active == True)  # noqa: E712
        )).scalars().all()
        if not rows:
            _snapshot = None
            _loaded_at = time.monotonic()
            return
        rates = (await db.execute(select(
            CostRate.provider, CostRate.model, CostRate.unit, CostRate.micro_dollars_per_unit
        ).where(CostRate.unit.in_(("input_token", "output_token"))))).all()
        cost: dict[tuple[str, str], float] = {}
        for provider, model, _unit, value in rates:
            cost[(provider, model)] = cost.get((provider, model), 0.0) + float(value)
        _snapshot = [
            (r.band, r.provider, r.model, r.priority, r.supports or {},
             cost.get((r.provider, r.model), 0.0))
            for r in rows
        ]
        _loaded_at = time.monotonic()
    except Exception:
        logger.exception("model_catalog refresh failed; keeping previous snapshot")


async def refresh_if_stale(db) -> None:
    if _snapshot is None or (time.monotonic() - _loaded_at) > _TTL_SECONDS:
        await refresh_snapshot(db)


def _candidates(band: str, available: list[str], needs: dict | None):
    out = []
    for b, provider, model, priority, supports, cost in _rows():
        if b != band or provider not in available:
            continue
        if needs and not all(supports.get(k) == v for k, v in needs.items()):
            continue
        out.append((priority, cost, provider, model))
    # lowest priority first; on a tie the cheaper model wins (spec 3.4.3 #8)
    out.sort(key=lambda c: (c[0], c[1]))
    return out


def resolve_band(band: str, available: list[str], needs: dict | None = None) -> tuple[str, str]:
    """Return (provider, model) for a band, given the providers we hold keys for.

    Walks down to cheaper bands when the requested band has no usable row, so a
    missing premium credential degrades the response instead of failing it.
    """
    if not available:
        raise ValueError("No LLM provider keys available.")
    start = BANDS.index(band) if band in BANDS else BANDS.index("standard")
    for candidate_band in reversed(BANDS[: start + 1]):
        found = _candidates(candidate_band, available, needs)
        if found:
            if candidate_band != band:
                logger.warning("band %s unavailable; resolved on %s", band, candidate_band)
            return found[0][2], found[0][3]
    raise ValueError(f"No catalogued model for band {band} on providers {available}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_catalog_resolver.py -q`
Expected: 9 passed

- [ ] **Step 5: Hook the TTL refresh into the universal precursor**

`registry.get_llm_keys()` is called immediately before model resolution on every path, in both the API and worker processes. Refreshing there gives the snapshot a TTL everywhere with no new plumbing.

In `apps/api/app/services/providers/registry.py`, add to the top of `get_llm_keys` (line 44), before `keys = await platform_llm_keys(db)`:

```python
    from app.services.providers import catalog
    await catalog.refresh_if_stale(db)
```

- [ ] **Step 6: Warm the snapshot at API startup**

In `apps/api/app/main.py`, inside `lifespan` after the `create_all` block (line 22):

```python
    from app.core.database import async_session_maker
    from app.services.providers import catalog
    async with async_session_maker() as db:
        await catalog.refresh_snapshot(db)
```

Check the actual session-factory name exported by `app/core/database.py` and use that name; do not invent one.

- [ ] **Step 7: Run the full provider/registry suite**

Run: `cd apps/api && python -m pytest tests/test_catalog_resolver.py tests/test_provider_registry.py tests/test_seo_provider_platform_first.py -q`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/services/providers/catalog.py apps/api/app/services/providers/registry.py \
        apps/api/app/main.py apps/api/tests/test_catalog_resolver.py
git commit -m "feat(routing): band resolver over model_catalog with snapshot cache"
```

---

### Task 3: Feature policy map

**Files:**
- Create: `apps/api/app/services/agents/policy.py`
- Test: `apps/api/tests/test_feature_policy.py`

**Interfaces:**
- Consumes: `catalog.BANDS` from Task 2.
- Produces:
  - `policy.FeaturePolicy` frozen dataclass: `band: str = "cheap"`, `max_output_tokens: int = 1024`, `needs_premium: bool = False`, `cascade: bool = False`.
  - `policy.FEATURE_POLICY: dict[str, FeaturePolicy]`
  - `policy.DEFAULT_POLICY: FeaturePolicy`
  - `policy.policy_for(feature: str | None) -> FeaturePolicy`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_feature_policy.py`:

```python
from app.services.agents import policy
from app.services.providers import catalog


def test_unknown_feature_defaults_to_cheap():
    """New features start cheap and are promoted only on evidence (spec 3.4.2)."""
    p = policy.policy_for("a-feature-nobody-registered")
    assert p.band == "cheap"
    assert p.needs_premium is False
    assert p.max_output_tokens <= 1024


def test_none_feature_returns_the_default():
    assert policy.policy_for(None) is policy.DEFAULT_POLICY


def test_short_form_features_are_cheap():
    for feature in ("meta_description", "alt_text", "title", "tags", "keyword_clustering"):
        assert policy.policy_for(feature).band == "cheap", feature


def test_long_form_features_are_standard():
    for feature in ("article_draft", "brand_voice", "discovery", "competitor_gap"):
        assert policy.policy_for(feature).band == "standard", feature


def test_no_feature_is_premium_by_default_band():
    """Premium is reached through needs_premium plus entitlement, never by a
    policy band alone -- this is what keeps Opus off by default."""
    assert all(p.band != "premium" for p in policy.FEATURE_POLICY.values())


def test_editorial_polish_is_the_only_premium_candidate():
    premium = [k for k, p in policy.FEATURE_POLICY.items() if p.needs_premium]
    assert premium == ["editorial_polish"]


def test_every_policy_band_is_a_real_band():
    for name, p in policy.FEATURE_POLICY.items():
        assert p.band in catalog.BANDS, name


def test_output_caps_are_sane():
    """Output costs ~5x input, so every feature carries an explicit ceiling."""
    for name, p in policy.FEATURE_POLICY.items():
        assert 0 < p.max_output_tokens <= 8192, name
    assert policy.policy_for("meta_description").max_output_tokens <= 256


def test_cascade_only_on_structured_or_bounded_features():
    for name, p in policy.FEATURE_POLICY.items():
        if p.cascade:
            assert p.band in ("cheap", "standard"), name
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_feature_policy.py -q`
Expected: FAIL with `ImportError: cannot import name 'policy'`

- [ ] **Step 3: Write the policy map**

Create `apps/api/app/services/agents/policy.py`:

```python
"""Feature -> routing policy. One table drives band choice, the output-token
ceiling, and cascade opt-in, so the three cost levers cannot disagree.

Feature keys are the same strings passed to the usage meter, so a per-feature
cost report maps 1:1 onto a policy row. Promoting or demoting a feature's model
is a change here, not a redeploy of any caller (spec 3.4.2).
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class FeaturePolicy:
    band: str = "cheap"
    max_output_tokens: int = 1024
    needs_premium: bool = False   # may escalate to premium when the org is entitled
    cascade: bool = False         # cheap-first with a programmatic validator


DEFAULT_POLICY = FeaturePolicy()

_CHEAP = "cheap"
_STANDARD = "standard"

FEATURE_POLICY: dict[str, FeaturePolicy] = {
    # Short, structured, or mechanical -- the cheap model nails these.
    "meta_description": FeaturePolicy(_CHEAP, 256),
    "alt_text": FeaturePolicy(_CHEAP, 128),
    "title": FeaturePolicy(_CHEAP, 128),
    "slug": FeaturePolicy(_CHEAP, 64),
    "tags": FeaturePolicy(_CHEAP, 256, cascade=True),
    "social_caption": FeaturePolicy(_CHEAP, 512),
    "keyword_clustering": FeaturePolicy(_CHEAP, 2048, cascade=True),
    "extraction": FeaturePolicy(_CHEAP, 2048, cascade=True),
    "classification": FeaturePolicy(_CHEAP, 512, cascade=True),
    "image_prompt": FeaturePolicy(_CHEAP, 512),
    "suggest": FeaturePolicy(_CHEAP, 1024, cascade=True),

    # The workhorse band: reasoning and long-form prose.
    "article_draft": FeaturePolicy(_STANDARD, 8192),
    "article_outline": FeaturePolicy(_STANDARD, 2048, cascade=True),
    "brand_voice": FeaturePolicy(_STANDARD, 4096),
    "discovery": FeaturePolicy(_STANDARD, 4096, cascade=True),
    "competitor_gap": FeaturePolicy(_STANDARD, 4096),
    "agent_reasoning": FeaturePolicy(_STANDARD, 4096),
    "employee_chat": FeaturePolicy(_STANDARD, 4096),
    "campaign_plan": FeaturePolicy(_STANDARD, 4096, cascade=True),
    "digest": FeaturePolicy(_STANDARD, 2048),
    "monitoring": FeaturePolicy(_STANDARD, 2048),

    # The one feature allowed to reach premium, and only for an entitled org.
    "editorial_polish": FeaturePolicy(_STANDARD, 8192, needs_premium=True),
}


def policy_for(feature: str | None) -> FeaturePolicy:
    if feature is None:
        return DEFAULT_POLICY
    return FEATURE_POLICY.get(feature, DEFAULT_POLICY)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_feature_policy.py -q`
Expected: 9 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/policy.py apps/api/tests/test_feature_policy.py
git commit -m "feat(routing): feature policy map for bands, output caps and cascade"
```

---

### Task 4: Premium entitlement

**Files:**
- Create: `apps/api/app/core/entitlements.py`
- Create: `apps/api/alembic/versions/j5y6z7a8b9c0_premium_models_flag.py`
- Modify: `apps/api/app/models/organization.py:34-36`
- Modify: `apps/api/app/api/v1/routers/organizations.py:38-92`
- Test: `apps/api/tests/test_entitlements.py`

**Interfaces:**
- Consumes: `catalog.BANDS` from Task 2.
- Produces:
  - `entitlements.max_band(org) -> str` — the highest band an org may reach.
  - `entitlements.cap_band(band: str, org) -> str` — clamps a requested band to `max_band(org)`.
  - `Organization.premium_models_enabled: bool`
  - `OrgOut.premium_models_enabled: bool`, `OrgUpdate.premium_models_enabled: bool | None`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_entitlements.py`:

```python
from types import SimpleNamespace

from app.core import entitlements
from app.models.organization import PlanTier


def _org(plan, flag=False):
    return SimpleNamespace(plan_tier=plan, premium_models_enabled=flag)


def test_premium_requires_both_plan_and_flag():
    assert entitlements.max_band(_org(PlanTier.PRO, True)) == "premium"
    assert entitlements.max_band(_org(PlanTier.PRO, False)) == "standard"
    assert entitlements.max_band(_org(PlanTier.STARTER, True)) == "standard"


def test_free_and_starter_never_reach_premium():
    for plan in (PlanTier.FREE, PlanTier.STARTER):
        assert entitlements.max_band(_org(plan, True)) == "standard"


def test_agency_and_enterprise_may_reach_premium():
    for plan in (PlanTier.AGENCY, PlanTier.ENTERPRISE):
        assert entitlements.max_band(_org(plan, True)) == "premium"


def test_plan_tier_accepts_a_plain_string():
    """plan_tier is an enum on the model but a string in some payloads."""
    assert entitlements.max_band(SimpleNamespace(plan_tier="pro", premium_models_enabled=True)) == "premium"


def test_cap_band_clamps_down_and_never_up():
    starter = _org(PlanTier.STARTER, True)
    assert entitlements.cap_band("premium", starter) == "standard"
    assert entitlements.cap_band("cheap", starter) == "cheap"
    pro = _org(PlanTier.PRO, True)
    assert entitlements.cap_band("premium", pro) == "premium"


def test_missing_org_caps_at_standard():
    assert entitlements.max_band(None) == "standard"
    assert entitlements.cap_band("premium", None) == "standard"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_entitlements.py -q`
Expected: FAIL with `ImportError: cannot import name 'entitlements'`

- [ ] **Step 3: Write the entitlement module**

Create `apps/api/app/core/entitlements.py`:

```python
"""Which capability band an org is allowed to reach.

Premium is a paid, opt-in entitlement, never a side effect of the org's
agent_tier preference: it needs a pro-or-above plan AND an explicit flag. Free,
starter and in-trial orgs cap at standard whatever else is set.
"""
from app.services.providers.catalog import BANDS

_RANK = {band: i for i, band in enumerate(BANDS)}

_PREMIUM_PLANS = {"pro", "agency", "enterprise"}


def _plan(org) -> str:
    value = getattr(org, "plan_tier", None)
    return (getattr(value, "value", None) or str(value or "free")).lower()


def max_band(org) -> str:
    if org is None:
        return "standard"
    if _plan(org) in _PREMIUM_PLANS and bool(getattr(org, "premium_models_enabled", False)):
        return "premium"
    return "standard"


def cap_band(band: str, org) -> str:
    """Clamp a requested band down to what the org may reach. Never raises: a
    policy asking for premium on a starter org silently gets standard."""
    ceiling = max_band(org)
    if _RANK.get(band, 0) <= _RANK[ceiling]:
        return band
    return ceiling
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_entitlements.py -q`
Expected: 6 passed

- [ ] **Step 5: Add the column and the migration**

In `apps/api/app/models/organization.py`, after the `byok_enabled` column (line 35):

```python
    premium_models_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
```

Create `apps/api/alembic/versions/j5y6z7a8b9c0_premium_models_flag.py`:

```python
"""organizations.premium_models_enabled

Revision ID: j5y6z7a8b9c0
Revises: i4x5y6z7a8b9
"""
from alembic import op

revision = "j5y6z7a8b9c0"
down_revision = "i4x5y6z7a8b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS "
        "premium_models_enabled BOOLEAN NOT NULL DEFAULT false"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE organizations DROP COLUMN IF EXISTS premium_models_enabled")
```

- [ ] **Step 6: Expose it on the org endpoint**

In `apps/api/app/api/v1/routers/organizations.py`:

Add to `OrgOut` (after `agent_tier`, line 44):
```python
    premium_models_enabled: bool
    premium_available: bool
```

Add to `OrgUpdate` (line 49):
```python
    premium_models_enabled: bool | None = None
```

In `_org_out` (line 62), replace the return with:
```python
    return OrgOut(id=str(org.id), slug=org.slug, name=org.name,
                  plan_tier=org.plan_tier.value if hasattr(org.plan_tier, "value") else str(org.plan_tier),
                  agent_tier=org.agent_tier or "balanced",
                  premium_models_enabled=bool(org.premium_models_enabled),
                  premium_available=_plan_allows_premium(org))
```

Add above `_org_out`:
```python
def _plan_allows_premium(org) -> bool:
    """Whether the plan could reach premium if the flag were on -- lets the UI
    explain why the toggle is disabled instead of just hiding it."""
    from app.core.entitlements import max_band
    from types import SimpleNamespace
    return max_band(SimpleNamespace(plan_tier=org.plan_tier, premium_models_enabled=True)) == "premium"
```

In `update_organization` (after the `agent_tier` block, line 88):
```python
    if body.premium_models_enabled is not None:
        if body.premium_models_enabled and not _plan_allows_premium(org):
            raise HTTPException(status_code=403,
                                detail="Premium models require the Pro plan or above")
        org.premium_models_enabled = body.premium_models_enabled
```

- [ ] **Step 7: Test the endpoint behaviour**

Append to `apps/api/tests/test_entitlements.py`:

```python
from app.api.v1.routers.organizations import _plan_allows_premium


def test_plan_allows_premium_matches_the_entitlement_rule():
    assert _plan_allows_premium(_org(PlanTier.PRO)) is True
    assert _plan_allows_premium(_org(PlanTier.AGENCY)) is True
    assert _plan_allows_premium(_org(PlanTier.STARTER)) is False
    assert _plan_allows_premium(_org(PlanTier.FREE)) is False
```

Run: `cd apps/api && python -m pytest tests/test_entitlements.py -q`
Expected: 7 passed

- [ ] **Step 8: Verify the migration chain still has one head**

Run the head-check command from Task 1 Step 6.
Expected: one head — `j5y6z7a8b9c0_premium_models_flag.py`

- [ ] **Step 9: Commit**

```bash
git add apps/api/app/core/entitlements.py apps/api/app/models/organization.py \
        apps/api/app/api/v1/routers/organizations.py \
        apps/api/alembic/versions/j5y6z7a8b9c0_premium_models_flag.py \
        apps/api/tests/test_entitlements.py
git commit -m "feat(routing): premium models entitlement flag on organizations"
```

---

### Task 5: Re-map `tiers.py` to bands

**Files:**
- Modify: `apps/api/app/services/agents/tiers.py` (full rewrite)
- Modify: `apps/api/app/employees/runtime/models.py:34-48,104-108` (repoint `CATALOGUE`/`is_allowed`)
- Modify: `apps/api/tests/test_agents_tiers.py` (rewrite — the old expectations assert Opus)
- Test: `apps/api/tests/test_agents_tiers.py`

**Interfaces:**
- Consumes: `catalog.resolve_band` (Task 2), `policy.policy_for` (Task 3), `entitlements.cap_band` (Task 4).
- Produces: `tiers.resolve_model(tier, weight, available, *, feature=None, org=None) -> tuple[str, str]` and `tiers.band_for(tier: str, weight: str) -> str`.

- [ ] **Step 1: Rewrite the test file**

Replace the contents of `apps/api/tests/test_agents_tiers.py`:

```python
from types import SimpleNamespace

import pytest

from app.models.organization import PlanTier
from app.services.agents.tiers import band_for, resolve_model
from app.services.providers import catalog


@pytest.fixture(autouse=True)
def clean_snapshot():
    catalog.invalidate_snapshot()
    yield
    catalog.invalidate_snapshot()


def _org(plan=PlanTier.PRO, flag=True):
    return SimpleNamespace(plan_tier=plan, premium_models_enabled=flag)


def test_heavy_work_on_balanced_is_standard_not_opus():
    """The Phase 1b headline: balanced/heavy stops routing to an Opus model."""
    assert band_for("balanced", "heavy") == "standard"
    assert resolve_model("balanced", "heavy", ["openai", "anthropic"]) == ("openai", "gpt-4o")


def test_economy_is_cheap_for_both_weights():
    assert resolve_model("economy", "heavy", ["openai"]) == ("openai", "gpt-4o-mini")
    assert resolve_model("economy", "light", ["openai"]) == ("openai", "gpt-4o-mini")


def test_max_tier_tops_out_at_standard_without_a_premium_feature():
    assert band_for("max", "heavy") == "standard"
    assert resolve_model("max", "heavy", ["openai", "anthropic"]) == ("openai", "gpt-4o")


def test_openai_is_preferred_when_both_providers_available():
    assert resolve_model("balanced", "heavy", ["openai", "anthropic"])[0] == "openai"


def test_falls_back_to_anthropic_when_openai_key_is_missing():
    assert resolve_model("balanced", "heavy", ["anthropic"]) == ("anthropic", "claude-sonnet-5")


def test_unknown_tier_defaults_to_balanced():
    assert band_for("bogus", "heavy") == "standard"


def test_no_providers_raises():
    with pytest.raises(ValueError):
        resolve_model("balanced", "light", [])


def test_premium_feature_reaches_premium_only_for_an_entitled_org():
    entitled = resolve_model("balanced", "heavy", ["openai", "anthropic"],
                             feature="editorial_polish", org=_org())
    assert entitled == ("anthropic", "claude-opus-5")


def test_premium_feature_is_capped_for_an_unentitled_org():
    for org in (_org(PlanTier.STARTER, True), _org(PlanTier.PRO, False), None):
        assert resolve_model("balanced", "heavy", ["openai", "anthropic"],
                             feature="editorial_polish", org=org) == ("openai", "gpt-4o")


def test_feature_policy_overrides_the_tier_band():
    """A cheap feature stays cheap even on the max tier."""
    assert resolve_model("max", "heavy", ["openai"], feature="alt_text") == ("openai", "gpt-4o-mini")


def test_unregistered_feature_routes_cheap():
    assert resolve_model("max", "heavy", ["openai"], feature="brand-new-thing") == ("openai", "gpt-4o-mini")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_agents_tiers.py -q`
Expected: FAIL with `ImportError: cannot import name 'band_for'`

- [ ] **Step 3: Rewrite `tiers.py`**

Replace the contents of `apps/api/app/services/agents/tiers.py`:

```python
"""Resolve (provider, model) from the org's agent tier, a skill's weight, and
the feature's policy.

Bands, not model ids: the concrete model comes from model_catalog, so swapping a
supplier is a data change. Premium is never reachable from agent_tier alone --
it needs a needs_premium feature AND an entitled org (see core.entitlements).
That is what keeps expensive models off by default.
"""
from app.core.entitlements import cap_band
from app.services.agents.policy import policy_for
from app.services.providers.catalog import resolve_band

# tier -> weight -> band
_TIERS: dict[str, dict[str, str]] = {
    "economy": {"light": "cheap", "heavy": "cheap"},
    "balanced": {"light": "cheap", "heavy": "standard"},
    "max": {"light": "standard", "heavy": "standard"},
}


def band_for(tier: str, weight: str) -> str:
    return _TIERS.get(tier, _TIERS["balanced"]).get(weight, "standard")


def resolve_model(tier: str, weight: str, available: list[str], *,
                  feature: str | None = None, org=None,
                  needs: dict | None = None) -> tuple[str, str]:
    """Return (provider, model). `feature` applies the policy band; `org` allows
    a needs_premium feature to reach premium when the org is entitled."""
    if not available:
        raise ValueError("No LLM provider keys available.")
    policy = policy_for(feature)
    band = policy.band if feature is not None else band_for(tier, weight)
    if policy.needs_premium:
        band = "premium"
    band = cap_band(band, org)
    return resolve_band(band, available, needs)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_agents_tiers.py -q`
Expected: 11 passed

- [ ] **Step 5: Repoint the duplicate catalogue in the employee runtime**

`apps/api/app/employees/runtime/models.py` holds its own hardcoded `CATALOGUE` used by `is_allowed()` and `for_action()`. Two catalogues drift; make it read the one source. Replace the body of `is_allowed` (line 104):

```python
def is_allowed(provider: str, model_id: str, keys: dict) -> bool:
    """Only a catalogued model on a configured provider may be chosen."""
    if provider not in keys:
        return False
    from app.services.providers import catalog
    return (provider, model_id) in catalog.known_models()
```

Leave `CATALOGUE` in place only if other code still reads it; check with `grep -rn "CATALOGUE" apps/api/app` and delete it if `is_allowed` was its only consumer.

- [ ] **Step 6: Run the agent and employee suites**

Run: `cd apps/api && python -m pytest tests/test_agents_tiers.py tests/test_agents_runner.py tests/test_agents_director.py tests/test_agents_reviewer.py tests/test_agents_standalone.py tests/test_ai_router.py -q`
Expected: all pass. If a test asserts an Opus model id, it is asserting the bug — update it to the band-resolved model and note why in the commit.

- [ ] **Step 7: Run the whole suite for routing fallout**

Run: `cd apps/api && python -m pytest -q`
Expected: no new failures versus the pre-task baseline. Record the baseline first with `git stash && python -m pytest -q | tail -3 && git stash pop` if unsure.

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/services/agents/tiers.py apps/api/app/employees/runtime/models.py \
        apps/api/tests/test_agents_tiers.py
git commit -m "feat(routing): resolve models by band, stop defaulting heavy work to Opus"
```

---

### Task 6: Output caps and the `feature` argument on `call_llm`

**Files:**
- Modify: `apps/api/app/services/llm_service.py:75-107`
- Test: `apps/api/tests/test_llm_output_caps.py`

**Interfaces:**
- Consumes: `policy.policy_for` (Task 3).
- Produces: `call_llm(..., max_tokens: int | None = None, feature: str | None = None, meter: dict | None = None)`. When `max_tokens` is None and `feature` is given, the cap comes from the policy; when both are absent it stays `DEFAULT_MAX_TOKENS`. An explicit `max_tokens` always wins.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_llm_output_caps.py`:

```python
import pytest

from app.services import llm_service
from app.services.llm_service import DEFAULT_MAX_TOKENS, LLMUsage


@pytest.fixture
def captured(monkeypatch):
    seen = {}

    async def fake_call_llm_usage(provider, model, api_key, system_prompt, user_prompt,
                                  locale="en", max_tokens=DEFAULT_MAX_TOKENS):
        seen["max_tokens"] = max_tokens
        return "ok", LLMUsage(provider, model)

    monkeypatch.setattr(llm_service, "call_llm_usage", fake_call_llm_usage)
    return seen


async def test_feature_policy_supplies_the_cap(captured):
    await llm_service.call_llm("openai", "gpt-4o-mini", "k", "sys", "usr",
                               feature="meta_description")
    assert captured["max_tokens"] == 256


async def test_explicit_max_tokens_wins_over_the_policy(captured):
    await llm_service.call_llm("openai", "gpt-4o-mini", "k", "sys", "usr",
                               feature="meta_description", max_tokens=4096)
    assert captured["max_tokens"] == 4096


async def test_no_feature_keeps_the_default(captured):
    await llm_service.call_llm("openai", "gpt-4o-mini", "k", "sys", "usr")
    assert captured["max_tokens"] == DEFAULT_MAX_TOKENS


async def test_unknown_feature_gets_the_conservative_default_cap(captured):
    await llm_service.call_llm("openai", "gpt-4o-mini", "k", "sys", "usr",
                               feature="not-registered")
    assert captured["max_tokens"] == 1024
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_llm_output_caps.py -q`
Expected: FAIL — `call_llm() got an unexpected keyword argument 'feature'`

- [ ] **Step 3: Implement**

In `apps/api/app/services/llm_service.py`, replace the `call_llm` signature and opening lines (lines 79-98):

```python
async def call_llm(
    provider: str,
    model: str,
    api_key: str,
    system_prompt: str,
    user_prompt: str,
    locale: str | None = "en",
    max_tokens: int | None = None,
    meter: dict | None = None,
    feature: str | None = None,
) -> str:
    """Call the named provider and return the raw text response.

    ``locale`` is the project's language code; when non-English a directive is
    appended to the system prompt so the agent answers in that language.

    ``feature`` names the calling feature. It supplies the output-token ceiling
    from the routing policy when the caller passes no explicit ``max_tokens``
    (output costs ~5x input, so an unbounded cap is a direct margin leak), and
    it is the key the usage meter reports against.

    When `meter` is given ({'db','org_id','project_id','feature'}), record
    token usage/cost after the call. Metering failures never break the call.
    """
    if max_tokens is None:
        from app.services.agents.policy import policy_for
        max_tokens = policy_for(feature).max_output_tokens if feature else DEFAULT_MAX_TOKENS
    text, usage = await call_llm_usage(provider, model, api_key, system_prompt,
                                       user_prompt, locale=locale, max_tokens=max_tokens)
    if meter is not None:
        try:
            from app.services.metering import meter as _m
            await _m.record_llm(meter["db"], org_id=meter["org_id"],
                                project_id=meter.get("project_id"),
                                usage=usage, feature=meter.get("feature") or feature)
        except Exception:
            logger.exception("usage metering failed (non-fatal)")
    return text
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_llm_output_caps.py -q`
Expected: 4 passed

- [ ] **Step 5: Audit the call sites for oversized literals**

Run: `cd apps/api && grep -rn "max_tokens" app/services app/employees app/api/v1/routers | grep -v "policy.py" | grep -v "llm_service.py"`

For each hit, replace a hardcoded `max_tokens=NNNN` with a `feature="..."` argument whose policy cap matches the intent, using the keys already in `FEATURE_POLICY`. Two rules: (1) never raise an existing cap, (2) if no policy key fits the call, add one to `FEATURE_POLICY` in the same commit rather than passing a literal. Leave `runtime/models.py`'s `8192 if weight == "heavy" else 2048` alone — that is the Strands model config, not a `call_llm` argument.

- [ ] **Step 6: Run the full suite**

Run: `cd apps/api && python -m pytest -q`
Expected: no new failures

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/services/llm_service.py apps/api/app/services apps/api/app/employees \
        apps/api/app/api/v1/routers apps/api/tests/test_llm_output_caps.py
git commit -m "feat(routing): per-feature output token ceilings on call_llm"
```

---

### Task 7: Prompt caching

**Files:**
- Modify: `apps/api/app/services/llm_service.py:143-156` (`_anthropic_usage`), `110-121` (`_call_anthropic`)
- Test: `apps/api/tests/test_prompt_caching.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `llm_service._anthropic_system_blocks(system_prompt: str) -> list[dict] | str` — returns cache-marked system blocks when the prefix is long enough to be cacheable, otherwise the plain string.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_prompt_caching.py`:

```python
from app.services.llm_service import CACHEABLE_MIN_CHARS, _anthropic_system_blocks


def test_short_system_prompt_is_left_alone():
    """Below the cacheable threshold a cache_control block only adds overhead."""
    assert _anthropic_system_blocks("be brief") == "be brief"


def test_long_system_prompt_is_marked_ephemeral():
    prompt = "x" * (CACHEABLE_MIN_CHARS + 1)
    blocks = _anthropic_system_blocks(prompt)
    assert isinstance(blocks, list)
    assert blocks[0]["type"] == "text"
    assert blocks[0]["text"] == prompt
    assert blocks[0]["cache_control"] == {"type": "ephemeral"}


def test_empty_prompt_is_left_alone():
    assert _anthropic_system_blocks("") == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_prompt_caching.py -q`
Expected: FAIL with `ImportError: cannot import name '_anthropic_system_blocks'`

- [ ] **Step 3: Implement**

In `apps/api/app/services/llm_service.py`, add near `DEFAULT_MAX_TOKENS` (line 75):

```python
# Anthropic bills a cache write at ~1.25x and a cache read at ~0.1x, so marking
# a short prefix costs more than it saves. This threshold is a conservative
# character-count proxy for the provider's minimum cacheable prompt length.
CACHEABLE_MIN_CHARS = 4000


def _anthropic_system_blocks(system_prompt: str):
    """Mark a long, stable system prefix as cacheable. Anything shorter is sent
    unchanged. OpenAI needs no equivalent: its caching is automatic once the
    stable content leads the prompt."""
    if len(system_prompt) < CACHEABLE_MIN_CHARS:
        return system_prompt
    return [{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}]
```

In `_anthropic_usage` (line 143), change the `system=` argument:

```python
        model=model, max_tokens=max_tokens, system=_anthropic_system_blocks(system_prompt),
```

Do the same in `_call_anthropic` (line 113).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_prompt_caching.py -q`
Expected: 3 passed

- [ ] **Step 5: Verify the language directive is appended after the cacheable prefix**

`call_llm_usage` (line 163) does `system_prompt = system_prompt + language_directive(locale)`. A per-locale suffix on the end of the system prompt breaks the cache for every locale variant. Move the directive to the front of the *user* prompt instead so the system prefix stays byte-identical across locales:

```python
    directive = language_directive(locale)
    if directive:
        user_prompt = directive.strip() + "\n\n" + user_prompt
```

Replace the existing `system_prompt = system_prompt + language_directive(locale)` line with the above.

- [ ] **Step 6: Run the locale-sensitive tests**

Run: `cd apps/api && python -m pytest -q -k "locale or language or llm"`
Expected: all pass. If a test asserts the directive is in the system prompt, update it — the behaviour it asserts is the cache-breaking one.

- [ ] **Step 7: Run the full suite and commit**

Run: `cd apps/api && python -m pytest -q`

```bash
git add apps/api/app/services/llm_service.py apps/api/tests/test_prompt_caching.py
git commit -m "feat(routing): cache stable Anthropic system prefixes, keep locale out of them"
```

---

### Task 8: Cheap-first cascade with a programmatic validator

**Files:**
- Create: `apps/api/app/services/agents/cascade.py`
- Test: `apps/api/tests/test_cascade.py`

**Interfaces:**
- Consumes: `policy.policy_for` (Task 3), `tiers.resolve_model` (Task 5), `llm_service.call_llm` (Task 6), `catalog.BANDS` (Task 2).
- Produces:
  - `cascade.validators.non_empty(text: str) -> bool`
  - `cascade.validators.json_object(required: tuple[str, ...] = ()) -> Callable[[str], bool]`
  - `cascade.validators.max_chars(limit: int) -> Callable[[str], bool]`
  - `await cascade.call_with_cascade(*, keys, feature, system_prompt, user_prompt, tier="balanced", weight="light", locale="en", org=None, validate=None, meter=None) -> str`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_cascade.py`:

```python
import json

import pytest

from app.services.agents import cascade
from app.services.agents.cascade import validators


def test_non_empty_rejects_blank():
    assert validators.non_empty("hi") is True
    assert validators.non_empty("   ") is False


def test_json_object_requires_parseable_json_with_keys():
    check = validators.json_object(("title", "slug"))
    assert check(json.dumps({"title": "a", "slug": "b"})) is True
    assert check(json.dumps({"title": "a"})) is False
    assert check("not json at all") is False


def test_json_object_tolerates_a_fenced_block():
    check = validators.json_object(("title",))
    assert check('```json\n{"title": "a"}\n```') is True


def test_max_chars_rejects_overrun():
    assert validators.max_chars(5)("abc") is True
    assert validators.max_chars(5)("abcdef") is False


@pytest.fixture
def spy(monkeypatch):
    """Returns (calls, replies). Push canned responses onto `replies`; each
    call_llm pops the next one and records what it was asked to run."""
    calls: list[dict] = []
    replies: list[str] = []

    async def fake_call_llm(provider, model, api_key, system_prompt, user_prompt,
                            locale="en", max_tokens=None, meter=None, feature=None):
        calls.append({"provider": provider, "model": model, "feature": feature,
                      "meter": meter})
        return replies.pop(0)

    monkeypatch.setattr(cascade, "call_llm", fake_call_llm)
    return calls, replies


async def test_valid_cheap_output_does_not_escalate(spy):
    calls, replies = spy
    replies.append('{"title": "ok"}')
    out = await cascade.call_with_cascade(
        keys={"openai": "k"}, feature="extraction", system_prompt="s", user_prompt="u",
        validate=validators.json_object(("title",)))
    assert out == '{"title": "ok"}'
    assert len(calls) == 1
    assert calls[0]["model"] == "gpt-4o-mini"


async def test_invalid_output_escalates_exactly_one_band_once(spy):
    calls, replies = spy
    replies.extend(["garbage", '{"title": "ok"}'])
    out = await cascade.call_with_cascade(
        keys={"openai": "k"}, feature="extraction", system_prompt="s", user_prompt="u",
        validate=validators.json_object(("title",)))
    assert out == '{"title": "ok"}'
    assert [c["model"] for c in calls] == ["gpt-4o-mini", "gpt-4o"]


async def test_both_attempts_are_metered(spy):
    """The ledger must show the true cost of a cascade, not just the winner."""
    calls, replies = spy
    replies.extend(["garbage", '{"title": "ok"}'])
    sentinel = {"db": None, "org_id": None}
    await cascade.call_with_cascade(
        keys={"openai": "k"}, feature="extraction", system_prompt="s", user_prompt="u",
        meter=sentinel, validate=validators.json_object(("title",)))
    assert [c["meter"] for c in calls] == [sentinel, sentinel]


async def test_second_failure_returns_the_retry_output_rather_than_raising(spy):
    """A cascade is a cost optimisation, not a correctness gate: the caller's own
    parsing still decides what to do with a bad response."""
    calls, replies = spy
    replies.extend(["garbage", "still garbage"])
    out = await cascade.call_with_cascade(
        keys={"openai": "k"}, feature="extraction", system_prompt="s", user_prompt="u",
        validate=validators.json_object(("title",)))
    assert out == "still garbage"
    assert len(calls) == 2


async def test_no_retry_when_escalation_resolves_to_the_same_model(spy):
    """editorial_polish sits on standard and its premium escalation is capped
    back to standard for an unentitled org -- re-running the identical model
    would burn a call for nothing."""
    calls, replies = spy
    replies.append("garbage")
    out = await cascade.call_with_cascade(
        keys={"anthropic": "k"}, feature="editorial_polish", system_prompt="s",
        user_prompt="u", org=None, validate=validators.json_object(("title",)))
    assert out == "garbage"
    assert len(calls) == 1


async def test_no_keys_raises(spy):
    with pytest.raises(ValueError):
        await cascade.call_with_cascade(keys={}, feature="extraction",
                                        system_prompt="s", user_prompt="u")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_cascade.py -q`
Expected: FAIL with `ImportError: cannot import name 'cascade'`

- [ ] **Step 3: Implement**

Create `apps/api/app/services/agents/cascade.py`:

```python
"""Cheap-first generation with a programmatic validator.

Run the policy band, check the output with code, and escalate exactly one band
with one retry when it fails. No LLM judge: cheap models fail on format, not on
taste, and a judge would cost a call on every generation to catch what parsing
already catches for free (spec 3.4.3 technique #2).
"""
import json
import logging
import re
from typing import Callable

from app.core.entitlements import cap_band
from app.services.agents.policy import policy_for
from app.services.agents.tiers import resolve_model
from app.services.llm_service import call_llm
from app.services.providers.catalog import BANDS, resolve_band

logger = logging.getLogger(__name__)

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")


class validators:
    """Objective checks only -- the failure mode of a cheap model is broken
    format, not weak prose."""

    @staticmethod
    def non_empty(text: str) -> bool:
        return bool(text and text.strip())

    @staticmethod
    def json_object(required: tuple[str, ...] = ()) -> Callable[[str], bool]:
        def check(text: str) -> bool:
            try:
                data = json.loads(_FENCE.sub("", text or ""))
            except (ValueError, TypeError):
                return False
            if not isinstance(data, dict):
                return False
            return all(key in data for key in required)
        return check

    @staticmethod
    def max_chars(limit: int) -> Callable[[str], bool]:
        def check(text: str) -> bool:
            return len(text or "") <= limit
        return check


def _next_band(band: str) -> str | None:
    i = BANDS.index(band) if band in BANDS else 0
    return BANDS[i + 1] if i + 1 < len(BANDS) else None


async def call_with_cascade(*, keys: dict[str, str], feature: str, system_prompt: str,
                            user_prompt: str, tier: str = "balanced", weight: str = "light",
                            locale: str | None = "en", org=None,
                            validate: Callable[[str], bool] | None = None,
                            meter: dict | None = None) -> str:
    """Generate at the policy band, escalate one band on a validation failure.

    Returns the last response either way -- the caller's own parsing decides
    what a still-bad response means. Both attempts are metered separately, so
    the ledger shows the true cost of a cascade.
    """
    available = list(keys)
    if not available:
        raise ValueError("No LLM provider keys available.")
    check = validate or validators.non_empty
    policy = policy_for(feature)

    provider, model = resolve_model(tier, weight, available, feature=feature, org=org)
    text = await call_llm(provider, model, keys[provider], system_prompt, user_prompt,
                          locale=locale, meter=meter, feature=feature)
    if check(text):
        return text

    higher = _next_band(policy.band)
    if higher is None:
        return text
    up_provider, up_model = resolve_band(cap_band(higher, org), available)
    if (up_provider, up_model) == (provider, model):
        # The escalation landed on the same model (entitlement cap, or the band
        # has no distinct row). Re-running it would burn a call for nothing.
        return text
    logger.info("cascade escalating feature=%s from %s:%s to %s:%s",
                feature, provider, model, up_provider, up_model)
    return await call_llm(up_provider, up_model, keys[up_provider], system_prompt,
                          user_prompt, locale=locale, meter=meter, feature=feature)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_cascade.py -q`
Expected: 10 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/cascade.py apps/api/tests/test_cascade.py
git commit -m "feat(routing): cheap-first cascade with programmatic validators"
```

---

### Task 9: Batch-aware metering

**Files:**
- Modify: `apps/api/app/services/llm_service.py:15-22` (`LLMUsage`)
- Modify: `apps/api/app/services/metering/meter.py:46-71` (`record_llm`)
- Create: `apps/api/alembic/versions/k6z7a8b9c0d1_batch_cost_rates.py`
- Test: `apps/api/tests/test_meter_batch_pricing.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `LLMUsage.batch: bool = False`; `record_llm` selects `batch_input_token` / `batch_output_token` / `batch_cache_read_token` when `usage.batch` is true.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_meter_batch_pricing.py`:

```python
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.cost_rate import CostRate
from app.models.usage_event import UsageEvent
from app.services.llm_service import LLMUsage
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


async def _seed(*rows):
    async with Session() as db:
        db.add_all(rows)
        await db.commit()


async def test_batch_usage_is_priced_from_the_batch_units():
    """The 50% batch discount is a rate, not a multiplier hardcoded in the meter,
    so a future discount change stays a data change."""
    await _seed(
        CostRate(provider="openai", unit="input_token", model="gpt-4o", micro_dollars_per_unit=2.5),
        CostRate(provider="openai", unit="output_token", model="gpt-4o", micro_dollars_per_unit=10.0),
        CostRate(provider="openai", unit="cache_read_token", model="gpt-4o", micro_dollars_per_unit=1.25),
        CostRate(provider="openai", unit="batch_input_token", model="gpt-4o", micro_dollars_per_unit=1.25),
        CostRate(provider="openai", unit="batch_output_token", model="gpt-4o", micro_dollars_per_unit=5.0),
        CostRate(provider="openai", unit="batch_cache_read_token", model="gpt-4o", micro_dollars_per_unit=0.625),
    )
    org = uuid.uuid4()
    async with Session() as db:
        usage = LLMUsage("openai", "gpt-4o", input_tokens=1000, output_tokens=100,
                         cache_read_tokens=0, batch=True)
        cost = await meter.record_llm(db, org_id=org, project_id=None, usage=usage)
        # 1000 * 1.25 + 100 * 5.0 = 1250 + 500 = 1750 (half of the interactive 3500)
        assert cost == 1750


async def test_interactive_usage_still_uses_the_plain_units():
    await _seed(
        CostRate(provider="openai", unit="input_token", model="gpt-4o", micro_dollars_per_unit=2.5),
        CostRate(provider="openai", unit="output_token", model="gpt-4o", micro_dollars_per_unit=10.0),
        CostRate(provider="openai", unit="batch_input_token", model="gpt-4o", micro_dollars_per_unit=1.25),
        CostRate(provider="openai", unit="batch_output_token", model="gpt-4o", micro_dollars_per_unit=5.0),
    )
    org = uuid.uuid4()
    async with Session() as db:
        usage = LLMUsage("openai", "gpt-4o", input_tokens=1000, output_tokens=100)
        assert await meter.record_llm(db, org_id=org, project_id=None, usage=usage) == 3500


async def test_batch_openai_cached_tokens_are_still_not_double_charged():
    await _seed(
        CostRate(provider="openai", unit="batch_input_token", model="gpt-4o-mini", micro_dollars_per_unit=0.075),
        CostRate(provider="openai", unit="batch_output_token", model="gpt-4o-mini", micro_dollars_per_unit=0.30),
        CostRate(provider="openai", unit="batch_cache_read_token", model="gpt-4o-mini", micro_dollars_per_unit=0.0375),
    )
    org = uuid.uuid4()
    async with Session() as db:
        usage = LLMUsage("openai", "gpt-4o-mini", input_tokens=1000, output_tokens=0,
                         cache_read_tokens=400, batch=True)
        # non-cached 600 * 0.075 = 45 + cached 400 * 0.0375 = 15 -> 60
        assert await meter.record_llm(db, org_id=org, project_id=None, usage=usage) == 60
        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.input_tokens == 1000  # raw tokens, never reduced


async def test_missing_batch_rate_warns_and_prices_zero(caplog):
    org = uuid.uuid4()
    async with Session() as db:
        usage = LLMUsage("openai", "unpriced-model", input_tokens=100, output_tokens=1, batch=True)
        cost = await meter.record_llm(db, org_id=org, project_id=None, usage=usage)
        assert cost == 0
        assert any("unpriced-model" in r.message for r in caplog.records)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_meter_batch_pricing.py -q`
Expected: FAIL — `LLMUsage.__init__() got an unexpected keyword argument 'batch'`

- [ ] **Step 3: Add the flag and the unit selection**

In `apps/api/app/services/llm_service.py`, add to `LLMUsage` (after `cache_read_tokens`, line 22):

```python
    batch: bool = False  # priced from the batch_* cost_rates units (50% off)
```

In `apps/api/app/services/metering/meter.py`, replace the first four lines of `record_llm` (lines 47-52):

```python
    prefix = "batch_" if usage.batch else ""
    in_rate = await rate(db, usage.provider, f"{prefix}input_token", usage.model)
    out_rate = await rate(db, usage.provider, f"{prefix}output_token", usage.model)
    cache_rate = await rate(db, usage.provider, f"{prefix}cache_read_token", usage.model)
    if in_rate == 0 and usage.input_tokens > 0:
        logger.warning("no cost_rate for provider=%s model=%s unit=%sinput_token; input priced to 0",
                       usage.provider, usage.model, prefix)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_meter_batch_pricing.py tests/test_meter_pricing.py -q`
Expected: all pass

- [ ] **Step 5: Seed the batch rates**

Create `apps/api/alembic/versions/k6z7a8b9c0d1_batch_cost_rates.py`:

```python
"""batch_* cost_rates units at 0.5x for every catalogued model

Revision ID: k6z7a8b9c0d1
Revises: j5y6z7a8b9c0
"""
from alembic import op

revision = "k6z7a8b9c0d1"
down_revision = "j5y6z7a8b9c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Batch is 50% off. Modelling it as its own unit (rather than a multiplier in
    # the meter) keeps the versioned-rate design: a discount change is a data change.
    op.execute("""
        INSERT INTO cost_rates (provider, unit, model, micro_dollars_per_unit) VALUES
          ('openai','batch_input_token','gpt-4o-mini',0.075),
          ('openai','batch_output_token','gpt-4o-mini',0.30),
          ('openai','batch_cache_read_token','gpt-4o-mini',0.0375),
          ('openai','batch_input_token','gpt-4o',1.25),
          ('openai','batch_output_token','gpt-4o',5.0),
          ('openai','batch_cache_read_token','gpt-4o',0.625),
          ('anthropic','batch_input_token','claude-haiku-4-5-20251001',0.5),
          ('anthropic','batch_output_token','claude-haiku-4-5-20251001',2.5),
          ('anthropic','batch_cache_read_token','claude-haiku-4-5-20251001',0.05),
          ('anthropic','batch_input_token','claude-sonnet-5',1.5),
          ('anthropic','batch_output_token','claude-sonnet-5',7.5),
          ('anthropic','batch_cache_read_token','claude-sonnet-5',0.15),
          ('anthropic','batch_input_token','claude-opus-5',2.5),
          ('anthropic','batch_output_token','claude-opus-5',12.5),
          ('anthropic','batch_cache_read_token','claude-opus-5',0.25)
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM cost_rates WHERE unit LIKE 'batch\\_%'")
```

- [ ] **Step 6: Add the catalog/rate invariant test**

Create `apps/api/tests/test_cost_rate_coverage.py`:

```python
"""Guard for the Phase 1a regression: a catalogued model with no cost_rates row
prices to $0 and silently destroys the margin math. Every model in the catalog
seed must have interactive and batch rates in the migrations."""
import pathlib
import re

from app.services.providers.catalog import SEED

VERSIONS = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions"

_ROW = re.compile(r"\(\s*'([a-z]+)'\s*,\s*'([a-z_]+)'\s*,\s*'([^']+)'\s*,\s*([0-9.]+)\s*\)")

REQUIRED_UNITS = (
    "input_token", "output_token", "cache_read_token",
    "batch_input_token", "batch_output_token", "batch_cache_read_token",
)


def _seeded_rates() -> set[tuple[str, str, str]]:
    seeded = set()
    for path in VERSIONS.glob("*.py"):
        text = path.read_text()
        for block in re.findall(r"INSERT INTO cost_rates.*?\"\"\"", text, re.S):
            for provider, unit, model, _value in _ROW.findall(block):
                seeded.add((provider, unit, model))
    return seeded


def test_every_catalogued_model_is_priced_for_every_unit():
    seeded = _seeded_rates()
    missing = [
        (provider, unit, model)
        for _band, provider, model, _priority, _supports in SEED
        for unit in REQUIRED_UNITS
        if (provider, unit, model) not in seeded
    ]
    assert missing == [], f"catalogued models without a cost_rate: {missing}"
```

- [ ] **Step 7: Run the invariant test and the head check**

Run: `cd apps/api && python -m pytest tests/test_cost_rate_coverage.py -q`
Expected: 1 passed. A failure names the exact `(provider, unit, model)` to add to a migration.

Run the head-check command from Task 1 Step 6.
Expected: one head — `k6z7a8b9c0d1_batch_cost_rates.py`

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/services/llm_service.py apps/api/app/services/metering/meter.py \
        apps/api/alembic/versions/k6z7a8b9c0d1_batch_cost_rates.py \
        apps/api/tests/test_meter_batch_pricing.py apps/api/tests/test_cost_rate_coverage.py
git commit -m "feat(billing): price batch usage from batch_* cost_rates units"
```

---

### Task 10: Batch client and scope

**Files:**
- Create: `apps/api/app/services/batch/__init__.py`
- Create: `apps/api/app/services/batch/scope.py`
- Create: `apps/api/app/services/batch/client.py`
- Modify: `apps/api/app/services/llm_service.py:157-172` (`call_llm_usage`)
- Test: `apps/api/tests/test_batch_client.py`

**Interfaces:**
- Consumes: `LLMUsage.batch` (Task 9).
- Produces:
  - `scope.batch_scope()` — context manager turning batch mode on for the current async context.
  - `scope.batch_enabled() -> bool`
  - `await client.run_batched(provider, model, api_key, system_prompt, user_prompt, max_tokens) -> tuple[str, LLMUsage] | None` — `None` means "not eligible or failed; caller falls back to the sync path".

**Design note:** a single-request batch gets the same 50% discount as a large one, so `call_llm_usage` submits and polls inline and keeps its signature. That is a deliberate deviation from the spec's "reconciler job" wording: a submit-then-resume reconciler would require splitting every worker job into two halves, which the inline poll avoids entirely. Update spec §9 to match in this task's commit.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_batch_client.py`:

```python
import pytest

from app.services import llm_service
from app.services.batch import client as batch_client
from app.services.batch.scope import batch_enabled, batch_scope
from app.services.llm_service import LLMUsage


def test_batch_mode_is_off_by_default():
    assert batch_enabled() is False


def test_scope_turns_batch_on_and_restores_it():
    assert batch_enabled() is False
    with batch_scope():
        assert batch_enabled() is True
    assert batch_enabled() is False


def test_nested_scopes_restore_correctly():
    with batch_scope():
        with batch_scope():
            assert batch_enabled() is True
        assert batch_enabled() is True
    assert batch_enabled() is False


async def test_call_llm_usage_ignores_batch_outside_a_scope(monkeypatch):
    called = {"batched": False, "sync": False}

    async def fake_run_batched(*a, **k):
        called["batched"] = True
        return "batched", LLMUsage("openai", "gpt-4o", batch=True)

    async def fake_openai_usage(model, api_key, system_prompt, user_prompt, max_tokens):
        called["sync"] = True
        return "sync", LLMUsage("openai", model)

    monkeypatch.setattr(batch_client, "run_batched", fake_run_batched)
    monkeypatch.setattr(llm_service, "_openai_usage", fake_openai_usage)

    text, usage = await llm_service.call_llm_usage("openai", "gpt-4o", "k", "s", "u")
    assert (text, called["sync"], called["batched"]) == ("sync", True, False)


async def test_call_llm_usage_uses_batch_inside_a_scope(monkeypatch):
    async def fake_run_batched(*a, **k):
        return "batched", LLMUsage("openai", "gpt-4o", input_tokens=5, batch=True)

    monkeypatch.setattr(batch_client, "run_batched", fake_run_batched)
    with batch_scope():
        text, usage = await llm_service.call_llm_usage("openai", "gpt-4o", "k", "s", "u")
    assert text == "batched"
    assert usage.batch is True


async def test_batch_failure_falls_back_to_the_sync_path(monkeypatch):
    """A batch problem must never kill a scheduled job."""
    async def fake_run_batched(*a, **k):
        return None

    async def fake_openai_usage(model, api_key, system_prompt, user_prompt, max_tokens):
        return "sync", LLMUsage("openai", model)

    monkeypatch.setattr(batch_client, "run_batched", fake_run_batched)
    monkeypatch.setattr(llm_service, "_openai_usage", fake_openai_usage)
    with batch_scope():
        text, usage = await llm_service.call_llm_usage("openai", "gpt-4o", "k", "s", "u")
    assert text == "sync"
    assert usage.batch is False


async def test_anthropic_stays_on_the_sync_path_inside_a_scope(monkeypatch):
    """Only the OpenAI batch path is implemented; other providers must not stall."""
    async def fake_anthropic_usage(model, api_key, system_prompt, user_prompt, max_tokens):
        return "sync", LLMUsage("anthropic", model)

    monkeypatch.setattr(llm_service, "_anthropic_usage", fake_anthropic_usage)
    with batch_scope():
        text, usage = await llm_service.call_llm_usage("anthropic", "claude-sonnet-5", "k", "s", "u")
    assert (text, usage.batch) == ("sync", False)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_batch_client.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.batch'`

- [ ] **Step 3: Write the scope**

Create `apps/api/app/services/batch/__init__.py` (empty file).

Create `apps/api/app/services/batch/scope.py`:

```python
"""Batch mode as an async-context flag.

Scheduled work opts in by wrapping its body in batch_scope(); every call_llm
underneath it routes to the 50%-off Batch API without a single service
signature changing. User-triggered runs of the same code path simply never
enter the scope, so they keep their interactive latency.
"""
from contextlib import contextmanager
from contextvars import ContextVar

_batch_mode: ContextVar[bool] = ContextVar("fennex_batch_mode", default=False)


def batch_enabled() -> bool:
    return _batch_mode.get()


@contextmanager
def batch_scope():
    token = _batch_mode.set(True)
    try:
        yield
    finally:
        _batch_mode.reset(token)
```

- [ ] **Step 4: Write the client**

Create `apps/api/app/services/batch/client.py`:

```python
"""OpenAI Batch API submission and inline polling.

A one-request batch earns the same 50% discount as a large one, so this submits
and waits rather than splitting callers into submit/resume halves. Returning
None means "fall back to the interactive path" -- a batch problem must never
kill a scheduled job.
"""
import asyncio
import io
import json
import logging
import time

from openai import AsyncOpenAI

from app.services.llm_service import LLMUsage

logger = logging.getLogger(__name__)

SUPPORTED_PROVIDERS = ("openai",)
POLL_INTERVAL_SECONDS = 20
MAX_WAIT_SECONDS = 6 * 60 * 60  # batches usually settle in minutes; 24h is the SLA
_TERMINAL_BAD = {"failed", "expired", "cancelled", "cancelling"}


async def run_batched(provider: str, model: str, api_key: str, system_prompt: str,
                      user_prompt: str, max_tokens: int) -> tuple[str, LLMUsage] | None:
    if provider not in SUPPORTED_PROVIDERS:
        return None
    try:
        client = AsyncOpenAI(api_key=api_key)
        line = {
            "custom_id": "req-0",
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {
                "model": model,
                "messages": [{"role": "system", "content": system_prompt},
                             {"role": "user", "content": user_prompt}],
                "max_tokens": max_tokens,
            },
        }
        payload = io.BytesIO((json.dumps(line) + "\n").encode())
        payload.name = "batch.jsonl"
        uploaded = await client.files.create(file=payload, purpose="batch")
        batch = await client.batches.create(
            input_file_id=uploaded.id,
            endpoint="/v1/chat/completions",
            completion_window="24h",
        )
        deadline = time.monotonic() + MAX_WAIT_SECONDS
        while batch.status not in ("completed",) and batch.status not in _TERMINAL_BAD:
            if time.monotonic() > deadline:
                logger.warning("batch %s still %s after the wait cap; falling back",
                               batch.id, batch.status)
                return None
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            batch = await client.batches.retrieve(batch.id)
        if batch.status != "completed" or not batch.output_file_id:
            logger.warning("batch %s ended as %s; falling back", batch.id, batch.status)
            return None
        content = await client.files.content(batch.output_file_id)
        raw = content.read() if hasattr(content, "read") else content
        record = json.loads((raw.decode() if isinstance(raw, bytes) else raw).splitlines()[0])
        body = record["response"]["body"]
        text = body["choices"][0]["message"]["content"]
        usage = body.get("usage") or {}
        cached = (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0) or 0
        return text, LLMUsage("openai", model,
                              input_tokens=usage.get("prompt_tokens", 0) or 0,
                              output_tokens=usage.get("completion_tokens", 0) or 0,
                              cache_read_tokens=cached, batch=True)
    except Exception:
        logger.exception("batch call failed; falling back to the interactive path")
        return None
```

- [ ] **Step 5: Route `call_llm_usage` through it**

In `apps/api/app/services/llm_service.py`, inside `call_llm_usage`, after the locale handling and before the provider dispatch:

```python
    from app.services.batch import client as _batch_client
    from app.services.batch.scope import batch_enabled
    if batch_enabled() and provider in _batch_client.SUPPORTED_PROVIDERS:
        result = await _batch_client.run_batched(provider, model, api_key, system_prompt,
                                                 user_prompt, max_tokens)
        if result is not None:
            return result
```

The tests monkeypatch `batch_client.run_batched` on the module, so import the module and call the attribute — do not `from ... import run_batched`.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_batch_client.py -q`
Expected: 7 passed

- [ ] **Step 7: Update the spec to match the inline-poll design**

In `docs/superpowers/specs/2026-07-26-phase1b-cost-first-routing-design.md` §9, replace "A submit/poll client, an arq reconciler job that collects completed batches, and a `batch=True` path on the callers." with:

```markdown
A submit/poll client plus a `batch_scope()` context manager. A one-request batch
earns the same 50% discount as a large one, so the client submits and polls
inline and `call_llm_usage` keeps its signature — no job has to be split into
submit and resume halves. Any batch failure or timeout falls back to the
interactive path, so a batch problem can never kill a scheduled job.
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/services/batch apps/api/app/services/llm_service.py \
        apps/api/tests/test_batch_client.py \
        docs/superpowers/specs/2026-07-26-phase1b-cost-first-routing-design.md
git commit -m "feat(routing): OpenAI Batch API path behind a batch scope"
```

---

### Task 11: Put scheduled jobs on the batch path

**Files:**
- Modify: `apps/api/app/workers/worker.py:54-68` (cron registrations stay; the scope goes in the tasks)
- Modify: `apps/api/app/workers/tasks/digest_tasks.py`, `monitoring_tasks.py`, `backlink_tasks.py`, `autopilot_tasks.py`, `keyword_tasks.py`
- Test: `apps/api/tests/test_batch_scheduled_jobs.py`

**Interfaces:**
- Consumes: `scope.batch_scope` (Task 10).
- Produces: each scheduled entrypoint wraps its body in `batch_scope()`; user-triggered entrypoints do not.

- [ ] **Step 1: Map which entrypoints are cron-only**

Run: `cd apps/api && grep -rn "send_weekly_digests\|run_market_monitor\|run_competitor_monitor\|weekly_backlink_discovery\|run_autopilot_planner\|run_keyword_research" app --include=*.py`

Write down, for each function, whether anything outside `app/workers/worker.py` enqueues or calls it. A function reachable from a router is user-triggered and must NOT get an unconditional scope: give it a `batched: bool = False` parameter instead and have only the cron registration pass `True`.

- [ ] **Step 2: Write the failing test**

Create `apps/api/tests/test_batch_scheduled_jobs.py`:

```python
"""Scheduled work runs on the 50%-off batch path; the same work triggered by a
user stays interactive, because a job that settles tomorrow is not what someone
who clicked 'run' asked for."""
import inspect

from app.workers.tasks import (autopilot_tasks, backlink_tasks, digest_tasks,
                               keyword_tasks, monitoring_tasks)

SCHEDULED = [
    (digest_tasks, "send_weekly_digests"),
    (monitoring_tasks, "run_market_monitor"),
    (monitoring_tasks, "run_competitor_monitor"),
    (backlink_tasks, "weekly_backlink_discovery"),
    (autopilot_tasks, "run_autopilot_planner"),
]


def test_scheduled_entrypoints_enter_a_batch_scope():
    for module, name in SCHEDULED:
        source = inspect.getsource(getattr(module, name))
        assert "batch_scope" in source, f"{name} does not run on the batch path"


def test_user_triggerable_keyword_research_is_not_unconditionally_batched():
    source = inspect.getsource(keyword_tasks.run_keyword_research)
    if "batch_scope" in source:
        assert "batched" in inspect.signature(keyword_tasks.run_keyword_research).parameters, (
            "run_keyword_research is reachable from a router, so batching must be "
            "opt-in per call, not unconditional")
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_batch_scheduled_jobs.py -q`
Expected: FAIL — `send_weekly_digests does not run on the batch path`

- [ ] **Step 4: Wrap the cron-only entrypoints**

For each cron-only function, wrap the existing body:

```python
async def send_weekly_digests(ctx):
    from app.services.batch.scope import batch_scope
    with batch_scope():
        ...  # existing body, indented one level
```

For a function that is also user-triggerable, add the parameter instead:

```python
async def run_keyword_research(ctx, ..., batched: bool = False):
    from contextlib import nullcontext
    from app.services.batch.scope import batch_scope
    with (batch_scope() if batched else nullcontext()):
        ...  # existing body
```

and pass `batched=True` only from the cron registration in `app/workers/worker.py`.

- [ ] **Step 5: Raise the arq job timeout for batched jobs**

A batch settles in minutes to hours, so a batched job outlives arq's default timeout. In `apps/api/app/workers/worker.py`, add to `WorkerSettings`:

```python
    # Batched jobs wait on the provider's batch queue; the client caps its own
    # wait at MAX_WAIT_SECONDS and falls back, so this only has to exceed that.
    job_timeout = 7 * 60 * 60
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_batch_scheduled_jobs.py -q`
Expected: 2 passed

- [ ] **Step 7: Run the worker suites**

Run: `cd apps/api && python -m pytest -q -k "task or worker or digest or monitoring or backlink or autopilot or keyword"`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/workers apps/api/tests/test_batch_scheduled_jobs.py
git commit -m "feat(routing): run scheduled jobs on the batch path"
```

---

### Task 12: Staff-only `model_catalog` admin CRUD

**Files:**
- Create: `apps/api/app/api/v1/routers/model_catalog.py`
- Modify: `apps/api/app/api/v1/__init__.py` (or wherever routers are registered — check how `provider_accounts` is wired)
- Test: `apps/api/tests/test_model_catalog_router.py`

**Interfaces:**
- Consumes: `ModelCatalog` (Task 1), `catalog.refresh_snapshot` / `catalog.invalidate_snapshot` (Task 2).
- Produces: `GET /api/v1/model-catalog`, `POST /api/v1/model-catalog`, `PATCH /api/v1/model-catalog`, `DELETE /api/v1/model-catalog` — all staff-only, all invalidating the snapshot on write.

- [ ] **Step 1: Read the existing pattern**

Run: `cd apps/api && cat app/api/v1/routers/provider_accounts.py && grep -rn "provider_accounts" app/api/v1/__init__.py app/api/v1/router.py 2>/dev/null`

Follow that file's `_require_staff` guard and registration style exactly.

- [ ] **Step 2: Write the failing test**

Create `apps/api/tests/test_model_catalog_router.py`:

```python
import pytest

from app.api.v1.routers import model_catalog as router_module


def test_every_write_route_invalidates_the_snapshot():
    """A stale snapshot would keep routing to the old model after an admin edit."""
    import inspect
    for name in ("create_entry", "update_entry", "delete_entry"):
        source = inspect.getsource(getattr(router_module, name))
        assert "invalidate_snapshot" in source or "refresh_snapshot" in source, name


def test_every_route_is_staff_guarded():
    import inspect
    for name in ("list_entries", "create_entry", "update_entry", "delete_entry"):
        source = inspect.getsource(getattr(router_module, name))
        assert "_require_staff" in source, name


def test_band_is_validated():
    with pytest.raises(Exception):
        router_module._validate_band("not-a-band")
    assert router_module._validate_band("cheap") == "cheap"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_model_catalog_router.py -q`
Expected: FAIL with `ImportError: cannot import name 'model_catalog'`

- [ ] **Step 4: Write the router**

Create `apps/api/app/api/v1/routers/model_catalog.py`:

```python
"""Staff-only CRUD for the band -> model map. Repointing a supplier is a row
change here, not a deploy. Every write invalidates the resolver snapshot."""
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.models.model_catalog import ModelCatalog
from app.services.providers import catalog

router = APIRouter()


def _require_staff(current_user: CurrentUser) -> None:
    admin_emails = {e.lower() for e in (settings.PLATFORM_ADMIN_EMAILS or [])}
    if current_user.email.lower() not in admin_emails:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff only")


def _validate_band(band: str) -> str:
    if band not in catalog.BANDS:
        raise HTTPException(status_code=422,
                            detail=f"band must be one of {', '.join(catalog.BANDS)}")
    return band


class EntryIn(BaseModel):
    band: str
    provider: str
    model: str
    priority: int = 100
    supports: dict = {}
    is_active: bool = True


class EntryPatch(BaseModel):
    band: str
    provider: str
    model: str
    priority: int | None = None
    supports: dict | None = None
    is_active: bool | None = None


def _out(row: ModelCatalog) -> dict:
    return {"band": row.band, "provider": row.provider, "model": row.model,
            "priority": row.priority, "supports": row.supports or {},
            "is_active": row.is_active}


@router.get("")
async def list_entries(current_user: CurrentUser, db: DB) -> list[dict]:
    _require_staff(current_user)
    rows = (await db.execute(select(ModelCatalog).order_by(
        ModelCatalog.band, ModelCatalog.priority))).scalars().all()
    return [_out(r) for r in rows]


@router.post("", status_code=201)
async def create_entry(body: EntryIn, current_user: CurrentUser, db: DB) -> dict:
    _require_staff(current_user)
    _validate_band(body.band)
    row = ModelCatalog(band=body.band, provider=body.provider, model=body.model,
                       priority=body.priority, supports=body.supports,
                       is_active=body.is_active)
    db.add(row)
    await db.commit()
    await catalog.refresh_snapshot(db)
    return _out(row)


@router.patch("")
async def update_entry(body: EntryPatch, current_user: CurrentUser, db: DB) -> dict:
    _require_staff(current_user)
    _validate_band(body.band)
    row = await db.get(ModelCatalog, (body.band, body.provider, body.model))
    if row is None:
        raise HTTPException(status_code=404, detail="Catalog entry not found")
    if body.priority is not None:
        row.priority = body.priority
    if body.supports is not None:
        row.supports = body.supports
    if body.is_active is not None:
        row.is_active = body.is_active
    await db.commit()
    await catalog.refresh_snapshot(db)
    return _out(row)


@router.delete("", status_code=204)
async def delete_entry(band: str, provider: str, model: str,
                       current_user: CurrentUser, db: DB) -> None:
    _require_staff(current_user)
    row = await db.get(ModelCatalog, (band, provider, model))
    if row is not None:
        await db.delete(row)
        await db.commit()
    catalog.invalidate_snapshot()
```

Register it the same way `provider_accounts` is registered, at prefix `/model-catalog` with tag `model-catalog`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_model_catalog_router.py -q`
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/api/v1 apps/api/tests/test_model_catalog_router.py
git commit -m "feat(routing): staff-only model_catalog admin CRUD"
```

---

### Task 13: Settings toggle for premium models

**Files:**
- Modify: `apps/web/lib/api.ts` (add `getOrganization` / `updateOrganization`)
- Modify: `apps/web/app/(dashboard)/settings/page.tsx:322-358` (`OrganizationSection`)
- Modify: `apps/web/public/locales/{en,fr,de,es,pt,ar}/common.json`

**Interfaces:**
- Consumes: `GET/PATCH /organizations/{org_id}` with `premium_models_enabled` and `premium_available` (Task 4).
- Produces: nothing downstream.

- [ ] **Step 1: Add the API client functions**

In `apps/web/lib/api.ts`, next to the other organization functions (around line 1626):

```typescript
export interface Organization {
  id: string;
  slug: string;
  name: string;
  plan_tier: string;
  agent_tier: string;
  premium_models_enabled: boolean;
  premium_available: boolean;
}

export async function getOrganization(orgId: string): Promise<Organization> {
  return apiClient.get<Organization>(`/organizations/${orgId}`);
}

export async function updateOrganization(
  orgId: string,
  body: Partial<Pick<Organization, "name" | "agent_tier" | "premium_models_enabled">>,
): Promise<Organization> {
  return apiClient.patch<Organization>(`/organizations/${orgId}`, body);
}
```

- [ ] **Step 2: Add the translation keys**

Add to `apps/web/public/locales/en/common.json` under the existing `settings.organization` object:

```json
"premiumModels": "Premium models",
"premiumModelsHint": "Allow the highest-capability models for editorial polish. Costs more per generation.",
"premiumModelsLocked": "Available on Pro and above"
```

Add the same three keys to `fr`, `de`, `es`, `pt` and `ar`, translated. Suggested values:

- fr: `"Modeles premium"`, `"Autoriser les modeles les plus performants pour la relecture editoriale. Cout par generation plus eleve."`, `"Disponible a partir du plan Pro"`
- de: `"Premium-Modelle"`, `"Die leistungsstarksten Modelle fur den redaktionellen Feinschliff zulassen. Hohere Kosten pro Generierung."`, `"Ab Pro verfugbar"`
- es: `"Modelos premium"`, `"Permite los modelos mas potentes para el pulido editorial. Mayor coste por generacion."`, `"Disponible en Pro y superiores"`
- pt: `"Modelos premium"`, `"Permite os modelos mais capazes para o polimento editorial. Custo por geracao mais alto."`, `"Disponivel no Pro e acima"`
- ar: `"النماذج المتقدمة"`, `"السماح بأقوى النماذج للتحرير النهائي. تكلفة أعلى لكل عملية إنشاء."`, `"متاح في خطة Pro وما فوق"`

- [ ] **Step 3: Add the toggle to `OrganizationSection`**

In `apps/web/app/(dashboard)/settings/page.tsx`, extend `OrganizationSection` so it loads the org and renders a toggle row inside the existing `<Card>`, after the plan row:

```tsx
  const qc = useQueryClient();
  const org = useQuery({
    queryKey: ["organization", me?.org_id],
    queryFn: () => getOrganization(me!.org_id),
    enabled: !!me?.org_id,
  });
  const setPremium = useMutation({
    mutationFn: (enabled: boolean) => updateOrganization(me!.org_id, { premium_models_enabled: enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["organization", me?.org_id] }),
  });
```

```tsx
          <div className="flex items-start gap-4 py-3.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                {t("settings.organization.premiumModels")}
              </p>
              <p className="text-xs text-muted-foreground">
                {org.data?.premium_available
                  ? t("settings.organization.premiumModelsHint")
                  : t("settings.organization.premiumModelsLocked")}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!!org.data?.premium_models_enabled}
              disabled={!org.data?.premium_available || setPremium.isPending}
              onClick={() => setPremium.mutate(!org.data?.premium_models_enabled)}
              className={cn(
                "mt-1 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40",
                org.data?.premium_models_enabled ? "bg-primary" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "block h-4 w-4 rounded-full bg-background transition-transform",
                  org.data?.premium_models_enabled ? "translate-x-4" : "translate-x-0.5",
                )}
              />
            </button>
          </div>
```

Add `Sparkles` to the existing `lucide-react` import, `getOrganization` / `updateOrganization` to the `lib/api` import, and `useMutation` / `useQueryClient` if the file does not already import them. Use the file's existing `cn` import; if it has none, import it from `@/lib/cn`.

- [ ] **Step 4: Typecheck and lint**

Run: `cd apps/web && npm run typecheck && npm run lint`
Expected: no errors

- [ ] **Step 5: Verify the JSON files parse**

Run: `cd apps/web && for f in public/locales/*/common.json; do node -e "JSON.parse(require('fs').readFileSync('$f'))" || echo "BAD $f"; done`
Expected: no output

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/api.ts "apps/web/app/(dashboard)/settings/page.tsx" apps/web/public/locales
git commit -m "feat(settings): premium models toggle gated on plan"
```

---

### Task 14: Wire the feature vocabulary through the hot paths

**Files:**
- Modify: `apps/api/app/services/discovery_service.py:35`, `apps/api/app/services/discovery/suggest.py`, `apps/api/app/services/discovery/synthesis.py`
- Modify: `apps/api/app/services/agents/runner.py:23`, `apps/api/app/services/agents/director.py:35`, `apps/api/app/services/agents/reviewer.py:19`
- Modify: `apps/api/app/api/v1/routers/articles.py:320-326`, `apps/api/app/services/knowledge_service.py:261-264`
- Test: `apps/api/tests/test_feature_routing_wired.py`

**Interfaces:**
- Consumes: `tiers.resolve_model(..., feature=..., org=...)` (Task 5), `policy.FEATURE_POLICY` (Task 3).
- Produces: nothing downstream. This is the task that makes the policy actually bind.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_feature_routing_wired.py`:

```python
"""The policy map only bites where callers name their feature. These are the
highest-volume paths; a call site without a feature silently falls back to the
tier band and skips its output cap."""
import inspect

from app.services import discovery_service, knowledge_service
from app.services.agents import director, reviewer, runner


def _source(obj) -> str:
    return inspect.getsource(obj)


def test_discovery_names_its_feature():
    assert 'feature="discovery"' in _source(discovery_service)


def test_agent_paths_pass_the_skill_feature_through():
    for module in (runner, director, reviewer):
        source = _source(module)
        assert "feature=" in source, module.__name__


def test_knowledge_service_names_its_feature():
    assert "feature=" in _source(knowledge_service)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_feature_routing_wired.py -q`
Expected: FAIL on the first assertion

- [ ] **Step 3: Thread `feature` through each call site**

For each site, pass the policy key that matches what the call actually does, and pass `org` wherever an `Organization` is already in scope so a `needs_premium` feature can be honoured:

- `discovery_service.py:35` — `resolve_model("balanced", "heavy", list(keys), feature="discovery")`
- `discovery/suggest.py` — `feature="suggest"` on its `call_llm`
- `discovery/synthesis.py:95` — `feature="discovery"`; drop the literal `max_tokens=4000` so the policy cap applies
- `agents/runner.py:23` — `resolve_model(tier, skill.weight, available, feature=getattr(skill, "feature", None))`, and pass the same `feature=` to both `call_llm` calls in that function
- `agents/director.py:35` — `feature="agent_reasoning"`
- `agents/reviewer.py:19` — `feature="agent_reasoning"`
- `routers/articles.py:326` — `feature="article_outline"` (confirm what that call produces first and pick the matching key)
- `knowledge_service.py:264` — `feature="extraction"`

If a skill has no `feature` attribute, add one to the skill spec dataclass defaulting to `None` rather than guessing a key at the call site.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_feature_routing_wired.py -q`
Expected: 3 passed

- [ ] **Step 5: Run the full suite**

Run: `cd apps/api && python -m pytest -q`
Expected: no new failures

- [ ] **Step 6: Commit**

```bash
git add apps/api/app apps/api/tests/test_feature_routing_wired.py
git commit -m "feat(routing): name features at the high-volume LLM call sites"
```

---

### Task 15: Final verification

**Files:** none created; this task only verifies.

- [ ] **Step 1: Full backend suite**

Run: `cd apps/api && python -m pytest -q`
Expected: all pass. Compare the count against the pre-Phase-1b baseline on `main`.

- [ ] **Step 2: Migration chain**

Run the head-check command from Task 1 Step 6.
Expected: exactly one head — `k6z7a8b9c0d1_batch_cost_rates.py`

- [ ] **Step 3: Migrations actually apply**

Run: `make db-migrate`
Expected: no error; the three new revisions apply in order.

- [ ] **Step 4: Confirm the seeded catalog and rates landed**

Run: `docker compose exec -T db psql -U postgres -d fennex -c "SELECT band, provider, model, priority FROM model_catalog ORDER BY band, priority;"`
Expected: the five seeded rows from Task 1.

Run: `docker compose exec -T db psql -U postgres -d fennex -c "SELECT m.provider, m.model, count(c.unit) AS units FROM model_catalog m LEFT JOIN cost_rates c ON c.provider = m.provider AND c.model = m.model GROUP BY 1,2 ORDER BY 1,2;"`
Expected: every row shows 6 units (three interactive, three batch).

Adjust the database name and service name to match `docker-compose.yml` if they differ.

- [ ] **Step 5: Frontend checks**

Run: `cd apps/web && npm run typecheck && npm run lint && npm run build`
Expected: all succeed

- [ ] **Step 6: Confirm the headline behaviour by hand**

Run: `cd apps/api && python -c "
from app.services.agents.tiers import resolve_model
print('balanced/heavy ->', resolve_model('balanced', 'heavy', ['openai', 'anthropic']))
print('max/heavy      ->', resolve_model('max', 'heavy', ['openai', 'anthropic']))
print('alt_text       ->', resolve_model('max', 'heavy', ['openai'], feature='alt_text'))
"`
Expected:
```
balanced/heavy -> ('openai', 'gpt-4o')
max/heavy      -> ('openai', 'gpt-4o')
alt_text       -> ('openai', 'gpt-4o-mini')
```
No Opus anywhere without an entitled org and a `needs_premium` feature.

- [ ] **Step 7: Request review**

Use the `superpowers:requesting-code-review` skill for a whole-branch review before merging. Phase 1a's review caught two real billing bugs on exactly this surface; the highest-risk areas here are the batch rate selection in `meter.record_llm`, the entitlement cap, and the catalog snapshot's staleness window.
