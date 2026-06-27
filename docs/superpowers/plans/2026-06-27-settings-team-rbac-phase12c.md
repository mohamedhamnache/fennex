# Team Members & RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let org owners/admins invite users by email, assign roles from the existing `UserRole` enum, and deactivate members. Add a "Team" section to Settings showing all org members.

**Architecture:** `User` model already exists with `role`, `is_active`, `org_id`. No new model needed. We need: (1) an `OrgInvite` model for pending invitations, (2) a migration, (3) service functions for list/invite/update-role/deactivate, (4) wired organization router endpoints, (5) a Team section in Settings.

Invitation flow: owner/admin enters email → backend creates `OrgInvite` row with a signed token → for now, returns the invite link in the response (no email sending — email infrastructure not yet wired). The invited user follows the link, which routes to `/accept-invite?token=...` and creates their account.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Alembic raw-SQL migration, Next.js 14, TanStack Query v5, Tailwind, Lucide React.

## Global Constraints

- Multi-tenant: all queries filter by `org_id`
- Only `OWNER` and `ADMIN` roles may invite, change roles, or deactivate; a user may not deactivate themselves
- An `OWNER` cannot be deactivated or have their role changed by an `ADMIN` — only another `OWNER` can
- Valid roles for assignment: all values of `UserRole` enum (`owner`, `admin`, `seo_manager`, `content_writer`, `editor`, `designer`, `marketing_manager`, `viewer`)
- Alembic migration: raw SQL `op.execute(sa.text(...))`; down_revision: `h3c4d5e6f7a8` (or `g2b3c4d5e6f7` if Phase 12b not yet run — implementer must check `alembic current`)
- New revision ID: `i4d5e6f7a8b9`
- Invite tokens: signed JWT with 7-day expiry using existing `create_access_token` from `app/core/security.py` — pass `{"sub": email, "org_id": str(org_id), "role": role, "type": "invite"}` as the payload

---

### Task 1: OrgInvite model + migration

**Files:**
- Create: `apps/api/app/models/invite.py`
- Modify: `apps/api/app/models/__init__.py`
- Create: `apps/api/alembic/versions/i4d5e6f7a8b9_phase12c_org_invites.py`

**Interfaces:**
- Produces: `OrgInvite` ORM model consumed by Tasks 2–3

- [ ] **Step 1: Create `apps/api/app/models/invite.py`**

```python
import uuid
from sqlalchemy import String, ForeignKey, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import TimestampMixin


class OrgInvite(Base, TimestampMixin):
    __tablename__ = "org_invites"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(50), nullable=False)
    token: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)
    accepted: Mapped[bool] = mapped_column(Boolean, default=False)
```

- [ ] **Step 2: Add import to `apps/api/app/models/__init__.py`**

Append:
```python
from app.models.invite import OrgInvite  # noqa: F401
```

- [ ] **Step 3: Write the migration**

First check the latest revision:
```bash
cd apps/api && docker compose exec api alembic current
```

Use the output as `down_revision`. Then create:

```python
# apps/api/alembic/versions/i4d5e6f7a8b9_phase12c_org_invites.py
"""Phase 12c: org_invites table

Revision ID: i4d5e6f7a8b9
Revises: h3c4d5e6f7a8
Create Date: 2026-06-27
"""
from alembic import op
import sqlalchemy as sa

revision = "i4d5e6f7a8b9"
down_revision = "h3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS org_invites (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            email VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL,
            token VARCHAR(500) NOT NULL UNIQUE,
            accepted BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        );
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_org_invites_org_id ON org_invites (org_id);"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_org_invites_email ON org_invites (email);"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS org_invites CASCADE;"))
```

- [ ] **Step 4: Run the migration**

```bash
cd apps/api && docker compose exec api alembic upgrade head
```
Expected: `Running upgrade ... -> i4d5e6f7a8b9, Phase 12c: org_invites table`

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/models/invite.py apps/api/app/models/__init__.py apps/api/alembic/versions/i4d5e6f7a8b9_phase12c_org_invites.py
git commit -m "feat(api): Phase 12c — OrgInvite model and migration"
```

---

### Task 2: Team service + organization router

**Files:**
- Create: `apps/api/app/services/team_service.py`
- Modify: `apps/api/app/api/v1/routers/organizations.py` (replace stubs)
- Create: `apps/api/tests/test_team.py`

**Interfaces:**
- Consumes: `OrgInvite` from Task 1, `User` model, `create_access_token` from `app/core/security.py`
- Produces:
  - `GET /organizations/{org_id}/members` → `list[MemberOut]`
  - `POST /organizations/{org_id}/invites` → `InviteOut` (201)
  - `PATCH /organizations/{org_id}/members/{user_id}` → `MemberOut`
  - `DELETE /organizations/{org_id}/members/{user_id}` → 204 (deactivate)

- [ ] **Step 1: Write the test**

```python
# apps/api/tests/test_team.py
import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.organization import Organization
from app.models.user import User, UserRole

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSession = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

