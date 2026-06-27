import uuid

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select

from app.core.dependencies import CurrentUser, DB
from app.models.organization import Organization

router = APIRouter()


class UserProfile(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    org_id: uuid.UUID
    org_name: str
    org_slug: str
    plan_tier: str
    created_at: str | None


@router.get("/me", response_model=UserProfile)
async def get_current_user_profile(current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(Organization).where(Organization.id == current_user.org_id)
    )
    org = result.scalar_one_or_none()
    return UserProfile(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role.value,
        org_id=current_user.org_id,
        org_name=org.name if org else "",
        org_slug=org.slug if org else "",
        plan_tier=org.plan_tier.value if org else "free",
        created_at=current_user.created_at.isoformat() if hasattr(current_user, "created_at") and current_user.created_at else None,
    )


@router.patch("/me")
async def update_current_user_profile():
    return {"message": "Not implemented yet"}


@router.get("/{user_id}")
async def get_user(user_id: str):
    return {"message": "Not implemented yet"}


@router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: str):
    return {"message": "Not implemented yet"}
