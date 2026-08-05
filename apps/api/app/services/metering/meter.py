"""Price provider usage from cost_rates, append it to the usage_events ledger,
and roll it into the current org_usage period. All money is micro-dollars."""
import logging
import uuid

from sqlalchemy import select

from app.core.billing import current_billing_period_start
from app.core.credits import (
    credits_from_micros, feature_min_credits, replicate_operation_credits, seo_credits_for,
)
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
    # Billed credits may exceed the cost-derived amount where the feature
    # carries a pricing floor. The floor is keyed off `feature`, so it holds on
    # the ambient metering path too -- no call site has to remember to ask for
    # it. Anchored on tokens rather than on cost so a missing cost_rate row
    # under-bills nothing: an unrated model prices to 0 (logged above), and
    # without this the floored feature would silently become free.
    billed_credits = credits_from_micros(cost)
    if usage.input_tokens > 0 or usage.output_tokens > 0:
        billed_credits = max(feature_min_credits(feature), billed_credits)
    # cost/ai_cost_micros stay the TRUE unfloored supplier cost -- COGS and
    # margin reporting read them, and a markup must never look like cost.
    await _bump_org_usage(db, org_id, ai_input_tokens=usage.input_tokens,
                          ai_output_tokens=usage.output_tokens, ai_requests=1, cost_micros=cost,
                          ai_cost_micros=cost, ai_credits_used=billed_credits)
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
                           feature: str | None = None,
                           predict_seconds: float | None = None,
                           image_count: int | None = None) -> int:
    """Price one Replicate prediction.

    Replicate bills community models by GPU-second, and its prediction
    response reports the real `metrics.predict_time`. When we have that, cost
    is `seconds x per-second rate` -- so a draft/2K run genuinely costs less
    than an ultra/8K one instead of every configuration billing the same flat
    fee. Falls back to the per-run rate (then the generic default) when the
    duration is unavailable, which keeps every existing caller unchanged.
    """
    cost: int | None = None

    # PER-IMAGE FIRST. Replicate bills its OFFICIAL image models per output
    # image, not per GPU-second (its pricing page: FLUX Pro at $0.04/image), and
    # reports `metrics.image_output_count` for them. Pricing those by duration
    # is not merely imprecise, it is the wrong axis: google/nano-banana runs in
    # ~5s, so the per-second path would bill ~$0.0075 for an edit costing
    # several times that -- an invisible margin loss on every call. A model only
    # takes this branch when an explicit replicate/image rate exists for it, so
    # per-second models are untouched.
    if image_count and image_count > 0:
        per_image = await rate(db, "replicate", "image", model)
        if per_image:
            cost = round(image_count * per_image)
        else:
            # Replicate only reports image_output_count for models it bills PER
            # IMAGE, so reaching here means an official image model is priced on
            # the wrong axis and is almost certainly undercharging: nano-banana
            # billed 11 credits by duration against 38 per image. That is a
            # margin leak with no symptom -- the edit succeeds and the number is
            # merely too small -- so say so loudly rather than let it pass.
            logger.warning(
                "replicate model %s reports image_output_count=%s but has no "
                "replicate/image cost rate; falling back to duration pricing, "
                "which undercharges per-image models. Seed a rate for it.",
                model, image_count,
            )

    if cost is None and predict_seconds and predict_seconds > 0:
        per_second = await rate(db, "replicate", "second", model)
        if not per_second:
            per_second = await rate(db, "replicate", "second", "")
        if per_second:
            cost = round(predict_seconds * per_second)

    if cost is None:
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
                     provider: str = "dataforseo", feature: str | None = None,
                     bill_credits: bool = True) -> int:
    """`bill_credits=False` still writes the UsageEvent and still bumps
    cost_micros (and the per-unit _SEO_COLUMN counter) so COGS/margin
    reporting stays complete -- it just skips the seo_credits_used increment,
    so background/cron work can never trip the enforced credit bucket that
    only user-initiated calls draw from. Default True keeps every existing
    caller unchanged."""
    cost = round(count * await rate(db, provider, unit, ""))
    db.add(UsageEvent(
        org_id=org_id, project_id=project_id, kind="seo", provider=provider,
        feature=feature, seo_unit=unit, seo_count=count, cost_micros=cost,
    ))
    increments = {"cost_micros": cost}
    if bill_credits:
        increments["seo_credits_used"] = seo_credits_for(unit, count)
    col = _SEO_COLUMN.get(unit)
    if col:
        increments[col] = count
    await _bump_org_usage(db, org_id, **increments)
    await db.commit()
    return cost
