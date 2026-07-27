import datetime as dt
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_auth import require_admin
from app.core.database import get_db
from app.models.model_catalog import ModelCatalog
from app.models.organization import Organization
from app.models.provider_account import ProviderAccount
from app.models.usage_daily import UsageDaily
from app.models.usage_event import UsageEvent

router = APIRouter(prefix="/admin", tags=["admin-analytics"])

_USAGE_METRICS = {"cost", "tokens", "requests", "seo"}
_USAGE_GROUP_BY = {"provider", "model", "org", "unit"}

RangeStr = Literal["24h", "7d", "30d", "90d"]

# Mirrors app/api/v1/routers/admin_overview.py::_range_start so both admin
# dashboards agree on what "last 30d" etc. means.
_RANGE_DAYS: dict[str, int] = {"24h": 0, "7d": 6, "30d": 29, "90d": 89}


def _range_start(range_: str) -> dt.date:
    """Map a range token to the first `UsageDaily.day` it should include
    (inclusive), counting back from today. Unknown values fall back to 30d."""
    days_back = _RANGE_DAYS.get(range_, _RANGE_DAYS["30d"])
    return dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=days_back)


def _month_start() -> dt.date:
    """First day of the current month, for month-to-date rollups -- always
    computed independently of the `range` query param."""
    return dt.datetime.now(dt.timezone.utc).date().replace(day=1)


def _range_start_ts(range_: str) -> dt.datetime:
    """Same window as `_range_start`, but as a tz-aware midnight datetime --
    for filtering `usage_events.ts` (a timestamp column) rather than
    `usage_daily.day` (a date column)."""
    return dt.datetime.combine(_range_start(range_), dt.time.min, tzinfo=dt.timezone.utc)


@router.get("/analytics/providers")
async def providers_analytics(
    range: RangeStr = Query("30d"),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin("read")),
):
    start = _range_start(range)
    month_start = _month_start()

    usage_rows = (
        await db.execute(
            select(
                UsageDaily.provider,
                func.coalesce(func.sum(UsageDaily.requests), 0).label("requests"),
                func.coalesce(func.sum(UsageDaily.input_tokens), 0).label("input_tokens"),
                func.coalesce(func.sum(UsageDaily.output_tokens), 0).label("output_tokens"),
                func.coalesce(func.sum(UsageDaily.cost_micros), 0).label("cost_micros"),
            )
            .where(UsageDaily.day >= start)
            .group_by(UsageDaily.provider)
        )
    ).all()
    usage_by_provider = {row.provider: row for row in usage_rows}

    # Month-to-date is a separate rollup -- NOT the `range` window -- so a
    # 90d range and a 2026-07-27 "today" both agree on what MTD means.
    mtd_rows = (
        await db.execute(
            select(
                UsageDaily.provider,
                func.coalesce(func.sum(UsageDaily.cost_micros), 0).label("cost_micros"),
            )
            .where(UsageDaily.day >= month_start)
            .group_by(UsageDaily.provider)
        )
    ).all()
    mtd_cost_micros_by_provider = {row.provider: int(row.cost_micros) for row in mtd_rows}

    # provider_accounts is a small admin-configuration table -- fetching it
    # whole and grouping in Python avoids a fragile "pick one row" SQL
    # aggregation while still being a single query (no N+1 per provider).
    account_rows = (await db.execute(select(ProviderAccount))).scalars().all()
    accounts_by_provider: dict[str, list[ProviderAccount]] = {}
    for acc in account_rows:
        accounts_by_provider.setdefault(acc.provider, []).append(acc)

    model_count_rows = (
        await db.execute(
            select(ModelCatalog.provider, func.count().label("count")).group_by(
                ModelCatalog.provider
            )
        )
    ).all()
    model_count_by_provider = {row.provider: int(row.count) for row in model_count_rows}

    # LEFT-combine: a provider may show up in usage but have no
    # provider_account (unconfigured), or be configured with no usage yet
    # (zeros) -- union both sets so neither is dropped.
    all_providers = set(usage_by_provider) | set(accounts_by_provider)

    items = []
    total_requests = 0
    total_cost_micros = 0
    for provider in sorted(all_providers):
        usage = usage_by_provider.get(provider)
        accounts = accounts_by_provider.get(provider, [])

        requests = int(usage.requests) if usage else 0
        input_tokens = int(usage.input_tokens) if usage else 0
        output_tokens = int(usage.output_tokens) if usage else 0
        cost_micros = int(usage.cost_micros) if usage else 0
        mtd_cost_micros = mtd_cost_micros_by_provider.get(provider, 0)

        is_configured = len(accounts) > 0
        is_active = any(a.is_active for a in accounts)
        kind = accounts[0].kind if accounts else "llm"
        budget_cents = next(
            (a.monthly_budget_cents for a in accounts if a.monthly_budget_cents is not None),
            None,
        )
        monthly_budget_usd = budget_cents / 100 if budget_cents is not None else None

        total_requests += requests
        total_cost_micros += cost_micros

        items.append(
            {
                "provider": provider,
                "kind": kind,
                "is_configured": is_configured,
                "is_active": is_active,
                "requests": requests,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_micros": cost_micros,
                "cost_usd": cost_micros / 1_000_000,
                "model_count": model_count_by_provider.get(provider, 0),
                "monthly_budget_usd": monthly_budget_usd,
                "mtd_cost_usd": mtd_cost_micros / 1_000_000,
            }
        )

    return {
        "items": items,
        "totals": {
            "requests": total_requests,
            "cost_usd": total_cost_micros / 1_000_000,
        },
    }


