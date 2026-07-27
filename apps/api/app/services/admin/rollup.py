import datetime as dt

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.usage_daily import UsageDaily
from app.models.usage_event import UsageEvent


def _day_bounds(day: dt.date) -> tuple[dt.datetime, dt.datetime]:
    start = dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc)
    return start, start + dt.timedelta(days=1)


async def rollup_usage_daily(db: AsyncSession, day: dt.date) -> int:
    """Aggregate usage_events for `day` into usage_daily. Idempotent: clears
    that day's usage_daily rows first, then re-inserts the aggregation, so
    re-running never double-counts. Groups by (org_id, provider, model,
    kind-as-unit); unit is the event's kind ('llm'|'seo') so the rollup stays
    simple for the executive dashboard -- per-token-unit splits come later."""
    start, end = _day_bounds(day)

    await db.execute(delete(UsageDaily).where(UsageDaily.day == day))

    rows = (
        await db.execute(
            select(
                UsageEvent.org_id,
                UsageEvent.provider,
                # Group by the raw model column and coalesce NULL -> "" in Python
                # below. Coalescing here would emit two separate bind params (one
                # in SELECT, one in GROUP BY), which Postgres rejects as a
                # non-grouped column; SQLite is lenient so tests never caught it.
                UsageEvent.model.label("model"),
                UsageEvent.kind.label("unit"),
                func.count().label("requests"),
                func.coalesce(func.sum(UsageEvent.input_tokens), 0).label("input_tokens"),
                func.coalesce(func.sum(UsageEvent.output_tokens), 0).label("output_tokens"),
                func.coalesce(func.sum(UsageEvent.cache_read_tokens), 0).label("cache_read_tokens"),
                func.coalesce(func.sum(UsageEvent.seo_count), 0).label("seo_count"),
                func.coalesce(func.sum(UsageEvent.cost_micros), 0).label("cost_micros"),
            )
            .where(UsageEvent.ts >= start, UsageEvent.ts < end)
            .group_by(
                UsageEvent.org_id,
                UsageEvent.provider,
                UsageEvent.model,
                UsageEvent.kind,
            )
        )
    ).all()

    for r in rows:
        db.add(
            UsageDaily(
                day=day,
                org_id=r.org_id,
                provider=r.provider or "",
                model=r.model or "",
                unit=r.unit or "",
                requests=r.requests,
                input_tokens=r.input_tokens,
                output_tokens=r.output_tokens,
                cache_read_tokens=r.cache_read_tokens,
                seo_count=r.seo_count,
                cost_micros=r.cost_micros,
            )
        )

    await db.commit()
    return len(rows)


async def rollup_daily_job(ctx) -> None:
    """arq entry point: rolls up yesterday and today using a fresh session,
    so a job that ticks over midnight still finalizes the prior day."""
    from app.core.database import async_session_factory

    today = dt.datetime.now(dt.timezone.utc).date()
    async with async_session_factory() as db:
        for day in (today - dt.timedelta(days=1), today):
            await rollup_usage_daily(db, day)
