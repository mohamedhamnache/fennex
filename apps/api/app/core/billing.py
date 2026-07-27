"""Billing: plan limits, usage tracking, and the check_usage_limit dependency."""
import json
import uuid
from datetime import date
from typing import Annotated, Callable

from fastapi import Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.credits import credit_allowance, credits_from_micros, seo_credit_allowance
from app.core.database import get_db
from app.core.dependencies import CurrentUser, DB, get_current_user
from app.models.billing import OrgUsage
from app.models.organization import Organization
from app.models.user import User

# Resources that are capacity limits (count existing rows) rather than monthly counters
CAPACITY_RESOURCES = {"projects", "brand_voices"}

# ── Plan limits ────────────────────────────────────────────────────────────────
# -1 means unlimited.

# projects/seats/articles/images/keywords come from the reseller spec's plan
# table (docs/superpowers/specs/2026-07-25-reseller-billing-architecture.md, s5).
# social/brand_voices/audits/backlinks are NOT priced there, so they keep their
# previous per-tier values and scale inherits agency's.
#
# The spec also prices AI credits, raw token caps, SERP and DataForSEO calls,
# storage, rate limits and concurrent jobs. Those are deliberately absent here:
# nothing enforces them yet (that is the QuotaGuard phase), and a key in this
# dict that check_usage_limit never reads would advertise a limit the app does
# not apply.
#
# "free" is retained for orgs already on it, which keep working unchanged. It is
# no longer offered to new signups and the pricing UI does not show it; the
# spec replaces it with a 7-day trial whose expiry machinery lands later.
#
# Billing v2 (2026-07-27, task 6): tightened structural and fair-use caps --
# Starter drops from 3 projects/3 seats to 1/1. Applies to every org
# immediately; no grandfathering. Credit allowances (AI/SEO) are NOT part of
# this dict -- they live in app.core.credits and are read via
# credit_allowance()/seo_credit_allowance() by require_credits() below.
PLAN_LIMITS: dict[str, dict[str, int]] = {
    "free": {
        "projects": 1, "articles": 4, "images": 5, "social": 10,
        "keywords": 50, "seats": 1, "brand_voices": 1, "audits": 1, "backlinks": 1,
    },
    "starter": {
        "projects": 1, "articles": 25, "images": 40, "social": 50,
        "keywords": 500, "seats": 1, "brand_voices": 3, "audits": 5, "backlinks": 5,
    },
    "pro": {
        "projects": 5, "articles": 120, "images": 200, "social": 200,
        "keywords": 2500, "seats": 3, "brand_voices": 10, "audits": 20, "backlinks": 20,
    },
    "agency": {
        "projects": 15, "articles": 500, "images": 800, "social": -1,
        "keywords": 10000, "seats": 10, "brand_voices": -1, "audits": -1, "backlinks": -1,
    },
    "scale": {
        # Articles and images are "unlimited" as fair use in the spec: still
        # bounded by the raw token and call caps the QuotaGuard phase will add.
        "projects": 50, "articles": -1, "images": -1, "social": -1,
        "keywords": 40000, "seats": 25, "brand_voices": -1, "audits": -1, "backlinks": -1,
    },
    # Enterprise is custom-contracted and absent from PLAN_PRICE_USD, but it
    # still needs an entry: the lookup falls back to `free`, which would cap a
    # custom-contract customer at 1 project / 4 articles.
    "enterprise": {
        "projects": -1, "articles": -1, "images": -1, "social": -1,
        "keywords": -1, "seats": -1, "brand_voices": -1, "audits": -1, "backlinks": -1,
    },
}


# Whole-USD monthly list price per plan tier, used by the admin billing/MRR
# helpers (app/services/admin/revenue.py). "enterprise" is deliberately absent:
# those deals are custom-priced and contribute $0 of *estimated* MRR here
# rather than a fabricated number.
PLAN_PRICE_USD: dict[str, int] = {
    "free": 0,
    "starter": 29,
    "pro": 99,
    "agency": 299,
    "scale": 799,
}


def current_billing_period_start() -> date:
    """Return the 1st of the current calendar month (v1: same for all orgs)."""
    today = date.today()
    return today.replace(day=1)


async def get_current_usage(org_id: uuid.UUID, resource: str, db: AsyncSession) -> int:
    """Return the current-period counter for a resource. 0 if no row yet."""
    period = current_billing_period_start()
    col = getattr(OrgUsage, f"{resource}_used")
    result = await db.execute(
        select(col).where(
            OrgUsage.org_id == org_id,
            OrgUsage.period_start == period,
        )
    )
    value = result.scalar_one_or_none()
    return value or 0


async def increment_usage(org_id: uuid.UUID, resource: str, db: AsyncSession) -> None:
    """Atomically increment the current-period counter for a resource."""
    period = current_billing_period_start()
    col_name = f"{resource}_used"
    stmt = pg_insert(OrgUsage).values(
        org_id=org_id,
        period_start=period,
        **{col_name: 1},
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["org_id", "period_start"],
        set_={col_name: getattr(OrgUsage, col_name) + 1},
    )
    await db.execute(stmt)