@router.get("/analytics/models")
async def models_analytics(
    range: RangeStr = Query("30d"),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin("read")),
):
    start = _range_start(range)

    rows = (
        await db.execute(
            select(
                UsageDaily.provider,
                UsageDaily.model,
                func.coalesce(func.sum(UsageDaily.requests), 0).label("requests"),
                func.coalesce(func.sum(UsageDaily.input_tokens), 0).label("input_tokens"),
                func.coalesce(func.sum(UsageDaily.output_tokens), 0).label("output_tokens"),
                func.coalesce(func.sum(UsageDaily.cost_micros), 0).label("cost_micros"),
            )
            .where(
                UsageDaily.day >= start,
                UsageDaily.unit == "llm",
                UsageDaily.model != "",
            )
            .group_by(UsageDaily.provider, UsageDaily.model)
        )
    ).all()

    catalog_rows = (await db.execute(select(ModelCatalog))).scalars().all()
    band_by_key = {(c.provider, c.model): c.band for c in catalog_rows}

    items = []
    for row in rows:
        input_tokens = int(row.input_tokens)
        output_tokens = int(row.output_tokens)
        cost_micros = int(row.cost_micros)
        cost_usd = cost_micros / 1_000_000
        total_tokens = input_tokens + output_tokens
        cost_per_1k_tokens = cost_usd / (total_tokens / 1000) if total_tokens > 0 else 0.0

        items.append(
            {
                "provider": row.provider,
                "model": row.model,
                "band": band_by_key.get((row.provider, row.model)),
                "requests": int(row.requests),
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cost_micros": cost_micros,
                "cost_usd": cost_usd,
                "cost_per_1k_tokens": cost_per_1k_tokens,
            }
        )

    items.sort(key=lambda i: i["cost_usd"], reverse=True)

    cheapest_row = (
        await db.execute(
            select(ModelCatalog)
            .where(ModelCatalog.band == "cheap", ModelCatalog.is_active.is_(True))
            .order_by(ModelCatalog.priority.asc())
            .limit(1)
        )
    ).scalar_one_or_none()

    cheapest = (
        {"provider": cheapest_row.provider, "model": cheapest_row.model}
        if cheapest_row
        else None
    )

    return {"items": items, "cheapest": cheapest}


@router.get("/analytics/seo")
async def seo_analytics(
    range: RangeStr = Query("30d"),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin("read")),
):
    """DataForSEO cost/volume dashboard: sourced from `usage_events` (kind='seo')
    rather than `usage_daily`, since the daily rollup collapses seo_unit
    (serp/keyword_ideas) into a single 'seo' unit -- the per-unit split this
    endpoint needs only exists on the raw event ledger."""
    start_ts = _range_start_ts(range)
    seo_filter = (UsageEvent.kind == "seo", UsageEvent.ts >= start_ts)

    totals = (
        await db.execute(
            select(
                func.count(UsageEvent.id).label("total_requests"),
                func.coalesce(func.sum(UsageEvent.seo_count), 0).label("total_seo_count"),
                func.coalesce(func.sum(UsageEvent.cost_micros), 0).label("cost_micros"),
            ).where(*seo_filter)
        )
    ).one()

    unit_rows = (
        await db.execute(
            select(
                UsageEvent.seo_unit,
                func.coalesce(func.sum(UsageEvent.seo_count), 0).label("count"),
                func.coalesce(func.sum(UsageEvent.cost_micros), 0).label("cost_micros"),
            )
            .where(*seo_filter)
            .group_by(UsageEvent.seo_unit)
        )
    ).all()
    by_unit = [
        {
            "unit": row.seo_unit,
            "count": int(row.count),
            "cost_usd": int(row.cost_micros) / 1_000_000,
        }
        for row in unit_rows
    ]

    consumer_rows = (
        await db.execute(
            select(
                UsageEvent.org_id,
                Organization.name.label("org_name"),
                func.coalesce(func.sum(UsageEvent.seo_count), 0).label("seo_count"),
                func.coalesce(func.sum(UsageEvent.cost_micros), 0).label("cost_micros"),
            )
            .join(Organization, Organization.id == UsageEvent.org_id)
            .where(*seo_filter)
            .group_by(UsageEvent.org_id, Organization.name)
            .order_by(func.sum(UsageEvent.cost_micros).desc())
            .limit(10)
        )
    ).all()
    top_consumers = [
        {
            "org_id": str(row.org_id),
            "org_name": row.org_name,
            "seo_count": int(row.seo_count),
            "cost_usd": int(row.cost_micros) / 1_000_000,
        }
        for row in consumer_rows
    ]

    cost_micros = int(totals.cost_micros)
    return {
        "total_requests": int(totals.total_requests),
        "total_seo_count": int(totals.total_seo_count),
        "cost_micros": cost_micros,
        "cost_usd": cost_micros / 1_000_000,
        "by_unit": by_unit,
        "top_consumers": top_consumers,
    }


@router.get("/analytics/usage")
async def usage_explorer(
    metric: str = Query("cost"),
    group_by: str = Query("provider"),
    range: RangeStr = Query("30d"),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin("read")),
):
    """Free-form usage explorer over `usage_daily`: pick a metric (cost,
    tokens, requests, seo) and a grouping dimension (provider, model, org,
    unit), get both a breakdown and a daily trend line."""
    if metric not in _USAGE_METRICS:
        raise HTTPException(status_code=422, detail=f"invalid metric: {metric!r}")
    if group_by not in _USAGE_GROUP_BY:
        raise HTTPException(status_code=422, detail=f"invalid group_by: {group_by!r}")

    start = _range_start(range)

    if metric == "cost":
        value_expr = func.coalesce(func.sum(UsageDaily.cost_micros), 0) / 1_000_000.0
    elif metric == "tokens":
        value_expr = func.coalesce(func.sum(UsageDaily.input_tokens), 0) + func.coalesce(
            func.sum(UsageDaily.output_tokens), 0
        )
    elif metric == "requests":
        value_expr = func.coalesce(func.sum(UsageDaily.requests), 0)
    else:  # seo
        value_expr = func.coalesce(func.sum(UsageDaily.seo_count), 0)

    group_columns = {
        "provider": UsageDaily.provider,
        "model": UsageDaily.model,
        "org": UsageDaily.org_id,
        "unit": UsageDaily.unit,
    }
    group_col = group_columns[group_by]

    if group_by == "org":
        rows = (
            await db.execute(
                select(
                    UsageDaily.org_id,
                    Organization.name.label("org_name"),
                    value_expr.label("value"),
                )
                .outerjoin(Organization, Organization.id == UsageDaily.org_id)
                .where(UsageDaily.day >= start)
                .group_by(UsageDaily.org_id, Organization.name)
            )
        ).all()
        groups = [
            {
                "key": str(row.org_id),
                "label": row.org_name or str(row.org_id),
                "value": float(row.value),
            }
            for row in rows
        ]
    else:
        rows = (
            await db.execute(
                select(group_col.label("key"), value_expr.label("value"))
                .where(UsageDaily.day >= start)
                .group_by(group_col)
            )
        ).all()
        groups = [{"key": row.key, "label": row.key, "value": float(row.value)} for row in rows]

    groups.sort(key=lambda g: g["value"], reverse=True)

    series_rows = (
        await db.execute(
            select(UsageDaily.day.label("day"), value_expr.label("value"))
            .where(UsageDaily.day >= start)
            .group_by(UsageDaily.day)
            .order_by(UsageDaily.day.asc())
        )
    ).all()
    series = [{"day": row.day.isoformat(), "value": float(row.value)} for row in series_rows]

    return {"groups": groups, "series": series}
