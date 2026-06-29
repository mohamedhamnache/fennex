"""Billing router — Checkout, Portal, and Usage endpoints."""
import stripe
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.billing import PLAN_LIMITS, get_billing_usage, _get_org, current_billing_period_start
from app.core.config import settings
from app.core.dependencies import CurrentUser, DB

router = APIRouter()

# Maps (tier, annual) → Stripe price ID from server-side settings.
# Keeps price IDs off the client so no NEXT_PUBLIC_STRIPE_PRICE_* env vars are needed.
_PRICE_MAP: dict[tuple[str, bool], str] = {
    ("starter", False): settings.STRIPE_PRICE_STARTER_MONTHLY,
    ("starter", True):  settings.STRIPE_PRICE_STARTER_ANNUAL,
    ("pro",     False): settings.STRIPE_PRICE_PRO_MONTHLY,
    ("pro",     True):  settings.STRIPE_PRICE_PRO_ANNUAL,
    ("agency",  False): settings.STRIPE_PRICE_AGENCY_MONTHLY,
    ("agency",  True):  settings.STRIPE_PRICE_AGENCY_ANNUAL,
}


# ── Schemas ────────────────────────────────────────────────────────────────────

class CheckoutRequest(BaseModel):
    tier: str
    annual: bool = False
    success_url: str
    cancel_url: str


class PortalRequest(BaseModel):
    return_url: str


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/checkout")
async def create_checkout_session(body: CheckoutRequest, current_user: CurrentUser, db: DB):
    price_id = _PRICE_MAP.get((body.tier, body.annual))
    if not price_id:
        raise HTTPException(status_code=400, detail=f"No Stripe price configured for tier '{body.tier}' (annual={body.annual}).")

    org = await _get_org(current_user, db)

    # Create Stripe customer if first checkout
    if not org.stripe_customer_id:
        customer = stripe.Customer.create(
            email=current_user.email,
            metadata={"org_id": str(org.id)},
        )
        org.stripe_customer_id = customer.id
        await db.commit()

    trial_days = 7 if not org.trial_ends_at else 0

    session = stripe.checkout.Session.create(
        customer=org.stripe_customer_id,
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        trial_period_days=trial_days if trial_days > 0 else None,
        success_url=body.success_url,
        cancel_url=body.cancel_url,
    )
    return {"checkout_url": session.url}


@router.post("/portal")
async def create_portal_session(body: PortalRequest, current_user: CurrentUser, db: DB):
    org = await _get_org(current_user, db)

    if not org.stripe_customer_id:
        raise HTTPException(status_code=400, detail="No active subscription to manage.")

    session = stripe.billing_portal.Session.create(
        customer=org.stripe_customer_id,
        return_url=body.return_url,
    )
    return {"portal_url": session.url}


@router.get("/usage")
async def get_usage(current_user: CurrentUser, db: DB):
    org = await _get_org(current_user, db)
    tier = org.plan_tier if isinstance(org.plan_tier, str) else org.plan_tier.value
    usage = await get_billing_usage(org, db)

    return {
        "plan_tier": tier,
        "trial_ends_at": org.trial_ends_at.isoformat() if org.trial_ends_at else None,
        "period_start": str(current_billing_period_start()),
        "usage": usage,
    }
