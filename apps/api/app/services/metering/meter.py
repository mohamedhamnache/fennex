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
