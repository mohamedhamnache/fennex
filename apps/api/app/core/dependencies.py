from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.permissions import Permission, has_permission
from app.core.security import decode_token
from app.models.organization import Organization
from app.models.user import User

security = HTTPBearer()


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    token = credentials.credentials
    payload = decode_token(token)

    user_id = payload.get("sub")
    token_type = payload.get("type")

    if not user_id or token_type != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    result = await db.execute(select(User).where(User.id == UUID(user_id)))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    organization = await db.get(Organization, user.org_id)
    if organization is not None and organization.suspended_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organization suspended",
        )

    # Admin-driven deactivate/lock actions (app/api/v1/routers/admin_users.py)
    # must take effect immediately on the customer session, not just block
    # new logins. Additive on top of the is_active check that used to live
    # in the "not user" branch above (as a 401) -- locked is new.
    if not user.is_active or user.locked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account disabled",
        )

    # Attribute any LLM usage during this request to the caller's org, so
    # `call_llm` meters even paths that reuse a cached key without re-resolving.
    from app.core.metering_context import set_metering_org
    set_metering_org(user.org_id)

    return user


def require_permission(permission: Permission):
    async def check_permission(
        current_user: Annotated[User, Depends(get_current_user)],
    ) -> User:
        if not has_permission(current_user.role, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: {permission}",
            )
        return current_user
    return check_permission


CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]
