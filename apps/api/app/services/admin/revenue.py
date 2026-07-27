"""Plan-tier MRR estimate for the admin console. Reused by /admin/billing/kpis
and /admin/overview/kpis so the two dashboards never disagree on a number."""
import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.billing import PLAN_PRICE_USD
from app.models.organization import Organization, PlanTier

# Tiers that represent a paid subscription. "free" never counts toward MRR
# even if a stripe_subscription_id is somehow present.
_PAID_TIERS = (
    PlanTier.STARTER,
    PlanTier.PRO,
    PlanTier.AGENCY,
    PlanTier.SCALE,
    PlanTier.ENTERPRISE,
)


def _tier_value(plan_tier) -> str:
    return plan_tier.value if hasattr(plan_tier, "value") else plan_tier


async def plan_revenue(db: AsyncSession) -> dict:
    """Estimate MRR from each org's plan-tier list price (app/core/billing.py's
    PLAN_PRICE_USD).

    A **paying** org is on a paid tier, has an active `stripe_subscription_id`,
    and is not suspended -- suspended-but-still-subscribed orgs contribute $0,
    matching the reality that we are not collecting from them right now.

    A **trialing** org has a future `trial_ends_at` and no subscription yet.

    Grouped queries only (no per-org N+1): one GROUP BY for the paying/by_plan
    breakdown, one COUNT for trialing, one COUNT for enterprise-tier orgs.
    """
    now = dt.datetime.utcnow()  # naive UTC -- matches how trial_ends_at is stored.

    paying_rows = (
        await db.execute(
            select(Organization.plan_tier, func.count().label("orgs"))
            .where(
                Organization.plan_tier.in_(_PAID_TIERS),
                Organization.stripe_subscription_id.is_not(None),
                Organization.suspended_at.is_(None),
            )
            .group_by(Organization.plan_tier)
        )
    ).all()

    by_plan: list[dict] = []
    mrr_usd = 0.0
    paying_orgs = 0
    for plan_tier, orgs in paying_rows:
        plan_value = _tier_value(plan_tier)
        price = PLAN_PRICE_USD.get(plan_value, 0)
        plan_mrr = float(price * orgs)
        mrr_usd += plan_mrr
        paying_orgs += int(orgs)
        by_plan.append({"plan": plan_value, "orgs": int(orgs), "mrr_usd": plan_mrr})

    trialing_orgs = (
        await db.execute(
            select(func.count()).select_from(Organization).where(
                Organization.trial_ends_at.is_not(None),
                Organization.trial_ends_at > now,
                Organization.stripe_subscription_id.is_(None),
            )
        )
    ).scalar_one()

    enterprise_orgs = (
        await db.execute(
            select(func.count())
            .select_from(Organization)
            .where(Organization.plan_tier == PlanTier.ENTERPRISE)
        )
    ).scalar_one()

    return {
        "mrr_usd": float(mrr_usd),
        "paying_orgs": int(paying_orgs),
        "trialing_orgs": int(trialing_orgs),
        "enterprise_orgs": int(enterprise_orgs),
        "by_plan": by_plan,
    }
