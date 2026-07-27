from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.config import settings
from app.core.security import verify_password, pwd_context
from app.core.admin_auth import (create_admin_token, get_current_admin, AdminContext,
                                 permissions_for)
from app.models.admin_user import AdminUser, AdminRole, AdminRoleAssignment

router = APIRouter(prefix="/admin", tags=["admin-auth"])

async def _roles_for(db: AsyncSession, admin_id) -> list[str]:
    rows = (await db.execute(
        select(AdminRole.key).join(AdminRoleAssignment,
            AdminRoleAssignment.role_id == AdminRole.id)
        .where(AdminRoleAssignment.admin_user_id == admin_id))).scalars().all()
    return list(rows)

@router.post("/auth/login")
async def login(form: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    email = form.username.strip().lower()
    admin = (await db.execute(
        select(AdminUser).where(func.lower(AdminUser.email) == email))).scalar_one_or_none()
    # First-run bootstrap: create the super-admin from env if the table is empty.
    if admin is None and settings.ADMIN_BOOTSTRAP_EMAIL and \
       email == settings.ADMIN_BOOTSTRAP_EMAIL.strip().lower() and \
       form.password == settings.ADMIN_BOOTSTRAP_PASSWORD and settings.ADMIN_BOOTSTRAP_PASSWORD:
        count = (await db.execute(select(func.count()).select_from(AdminUser))).scalar_one()
        if count == 0:
            admin = AdminUser(email=email, name="Owner",
                              password_hash=pwd_context.hash(form.password), is_active=True)
            db.add(admin); await db.flush()
            role = (await db.execute(
                select(AdminRole).where(AdminRole.key == "super_admin"))).scalar_one_or_none()
            if role:
                db.add(AdminRoleAssignment(admin_user_id=admin.id, role_id=role.id))
            await db.commit()
    if admin is None or not admin.password_hash or not verify_password(form.password, admin.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    if not admin.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
    admin.last_login_at = datetime.now(timezone.utc)
    roles = await _roles_for(db, admin.id)
    await db.commit()
    return {"access_token": create_admin_token(str(admin.id), roles), "token_type": "bearer"}

@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(_: AdminContext = Depends(get_current_admin)):
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@router.get("/me")
async def me(ctx: AdminContext = Depends(get_current_admin)):
    return {"id": str(ctx.admin.id), "email": ctx.admin.email, "name": ctx.admin.name,
            "roles": ctx.roles, "permissions": sorted(ctx.permissions)}
