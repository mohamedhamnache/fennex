import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.dependencies import CurrentUser, DB
from app.models.organization import Organization
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


class OrgOut(BaseModel):
    id: str
    slug: str
    name: str
    plan_tier: str
    agent_tier: str


class OrgUpdate(BaseModel):
    name: str | None = None
    agent_tier: str | None = None


_AGENT_TIERS = {"economy", "balanced", "max"}


@router.post("", status_code=201)
async def create_organization():
    return {"message": "Not implemented yet"}


def _org_out(org) -> "OrgOut":
    return OrgOut(id=str(org.id), slug=org.slug, name=org.name,
                  plan_tier=org.plan_tier.value if hasattr(org.plan_tier, "value") else str(org.plan_tier),
                  agent_tier=org.agent_tier or "balanced")


@router.get("/{org_id}", response_model=OrgOut)
async def get_organization(org_id: uuid.UUID, current_user: CurrentUser, db: DB):
    if current_user.org_id != org_id:
        raise HTTPException(status_code=403, detail="Access denied")
    org = await db.get(Organization, org_id)
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return _org_out(org)


@router.patch("/{org_id}", response_model=OrgOut)
async def update_organization(org_id: uuid.UUID, body: OrgUpdate, current_user: CurrentUser, db: DB):
    if current_user.org_id != org_id:
        raise HTTPException(status_code=403, detail="Access denied")
    org = await db.get(Organization, org_id)
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    if body.name is not None:
        org.name = body.name
    if body.agent_tier is not None:
        if body.agent_tier not in _AGENT_TIERS:
            raise HTTPException(status_code=422, detail="agent_tier must be economy, balanced or max")
        org.agent_tier = body.agent_tier
    await db.commit()
    await db.refresh(org)
    return _org_out(org)


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
