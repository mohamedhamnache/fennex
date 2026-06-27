# Social Network Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users connect Twitter/X, LinkedIn, Instagram, and Facebook accounts to their org by pasting an access token; the social studio reads these connections to know which platforms are active.

**Architecture:** Add a new `SocialConnection` model (org-scoped, one row per platform) that stores the encrypted access token and display handle. Expose CRUD endpoints under `/social/connections`. Add a "Social Accounts" section to Settings. The social studio page can later check connection status before publishing.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Fernet encryption (`encrypt_value`/`decrypt_value` from `app/core/security.py`), Alembic raw-SQL migration, Next.js 14, TanStack Query v5, Tailwind, Lucide React.

## Global Constraints

- Multi-tenant: all DB queries filter by `org_id`
- Access tokens stored encrypted via `encrypt_value()`; GET returns handle + platform only, never the raw token
- Valid `platform` values: `"twitter"`, `"linkedin"`, `"instagram"`, `"facebook"` (must match existing `SocialPlatform` enum in `app/models/social.py`)
- One connection per platform per org (unique constraint on `(org_id, platform)`)
- Alembic migration uses raw SQL `op.execute(sa.text(...))`; down_revision: `g2b3c4d5e6f7`
- New revision ID: `h3c4d5e6f7a8`

---

### Task 1: SocialConnection model + migration

**Files:**
- Modify: `apps/api/app/models/social.py` (append `SocialConnection` class)
- Modify: `apps/api/app/models/__init__.py` (add import)
- Create: `apps/api/alembic/versions/h3c4d5e6f7a8_phase12b_social_connections.py`

**Interfaces:**
- Produces: `SocialConnection` ORM model consumed by Task 2

- [ ] **Step 1: Append `SocialConnection` to `apps/api/app/models/social.py`**

After the existing `SocialPost` class, append:

```python
class SocialConnection(Base, TimestampMixin):
    __tablename__ = "social_connections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    platform: Mapped[SocialPlatform] = mapped_column(
        SAEnum(SocialPlatform, name="social_platform_enum"), nullable=False
    )
    handle: Mapped[str | None] = mapped_column(String(200))          # @username or page name
    encrypted_token: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        UniqueConstraint("org_id", "platform", name="uq_social_connection_org_platform"),
    )
```

Also add `UniqueConstraint` to the imports at the top of `social.py`:

```python
from sqlalchemy import String, ForeignKey, Text, Enum as SAEnum, Integer, Boolean, JSON, UniqueConstraint
```

- [ ] **Step 2: Add import to `apps/api/app/models/__init__.py`**

Append to the existing imports:

```python
from app.models.social import SocialConnection  # noqa: F401  (already imports SocialPost)
```

Note: the existing line imports `SocialPost` from `app.models.social` — update it to also import `SocialConnection`:

```python
from app.models.social import SocialPost, SocialConnection  # noqa: F401
```

- [ ] **Step 3: Write the migration**

```python
# apps/api/alembic/versions/h3c4d5e6f7a8_phase12b_social_connections.py
"""Phase 12b: social_connections table

Revision ID: h3c4d5e6f7a8
Revises: g2b3c4d5e6f7
Create Date: 2026-06-27
"""
from alembic import op
import sqlalchemy as sa

revision = "h3c4d5e6f7a8"
down_revision = "g2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS social_connections (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            platform social_platform_enum NOT NULL,
            handle VARCHAR(200),
            encrypted_token TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT uq_social_connection_org_platform UNIQUE (org_id, platform)
        );
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_social_connections_org_id ON social_connections (org_id);"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS social_connections CASCADE;"))
```

- [ ] **Step 4: Run the migration**

