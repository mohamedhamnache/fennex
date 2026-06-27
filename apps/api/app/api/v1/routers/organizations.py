import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.dependencies import CurrentUser, DB
from app.services.team_service import list_members, create_invite, update_member_role, deactivate_member

router = APIRouter()

FRONTEND_URL = "http://localhost:3000"


class MemberOut(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    is_active: bool
    created_at: str | None


class InviteOut(BaseModel):
    id: str
    email: str
    role: str
    invite_link: str


class InviteCreate(BaseModel):
    email: str
    role: str


class MemberRoleUpdate(BaseModel):
    role: str


@router.post("", status_code=201)
async def create_organization():
    return {"message": "Not implemented yet"}


@router.get("/{org_id}")
async def get_organization(org_id: str):
    return {"message": "Not implemented yet"}


@router.patch("/{org_id}")
async def update_organization(org_id: str):
    return {"message": "Not implemented yet"}


@router.get("/{org_id}/members", response_model=list[MemberOut])
async def list_org_members(org_id: uuid.UUID, current_user: CurrentUser, db: DB):
    if current_user.org_id != org_id:
        raise HTTPException(status_code=403, detail="Access denied")
    members = await list_members(org_id, db)
    return [
        MemberOut(
            id=str(m.id),
            email=m.email,
            full_name=m.full_name,
            role=m.role.value,
            is_active=m.is_active,
            created_at=m.created_at.isoformat() if m.created_at else None,
        )
        for m in members
    ]


@router.post("/{org_id}/invites", response_model=InviteOut, status_code=201)
async def invite_member(org_id: uuid.UUID, body: InviteCreate, current_user: CurrentUser, db: DB):
    if current_user.org_id != org_id:
        raise HTTPException(status_code=403, detail="Access denied")
    invite = await create_invite(org_id, body.email, body.role, current_user, db)
    return InviteOut(
        id=str(invite.id),
        email=invite.email,
        role=invite.role,
        invite_link=f"{FRONTEND_URL}/accept-invite?token={invite.token}",
    )


@router.patch("/{org_id}/members/{user_id}", response_model=MemberOut)
async def update_member(org_id: uuid.UUID, user_id: uuid.UUID, body: MemberRoleUpdate, current_user: CurrentUser, db: DB):
    if current_user.org_id != org_id:
        raise HTTPException(status_code=403, detail="Access denied")
    member = await update_member_role(org_id, user_id, body.role, current_user, db)
    return MemberOut(
        id=str(member.id),
        email=member.email,
        full_name=member.full_name,
        role=member.role.value,
        is_active=member.is_active,
        created_at=member.created_at.isoformat() if member.created_at else None,
    )


@router.delete("/{org_id}/members/{user_id}", status_code=204)
async def deactivate_org_member(org_id: uuid.UUID, user_id: uuid.UUID, current_user: CurrentUser, db: DB):
    if current_user.org_id != org_id:
        raise HTTPException(status_code=403, detail="Access denied")
    await deactivate_member(org_id, user_id, current_user, db)
