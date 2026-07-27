import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_auth import require_admin
from app.core.database import get_db
from app.models.organization import Organization
from app.models.user import User

router = APIRouter(prefix="/admin", tags=["admin-users"])


def _serialize_row(user: User, org_name: str | None) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role.value if user.role else None,
        "org_id": str(user.org_id),
        "org_name": org_name,
        "is_active": user.is_active,
        "locked": user.locked,
        "language": user.language,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "updated_at": user.updated_at.isoformat() if user.updated_at else None,
    }


@router.get("/users")
async def list_users(
    q: str | None = Query(None),
    org_id: uuid.UUID | None = Query(None),
    role: str | None = Query(None),
    active: bool | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin("read")),
):
    # Single query joined to Organization for org_name -- avoids N+1 lookups
    # per row that a per-user org fetch would cause.
    base_query = select(User, Organization.name).join(
        Organization, Organization.id == User.org_id
    )

    if q:
        like = f"%{q}%"
        base_query = base_query.where(
            User.email.ilike(like) | User.full_name.ilike(like)
        )
    if org_id is not None:
        base_query = base_query.where(User.org_id == org_id)
    if role:
        base_query = base_query.where(User.role == role)
    if active is not None:
        base_query = base_query.where(User.is_active.is_(active))

    total = (
        await db.execute(
            select(func.count()).select_from(base_query.with_only_columns(User.id).subquery())
        )
    ).scalar_one()

    rows = (
        await db.execute(
            base_query.order_by(User.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()

    items = [_serialize_row(user, org_name) for user, org_name in rows]

    return {"items": items, "total": int(total), "page": page, "page_size": page_size}


@router.get("/users/{user_id}")
async def get_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin("read")),
):
    row = (
        await db.execute(
            select(User, Organization)
            .join(Organization, Organization.id == User.org_id)
            .where(User.id == user_id)
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    user, org = row
    payload = _serialize_row(user, org.name)
    payload.update({
        "avatar_url": user.avatar_url,
        "locked_reason": user.locked_reason,
        "org": {
            "id": str(org.id),
            "name": org.name,
            "slug": org.slug,
            "plan_tier": org.plan_tier.value if org.plan_tier else None,
        },
    })
    return payload