FAKE_ORG_ID = uuid.uuid4()
OWNER_ID = uuid.uuid4()
fake_owner = User(
    id=OWNER_ID, org_id=FAKE_ORG_ID,
    email="owner@test.com", hashed_password="x",
    full_name="Owner", role=UserRole.OWNER, is_active=True,
)

async def override_get_db():
    async with TestSession() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise

async def override_get_current_user():
    return fake_owner

@pytest.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with TestSession() as session:
        org = Organization(id=FAKE_ORG_ID, slug="test-org", name="Test Org")
        session.add_all([org, fake_owner])
        await session.commit()
    yield
    app.dependency_overrides.clear()
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.mark.asyncio
async def test_list_members():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/api/v1/organizations/{FAKE_ORG_ID}/members", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["email"] == "owner@test.com"

@pytest.mark.asyncio
async def test_invite_member():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            f"/api/v1/organizations/{FAKE_ORG_ID}/invites",
            json={"email": "new@test.com", "role": "editor"},
            headers={"Authorization": "Bearer token"},
        )
    assert r.status_code == 201
    body = r.json()
    assert body["email"] == "new@test.com"
    assert "invite_link" in body

@pytest.mark.asyncio
async def test_update_member_role():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # add a second member
        member = User(
            id=uuid.uuid4(), org_id=FAKE_ORG_ID,
            email="member@test.com", hashed_password="x",
            full_name="Member", role=UserRole.VIEWER, is_active=True,
        )
        async with TestSession() as session:
            session.add(member)
            await session.commit()
        r = await client.patch(
            f"/api/v1/organizations/{FAKE_ORG_ID}/members/{member.id}",
            json={"role": "editor"},
            headers={"Authorization": "Bearer token"},
        )
    assert r.status_code == 200
    assert r.json()["role"] == "editor"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && python -m pytest tests/test_team.py -v
```
Expected: FAIL — stub returns wrong shape.

- [ ] **Step 3: Create the service**

```python
# apps/api/app/services/team_service.py
import uuid
from datetime import timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException
from app.models.user import User, UserRole
from app.models.invite import OrgInvite
from app.core.security import create_access_token
from app.core.config import settings

VALID_ROLES = {r.value for r in UserRole}


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

    token = create_access_token(
        data={"sub": email, "org_id": str(org_id), "role": role, "type": "invite"},
        expires_delta=timedelta(days=7),
    )
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
```

- [ ] **Step 4: Replace the organizations router**

```python
# apps/api/app/api/v1/routers/organizations.py
import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.dependencies import CurrentUser, DB
from app.core.config import settings
from app.services.team_service import list_members, create_invite, update_member_role, deactivate_member

