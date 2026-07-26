from fastapi import APIRouter
from sqlalchemy import select
from app.core.dependencies import CurrentUser, DB
from app.core.billing import current_billing_period_start
from app.models.billing import OrgUsage

router = APIRouter()


@router.get("/summary")
async def usage_summary(current_user: CurrentUser, db: DB) -> dict:
    period = current_billing_period_start()
    row = (await db.execute(select(OrgUsage).where(
        OrgUsage.org_id == current_user.org_id, OrgUsage.period_start == period
    ))).scalar_one_or_none()
    cost_micros = int(getattr(row, "cost_micros", 0) or 0)
    return {
        "period_start": period.isoformat(),
        "ai_input_tokens": int(getattr(row, "ai_input_tokens", 0) or 0),
        "ai_output_tokens": int(getattr(row, "ai_output_tokens", 0) or 0),
        "ai_requests": int(getattr(row, "ai_requests", 0) or 0),
        "seo_serp": int(getattr(row, "seo_serp", 0) or 0),
        "seo_keyword_analyses": int(getattr(row, "seo_keyword_analyses", 0) or 0),
        "cost_micros": cost_micros,
        "cost_usd": round(cost_micros / 1_000_000, 4),
    }
