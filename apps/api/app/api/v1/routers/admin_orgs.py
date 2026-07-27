import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_auth import AdminContext, require_admin
from app.core.billing import current_billing_period_start
from app.core.credits import credit_allowance, credits_from_micros, seo_credit_allowance
from app.core.database import get_db
from app.core.security import create_access_token
from app.models.billing import OrgUsage
from app.models.organization import Organization
from app.models.project import Project
from app.models.user import User, UserRole
from app.services.admin.audit import record_admin_action

router = APIRouter(prefix="/admin", tags=["admin-orgs"])

SortStr = Literal["created_at", "-created_at", "name", "-name"]


def _mask_stripe_id(stripe_customer_id: str | None) -> str | None:
    if not stripe_customer_id:
        return None
    return f"…{stripe_customer_id[-4:]}"


def _usage_rollup_subquery():
    """Per-org rollup of OrgUsage. OrgUsage has one row per (org_id,
    period_start).

    ai_requests/seo_count/cost_micros are summed across ALL periods
    (lifetime) -- deliberate, since those are cumulative historical figures
    with no monthly cap to compare against, and an org's totals shouldn't
    silently drop history as months roll over.

    ai_cost_micros/seo_credits_used are summed for the CURRENT period ONLY.
    These feed ai_credits_used/seo_credits_used in _serialize_row, which are
    compared against credit_allowance()/seo_credit_allowance() -- MONTHLY
    allowances (see app.core.credits, app.core.billing.require_credits).
    Summing them lifetime would show every long-lived org permanently over
    100%, disagreeing with /usage/summary and with enforcement.
    """
    current_period = OrgUsage.period_start == current_billing_period_start()
    return (
        select(
            OrgUsage.org_id.label("org_id"),
            func.sum(OrgUsage.ai_requests).label("ai_requests"),
            func.sum(OrgUsage.seo_serp).label("seo_count"),
            func.sum(OrgUsage.cost_micros).label("cost_micros"),
            func.sum(case((current_period, OrgUsage.ai_cost_micros), else_=0)).label("ai_cost_micros"),
            func.sum(case((current_period, OrgUsage.seo_credits_used), else_=0)).label("seo_credits_used"),
        )
        .group_by(OrgUsage.org_id)
        .subquery()
    )


def _user_count_subquery():
    return (
        select(User.org_id.label("org_id"), func.count().label("user_count"))
        .group_by(User.org_id)
        .subquery()
    )


def _project_count_subquery():
    return (
        select(Project.org_id.label("org_id"), func.count().label("project_count"))
        .group_by(Project.org_id)
        .subquery()
    )


def _serialize_row(org: Organization, user_count: int, project_count: int,
                   ai_requests: int, seo_count: int, cost_micros: int,
                   ai_cost_micros: int = 0, seo_credits_used: int = 0) -> dict:
    cost_micros = int(cost_micros or 0)
    tier = org.plan_tier.value if org.plan_tier else None
    return {
        "id": str(org.id),
        "name": org.name,
        "slug": org.slug,
        "plan_tier": tier,
        "byok_enabled": org.byok_enabled,
        "suspended": org.suspended_at is not None,
        "user_count": int(user_count or 0),
        "project_count": int(project_count or 0),
        "cost_micros": cost_micros,
        "cost_usd": cost_micros / 1_000_000,
        "ai_requests": int(ai_requests or 0),
        "seo_count": int(seo_count or 0),
        "ai_credits_used": credits_from_micros(int(ai_cost_micros or 0)),
        "ai_credits_allowance": credit_allowance(tier),
        "seo_credits_used": int(seo_credits_used or 0),
        "seo_credits_allowance": seo_credit_allowance(tier),
        "created_at": org.created_at.isoformat() if org.created_at else None,
    }