router = APIRouter()


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
    base_url = settings.FRONTEND_URL if hasattr(settings, "FRONTEND_URL") else "http://localhost:3000"
    return InviteOut(
        id=str(invite.id),
        email=invite.email,
        role=invite.role,
        invite_link=f"{base_url}/accept-invite?token={invite.token}",
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
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/api && python -m pytest tests/test_team.py -v
```
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/services/team_service.py apps/api/app/api/v1/routers/organizations.py apps/api/tests/test_team.py
git commit -m "feat(api): Phase 12c — team service and org member endpoints"
```

---

### Task 3: Frontend — Team section in Settings

**Files:**
- Modify: `apps/web/lib/api.ts` (append team functions + interfaces)
- Modify: `apps/web/app/(dashboard)/settings/page.tsx` (add Team section)

**Interfaces:**
- Consumes: `GET /organizations/{orgId}/members`, `POST /organizations/{orgId}/invites`, `PATCH /organizations/{orgId}/members/{userId}`, `DELETE /organizations/{orgId}/members/{userId}`
- Produces: Team section with member list (avatar initials, email, role badge, status), invite form, inline role selector, deactivate button

- [ ] **Step 1: Append to api.ts**

```typescript
// ── Team / RBAC ───────────────────────────────────────────────────────────────

export interface OrgMember {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  created_at: string | null;
}

export interface OrgInvite {
  id: string;
  email: string;
  role: string;
  invite_link: string;
}

export async function listOrgMembers(orgId: string): Promise<OrgMember[]> {
  return apiClient.get<OrgMember[]>(`/organizations/${orgId}/members`);
}

export async function inviteMember(orgId: string, email: string, role: string): Promise<OrgInvite> {
  return apiClient.post<OrgInvite>(`/organizations/${orgId}/invites`, { email, role });
}

export async function updateMemberRole(orgId: string, userId: string, role: string): Promise<OrgMember> {
  return apiClient.patch<OrgMember>(`/organizations/${orgId}/members/${userId}`, { role });
}

export async function deactivateMember(orgId: string, userId: string): Promise<void> {
  return apiClient.delete<void>(`/organizations/${orgId}/members/${userId}`);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Add TeamSection to Settings page**

Add these imports (merge with existing):
```tsx
import { UserX, UserPlus, Copy, Check } from "lucide-react";
import { listOrgMembers, inviteMember, updateMemberRole, deactivateMember, type OrgMember } from "@/lib/api";
```

Add the `TeamSection` component before `SettingsPage`:

```tsx
const ROLE_OPTIONS = [
  "owner", "admin", "seo_manager", "content_writer",
  "editor", "designer", "marketing_manager", "viewer",
] as const;

function initials(name: string): string {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

function TeamSection({ orgId, myId, myRole }: { orgId: string; myId: string; myRole: string }) {
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "viewer" });
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canManage = myRole === "owner" || myRole === "admin";

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["org-members", orgId],
    queryFn: () => listOrgMembers(orgId),
    staleTime: 60_000,
  });

  const inviteMutation = useMutation({
    mutationFn: () => inviteMember(orgId, inviteForm.email, inviteForm.role),
    onSuccess: (data) => {
      setInviteLink(data.invite_link);
      setInviteForm({ email: "", role: "viewer" });
    },
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      updateMemberRole(orgId, userId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-members", orgId] }),
  });

  const deactivateMutationFn = useMutation({
    mutationFn: (userId: string) => deactivateMember(orgId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org-members", orgId] }),
  });

  const copyLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-6 py-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Team Members</h2>
        {canManage && (
          <button
            onClick={() => { setShowInvite((v) => !v); setInviteLink(null); }}
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <UserPlus className="h-3 w-3" /> Invite
          </button>
        )}
      </div>
      <div className="px-6 py-5 flex flex-col gap-4">
        {showInvite && canManage && (
          <div className="flex flex-col gap-3 rounded-md border p-4">
            {inviteLink ? (
              <>
                <p className="text-sm font-medium text-green-600">Invite link generated</p>
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                  <p className="flex-1 truncate font-mono text-xs text-muted-foreground">{inviteLink}</p>
                  <button onClick={copyLink} className="shrink-0 text-muted-foreground hover:text-foreground">
                    {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <button
                  onClick={() => { setShowInvite(false); setInviteLink(null); }}
                  className="self-start rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <input
                  type="email"
                  placeholder="colleague@company.com"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                  className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <select
                  value={inviteForm.role}
                  onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value }))}
                  className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={() => inviteMutation.mutate()}
                    disabled={!inviteForm.email.trim() || inviteMutation.isPending}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {inviteMutation.isPending ? "Sending…" : "Generate invite link"}
                  </button>
                  <button
                    onClick={() => setShowInvite(false)}
                    className="rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="h-10 animate-pulse rounded bg-muted/30" />
        ) : (
          <div className="flex flex-col gap-2">
            {members.map((m) => (
              <div
                key={m.id}
                className={`flex items-center justify-between rounded-md border px-4 py-3 ${!m.is_active ? "opacity-50" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {initials(m.full_name)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{m.full_name}</p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canManage && m.id !== myId ? (
                    <select
                      value={m.role}
                      onChange={(e) => roleMutation.mutate({ userId: m.id, role: e.target.value })}
                      disabled={roleMutation.isPending}
                      className="rounded-md border bg-background px-2 py-1 text-xs focus:outline-none"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      {ROLE_LABELS[m.role] ?? m.role}
                    </span>
                  )}
                  {!m.is_active && (
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                      Inactive
                    </span>
                  )}
                  {canManage && m.id !== myId && m.is_active && (
                    <button
                      onClick={() => deactivateMutationFn.mutate(m.id)}
                      disabled={deactivateMutationFn.isPending}
                      className="text-muted-foreground hover:text-destructive"
                      title="Deactivate member"
                    >
                      <UserX className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

4. In `SettingsPage`, the `me` query already runs. Add `<TeamSection>` after the Organization section:

```tsx
{me && (
  <TeamSection orgId={me.org_id} myId={me.id} myRole={me.role} />
)}
```

Note: `me.org_id` is a UUID — pass `String(me.org_id)` if TypeScript complains about the type, since `UserProfile.org_id` is typed as `string` in `api.ts`.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/api.ts apps/web/app/(dashboard)/settings/page.tsx
git commit -m "feat(web): Settings — team members section with invite, role change, deactivate"
```
