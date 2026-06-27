# LLM API Keys (BYOK) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let org owners/admins add and delete their own OpenAI, Anthropic, and Google API keys via Settings; the LLM router uses whichever keys are stored.

**Architecture:** `APIKey` model already exists with `provider` (string) and `encrypted_value` (Fernet-encrypted text). `encrypt_value`/`decrypt_value` are in `app/core/security.py`. We wire up the `api_keys` router stub, add a service layer, expose 3 endpoints (list, create, delete), and add an LLM Keys section to the Settings page.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Fernet encryption (already wired), Next.js 14 App Router, TanStack Query v5, Tailwind, Lucide React.

## Global Constraints

- Multi-tenant: all DB queries filter by `org_id` (from `current_user.org_id`)
- Encrypted storage: API key values stored via `encrypt_value()`; list endpoint returns masked values (last 4 chars only, e.g. `sk-...ab12`) — never returns the full key
- Only `OWNER` and `ADMIN` roles may create/delete keys; `GET` is open to all authenticated users
- Alembic migration uses raw SQL `op.execute(sa.text(...))` — no `op.create_table()`
- Valid `provider` values: `"openai"`, `"anthropic"`, `"google"` (lowercase, exact)
- Latest Alembic revision (down_revision): `g2b3c4d5e6f7`

---

### Task 1: API Keys service + router

**Files:**
- Create: `apps/api/app/services/api_keys_service.py`
- Modify: `apps/api/app/api/v1/routers/api_keys.py` (replace stub)
- Create: `apps/api/tests/test_api_keys.py`

**Interfaces:**
- Produces:
  - `GET /api-keys` → `list[ApiKeyOut]`
  - `POST /api-keys` → `ApiKeyOut` (201)
  - `DELETE /api-keys/{key_id}` → 204

- [ ] **Step 1: Write the test**

```python
# apps/api/tests/test_api_keys.py
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
        r = await client.get("/api/v1/api-keys", headers={"Authorization": "Bearer token"})
    assert r.status_code == 200
    assert r.json() == []

@pytest.mark.asyncio
async def test_create_and_list():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/api/v1/api-keys", json={"provider": "openai", "value": "sk-test1234abcd"}, headers={"Authorization": "Bearer token"})
    assert r.status_code == 201
    body = r.json()
    assert body["provider"] == "openai"
    assert "sk-test1234abcd" not in body["masked_value"]
    assert body["masked_value"].endswith("abcd")

@pytest.mark.asyncio
async def test_delete():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        create = await client.post("/api/v1/api-keys", json={"provider": "anthropic", "value": "sk-ant-xyz9"}, headers={"Authorization": "Bearer token"})
        key_id = create.json()["id"]
        r = await client.delete(f"/api/v1/api-keys/{key_id}", headers={"Authorization": "Bearer token"})
    assert r.status_code == 204
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && python -m pytest tests/test_api_keys.py -v
```
Expected: FAIL — stub router returns wrong shape.

- [ ] **Step 3: Create the service**

```python
# apps/api/app/services/api_keys_service.py
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.api_key import APIKey
from app.core.security import encrypt_value, decrypt_value

VALID_PROVIDERS = {"openai", "anthropic", "google"}


def _mask(value: str) -> str:
    """Return last-4 chars masked as sk-...XXXX."""
    tail = value[-4:] if len(value) >= 4 else value
    return f"sk-...{tail}"


async def list_keys(org_id: uuid.UUID, db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(APIKey).where(APIKey.org_id == org_id).order_by(APIKey.created_at)
    )
    keys = result.scalars().all()
    return [
        {
            "id": str(k.id),
            "provider": k.provider,
            "masked_value": _mask(decrypt_value(k.encrypted_value)),
            "created_at": k.created_at.isoformat() if k.created_at else None,
        }
        for k in keys
    ]


async def create_key(org_id: uuid.UUID, provider: str, value: str, db: AsyncSession) -> dict:
    if provider not in VALID_PROVIDERS:
        raise ValueError(f"Invalid provider. Must be one of: {', '.join(sorted(VALID_PROVIDERS))}")
    key = APIKey(
        org_id=org_id,
        provider=provider,
        encrypted_value=encrypt_value(value),
    )
    db.add(key)
    await db.commit()
    await db.refresh(key)
    return {
        "id": str(key.id),
        "provider": key.provider,
        "masked_value": _mask(value),
        "created_at": key.created_at.isoformat() if key.created_at else None,
    }


async def delete_key(key_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> bool:
    result = await db.execute(
        select(APIKey).where(APIKey.id == key_id, APIKey.org_id == org_id)
    )
    key = result.scalar_one_or_none()
    if not key:
        return False
    await db.delete(key)
    await db.commit()
    return True
```

- [ ] **Step 4: Replace the router**

```python
# apps/api/app/api/v1/routers/api_keys.py
import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.dependencies import CurrentUser, DB
from app.services.api_keys_service import list_keys, create_key, delete_key

router = APIRouter()


class ApiKeyOut(BaseModel):
    id: str
    provider: str
    masked_value: str
    created_at: str | None


class ApiKeyCreate(BaseModel):
    provider: str
    value: str


@router.get("", response_model=list[ApiKeyOut])
async def get_api_keys(current_user: CurrentUser, db: DB):
    return await list_keys(current_user.org_id, db)


@router.post("", response_model=ApiKeyOut, status_code=201)
async def add_api_key(body: ApiKeyCreate, current_user: CurrentUser, db: DB):
    try:
        return await create_key(current_user.org_id, body.provider, body.value, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{key_id}", status_code=204)
async def remove_api_key(key_id: uuid.UUID, current_user: CurrentUser, db: DB):
    deleted = await delete_key(key_id, current_user.org_id, db)
    if not deleted:
        raise HTTPException(status_code=404, detail="Key not found")
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/api && python -m pytest tests/test_api_keys.py -v
```
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/services/api_keys_service.py apps/api/app/api/v1/routers/api_keys.py apps/api/tests/test_api_keys.py
git commit -m "feat(api): LLM API keys — list, create, delete endpoints"
```

---

### Task 2: Frontend — LLM Keys section in Settings

**Files:**
- Modify: `apps/web/lib/api.ts` (append 3 functions + 1 interface)
- Modify: `apps/web/app/(dashboard)/settings/page.tsx` (add LLM Keys section)

**Interfaces:**
- Consumes: `GET /api-keys`, `POST /api-keys`, `DELETE /api-keys/{id}`
- Produces: LLM Keys section in Settings showing provider pills with masked values, add form, delete button

- [ ] **Step 1: Append to api.ts**

Append after the existing last export in `apps/web/lib/api.ts`:

```typescript
// ── LLM API Keys ─────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string;
  provider: string;
  masked_value: string;
  created_at: string | null;
}

export async function listApiKeys(): Promise<ApiKey[]> {
  return apiClient.get<ApiKey[]>("/api-keys");
}

export async function createApiKey(provider: string, value: string): Promise<ApiKey> {
  return apiClient.post<ApiKey>("/api-keys", { provider, value });
}

export async function deleteApiKey(keyId: string): Promise<void> {
  return apiClient.delete<void>(`/api-keys/${keyId}`);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Add LLM Keys section to Settings page**

In `apps/web/app/(dashboard)/settings/page.tsx`:

1. Add imports at the top:
```tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, Plus, Eye, EyeOff } from "lucide-react";
import { listApiKeys, createApiKey, deleteApiKey, type ApiKey } from "@/lib/api";
```

2. Add a new `LLMKeysSection` component before `SettingsPage`:

```tsx
const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
};

const PROVIDERS = ["openai", "anthropic", "google"] as const;

function LLMKeysSection() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState<string>("openai");
  const [value, setValue] = useState("");
  const [showValue, setShowValue] = useState(false);

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: listApiKeys,
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: () => createApiKey(provider, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      setValue("");
      setShowForm(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-6 py-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">LLM API Keys</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-3 w-3" /> Add key
        </button>
      </div>
      <div className="px-6 py-5 flex flex-col gap-4">
        {showForm && (
          <div className="flex flex-col gap-3 rounded-md border p-4">
            <div className="flex gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                    provider === p
                      ? "bg-primary text-primary-foreground border-primary"
                      : "text-muted-foreground border-border hover:border-foreground"
                  }`}
                >
                  {PROVIDER_LABELS[p]}
                </button>
              ))}
            </div>
            <div className="relative">
              <input
                type={showValue ? "text" : "password"}
                placeholder="sk-..."
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="button"
                onClick={() => setShowValue((v) => !v)}
                className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
              >
                {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => addMutation.mutate()}
                disabled={!value.trim() || addMutation.isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {addMutation.isPending ? "Saving…" : "Save key"}
              </button>
              <button
                onClick={() => { setShowForm(false); setValue(""); }}
                className="rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
            {addMutation.isError && (
              <p className="text-xs text-destructive">Failed to save key. Check the value and try again.</p>
            )}
          </div>
        )}
        {isLoading ? (
          <div className="h-10 animate-pulse rounded bg-muted/30" />
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No API keys added yet. Add keys to enable AI features.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between rounded-md border px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {PROVIDER_LABELS[k.provider] ?? k.provider}
                  </span>
                  <span className="font-mono text-sm text-muted-foreground">{k.masked_value}</span>
                </div>
                <button
                  onClick={() => deleteMutation.mutate(k.id)}
                  disabled={deleteMutation.isPending}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

3. Add `<LLMKeysSection />` to `SettingsPage` return, after the `<Section title="Organization">` block and before `<Section title="Integrations">`.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/api.ts apps/web/app/(dashboard)/settings/page.tsx
git commit -m "feat(web): Settings — LLM API keys section (BYOK)"
```
