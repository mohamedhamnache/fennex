import datetime as dt

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_auth import require_admin
from app.core.database import get_db
from app.models.admin_audit_log import AdminAuditLog

router = APIRouter(prefix="/admin", tags=["admin-audit"])


@router.get("/audit")
async def list_audit_log(
    actor: str | None = Query(None),
    action: str | None = Query(None),
    resource_type: str | None = Query(None),
    resource_id: str | None = Query(None),
    from_: dt.datetime | None = Query(None, alias="from"),
    to: dt.datetime | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin("read")),
):
    filters = []
    if actor:
        filters.append(AdminAuditLog.actor_admin_id == actor)
    if action:
        filters.append(AdminAuditLog.action == action)
    if resource_type:
        filters.append(AdminAuditLog.resource_type == resource_type)
    if resource_id:
        filters.append(AdminAuditLog.resource_id == resource_id)
    if from_:
        filters.append(AdminAuditLog.created_at >= from_)
    if to:
        filters.append(AdminAuditLog.created_at <= to)

    total_stmt = select(func.count()).select_from(AdminAuditLog)
    for f in filters:
        total_stmt = total_stmt.where(f)
    total = (await db.execute(total_stmt)).scalar_one()

    stmt = select(AdminAuditLog)
    for f in filters:
        stmt = stmt.where(f)
    stmt = (
        stmt.order_by(AdminAuditLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = (await db.execute(stmt)).scalars().all()

    return {
        "items": [
            {
                "id": row.id,
                "actor_admin_id": str(row.actor_admin_id),
                "action": row.action,
                "resource_type": row.resource_type,
                "resource_id": row.resource_id,
                "before_json": row.before_json,
                "after_json": row.after_json,
                "ip": row.ip,
                "result": row.result,
                "created_at": row.created_at.isoformat(),
            }
            for row in rows
        ],
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }
