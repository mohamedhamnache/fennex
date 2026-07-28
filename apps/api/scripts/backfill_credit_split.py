"""One-off backfill: split existing usage_events into the org_usage credit
columns (ai_cost_micros, ai_credits_used, seo_credits_used).

Why: those columns default to 0. Orgs metered before this split (or before
the min-credits floor) shipped have real usage_events but zero/stale values
in these columns, so their credit balance would read empty (unspent) or
wrong until their next metered event recomputes it -- wrong for anyone
checking balance today. This script recomputes all three columns from the
ledger (the source of truth) for a given billing period and upserts them
into org_usage, without touching the pre-existing cost_micros/*_used
columns.

ai_credits_used is summed PER EVENT, not from the org's total cost: the
Replicate pricing floor (app.core.credits.replicate_operation_credits)
applies per prediction, so flooring an org's summed total instead would
under-count every org with more than one cheap Replicate call. LLM/image
events are never floored -- only kind == "edit" (Replicate) is.

Usage:
    python -m scripts.backfill_credit_split               # current period
    python -m scripts.backfill_credit_split 2026-07-01     # specific period
"""
import asyncio
import calendar
import datetime as dt
import logging
import sys
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.credits import AI_KINDS, credits_from_micros, replicate_operation_credits, seo_credits_for
from app.core.database import async_session_factory
from app.core.billing import current_billing_period_start
from app.models.billing import OrgUsage
from app.models.usage_event import UsageEvent

logger = logging.getLogger(__name__)


def _next_month(period_start: dt.date) -> dt.date:
    days_in_month = calendar.monthrange(period_start.year, period_start.month)[1]
    return period_start + dt.timedelta(days=days_in_month)


async def backfill_credit_split(db: AsyncSession, period_start: dt.date) -> int:
    """Recompute ai_cost_micros, ai_credits_used, and seo_credits_used from
    usage_events for every org active in `[period_start, next month)`,
    upserting into that org's org_usage row for the period. Returns the
    number of orgs updated."""
    period_end = _next_month(period_start)

    ai_event_rows = (await db.execute(
        select(UsageEvent.org_id, UsageEvent.kind, UsageEvent.cost_micros)
        .where(
            UsageEvent.ts >= period_start,
            UsageEvent.ts < period_end,
            UsageEvent.kind.in_(AI_KINDS),
        )
    )).all()
    ai_cost_by_org: dict[uuid.UUID, int] = {}
    ai_credits_by_org: dict[uuid.UUID, int] = {}
    for org_id, kind, cost_micros in ai_event_rows:
        cost_micros = int(cost_micros or 0)
        ai_cost_by_org[org_id] = ai_cost_by_org.get(org_id, 0) + cost_micros
        # Only Replicate ("edit") predictions get the pricing floor.
        credits = (replicate_operation_credits(cost_micros) if kind == "edit"
                  else credits_from_micros(cost_micros))
        ai_credits_by_org[org_id] = ai_credits_by_org.get(org_id, 0) + credits

    seo_event_rows = (await db.execute(
        select(UsageEvent.org_id, UsageEvent.seo_unit, UsageEvent.seo_count)
        .where(
            UsageEvent.ts >= period_start,
            UsageEvent.ts < period_end,
            UsageEvent.kind == "seo",
        )
    )).all()
    seo_credits_by_org: dict[uuid.UUID, int] = {}
    for org_id, seo_unit, seo_count in seo_event_rows:
        seo_credits_by_org[org_id] = seo_credits_by_org.get(org_id, 0) + seo_credits_for(seo_unit, seo_count)

    org_ids = set(ai_cost_by_org) | set(seo_credits_by_org)
    updated = 0
    for org_id in org_ids:
        row = (await db.execute(
            select(OrgUsage).where(OrgUsage.org_id == org_id, OrgUsage.period_start == period_start)
        )).scalar_one_or_none()
        if row is None:
            row = OrgUsage(org_id=org_id, period_start=period_start)
            db.add(row)
        row.ai_cost_micros = ai_cost_by_org.get(org_id, 0)
        row.ai_credits_used = ai_credits_by_org.get(org_id, 0)
        row.seo_credits_used = seo_credits_by_org.get(org_id, 0)
        updated += 1

    await db.commit()
    return updated


async def _main() -> None:
    if len(sys.argv) > 1:
        period_start = dt.date.fromisoformat(sys.argv[1])
    else:
        period_start = current_billing_period_start()
    async with async_session_factory() as db:
        updated = await backfill_credit_split(db, period_start)
    print(f"backfill_credit_split: period_start={period_start} orgs_updated={updated}")


if __name__ == "__main__":
    asyncio.run(_main())
