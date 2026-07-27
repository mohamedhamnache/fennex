import calendar
import datetime as dt

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_auth import require_admin
from app.core.database import get_db
from app.models.billing import SubscriptionEvent
from app.models.usage_daily import UsageDaily
from app.services.admin.revenue import plan_revenue

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
