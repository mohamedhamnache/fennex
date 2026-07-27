import datetime as dt
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_auth import require_admin
from app.core.database import get_db
from app.models.organization import Organization
from app.models.usage_daily import UsageDaily
from app.models.user import User
from app.services.admin.revenue import plan_revenue

router = APIRouter(prefix="/admin/overview", tags=["admin-overview"])

RangeStr = Literal["24h", "7d", "30d", "90d"]

_RANGE_DAYS: dict[str, int] = {"24h": 0, "7d": 6, "30d": 29, "90d": 89}


def _range_start(range_: str) -> dt.date:
    """Map a range token to the first `UsageDaily.day` it should include
    (inclusive), counting back from today. Unknown values fall back to 30d."""
    days_back = _RANGE_DAYS.get(range_, _RANGE_DAYS["30d"])
    return dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=days_back)


@router.get("/kpis")
async def kpis(
    range: RangeStr = Query("30d"),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin("read")),
):
    start = _range_start(range)

    usage_row = (
        await db.execute(
            select(
                func.coalesce(func.sum(UsageDaily.cost_micros), 0).label("cost_micros"),
                func.coalesce(func.sum(UsageDaily.input_tokens), 0).label("ai_input_tokens"),
                func.coalesce(func.sum(UsageDaily.output_tokens), 0).label("ai_output_tokens"),
                func.coalesce(func.sum(UsageDaily.requests), 0).label("ai_requests"),
                func.coalesce(func.sum(UsageDaily.seo_count), 0).label("seo_count"),
                func.count(func.distinct(UsageDaily.org_id)).label("active_orgs"),
            ).where(UsageDaily.day >= start)
        )
    ).one()

    total_orgs = (
        await db.execute(select(func.count()).select_from(Organization))
    ).scalar_one()
    total_users = (
        await db.execute(select(func.count()).select_from(User))
    ).scalar_one()

    cost_micros = int(usage_row.cost_micros)
    cost_usd = cost_micros / 1_000_000

    # MRR: estimated from each paying org's plan-tier list price (see
    # app/services/admin/revenue.py, reused by /admin/billing/kpis so the two
    # dashboards never disagree). margin_pct is undefined (None) when there is
    # no MRR to compare cost against.
    mrr_usd = (await plan_revenue(db))["mrr_usd"]
    margin_pct = (mrr_usd - cost_usd) / mrr_usd if mrr_usd > 0 else None

    return {
        "total_orgs": int(total_orgs),
        "active_orgs": int(usage_row.active_orgs),
        "total_users": int(total_users),
        "cost_micros": cost_micros,
        "cost_usd": cost_usd,
        "ai_input_tokens": int(usage_row.ai_input_tokens),
        "ai_output_tokens": int(usage_row.ai_output_tokens),
        "ai_requests": int(usage_row.ai_requests),
        "seo_count": int(usage_row.seo_count),
        "mrr_usd": mrr_usd,
        "margin_pct": margin_pct,
    }


_METRIC_COLUMNS = {
    "cost": UsageDaily.cost_micros,
    "requests": UsageDaily.requests,
}


@router.get("/series")
async def series(
    metric: Literal["cost", "tokens", "requests"] = Query("cost"),
    range: RangeStr = Query("30d"),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin("read")),
):
    start = _range_start(range)

    if metric == "tokens":
        value_col = func.coalesce(
            func.sum(UsageDaily.input_tokens + UsageDaily.output_tokens), 0
        )
    else:
        value_col = func.coalesce(func.sum(_METRIC_COLUMNS[metric]), 0)

    rows = (
        await db.execute(
            select(UsageDaily.day, value_col.label("value"))
            .where(UsageDaily.day >= start)
            .group_by(UsageDaily.day)
            .order_by(UsageDaily.day)
        )
    ).all()

    return {
        "points": [
            {"day": row.day.isoformat(), "value": int(row.value)} for row in rows
        ]
    }
