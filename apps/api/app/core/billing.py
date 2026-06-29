"""Billing: plan limits, usage tracking, and the check_usage_limit dependency."""
import json
import uuid
from datetime import date
from typing import Annotated, Callable

from fastapi import Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.billing import OrgUsage
from app.models.organization import Organization
from app.models.user import User

# Resources that are capacity limits (count existing rows) rather than monthly counters
CAPACITY_RESOURCES = {"projects", "brand_voices"}

# ── Plan limits ────────────────────────────────────────────────────────────────
# -1 means unlimited.

PLAN_LIMITS: dict[str, dict[str, int]] = {
    "free": {
        "projects": 1, "articles": 4, "images": 5, "social": 10,
        "keywords": 50, "seats": 1, "brand_voices": 1, "audits": 1, "backlinks": 1,
    },
    "starter": {
        "projects": 5, "articles": 20, "images": 50, "social": 50,
        "keywords": 500, "seats": 3, "brand_voices": 3, "audits": 5, "backlinks": 5,
    },
    "pro": {
        "projects": 10, "articles": 40, "images": 150, "social": 200,
        "keywords": 2000, "seats": 10, "brand_voices": 10, "audits": 20, "backlinks": 20,
    },
    "agency": {
        "projects": 100, "articles": 400, "images": -1, "social": -1,
        "keywords": -1, "seats": -1, "brand_voices": -1, "audits": -1, "backlinks": -1,
    },
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
