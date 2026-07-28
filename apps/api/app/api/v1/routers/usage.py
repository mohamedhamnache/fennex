from fastapi import APIRouter
from sqlalchemy import select
from app.core.dependencies import CurrentUser, DB
from app.core.billing import current_billing_period_start, _get_org
from app.core.credits import credit_allowance, seo_credit_allowance
from app.models.billing import OrgUsage

router = APIRouter()


@router.get("/summary")
async def usage_summary(current_user: CurrentUser, db: DB) -> dict:
    period = current_billing_period_start()
    row = (await db.execute(select(OrgUsage).where(
        OrgUsage.org_id == current_user.org_id, OrgUsage.period_start == period
    ))).scalar_one_or_none()
    cost_micros = int(getattr(row, "cost_micros", 0) or 0)
    # AI credits are a COUNTER (ai_credits_used) accumulated per operation at
    # meter time -- with the Replicate pricing floor baked in -- not derived
    # from ai_cost_micros. ai_cost_micros stays the true, unfloored supplier
    # cost and feeds COGS/margin reporting instead.
    org = await _get_org(current_user, db)
    plan_tier = getattr(getattr(org, "plan_tier", None), "value", None) or str(
        getattr(org, "plan_tier", "free")
    )
    allowance = credit_allowance(plan_tier)
    used = int(getattr(row, "ai_credits_used", 0) or 0)
    seo_allowance = seo_credit_allowance(plan_tier)
    seo_used = int(getattr(row, "seo_credits_used", 0) or 0)
    return {
        "period_start": period.isoformat(),
        "credits_used": used,
        "credits_allowance": allowance,
        "credits_remaining": max(0, allowance - used),
        "seo_credits_used": seo_used,
        "seo_credits_allowance": seo_allowance,
        "seo_credits_remaining": max(0, seo_allowance - seo_used),
        "ai_input_tokens": int(getattr(row, "ai_input_tokens", 0) or 0),
        "ai_output_tokens": int(getattr(row, "ai_output_tokens", 0) or 0),
        "ai_requests": int(getattr(row, "ai_requests", 0) or 0),
        "seo_serp": int(getattr(row, "seo_serp", 0) or 0),
        "seo_keyword_analyses": int(getattr(row, "seo_keyword_analyses", 0) or 0),
        "cost_micros": cost_micros,
        "cost_usd": round(cost_micros / 1_000_000, 4),
    }