async def _get_org(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Organization:
    """Resolve the Organization for the current authenticated user."""
    result = await db.execute(select(Organization).where(Organization.id == current_user.org_id))
    org = result.scalar_one_or_none()
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


def check_usage_limit(resource: str) -> Callable:
    """
    FastAPI dependency factory. Raises 429 when the org has hit its limit for
    `resource`. Sets X-Usage-Warning header at >=80%.

    Usage:
        @router.post("/generate")
        async def generate(
            _: Annotated[None, Depends(check_usage_limit("articles"))],
            ...
        ):
    """
    async def _check(
        org: Annotated[Organization, Depends(_get_org)],
        db: Annotated[AsyncSession, Depends(get_db)],
        response: Response,
    ) -> None:
        tier = org.plan_tier if isinstance(org.plan_tier, str) else org.plan_tier.value
        limit = PLAN_LIMITS.get(tier, PLAN_LIMITS["free"])[resource]

        if limit == -1:
            return  # unlimited

        if resource in CAPACITY_RESOURCES:
            # Capacity check: count existing rows instead of reading org_usage
            from app.models.project import Project
            from app.models.brand_voice import BrandVoice
            model_map = {"projects": Project, "brand_voices": BrandVoice}
            model = model_map[resource]
            count_result = await db.execute(
                select(func.count()).select_from(model).where(model.org_id == org.id)
            )
            used = count_result.scalar() or 0
        else:
            used = await get_current_usage(org.id, resource, db)
        pct = used / limit

        if pct >= 1.0:
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "LIMIT_REACHED",
                    "resource": resource,
                    "used": used,
                    "limit": limit,
                    "tier": tier,
                },
            )
        if pct >= 0.8:
            response.headers["X-Usage-Warning"] = json.dumps({
                "resource": resource,
                "used": used,
                "limit": limit,
                "pct": round(pct, 2),
            })

    return _check


def _tier_value(org: Organization) -> str:
    """The org's plan tier as its lowercase string value.

    PlanTier is a `str` subclass (class PlanTier(str, enum.Enum)), so the
    `isinstance(org.plan_tier, str)` check used elsewhere in this file is
    always true and leaves the enum member in place. That is harmless for
    `PLAN_LIMITS.get(tier, ...)` (dict lookup uses __eq__/__hash__, which
    str-mixin enums share with their value), but credit_allowance() and
    seo_credit_allowance() call `str(tier)`, and `str(PlanTier.STARTER)` is
    `"PlanTier.STARTER"` in this Python version, not `"starter"` -- silently
    falling back to the free-tier allowance for every paid org. Extract
    `.value` explicitly instead.
    """
    return org.plan_tier.value if hasattr(org.plan_tier, "value") else org.plan_tier


async def current_credits(db: AsyncSession, org: Organization, bucket: str) -> tuple[int, int]:
    """Return (used, allowance) in whole credits for the current period."""
    tier = _tier_value(org)
    result = await db.execute(
        select(OrgUsage).where(OrgUsage.org_id == org.id,
                               OrgUsage.period_start == current_billing_period_start())
    )
    row = result.scalar_one_or_none()
    if bucket == "ai":
        used = credits_from_micros(getattr(row, "ai_cost_micros", 0) if row else 0)
        return used, credit_allowance(tier)
    used = (getattr(row, "seo_credits_used", 0) if row else 0)
    return used, seo_credit_allowance(tier)


def require_credits(bucket: str):
    """Hard-stop dependency: 429 at >=100% of the bucket for EVERY plan;
    sets X-Usage-Warning at >=80%.

    Usage:
        @router.post("/generate")
        async def generate(
            _: Annotated[None, Depends(require_credits("ai"))],
            ...
        ):
    """
    async def _dep(response: Response, current_user: CurrentUser, db: DB) -> None:
        org = await _get_org(current_user, db)
        used, allowance = await current_credits(db, org, bucket)
        if allowance <= 0:
            return
        pct = used / allowance
        if pct >= 1.0:
            # Same envelope as check_usage_limit: the web client's global 429
            # handler keys on detail.code/detail.resource to raise the upgrade
            # modal, so a different shape here would surface as an unhandled
            # error at exactly the moment we want to sell an upgrade.
            raise HTTPException(status_code=429, detail={
                "code": "LIMIT_REACHED",
                "resource": f"{bucket}_credits",
                "used": used,
                "limit": allowance,
                "tier": _tier_value(org),
                "bucket": bucket,
            })
        if pct >= 0.8:
            response.headers["X-Usage-Warning"] = json.dumps({
                "resource": f"{bucket}_credits", "bucket": bucket,
                "used": used, "limit": allowance, "pct": round(pct, 2),
            })
    return _dep


async def get_billing_usage(org: Organization, db: AsyncSession) -> dict:
    """
    Return current usage + limits for all resources.
    Shape: { resource: { used, limit, pct } }
    """
    tier = org.plan_tier if isinstance(org.plan_tier, str) else org.plan_tier.value
    limits = PLAN_LIMITS.get(tier, PLAN_LIMITS["free"])
    period = current_billing_period_start()

    result = await db.execute(
        select(OrgUsage).where(
            OrgUsage.org_id == org.id,
            OrgUsage.period_start == period,
        )
    )
    row = result.scalar_one_or_none()

    # Resources NOT tracked in OrgUsage table (capacity limits or handled separately)
    SKIP_RESOURCES = {"seats", "projects", "brand_voices"}

    usage: dict[str, dict] = {}
    for resource, limit in limits.items():
        if resource in SKIP_RESOURCES:
            continue  # seats, projects, brand_voices checked differently
        used_val = getattr(row, f"{resource}_used", 0) if row else 0
        usage[resource] = {
            "used": used_val,
            "limit": limit,
            "pct": round(used_val / limit, 2) if limit > 0 else 0.0,
        }
    return usage


async def check_project_not_locked(project_id: uuid.UUID, db: AsyncSession) -> None:
    """Raise 423 if the project is locked (downgrade or payment failure)."""
    from app.models.project import Project
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if project and project.locked:
        raise HTTPException(
            status_code=423,
            detail={
                "code": "RESOURCE_LOCKED",
                "reason": project.locked_reason or "downgrade",
                "message": "This project is locked. Upgrade your plan to unlock it.",
            },
        )
