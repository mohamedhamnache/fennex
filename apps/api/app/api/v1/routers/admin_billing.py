import calendar
import datetime as dt

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_auth import require_admin
from app.core.billing import PLAN_LIMITS, PLAN_PRICE_USD
from app.core.database import get_db
from app.models.billing import SubscriptionEvent
from app.models.organization import Organization
from app.models.usage_daily import UsageDaily
from app.services.admin.revenue import plan_revenue

# The plans/limits UI only ever needs these four capacity numbers -- see
# app/core/billing.py's PLAN_LIMITS docstring for the full (unenforced) set.
_LIMIT_KEYS = ("projects", "articles", "images", "social")

router = APIRouter(prefix="/admin/billing", tags=["admin-billing"])


def _current_month_bounds() -> tuple[dt.date, dt.date]:
    """Return (first day of this month, first day of next month), inclusive/
    exclusive, so the mtd cost query never needs to worry about month length."""
    today = dt.datetime.now(dt.timezone.utc).date()
    start = today.replace(day=1)
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    end = start + dt.timedelta(days=days_in_month)
    return start, end


@router.get("/kpis")
async def billing_kpis(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin("read")),
):
    revenue = await plan_revenue(db)
    mrr_usd = revenue["mrr_usd"]
    paying_orgs = revenue["paying_orgs"]

    month_start, month_end = _current_month_bounds()
    mtd_cost_micros = (
        await db.execute(
            select(func.coalesce(func.sum(UsageDaily.cost_micros), 0)).where(
                UsageDaily.day >= month_start,
                UsageDaily.day < month_end,
            )
        )
    ).scalar_one()
    mtd_cost_usd = int(mtd_cost_micros) / 1_000_000

    gross_margin_pct = (mrr_usd - mtd_cost_usd) / mrr_usd if mrr_usd > 0 else None
    arpu_usd = mrr_usd / paying_orgs if paying_orgs > 0 else 0.0

    cutoff = dt.datetime.utcnow() - dt.timedelta(days=30)
    failed_payments_30d = (
        await db.execute(
            select(func.count()).select_from(SubscriptionEvent).where(
                SubscriptionEvent.event_type.ilike("%payment_failed%"),
                SubscriptionEvent.processed_at >= cutoff,
            )
        )
    ).scalar_one()

    return {
        "mrr_usd": mrr_usd,
        "arr_usd": mrr_usd * 12,
        "mtd_cost_usd": mtd_cost_usd,
        "gross_margin_pct": gross_margin_pct,
        "arpu_usd": arpu_usd,
        "paying_orgs": paying_orgs,
        "trialing_orgs": revenue["trialing_orgs"],
        "enterprise_orgs": revenue["enterprise_orgs"],
        "failed_payments_30d": int(failed_payments_30d),
        "by_plan": revenue["by_plan"],
    }


@router.get("/plans")
async def billing_plans(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin("read")),
):
    # Paying-org counts and per-plan mrr come from the same helper that backs
    # /admin/billing/kpis (app/services/admin/revenue.py), so this view never
    # disagrees with the KPI dashboard on what "paying" means.
    revenue = await plan_revenue(db)
    paying_by_plan = {row["plan"]: row for row in revenue["by_plan"]}

    org_count_rows = (
        await db.execute(
            select(Organization.plan_tier, func.count()).group_by(Organization.plan_tier)
        )
    ).all()
    org_count_by_plan: dict[str, int] = {}
    for plan_tier, count in org_count_rows:
        plan_value = plan_tier.value if hasattr(plan_tier, "value") else plan_tier
        org_count_by_plan[plan_value] = int(count)

    items = []
    for plan, price_usd in PLAN_PRICE_USD.items():
        limits = PLAN_LIMITS.get(plan, {})
        paying = paying_by_plan.get(plan)
        items.append({
            "plan": plan,
            "price_usd": price_usd,
            "org_count": org_count_by_plan.get(plan, 0),
            "mrr_usd": paying["mrr_usd"] if paying else 0.0,
            "limits": {key: limits.get(key) for key in _LIMIT_KEYS},
        })

    return {"items": items}


def _parse_amount_usd(payload: dict | None) -> float | None:
    """Defensively pull a dollar amount out of a Stripe webhook payload.

    Stripe amounts are integer cents. We check the common invoice keys at the
    top level and, since our stored payloads are the raw webhook body, nested
    under data.object (e.g. data.object.amount_paid). Returns None rather
    than raising when the shape doesn't match -- this is best-effort display
    data, not something the rest of the system depends on.
    """
    if not isinstance(payload, dict):
        return None

    candidates = [payload]
    data = payload.get("data")
    if isinstance(data, dict):
        obj = data.get("object")
        if isinstance(obj, dict):
            candidates.append(obj)

    for source in candidates:
        for key in ("amount_paid", "amount_due"):
            cents = source.get(key)
            if isinstance(cents, (int, float)) and not isinstance(cents, bool):
                return cents / 100

    return None


@router.get("/events")
async def billing_events(
    type: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin("read")),
):
    filters = []
    if type:
        filters.append(SubscriptionEvent.event_type.ilike(f"%{type}%"))

    total_stmt = select(func.count()).select_from(SubscriptionEvent)
    for f in filters:
        total_stmt = total_stmt.where(f)
    total = (await db.execute(total_stmt)).scalar_one()

    stmt = select(SubscriptionEvent)
    for f in filters:
        stmt = stmt.where(f)
    stmt = (
        stmt.order_by(SubscriptionEvent.processed_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = (await db.execute(stmt)).scalars().all()

    return {
        "items": [
            {
                "id": str(row.id),
                "org_id": str(row.org_id) if row.org_id else None,
                "event_type": row.event_type,
                "amount_usd": _parse_amount_usd(row.payload),
                "processed_at": row.processed_at.isoformat(),
            }
            for row in rows
        ],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }
