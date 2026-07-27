import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.admin_audit_log import AdminAuditLog


async def record_admin_action(db: AsyncSession, *, actor_admin_id: uuid.UUID, action: str,
                              resource_type: str, resource_id: str | None = None,
                              before: dict | None = None, after: dict | None = None,
                              ip: str | None = None, result: str = "ok") -> None:
    """Append an admin-action row. Commit-neutral: only db.add(); the calling
    endpoint commits so the action + its audit row land in one transaction."""
    db.add(AdminAuditLog(actor_admin_id=actor_admin_id, action=action,
                         resource_type=resource_type, resource_id=resource_id,
                         before_json=before, after_json=after, ip=ip, result=result))
