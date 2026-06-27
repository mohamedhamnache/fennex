import uuid
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException
from jose import jwt

from app.models.user import User, UserRole
from app.models.invite import OrgInvite
from app.core.config import settings

VALID_ROLES = {r.value for r in UserRole}


def _create_invite_token(email: str, org_id: uuid.UUID, role: str) -> str:
    """Create a JWT token specifically for org invites (type=invite, 7-day expiry)."""
    to_encode = {
        "sub": email,
        "org_id": str(org_id),
        "role": role,
        "type": "invite",
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


async def list_members(org_id: uuid.UUID, db: AsyncSession) -> list[User]:
    result = await db.execute(
        select(User).where(User.org_id == org_id).order_by(User.created_at)
    )
    return list(result.scalars().all())


async def create_invite(
    org_id: uuid.UUID,
    email: str,
    role: str,
    acting_user: User,
    db: AsyncSession,
) -> OrgInvite:
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {role}")
    if acting_user.role not in (UserRole.OWNER, UserRole.ADMIN):
        raise HTTPException(status_code=403, detail="Only owners and admins can invite members")

    token = _create_invite_token(email, org_id, role)
    invite = OrgInvite(org_id=org_id, email=email, role=role, token=token)
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    return invite


async def update_member_role(
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    new_role: str,
    acting_user: User,
    db: AsyncSession,
) -> User:
    if new_role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {new_role}")
    if acting_user.role not in (UserRole.OWNER, UserRole.ADMIN):
        raise HTTPException(status_code=403, detail="Only owners and admins can change roles")

    result = await db.execute(
        select(User).where(User.id == user_id, User.org_id == org_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Member not found")
    if user.role == UserRole.OWNER and acting_user.role != UserRole.OWNER:
        raise HTTPException(status_code=403, detail="Only an owner can change another owner's role")

    user.role = UserRole(new_role)
    await db.commit()
    await db.refresh(user)
    return user


async def deactivate_member(
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    acting_user: User,
    db: AsyncSession,
) -> None:
    if acting_user.role not in (UserRole.OWNER, UserRole.ADMIN):
        raise HTTPException(status_code=403, detail="Only owners and admins can deactivate members")
    if acting_user.id == user_id:
        raise HTTPException(status_code=400, detail="You cannot deactivate yourself")

    result = await db.execute(
        select(User).where(User.id == user_id, User.org_id == org_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Member not found")
    if user.role == UserRole.OWNER and acting_user.role != UserRole.OWNER:
        raise HTTPException(status_code=403, detail="Only an owner can deactivate another owner")

    user.is_active = False
    await db.commit()
