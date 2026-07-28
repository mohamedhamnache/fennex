"""Price provider usage from cost_rates, append it to the usage_events ledger,
and roll it into the current org_usage period. All money is micro-dollars."""
import logging
import uuid

from sqlalchemy import select

from app.core.billing import current_billing_period_start
from app.core.credits import credits_from_micros, replicate_operation_credits, seo_credits_for
from app.models.billing import OrgUsage
from app.models.cost_rate import CostRate
from app.models.usage_event import UsageEvent
from app.services.llm_service import LLMUsage

logger = logging.getLogger(__name__)


async def rate(db, provider: str, unit: str, model: str = "") -> float:
    row = (await db.execute(
        select(CostRate.micro_dollars_per_unit).where(
            CostRate.provider == provider, CostRate.unit == unit, CostRate.model == (model or "")
        ).order_by(CostRate.effective_from.desc()).limit(1)
    )).scalar_one_or_none()
    return float(row) if row is not None else 0.0


async def _bump_org_usage(db, org_id, **increments) -> None:
    """Portable (SQLite + Postgres) select-then-increment-or-insert of the
    current-period rollup. This rollup update shares a single db.commit() with
    the caller's UsageEvent insert, so it is best-effort, not independently
    durable: under a rare concurrent first-insert unique-violation race (on
    org_id+period_start) the whole transaction rolls back, dropping the
    ledger row too. Full hardening (a separate transaction, or an upsert) is
    deferred."""
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
    prefix = "batch_" if usage.batch else ""
    in_rate = await rate(db, usage.provider, f"{prefix}input_token", usage.model)
    out_rate = await rate(db, usage.provider, f"{prefix}output_token", usage.model)
    cache_rate = await rate(db, usage.provider, f"{prefix}cache_read_token", usage.model)
    if in_rate == 0 and usage.input_tokens > 0:
        logger.warning("no cost_rate for provider=%s model=%s unit=%sinput_token; input priced to 0",
                       usage.provider, usage.model, prefix)

    cache_write_rate = 0.0
    if usage.cache_write_tokens > 0:
        cache_write_rate = await rate(db, usage.provider, f"{prefix}cache_write_token", usage.model)
        if cache_write_rate == 0:
            logger.warning("no cost_rate for provider=%s model=%s unit=%scache_write_token; "
                           "cache-write tokens priced to 0",
                           usage.provider, usage.model, prefix)

    billable_input = usage.input_tokens
    if usage.provider == "openai":
        # OpenAI prompt_tokens already includes the cached subset; bill only the
        # non-cached remainder at the input rate (cached billed at cache_rate below).
        billable_input = max(0, usage.input_tokens - usage.cache_read_tokens)
    cost = round(billable_input * in_rate
                 + usage.output_tokens * out_rate
                 + usage.cache_read_tokens * cache_rate
                 + usage.cache_write_tokens * cache_write_rate)
    db.add(UsageEvent(
        org_id=org_id, project_id=project_id, kind="llm", provider=usage.provider,
        model=usage.model, feature=feature, input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens, cache_read_tokens=usage.cache_read_tokens,
        cache_write_tokens=usage.cache_write_tokens,
        cost_micros=cost,
    ))
    await _bump_org_usage(db, org_id, ai_input_tokens=usage.input_tokens,
                          ai_output_tokens=usage.output_tokens, ai_requests=1, cost_micros=cost,
                          ai_cost_micros=cost, ai_credits_used=credits_from_micros(cost))
    await db.commit()
    return cost


async def record_image(db, *, org_id: uuid.UUID, project_id, model: str,
                       cost_usd: float, feature: str | None = None) -> int:
    """Price an image generation from the cost the image service already
    computed -- it knows the size/quality that was actually billed."""
    cost = round(cost_usd * 1_000_000)
    db.add(UsageEvent(
        org_id=org_id, project_id=project_id, kind="image", provider="openai",
        model=model, feature=feature, cost_micros=cost,
    ))
    await _bump_org_usage(db, org_id, cost_micros=cost, ai_cost_micros=cost,
                          ai_credits_used=credits_from_micros(cost))
    await db.commit()
    return cost


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
    # cost_micros/ai_cost_micros stay the TRUE unfloored cost; only the
    # credit counter gets the Replicate pricing floor.
    await _bump_org_usage(db, org_id, cost_micros=cost, ai_cost_micros=cost,
                          ai_credits_used=replicate_operation_credits(cost))
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
    increments = {"cost_micros": cost, "seo_credits_used": seo_credits_for(unit, count)}
    col = _SEO_COLUMN.get(unit)
    if col:
        increments[col] = count
    await _bump_org_usage(db, org_id, **increments)
    await db.commit()
    return cost
