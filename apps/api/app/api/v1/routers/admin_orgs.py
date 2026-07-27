import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_auth import require_admin
from app.core.database import get_db
from app.models.billing import OrgUsage
from app.models.organization import Organization
from app.models.project import Project
from app.models.user import User

router = APIRouter(prefix="/admin", tags=["admin-orgs"])

SortStr = Literal["created_at", "-created_at", "name", "-name"]


def _mask_stripe_id(stripe_customer_id: str | None) -> str | None:
    if not stripe_customer_id:
        return None
    return f"…{stripe_customer_id[-4:]}"


def _usage_rollup_subquery():
    """Per-org lifetime rollup of OrgUsage. OrgUsage has one row per
    (org_id, period_start) -- SUM across all periods rather than reading a
    single "current" row, so an org's totals don't silently drop history as
    months roll over."""
    return (
        select(
            OrgUsage.org_id.label("org_id"),
            func.sum(OrgUsage.ai_requests).label("ai_requests"),
            func.sum(OrgUsage.seo_serp).label("seo_count"),
            func.sum(OrgUsage.cost_micros).label("cost_micros"),
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
                   ai_requests: int, seo_count: int, cost_micros: int) -> dict:
    cost_micros = int(cost_micros or 0)
    return {
        "id": str(org.id),
        "name": org.name,
        "slug": org.slug,
        "plan_tier": org.plan_tier.value if org.plan_tier else None,
        "byok_enabled": org.byok_enabled,
        "suspended": org.suspended_at is not None,
        "user_count": int(user_count or 0),
        "project_count": int(project_count or 0),
        "cost_micros": cost_micros,
        "cost_usd": cost_micros / 1_000_000,
        "ai_requests": int(ai_requests or 0),
        "seo_count": int(seo_count or 0),
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
        _serialize_row(org, user_count, project_count, ai_requests, seo_count, cost_micros)
        for org, user_count, project_count, ai_requests, seo_count, cost_micros in rows
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

    usage_row = (
        await db.execute(
            select(
                func.coalesce(func.sum(OrgUsage.ai_requests), 0).label("ai_requests"),
                func.coalesce(func.sum(OrgUsage.seo_serp), 0).label("seo_count"),
                func.coalesce(func.sum(OrgUsage.cost_micros), 0).label("cost_micros"),
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
