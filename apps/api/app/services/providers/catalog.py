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


def rows() -> list[tuple[str, str, str]]:
    """Every (band, provider, model) currently catalogued. Read-only, for
    callers that need more than known_models()'s flat membership set -- e.g.
    a model picker's display grouping, or an entitlement check against a
    model's highest band (a model may be catalogued under more than one)."""
    return [(band, provider, model) for band, provider, model, *_rest in _rows()]


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
