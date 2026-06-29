import json
from datetime import datetime

import stripe
from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.billing import PLAN_LIMITS
from app.core.config import settings
from app.core.dependencies import DB
from app.models.billing import SubscriptionEvent
from app.models.brand_voice import BrandVoice
from app.models.organization import Organization, PlanTier
from app.models.project import Project
from app.models.user import User

router = APIRouter()

# Map from Stripe price lookup_key → PlanTier value
# Set lookup_keys on Stripe prices to match these strings.
PRICE_TO_TIER: dict[str, str] = {
    "starter_monthly": "starter",
    "starter_annual": "starter",
    "pro_monthly": "pro",
    "pro_annual": "pro",
    "agency_monthly": "agency",
    "agency_annual": "agency",
}

TIER_ORDER = ["free", "starter", "pro", "agency"]


async def _get_org_by_customer(customer_id: str, db) -> Organization | None:
    result = await db.execute(
        select(Organization).where(Organization.stripe_customer_id == customer_id)
    )
    return result.scalar_one_or_none()


async def _record_event(event_id: str, event_type: str, payload: dict, db) -> bool:
    """
    Insert a SubscriptionEvent row for idempotency.
    Returns True if this is a new event, False if it's a duplicate (IntegrityError).
    """
    try:
        db.add(SubscriptionEvent(
            stripe_event_id=event_id,
            event_type=event_type,
            payload=payload,
        ))
        await db.flush()
        return True
    except IntegrityError:
        await db.rollback()
        return False


async def _handle_downgrade(org: Organization, new_tier: str, db) -> None:
    """Lock excess projects, brand_voices, and users when downgrading."""
    limits = PLAN_LIMITS.get(new_tier, PLAN_LIMITS["free"])

    # Projects — oldest kept (ORDER BY created_at ASC), newest locked
    if limits["projects"] != -1:
        result = await db.execute(
            select(Project)
            .where(Project.org_id == org.id)
            .order_by(Project.created_at.asc())
        )
        projects = result.scalars().all()
        for p in projects[limits["projects"]:]:
            p.locked = True
            p.locked_reason = "downgrade"

    # Brand voices — oldest kept, newest locked
    if limits["brand_voices"] != -1:
        result = await db.execute(
            select(BrandVoice)
            .where(BrandVoice.org_id == org.id)
            .order_by(BrandVoice.created_at.asc())
        )
        voices = result.scalars().all()
        for v in voices[limits["brand_voices"]:]:
            v.locked = True
            v.locked_reason = "downgrade"

    # Users — owner kept first (role == "owner"), then by created_at asc; owner never locked
    if limits["seats"] != -1:
        result = await db.execute(
            select(User)
            .where(User.org_id == org.id, User.is_active == True)  # noqa: E712
            .order_by(User.role.desc(), User.created_at.asc())
        )
        members = result.scalars().all()
        for m in members[limits["seats"]:]:
            m.locked = True
            m.locked_reason = "downgrade"

    org.plan_locked_at = datetime.utcnow()


async def _unlock_for_upgrade(org: Organization, db) -> None:
    """Lift downgrade locks when org upgrades."""
    for model in (Project, BrandVoice, User):
        result = await db.execute(
            select(model).where(
                model.org_id == org.id,
                model.locked == True,  # noqa: E712
                model.locked_reason == "downgrade",
            )
        )
        for row in result.scalars().all():
            row.locked = False
            row.locked_reason = None
    org.plan_locked_at = None


@router.post("/stripe")
async def stripe_webhook(request: Request, db: DB):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    # Idempotency — ignore duplicate deliveries
    is_new = await _record_event(event.id, event.type, json.loads(payload), db)
    if not is_new:
        return {"received": True}  # duplicate event_id — already processed

    obj = event.data.object
    customer_id = obj.get("customer")
    org = await _get_org_by_customer(customer_id, db) if customer_id else None

    if event.type == "checkout.session.completed":
        if org and not org.stripe_customer_id:
            org.stripe_customer_id = customer_id

    elif event.type in ("customer.subscription.created", "customer.subscription.updated"):
        if org:
            items = obj.get("items", {}).get("data", [])
            lookup_key = items[0]["price"].get("lookup_key", "") if items else ""
            new_tier = PRICE_TO_TIER.get(lookup_key, "")

            old_tier = org.plan_tier if isinstance(org.plan_tier, str) else org.plan_tier.value

            if new_tier and new_tier != old_tier:
                old_idx = TIER_ORDER.index(old_tier) if old_tier in TIER_ORDER else 0
                new_idx = TIER_ORDER.index(new_tier) if new_tier in TIER_ORDER else 0

                if new_idx > old_idx:
                    await _unlock_for_upgrade(org, db)
                elif new_idx < old_idx:
                    await _handle_downgrade(org, new_tier, db)

                org.plan_tier = PlanTier(new_tier)

            trial_end = obj.get("trial_end")
            if trial_end and not org.trial_ends_at:
                org.trial_ends_at = datetime.utcfromtimestamp(trial_end)

    elif event.type == "customer.subscription.deleted":
        if org:
            await _handle_downgrade(org, "free", db)
            org.plan_tier = PlanTier.FREE

    elif event.type == "invoice.payment_failed":
        if org:
            org.plan_locked_at = datetime.utcnow()
            for model in (Project, BrandVoice):
                result = await db.execute(select(model).where(model.org_id == org.id))
                for row in result.scalars().all():
                    if not row.locked:
                        row.locked = True
                        row.locked_reason = "payment_failed"

    await db.commit()
    return {"received": True}


@router.post("/publishing")
async def publishing_webhook():
    return {"message": "Not implemented yet"}


@router.get("")
async def list_webhooks():
    return {"message": "Not implemented yet"}


@router.post("", status_code=201)
async def create_webhook():
    return {"message": "Not implemented yet"}
