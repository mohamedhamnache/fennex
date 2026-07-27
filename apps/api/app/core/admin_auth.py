from dataclasses import dataclass
from datetime import timedelta
import uuid
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token
from app.models.admin_user import AdminUser, AdminRole, AdminRoleAssignment

# Capability grants per role. "read" = may view any section.
ROLE_PERMISSIONS: dict[str, set[str]] = {
    "super_admin": {"read", "org.suspend", "org.impersonate", "org.reset_quotas",
                    "org.plan", "billing.write", "queue.write", "flags.write",
                    "alerts.write", "system.write"},
    "support":     {"read", "org.impersonate", "org.suspend", "org.reset_quotas"},
    "finance":     {"read", "billing.write"},
    "marketing":   {"read"},
    "operations":  {"read", "org.suspend", "org.reset_quotas", "queue.write",
                    "flags.write", "alerts.write"},
    "developer":   {"read", "flags.write", "alerts.write", "system.write"},
    "auditor":     {"read"},
}

def permissions_for(roles: list[str]) -> set[str]:
    perms: set[str] = set()
    for r in roles:
        perms |= ROLE_PERMISSIONS.get(r, set())
    return perms

def create_admin_token(admin_id: str, roles: list[str]) -> str:
    return create_access_token(
        {"sub": admin_id, "scope": "admin", "roles": roles},
        expires_delta=timedelta(hours=12),
    )

@dataclass
class AdminContext:
    admin: AdminUser
    roles: list[str]
    permissions: set[str]

_oauth = OAuth2PasswordBearer(tokenUrl="/api/v1/admin/auth/login", auto_error=False)

async def get_current_admin(token: str | None = Depends(_oauth),
                            db: AsyncSession = Depends(get_db)) -> AdminContext:
    cred_exc = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated",
                            {"WWW-Authenticate": "Bearer"})
    if not token:
        raise cred_exc
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("scope") != "admin":
            raise cred_exc
        admin_id = payload["sub"]
        roles = payload.get("roles", [])
    except (JWTError, KeyError):
        raise cred_exc
    admin = (await db.execute(
        select(AdminUser).where(AdminUser.id == uuid.UUID(admin_id)))).scalar_one_or_none()
    if admin is None or not admin.is_active:
        raise cred_exc
    return AdminContext(admin=admin, roles=roles, permissions=permissions_for(roles))

def require_admin(permission: str | None = None):
    async def _dep(ctx: AdminContext = Depends(get_current_admin)) -> AdminContext:
        if permission and permission not in ctx.permissions:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient admin permission")
        return ctx
    return _dep