```bash
cd apps/api && docker compose exec api alembic upgrade head
```
Expected: `Running upgrade g2b3c4d5e6f7 -> h3c4d5e6f7a8, Phase 12b: social_connections table`

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/models/social.py apps/api/app/models/__init__.py apps/api/alembic/versions/h3c4d5e6f7a8_phase12b_social_connections.py
git commit -m "feat(api): Phase 12b — SocialConnection model and migration"
```

---

### Task 2: Social connections service + router

**Files:**
- Create: `apps/api/app/services/social_connections_service.py`
- Modify: `apps/api/app/api/v1/routers/social.py` (append connection endpoints)
- Create: `apps/api/tests/test_social_connections.py`

**Interfaces:**
- Consumes: `SocialConnection` model from Task 1
- Produces:
  - `GET /social/connections` → `list[SocialConnectionOut]`
  - `PUT /social/connections/{platform}` → `SocialConnectionOut` (upsert, 200)
  - `DELETE /social/connections/{platform}` → 204

- [ ] **Step 1: Write the test**

```python
# apps/api/tests/test_social_connections.py
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
fake_user = User(
    id=uuid.uuid4(), org_id=FAKE_ORG_ID,
    email="admin@test.com", hashed_password="x",
    full_name="Admin", role=UserRole.ADMIN, is_active=True,
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
    return fake_user

@pytest.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with TestSession() as session:
        org = Organization(id=FAKE_ORG_ID, slug="test-org", name="Test Org")
        session.add(org)
        await session.commit()
    yield
    app.dependency_overrides.clear()
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.mark.asyncio
async def test_list_empty():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/social/connections", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    assert r.json() == []

@pytest.mark.asyncio
async def test_upsert_and_list():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.put(
            "/api/v1/social/connections/linkedin",
            json={"handle": "@mypage", "token": "my-secret-token"},
            headers={"Authorization": "Bearer token"},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["platform"] == "linkedin"
    assert body["handle"] == "@mypage"
    assert "token" not in body  # raw token never returned

@pytest.mark.asyncio
async def test_delete():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.put(
            "/api/v1/social/connections/twitter",
            json={"handle": "@acme", "token": "tok123"},
            headers={"Authorization": "Bearer token"},
        )
        r = await client.delete("/api/v1/social/connections/twitter", headers={"Authorization": "Bearer token"})
    assert r.status_code == 204
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && python -m pytest tests/test_social_connections.py -v
```
Expected: FAIL — endpoints don't exist.

- [ ] **Step 3: Create the service**

```python
# apps/api/app/services/social_connections_service.py
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.social import SocialConnection, SocialPlatform
from app.core.security import encrypt_value

VALID_PLATFORMS = {p.value for p in SocialPlatform}


async def list_connections(org_id: uuid.UUID, db: AsyncSession) -> list[SocialConnection]:
    result = await db.execute(
        select(SocialConnection).where(SocialConnection.org_id == org_id).order_by(SocialConnection.platform)
    )
    return list(result.scalars().all())


async def upsert_connection(
    org_id: uuid.UUID,
    platform: str,
    handle: str | None,
    token: str,
    db: AsyncSession,
) -> SocialConnection:
    result = await db.execute(
        select(SocialConnection).where(
            SocialConnection.org_id == org_id,
            SocialConnection.platform == platform,
        )
    )
    conn = result.scalar_one_or_none()
    if conn:
        conn.handle = handle
        conn.encrypted_token = encrypt_value(token)
    else:
        conn = SocialConnection(
            org_id=org_id,
            platform=platform,
            handle=handle,
            encrypted_token=encrypt_value(token),
        )
        db.add(conn)
    await db.commit()
    await db.refresh(conn)
    return conn


async def delete_connection(org_id: uuid.UUID, platform: str, db: AsyncSession) -> bool:
    result = await db.execute(
        select(SocialConnection).where(
            SocialConnection.org_id == org_id,
            SocialConnection.platform == platform,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn:
        return False
    await db.delete(conn)
    await db.commit()
    return True
```

- [ ] **Step 4: Append connection endpoints to the social router**

Open `apps/api/app/api/v1/routers/social.py` and append at the bottom (after existing social post endpoints):

```python
# ── Social Connections ────────────────────────────────────────────────────────
from pydantic import BaseModel as _BaseModel

class SocialConnectionOut(_BaseModel):
    id: str
    platform: str
    handle: str | None
    model_config = {"from_attributes": True}

class SocialConnectionUpsert(_BaseModel):
    handle: str | None = None
    token: str


@router.get("/connections", response_model=list[SocialConnectionOut])
async def list_social_connections(current_user: CurrentUser, db: DB):
    from app.services.social_connections_service import list_connections
    conns = await list_connections(current_user.org_id, db)
    return [SocialConnectionOut(id=str(c.id), platform=c.platform, handle=c.handle) for c in conns]


@router.put("/connections/{platform}", response_model=SocialConnectionOut)
async def upsert_social_connection(
    platform: str,
    body: SocialConnectionUpsert,
    current_user: CurrentUser,
    db: DB,
):
    from app.services.social_connections_service import upsert_connection, VALID_PLATFORMS
    if platform not in VALID_PLATFORMS:
        raise HTTPException(status_code=400, detail=f"Invalid platform. Must be one of: {', '.join(sorted(VALID_PLATFORMS))}")
    conn = await upsert_connection(current_user.org_id, platform, body.handle, body.token, db)
    return SocialConnectionOut(id=str(conn.id), platform=conn.platform, handle=conn.handle)


@router.delete("/connections/{platform}", status_code=204)
async def delete_social_connection(platform: str, current_user: CurrentUser, db: DB):
    from app.services.social_connections_service import delete_connection
    deleted = await delete_connection(current_user.org_id, platform, db)
    if not deleted:
        raise HTTPException(status_code=404, detail="Connection not found")
```

Also confirm `HTTPException` is already imported in `social.py` — if not, add:
```python
from fastapi import APIRouter, HTTPException
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/api && python -m pytest tests/test_social_connections.py -v
```
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/services/social_connections_service.py apps/api/app/api/v1/routers/social.py apps/api/tests/test_social_connections.py
git commit -m "feat(api): Phase 12b — social connections service and endpoints"
```

---

### Task 3: Frontend — Social Accounts section in Settings

**Files:**
- Modify: `apps/web/lib/api.ts` (append 3 functions + 1 interface)
- Modify: `apps/web/app/(dashboard)/settings/page.tsx` (add Social Accounts section)

**Interfaces:**
- Consumes: `GET /social/connections`, `PUT /social/connections/{platform}`, `DELETE /social/connections/{platform}`
- Produces: Social Accounts section showing connected platforms with handle, connect form (token paste), disconnect button

- [ ] **Step 1: Append to api.ts**

```typescript
// ── Social Connections ────────────────────────────────────────────────────────

export interface SocialConnection {
  id: string;
  platform: string;
  handle: string | null;
}

export async function listSocialConnections(): Promise<SocialConnection[]> {
  return apiClient.get<SocialConnection[]>("/social/connections");
}

export async function upsertSocialConnection(
  platform: string,
  handle: string | null,
  token: string
): Promise<SocialConnection> {
  return apiClient.put<SocialConnection>(`/social/connections/${platform}`, { handle, token });
}

export async function deleteSocialConnection(platform: string): Promise<void> {
  return apiClient.delete<void>(`/social/connections/${platform}`);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Add SocialAccountsSection to Settings page**

In `apps/web/app/(dashboard)/settings/page.tsx`, add these imports (merge with existing imports):
```tsx
import { Link2, Link2Off } from "lucide-react";
import { listSocialConnections, upsertSocialConnection, deleteSocialConnection, type SocialConnection } from "@/lib/api";
```

Add the `SocialAccountsSection` component before `SettingsPage`:

```tsx
const SOCIAL_PLATFORMS = [
  { id: "twitter", label: "Twitter / X", icon: "𝕏", placeholder: "Bearer eyJ..." },
  { id: "linkedin", label: "LinkedIn", icon: "in", placeholder: "AQX..." },
  { id: "instagram", label: "Instagram", icon: "📷", placeholder: "EAA..." },
  { id: "facebook", label: "Facebook", icon: "f", placeholder: "EAA..." },
] as const;

type PlatformId = (typeof SOCIAL_PLATFORMS)[number]["id"];

function SocialAccountsSection() {
  const qc = useQueryClient();
  const [connecting, setConnecting] = useState<PlatformId | null>(null);
  const [form, setForm] = useState({ handle: "", token: "" });

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ["social-connections"],
    queryFn: listSocialConnections,
    staleTime: 60_000,
  });

  const connected = new Map(connections.map((c) => [c.platform, c]));

  const connectMutation = useMutation({
    mutationFn: () =>
      upsertSocialConnection(connecting!, form.handle || null, form.token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["social-connections"] });
      setConnecting(null);
      setForm({ handle: "", token: "" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (platform: string) => deleteSocialConnection(platform),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["social-connections"] }),
  });

  const platform = SOCIAL_PLATFORMS.find((p) => p.id === connecting);

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-6 py-4">
        <h2 className="text-sm font-semibold">Social Accounts</h2>
      </div>
      <div className="px-6 py-5 flex flex-col gap-3">
        {isLoading ? (
          <div className="h-10 animate-pulse rounded bg-muted/30" />
        ) : (
          SOCIAL_PLATFORMS.map((p) => {
            const conn = connected.get(p.id);
            return (
              <div key={p.id} className="flex items-center justify-between rounded-md border px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="w-6 text-center text-sm font-bold">{p.icon}</span>
                  <div>
                    <p className="text-sm font-medium">{p.label}</p>
                    {conn?.handle && (
                      <p className="text-xs text-muted-foreground">{conn.handle}</p>
                    )}
                  </div>
                </div>
                {conn ? (
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600">
                      Connected
                    </span>
                    <button
                      onClick={() => disconnectMutation.mutate(p.id)}
                      disabled={disconnectMutation.isPending}
                      className="text-muted-foreground hover:text-destructive"
                      title="Disconnect"
                    >
                      <Link2Off className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConnecting(p.id)}
                    className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground"
                  >
                    <Link2 className="h-3 w-3" /> Connect
                  </button>
                )}
              </div>
            );
          })
        )}

        {connecting && platform && (
          <div className="flex flex-col gap-3 rounded-md border p-4 bg-muted/20">
            <p className="text-sm font-medium">Connect {platform.label}</p>
            <input
              type="text"
              placeholder="Handle (e.g. @yourcompany)"
              value={form.handle}
              onChange={(e) => setForm((f) => ({ ...f, handle: e.target.value }))}
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <input
              type="password"
              placeholder={platform.placeholder}
              value={form.token}
              onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
              className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <p className="text-xs text-muted-foreground">
              Paste your access token. Get it from the {platform.label} developer portal.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => connectMutation.mutate()}
                disabled={!form.token.trim() || connectMutation.isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {connectMutation.isPending ? "Connecting…" : "Connect"}
              </button>
              <button
                onClick={() => { setConnecting(null); setForm({ handle: "", token: "" }); }}
                className="rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
            {connectMutation.isError && (
              <p className="text-xs text-destructive">Failed to connect. Check your token and try again.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

Add `<SocialAccountsSection />` to `SettingsPage` return after `<LLMKeysSection />` (or after Organization if LLM plan not yet implemented).

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/api.ts apps/web/app/(dashboard)/settings/page.tsx
git commit -m "feat(web): Settings — social accounts connect/disconnect section"
```