@router.get("/orgs")
async def list_orgs(
    q: str | None = Query(None),
    plan: str | None = Query(None),
    suspended: bool | None = Query(None),
    sort: SortStr = Query("-created_at"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin("read")),
):
    usage_sq = _usage_rollup_subquery()
    users_sq = _user_count_subquery()
    projects_sq = _project_count_subquery()

    base_query = (
        select(
            Organization,
            users_sq.c.user_count,
            projects_sq.c.project_count,
            usage_sq.c.ai_requests,
            usage_sq.c.seo_count,
            usage_sq.c.cost_micros,
            usage_sq.c.ai_cost_micros,
            usage_sq.c.seo_credits_used,
        )
        .outerjoin(users_sq, users_sq.c.org_id == Organization.id)
        .outerjoin(projects_sq, projects_sq.c.org_id == Organization.id)
        .outerjoin(usage_sq, usage_sq.c.org_id == Organization.id)
    )

    if q:
        like = f"%{q}%"
        base_query = base_query.where(
            Organization.name.ilike(like) | Organization.slug.ilike(like)
        )
    if plan:
        base_query = base_query.where(Organization.plan_tier == plan)
    if suspended is not None:
        if suspended:
            base_query = base_query.where(Organization.suspended_at.is_not(None))
        else:
            base_query = base_query.where(Organization.suspended_at.is_(None))

    total = (
        await db.execute(
            select(func.count()).select_from(base_query.with_only_columns(Organization.id).subquery())
        )
    ).scalar_one()

    order_col = {
        "created_at": Organization.created_at.asc(),
        "-created_at": Organization.created_at.desc(),
        "name": Organization.name.asc(),
        "-name": Organization.name.desc(),
    }[sort]

    rows = (
        await db.execute(
            base_query.order_by(order_col)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()

    items = [
        _serialize_row(org, user_count, project_count, ai_requests, seo_count, cost_micros,
                       ai_cost_micros, seo_credits_used)
        for org, user_count, project_count, ai_requests, seo_count, cost_micros,
            ai_cost_micros, seo_credits_used in rows
    ]

    return {"items": items, "total": int(total), "page": page, "page_size": page_size}


@router.get("/orgs/{org_id}")
async def get_org(
    org_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin("read")),
):
    org = (
        await db.execute(select(Organization).where(Organization.id == org_id))
    ).scalar_one_or_none()
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")

    user_count = (
        await db.execute(
            select(func.count()).select_from(User).where(User.org_id == org_id)
        )
    ).scalar_one()

    # See _usage_rollup_subquery: ai_cost_micros/seo_credits_used are current-
    # period only (compared against monthly allowances); the rest stay lifetime.
    current_period = OrgUsage.period_start == current_billing_period_start()
    usage_row = (
        await db.execute(
            select(
                func.coalesce(func.sum(OrgUsage.ai_requests), 0).label("ai_requests"),
                func.coalesce(func.sum(OrgUsage.seo_serp), 0).label("seo_count"),
                func.coalesce(func.sum(OrgUsage.cost_micros), 0).label("cost_micros"),
                func.coalesce(
                    func.sum(case((current_period, OrgUsage.ai_cost_micros), else_=0)), 0
                ).label("ai_cost_micros"),
                func.coalesce(
                    func.sum(case((current_period, OrgUsage.seo_credits_used), else_=0)), 0
                ).label("seo_credits_used"),
            ).where(OrgUsage.org_id == org_id)
        )
    ).one()

    projects = (
        await db.execute(
            select(Project).where(Project.org_id == org_id).order_by(Project.created_at.desc())
        )
    ).scalars().all()
    project_count = len(projects)

    payload = _serialize_row(
        org, user_count, project_count,
        usage_row.ai_requests, usage_row.seo_count, usage_row.cost_micros,
        usage_row.ai_cost_micros, usage_row.seo_credits_used,
    )
    payload.update({
        "suspended_reason": org.suspended_reason,
        "trial_ends_at": org.trial_ends_at.isoformat() if org.trial_ends_at else None,
        "stripe_customer_id": _mask_stripe_id(org.stripe_customer_id),
        "projects": [
            {
                "id": str(p.id),
                "name": p.name,
                "domain": p.domain,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in projects
        ],
    })
    return payload


class SuspendOrgRequest(BaseModel):
    reason: str | None = None


# Denormalized OrgUsage rollup counters that reset-quotas zeroes. The
# usage_events ledger is the source of truth for historical usage and is
# never touched by this endpoint -- see reset_org_quotas() below.
_RESET_COUNTER_FIELDS = (
    "ai_input_tokens",
    "ai_output_tokens",
    "ai_requests",
    "seo_serp",
    "seo_keyword_analyses",
    "cost_micros",
)


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


async def _get_org_or_404(db: AsyncSession, org_id: uuid.UUID) -> Organization:
    org = (
        await db.execute(select(Organization).where(Organization.id == org_id))
    ).scalar_one_or_none()
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization not found")
    return org


@router.post("/orgs/{org_id}/suspend")
async def suspend_org(
    org_id: uuid.UUID,
    request: Request,
    body: SuspendOrgRequest = SuspendOrgRequest(),
    db: AsyncSession = Depends(get_db),
    ctx: AdminContext = Depends(require_admin("org.suspend")),
):
    org = await _get_org_or_404(db, org_id)

    if org.suspended_at is not None:
        # Already suspended -- true no-op: no state change, no new audit row.
        return {"id": str(org.id), "suspended": True, "suspended_reason": org.suspended_reason}

    org.suspended_at = datetime.now(timezone.utc)
    org.suspended_reason = body.reason

    await record_admin_action(
        db, actor_admin_id=ctx.admin.id, action="org.suspend",
        resource_type="organization", resource_id=str(org.id),
        before={"suspended": False},
        after={"suspended": True, "reason": body.reason},
        ip=_client_ip(request),
    )
    await db.commit()

    return {"id": str(org.id), "suspended": True, "suspended_reason": org.suspended_reason}


@router.post("/orgs/{org_id}/unsuspend")
async def unsuspend_org(
    org_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ctx: AdminContext = Depends(require_admin("org.suspend")),
):
    org = await _get_org_or_404(db, org_id)

    before = {"suspended": org.suspended_at is not None, "reason": org.suspended_reason}
    org.suspended_at = None
    org.suspended_reason = None

    await record_admin_action(
        db, actor_admin_id=ctx.admin.id, action="org.unsuspend",
        resource_type="organization", resource_id=str(org.id),
        before=before, after={"suspended": False},
        ip=_client_ip(request),
    )
    await db.commit()

    return {"id": str(org.id), "suspended": False}


@router.post("/orgs/{org_id}/reset-quotas")
async def reset_org_quotas(
    org_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ctx: AdminContext = Depends(require_admin("org.reset_quotas")),
):
    org = await _get_org_or_404(db, org_id)

    usage_rows = (
        await db.execute(select(OrgUsage).where(OrgUsage.org_id == org_id))
    ).scalars().all()

    before = {
        field: sum(getattr(row, field) or 0 for row in usage_rows)
        for field in _RESET_COUNTER_FIELDS
    }

    # NOTE: this resets the denormalized OrgUsage rollup only, across every
    # (org_id, period_start) row the org has accumulated. The usage_events
    # ledger (the source of truth for historical usage/billing) is
    # intentionally left untouched by this action.
    for row in usage_rows:
        for field in _RESET_COUNTER_FIELDS:
            setattr(row, field, 0)

    after = {field: 0 for field in _RESET_COUNTER_FIELDS}

    await record_admin_action(
        db, actor_admin_id=ctx.admin.id, action="org.reset_quotas",
        resource_type="organization", resource_id=str(org.id),
        before=before, after=after, ip=_client_ip(request),
    )
    await db.commit()

    return {"id": str(org.id), "reset": True, "periods_reset": len(usage_rows)}


async def _select_impersonation_user(db: AsyncSession, org_id: uuid.UUID) -> User | None:
    """Pick the user to impersonate for an org. Preference order: the OWNER,
    then an ADMIN, then the earliest-created active user -- so impersonation
    always lands on the most representative account rather than an arbitrary
    row. Every tier requires is_active=True: a deactivated owner/admin must
    never be selected -- the product considers that account disabled, and
    minting a live customer token for it would resurrect access that was
    deliberately revoked."""
    owner = (
        await db.execute(
            select(User)
            .where(User.org_id == org_id, User.role == UserRole.OWNER, User.is_active.is_(True))
            .order_by(User.created_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if owner is not None:
        return owner

    admin_user = (
        await db.execute(
            select(User)
            .where(User.org_id == org_id, User.role == UserRole.ADMIN, User.is_active.is_(True))
            .order_by(User.created_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if admin_user is not None:
        return admin_user

    return (
        await db.execute(
            select(User)
            .where(User.org_id == org_id, User.is_active.is_(True))
            .order_by(User.created_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()


@router.post("/orgs/{org_id}/impersonate")
async def impersonate_org(
    org_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    ctx: AdminContext = Depends(require_admin("org.impersonate")),
):
    org = await _get_org_or_404(db, org_id)

    if org.suspended_at is not None:
        # Never impersonate into a suspended org -- support must unsuspend
        # (a separate, audited action) before assuming a customer's session.
        raise HTTPException(status.HTTP_409_CONFLICT, "Organization is suspended")

    user = await _select_impersonation_user(db, org_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organization has no owner user")

    # Short-lived customer access token. The `imp` claim marks this as an
    # impersonation session so downstream code/audit can distinguish it from
    # a normal customer login.
    token = create_access_token(
        {
            "sub": str(user.id),
            "org_id": str(org.id),
            "role": user.role.value,
            "imp": str(ctx.admin.id),
        },
        expires_delta=timedelta(minutes=30),
    )

    await record_admin_action(
        db, actor_admin_id=ctx.admin.id, action="org.impersonate",
        resource_type="organization", resource_id=str(org.id),
        after={"impersonated_user": str(user.id)},
        ip=_client_ip(request),
    )
    await db.commit()

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": str(user.id), "email": user.email, "full_name": user.full_name},
        "expires_in": 1800,
    }
