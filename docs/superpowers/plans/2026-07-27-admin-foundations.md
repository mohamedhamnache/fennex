# Admin Console — Phase 1a: Foundations + Executive Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the staff-only admin console walking skeleton — a new `apps/admin` where a staff member logs in, is RBAC-gated, and sees a live Executive dashboard (revenue, COGS, margin, usage) — establishing every pattern the later shallow section pages replicate.

**Architecture:** New `apps/admin` (Next.js 14) talks only to RBAC-gated `/api/v1/admin/*` routers in the existing `apps/api`. Staff identity (`admin_user`) is isolated from customer `user`. Trend/KPI reads come from a pre-aggregated `usage_daily` rollup (nightly arq cron). Design spec: `docs/superpowers/specs/2026-07-27-admin-dashboard-design.md`.

**Tech Stack:** Backend: FastAPI, SQLAlchemy 2 async, Alembic, arq, passlib(bcrypt), python-jose. Frontend: Next.js 14 App Router, React 18, TypeScript, Tailwind (CSS variables), `@fennex/ui`, `@fennex/types`, Tremor (charts), TanStack Query, Zustand, cmdk.

## Global Constraints

- **Money is integer micro-dollars** ($1 = 1,000,000) end to end; format only at the UI edge. `cost_rate.micro_dollars_per_unit` stays FLOAT (per token).
- **Revenue allocation is deferred** (spec open item): `usage_daily` stores cost + usage only. Platform margin = MRR (from `billing`) − COGS (from `usage_daily`); no per-row `revenue_micros` in this phase.
- **Backend tests run on HOST with in-memory SQLite** (`sqlite+aiosqlite:///:memory:`), `asyncio_mode="auto"` (NO `@pytest.mark.asyncio`). Each test file stands up its own engine + an autouse `setup_db` fixture that runs `Base.metadata.create_all`/`drop_all`. New models MUST be import-registered in `apps/api/app/models/__init__.py`. Use only SQLite-safe column types in test-relevant tables (no `JSONB`/`Vector`; use `JSON`/`Text`). SQLAlchemy `default=` applies at flush, not construction; a migration `server_default` is what backfills existing rows.
- **Single Alembic head.** Current head on this branch is `l8h9i0j1k2l3`; migrations in this plan chain linearly: `m9i0j1k2l3m4` (admin RBAC) → `n0j1k2l3m4n5` (usage_daily). Apply with `make db-migrate` from repo root.
- **Admin auth is separate from customer auth.** Admin JWTs reuse `settings.SECRET_KEY`/`ALGORITHM` via `create_access_token` but carry `scope: "admin"`, `sub: <admin_user_id>`, and `roles: [...]`. `get_current_admin` rejects any token lacking `scope == "admin"`.
- **RBAC enforced server-side** on every `/admin/*` route; the 7 roles are Super Admin, Support, Finance, Marketing, Operations, Developer, Auditor. Auditor may never mutate.
- **Frontend rules (from CLAUDE.md):** App Router + TypeScript; Tailwind CSS variables only (never hard-code colors); use the admin `apiClient` (never call `fetch` directly in components); user-visible strings through `t()` (i18n); `cn()` for conditional classes; reuse `@fennex/ui`. No test framework — verify every frontend task with `npm run typecheck` (from `apps/admin`) and a note for visual check.
- **No emoji** anywhere (code, UI, comments, commits). Commit style `feat(admin): …`; every commit ends with trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

```
apps/api/app/
  models/admin_user.py            AdminUser, AdminRole, AdminRoleAssignment
  models/usage_daily.py           UsageDaily rollup
  core/admin_auth.py              create_admin_token, get_current_admin, require_admin, ROLE_PERMISSIONS
  api/v1/routers/admin_auth.py    /admin/auth/login, /admin/auth/logout, /admin/me
  api/v1/routers/admin_overview.py /admin/overview/kpis, /admin/overview/series
  services/admin/rollup.py        rollup_usage_daily(db, day) + rollup_daily_job(ctx)
  workers/worker.py               + cron(rollup_daily_job) and function registration
  alembic/versions/m9i0j1k2l3m4_admin_rbac.py
  alembic/versions/n0j1k2l3m4n5_usage_daily.py
apps/admin/                       new Next.js 14 app (@fennex/admin), dev port 3002
  app/(auth)/login/page.tsx
  app/(console)/layout.tsx overview/page.tsx
  components/shell/*  components/kpi/*  components/charts/*  components/common/RoleGate.tsx
  lib/api.ts lib/query.ts lib/rbac.ts store.ts
```

---

### Task 1: Admin RBAC models + migration + seeded roles

**Files:**
- Create: `apps/api/app/models/admin_user.py`
- Modify: `apps/api/app/models/__init__.py`
- Create: `apps/api/alembic/versions/m9i0j1k2l3m4_admin_rbac.py`
- Test: `apps/api/tests/test_admin_rbac_model.py`

**Interfaces:**
- Produces: `AdminUser(id, email, name, password_hash, is_active, mfa_enabled, last_login_at, created_at)`, `AdminRole(id, key, name, description)`, `AdminRoleAssignment(admin_user_id, role_id)`. Seeded role keys: `super_admin, support, finance, marketing, operations, developer, auditor`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_admin_rbac_model.py
import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
import pytest
from app.core.database import Base
from app.models.admin_user import AdminUser, AdminRole, AdminRoleAssignment

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)

async def test_admin_user_role_assignment_roundtrip():
    async with Session() as db:
        role = AdminRole(key="support", name="Support", description="")
        admin = AdminUser(email="ops@fennex.io", name="Ops", password_hash="x", is_active=True)
        db.add_all([role, admin])
        await db.flush()
        db.add(AdminRoleAssignment(admin_user_id=admin.id, role_id=role.id))
        await db.commit()
        got = (await db.execute(select(AdminUser).where(AdminUser.email == "ops@fennex.io"))).scalar_one()
        assert got.is_active is True
        assignments = (await db.execute(select(AdminRoleAssignment))).scalars().all()
        assert len(assignments) == 1 and assignments[0].role_id == role.id
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_admin_rbac_model.py -v`
Expected: FAIL (`ModuleNotFoundError: app.models.admin_user`).

- [ ] **Step 3: Create the models**

```python
# apps/api/app/models/admin_user.py
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

def _uuid_col():
    # matches the project's existing UUID PK pattern (string on sqlite via SA)
    return mapped_column(PGUUID(as_uuid=True).with_variant(String(36), "sqlite"),
                         primary_key=True, default=uuid.uuid4)

class AdminUser(Base):
    __tablename__ = "admin_user"
    id: Mapped[uuid.UUID] = _uuid_col()
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class AdminRole(Base):
    __tablename__ = "admin_role"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")

class AdminRoleAssignment(Base):
    __tablename__ = "admin_role_assignment"
    admin_user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True).with_variant(String(36), "sqlite"),
        ForeignKey("admin_user.id", ondelete="CASCADE"), primary_key=True)
    role_id: Mapped[int] = mapped_column(
        ForeignKey("admin_role.id", ondelete="CASCADE"), primary_key=True)
```

Confirm the existing UUID PK style by opening `apps/api/app/models/organization.py`; if it uses a shared helper or plain `PGUUID(as_uuid=True)`, match that exactly instead of the `_uuid_col` helper above (keep behavior: UUID PK on Postgres, string on SQLite tests).

- [ ] **Step 4: Register the models**

In `apps/api/app/models/__init__.py`, add: `from app.models.admin_user import AdminUser, AdminRole, AdminRoleAssignment` and include them in `__all__` if that list exists (match the file's existing convention).

- [ ] **Step 5: Write the migration (chains from `l8h9i0j1k2l3`) with role seed**

```python
# apps/api/alembic/versions/m9i0j1k2l3m4_admin_rbac.py
from alembic import op
import sqlalchemy as sa

revision = "m9i0j1k2l3m4"
down_revision = "l8h9i0j1k2l3"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        "admin_user",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("name", sa.String(255), server_default=""),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("mfa_enabled", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_admin_user_email", "admin_user", ["email"])
    op.create_table(
        "admin_role",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("key", sa.String(50), nullable=False, unique=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text, server_default=""),
    )
    op.create_table(
        "admin_role_assignment",
        sa.Column("admin_user_id", sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("admin_user.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role_id", sa.Integer,
                  sa.ForeignKey("admin_role.id", ondelete="CASCADE"), primary_key=True),
    )
    op.execute("""
        INSERT INTO admin_role (key, name, description) VALUES
          ('super_admin','Super Admin','Full access'),
          ('support','Support','Read + impersonate + reset quotas'),
          ('finance','Finance','Billing and revenue'),
          ('marketing','Marketing','Growth and usage read'),
          ('operations','Operations','Queue, providers, flags'),
          ('developer','Developer','System, flags, integrations'),
          ('auditor','Auditor','Read-only, no mutations')
        ON CONFLICT (key) DO NOTHING
    """)

def downgrade():
    op.drop_table("admin_role_assignment")
    op.drop_table("admin_role")
    op.drop_index("ix_admin_user_email", table_name="admin_user")
    op.drop_table("admin_user")
```

- [ ] **Step 6: Run the model test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_admin_rbac_model.py -v` → PASS.

- [ ] **Step 7: Apply the migration and confirm head + seed**

Run: `make db-migrate` (from repo root). Confirm alembic head is `m9i0j1k2l3m4` and `SELECT count(*) FROM admin_role;` returns 7.

- [ ] **Step 8: Full suite + commit**

Run: `cd apps/api && python -m pytest -q` (ignore known pre-existing failures; confirm no NEW failures). Commit:
```bash
git add apps/api/app/models/admin_user.py apps/api/app/models/__init__.py \
        apps/api/alembic/versions/m9i0j1k2l3m4_admin_rbac.py apps/api/tests/test_admin_rbac_model.py
git commit -m "feat(admin): admin_user + RBAC roles model, migration, seed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Admin auth core — token, current-admin, require_admin, permission map

**Files:**
- Create: `apps/api/app/core/admin_auth.py`
- Modify: `apps/api/app/core/config.py` (add `ADMIN_BOOTSTRAP_EMAIL: str = ""`, `ADMIN_BOOTSTRAP_PASSWORD: str = ""`)
- Test: `apps/api/tests/test_admin_auth.py`

**Interfaces:**
- Consumes: `app.core.security.create_access_token`, `verify_password`, `pwd_context`; `AdminUser`, `AdminRoleAssignment`, `AdminRole` from Task 1.
- Produces:
  - `ROLE_PERMISSIONS: dict[str, set[str]]` mapping role key → capability strings (e.g. `"org.suspend"`, `"billing.write"`, `"read"`).
  - `create_admin_token(admin_id: str, roles: list[str]) -> str` (claims `sub`, `scope="admin"`, `roles`).
  - `async get_current_admin(token) -> AdminContext` where `AdminContext` is a small dataclass `(admin: AdminUser, roles: list[str], permissions: set[str])`; raises 401 if scope != "admin" or admin missing/inactive.
  - `require_admin(permission: str | None = None)` → FastAPI dependency factory that resolves the admin and 403s if `permission` not in their permissions (Auditor has only `"read"`).

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_admin_auth.py
import uuid, pytest
from app.core.admin_auth import create_admin_token, ROLE_PERMISSIONS, permissions_for

def test_role_permissions_auditor_is_read_only():
    assert "read" in ROLE_PERMISSIONS["auditor"]
    assert not any(p for p in ROLE_PERMISSIONS["auditor"] if p.endswith(".write") or "." in p and p != "read")

def test_super_admin_has_everything():
    perms = permissions_for(["super_admin"])
    assert "org.suspend" in perms and "billing.write" in perms and "read" in perms

def test_permissions_union_across_roles():
    perms = permissions_for(["finance", "support"])
    assert "billing.write" in perms          # from finance
    assert "org.impersonate" in perms         # from support

def test_admin_token_roundtrip_carries_scope_and_roles():
    from jose import jwt
    from app.core.config import settings
    tok = create_admin_token(str(uuid.uuid4()), ["operations"])
    payload = jwt.decode(tok, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    assert payload["scope"] == "admin" and payload["roles"] == ["operations"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_admin_auth.py -v` → FAIL (`ModuleNotFoundError: app.core.admin_auth`).

- [ ] **Step 3: Implement `admin_auth.py`**

```python
# apps/api/app/core/admin_auth.py
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
```

Add to `apps/api/app/core/config.py` (near `PLATFORM_ADMIN_EMAILS`):
```python
    ADMIN_BOOTSTRAP_EMAIL: str = ""
    ADMIN_BOOTSTRAP_PASSWORD: str = ""
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && python -m pytest tests/test_admin_auth.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/core/admin_auth.py apps/api/app/core/config.py apps/api/tests/test_admin_auth.py
git commit -m "feat(admin): admin auth core (token, current-admin, require_admin, RBAC map)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Admin auth router + bootstrap super-admin

**Files:**
- Create: `apps/api/app/api/v1/routers/admin_auth.py`
- Modify: wherever v1 routers are registered (open `apps/api/app/api/v1/__init__.py` or `app/main.py` and follow the existing `include_router` pattern) — mount at prefix `/api/v1/admin`.
- Test: `apps/api/tests/test_admin_auth_router.py`

**Interfaces:**
- Consumes: `create_admin_token`, `get_current_admin`, `verify_password`, `pwd_context`, `AdminUser`, config bootstrap.
- Produces routes: `POST /api/v1/admin/auth/login` (form: username/password → `{access_token, token_type}`), `POST /api/v1/admin/auth/logout` (204, stateless), `GET /api/v1/admin/me` (`{id, email, name, roles, permissions}`).
- Bootstrap: on login, if no `admin_user` exists and the submitted email matches `ADMIN_BOOTSTRAP_EMAIL` with `ADMIN_BOOTSTRAP_PASSWORD`, create the first super-admin (hashed) and assign `super_admin`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_admin_auth_router.py
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base, get_db
from app.core.security import pwd_context
from app.main import app
from app.models.admin_user import AdminUser, AdminRole, AdminRoleAssignment

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as db:
        role = AdminRole(key="super_admin", name="Super Admin", description="")
        admin = AdminUser(email="owner@fennex.io", name="Owner",
                          password_hash=pwd_context.hash("secret"), is_active=True)
        db.add_all([role, admin]); await db.flush()
        db.add(AdminRoleAssignment(admin_user_id=admin.id, role_id=role.id)); await db.commit()
    async def _override():
        async with Session() as s: yield s
    app.dependency_overrides[get_db] = _override
    yield
    app.dependency_overrides.clear()
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)

async def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")

async def test_login_ok_and_me():
    async with await _client() as ac:
        r = await ac.post("/api/v1/admin/auth/login",
                          data={"username": "owner@fennex.io", "password": "secret"})
        assert r.status_code == 200
        tok = r.json()["access_token"]
        me = await ac.get("/api/v1/admin/me", headers={"Authorization": f"Bearer {tok}"})
        assert me.status_code == 200
        body = me.json()
        assert body["email"] == "owner@fennex.io" and "super_admin" in body["roles"]
        assert "org.suspend" in body["permissions"]

async def test_login_wrong_password_401():
    async with await _client() as ac:
        r = await ac.post("/api/v1/admin/auth/login",
                          data={"username": "owner@fennex.io", "password": "nope"})
        assert r.status_code == 401

async def test_me_without_token_401():
    async with await _client() as ac:
        assert (await ac.get("/api/v1/admin/me")).status_code == 401
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_admin_auth_router.py -v` → FAIL (route 404 / import error).

- [ ] **Step 3: Implement the router**

```python
# apps/api/app/api/v1/routers/admin_auth.py
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
```

Register it: in the v1 router aggregator, `from app.api.v1.routers import admin_auth` and `api_router.include_router(admin_auth.router)` (the aggregator already carries the `/api/v1` prefix; the router adds `/admin`). Match the existing include pattern exactly.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && python -m pytest tests/test_admin_auth_router.py -v` → PASS (all three).

- [ ] **Step 5: Full suite + commit**

Run: `cd apps/api && python -m pytest -q` (no new failures). Commit:
```bash
git add apps/api/app/api/v1/routers/admin_auth.py apps/api/app/api/v1/__init__.py apps/api/tests/test_admin_auth_router.py
git commit -m "feat(admin): admin auth router (login/logout/me) + first-run bootstrap

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
(Adjust the staged registration file to wherever you actually added `include_router`.)

---

### Task 4: `usage_daily` rollup model + migration

**Files:**
- Create: `apps/api/app/models/usage_daily.py`
- Modify: `apps/api/app/models/__init__.py`
- Create: `apps/api/alembic/versions/n0j1k2l3m4n5_usage_daily.py`
- Test: `apps/api/tests/test_usage_daily_model.py`

**Interfaces:**
- Produces: `UsageDaily(day: date, org_id: uuid, provider: str, model: str = "", unit: str, requests, input_tokens, output_tokens, cache_read_tokens, seo_count, cost_micros)` — all counters BIGINT; PK `(day, org_id, provider, model, unit)`. No `revenue_micros` (deferred).

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_usage_daily_model.py
import uuid, datetime as dt, pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.usage_daily import UsageDaily

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)

async def test_usage_daily_roundtrip():
    org = uuid.uuid4()
    async with Session() as db:
        db.add(UsageDaily(day=dt.date(2026, 7, 26), org_id=org, provider="openai",
                          model="gpt-4o", unit="input_token", requests=3,
                          input_tokens=1000, output_tokens=200, cache_read_tokens=0,
                          seo_count=0, cost_micros=270))
        await db.commit()
        row = (await db.execute(select(UsageDaily))).scalar_one()
        assert row.cost_micros == 270 and row.input_tokens == 1000
```

- [ ] **Step 2: Run to verify it fails** — `ModuleNotFoundError: app.models.usage_daily`.

- [ ] **Step 3: Create the model** (mirror `cost_rate.py`/`usage_event.py` typing; `day` is `sa.Date`; `org_id` UUID with sqlite string variant; counters `BigInteger` default 0; PK across the five columns).

- [ ] **Step 4: Register in `models/__init__.py`.**

- [ ] **Step 5: Migration `n0j1k2l3m4n5` (down_revision `m9i0j1k2l3m4`)** — create `usage_daily` with the composite PK and `index("ix_usage_daily_org_day", ["org_id", "day"])` and `index("ix_usage_daily_day", ["day"])`. Follow `alembic/versions/` conventions in the repo.

- [ ] **Step 6: Run the model test → PASS; `make db-migrate` → head `n0j1k2l3m4n5`.**

- [ ] **Step 7: Commit** `feat(admin): usage_daily rollup model + migration` (with trailer).

---

### Task 5: Rollup service + nightly arq cron

**Files:**
- Create: `apps/api/app/services/admin/rollup.py`
- Modify: `apps/api/app/workers/worker.py` (register function + add `cron`)
- Test: `apps/api/tests/test_usage_daily_rollup.py`

**Interfaces:**
- Consumes: `UsageEvent` (columns `org_id, provider, model, kind, input_tokens, output_tokens, cache_read_tokens, seo_unit, seo_count, cost_micros, created_at`), `UsageDaily`.
- Produces: `async rollup_usage_daily(db, day: date) -> int` (returns rows written; IDEMPOTENT — deletes that day's `usage_daily` rows then re-inserts the aggregation, so re-running never double-counts) and `async rollup_daily_job(ctx)` (arq entry: rolls yesterday and today using a fresh session).

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_usage_daily_rollup.py
import uuid, datetime as dt, pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.usage_event import UsageEvent
from app.models.usage_daily import UsageDaily
from app.services.admin.rollup import rollup_usage_daily

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)

async def test_rollup_aggregates_and_is_idempotent():
    org = uuid.uuid4()
    day = dt.date(2026, 7, 26)
    ts = dt.datetime(2026, 7, 26, 10, 0, tzinfo=dt.timezone.utc)
    async with Session() as db:
        db.add_all([
            UsageEvent(org_id=org, kind="llm", provider="openai", model="gpt-4o",
                       input_tokens=1000, output_tokens=200, cache_read_tokens=0,
                       cost_micros=120, created_at=ts),
            UsageEvent(org_id=org, kind="llm", provider="openai", model="gpt-4o",
                       input_tokens=500, output_tokens=100, cache_read_tokens=0,
                       cost_micros=60, created_at=ts),
            UsageEvent(org_id=org, kind="seo", provider="dataforseo", seo_unit="serp",
                       seo_count=3, cost_micros=4500, created_at=ts),
        ])
        await db.commit()
        n = await rollup_usage_daily(db, day)
        assert n >= 2
        llm = (await db.execute(select(UsageDaily).where(
            UsageDaily.provider == "openai", UsageDaily.unit == "llm"))).scalar_one()
        assert llm.requests == 2 and llm.input_tokens == 1500 and llm.cost_micros == 180
        seo = (await db.execute(select(UsageDaily).where(
            UsageDaily.provider == "dataforseo"))).scalar_one()
        assert seo.seo_count == 3 and seo.cost_micros == 4500
        # idempotency: second run must not double count
        await rollup_usage_daily(db, day)
        llm2 = (await db.execute(select(UsageDaily).where(
            UsageDaily.provider == "openai", UsageDaily.unit == "llm"))).scalar_one()
        assert llm2.cost_micros == 180 and llm2.requests == 2
```

- [ ] **Step 2: Run to verify it fails** — `ModuleNotFoundError: app.services.admin.rollup`.

- [ ] **Step 3: Implement the rollup**

```python
# apps/api/app/services/admin/rollup.py
import datetime as dt
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.usage_event import UsageEvent
from app.models.usage_daily import UsageDaily

def _day_bounds(day: dt.date):
    start = dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc)
    return start, start + dt.timedelta(days=1)

async def rollup_usage_daily(db: AsyncSession, day: dt.date) -> int:
    """Aggregate usage_event rows for `day` into usage_daily. Idempotent:
    clears that day's rows first, then re-inserts. Groups by (provider, model,
    kind-as-unit). unit is the event's kind ('llm'|'seo') so the rollup stays
    simple for the executive dashboard; per-token-unit splits come later."""
    start, end = _day_bounds(day)
    await db.execute(delete(UsageDaily).where(UsageDaily.day == day))
    rows = (await db.execute(
        select(
            UsageEvent.org_id, UsageEvent.provider,
            func.coalesce(UsageEvent.model, "").label("model"),
            UsageEvent.kind.label("unit"),
            func.count().label("requests"),
            func.coalesce(func.sum(UsageEvent.input_tokens), 0).label("input_tokens"),
            func.coalesce(func.sum(UsageEvent.output_tokens), 0).label("output_tokens"),
            func.coalesce(func.sum(UsageEvent.cache_read_tokens), 0).label("cache_read_tokens"),
            func.coalesce(func.sum(UsageEvent.seo_count), 0).label("seo_count"),
            func.coalesce(func.sum(UsageEvent.cost_micros), 0).label("cost_micros"),
        )
        .where(UsageEvent.created_at >= start, UsageEvent.created_at < end)
        .group_by(UsageEvent.org_id, UsageEvent.provider,
                  func.coalesce(UsageEvent.model, ""), UsageEvent.kind)
    )).all()
    for r in rows:
        db.add(UsageDaily(day=day, org_id=r.org_id, provider=r.provider or "",
                          model=r.model or "", unit=r.unit or "",
                          requests=r.requests, input_tokens=r.input_tokens,
                          output_tokens=r.output_tokens, cache_read_tokens=r.cache_read_tokens,
                          seo_count=r.seo_count, cost_micros=r.cost_micros))
    await db.commit()
    return len(rows)

async def rollup_daily_job(ctx):
    from app.core.database import async_session_factory
    today = dt.datetime.now(dt.timezone.utc).date()
    async with async_session_factory() as db:
        for day in (today - dt.timedelta(days=1), today):
            await rollup_usage_daily(db, day)
```

(Verify `UsageEvent`'s actual column names in `apps/api/app/models/usage_event.py` and adjust the `select` if any differ — e.g. if SEO count is `seo_count` vs another name.)

- [ ] **Step 4: Run the rollup test → PASS** (asserts aggregation AND idempotency).

- [ ] **Step 5: Register the arq function + cron**

In `apps/api/app/workers/worker.py`: import `rollup_daily_job`, add it to `WorkerSettings.functions`, and add to the cron list: `cron(rollup_daily_job, hour=2, minute=10, run_at_startup=False)`. Match the file's existing import/registration style.

- [ ] **Step 6: Full suite + commit** `feat(admin): usage_daily rollup service + nightly cron` (with trailer).

---

### Task 6: `/admin/overview` KPIs + series endpoints

**Files:**
- Create: `apps/api/app/api/v1/routers/admin_overview.py`
- Modify: v1 router aggregator (register, same place as Task 3)
- Test: `apps/api/tests/test_admin_overview.py`

**Interfaces:**
- Consumes: `require_admin("read")`, `UsageDaily`, `Organization`, `User`, `billing`/`OrgUsage`.
- Produces:
  - `GET /api/v1/admin/overview/kpis?range=30d` → `{total_orgs, active_orgs, total_users, cost_micros, cost_usd, ai_input_tokens, ai_output_tokens, ai_requests, seo_count, mrr_usd, margin_pct}`. `mrr_usd` from `billing` (sum active subscriptions) — if the billing model has no simple MRR, return the sum of active plan prices; state the query used. `margin_pct = (mrr - cost)/mrr` when mrr>0 else null. Cost from `usage_daily` over the range.
  - `GET /api/v1/admin/overview/series?metric=cost|tokens|requests&range=30d` → `{points: [{day, value}]}` from `usage_daily`.
- Both require a valid admin token (`require_admin("read")`); no token → 401.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_admin_overview.py  (pattern mirrors test_admin_auth_router.py setup:
# in-memory engine, seed an admin+super_admin role, override get_db, ASGITransport client)
# Seed: one Organization, a couple UsageDaily rows in-range, then:
#   - GET /api/v1/admin/overview/kpis with a valid admin bearer -> 200, cost_usd == sum/1e6,
#     total_orgs == 1, ai_requests == sum(requests)
#   - GET /api/v1/admin/overview/kpis with NO token -> 401
#   - GET /api/v1/admin/overview/series?metric=cost&range=30d -> 200 and points non-empty
# (Reuse the create_admin_token helper to mint the bearer directly for the seeded admin.)
```
Write the full test following `test_admin_auth_router.py`'s fixture exactly (same engine/override/client helpers), asserting the three cases above with concrete seeded numbers.

- [ ] **Step 2: Run to verify it fails** (route 404).

- [ ] **Step 3: Implement the endpoints** — parse `range` (`24h|7d|30d|90d` → start date), aggregate `UsageDaily` with `func.sum`, count `Organization`/`User`, compute MRR from `billing`, assemble the response. `cost_usd = cost_micros / 1_000_000`. Guard `margin_pct` for mrr==0.

- [ ] **Step 4: Run the test → PASS. Register the router** (same aggregator as Task 3).

- [ ] **Step 5: Full suite + commit** `feat(admin): overview KPIs + series endpoints` (with trailer).

---

### Task 7: `apps/admin` Next.js scaffold

**Files (create):** `apps/admin/package.json`, `tsconfig.json`, `next.config.js`, `postcss.config.js`, `tailwind.config.ts`, `app/globals.css`, `app/layout.tsx`, `app/(console)/overview/page.tsx` (placeholder), plus a `web`-style service entry in the root `docker-compose.yml` (mirror the `web` service; host port 3002 → container 3000).

**Interfaces:** Produces the `@fennex/admin` workspace consuming `@fennex/ui` + `@fennex/types`; dev script `next dev --turbo -p 3000` (container), mapped to host 3002.

- [ ] **Step 1: Create `package.json`** — name `@fennex/admin`, `"dev": "next dev --turbo"`, deps: `next@14`, `react`, `react-dom`, `@fennex/ui: "workspace:*"`, `@fennex/types: "workspace:*"`, `@tremor/react`, `@tanstack/react-query`, `zustand`, `cmdk`, `react-i18next`, `i18next`, `tailwindcss`, `clsx`, `tailwind-merge`. Copy exact versions from `apps/web/package.json` where the dep already exists there (keep versions identical across the monorepo).

- [ ] **Step 2: Copy config from `apps/web`** — `tsconfig.json`, `next.config.js`, `postcss.config.js`, `tailwind.config.ts` (point `content` at `apps/admin` + `packages/ui`), and `app/globals.css` (import the same CSS-variable design tokens the web app uses, so `bg-card`, `hsl(var(--primary))`, `.popover`, `animate-*` all work identically). Do NOT hard-code colors.

- [ ] **Step 3: Minimal `app/layout.tsx` + placeholder `app/(console)/overview/page.tsx`** rendering a "Loading admin" shell so the app builds.

- [ ] **Step 4: Add the compose service** — in `docker-compose.yml`, add `admin:` mirroring `web:` (same build, `command` runs the admin dev server, `ports: ["3002:3000"]`, same `env_file`, `NEXT_PUBLIC_ADMIN_API_URL=http://localhost:8000`). Keep it minimal.

- [ ] **Step 5: Install + verify** — `pnpm install` (root), then `cd apps/admin && npm run typecheck` (or `pnpm --filter @fennex/admin typecheck`) passes; `npm run build` compiles. (No unit tests — this is scaffolding.)

- [ ] **Step 6: Commit** `feat(admin): scaffold apps/admin Next.js app` (with trailer).

---

### Task 8: Admin apiClient, query client, auth store, login page

**Files (create):** `apps/admin/lib/api.ts`, `apps/admin/lib/query.ts`, `apps/admin/lib/rbac.ts`, `apps/admin/store.ts`, `apps/admin/app/(auth)/login/page.tsx`, `apps/admin/app/providers.tsx` (QueryClientProvider).

**Interfaces:**
- Produces `apiClient` (mirrors `apps/web/lib/api.ts`: base `NEXT_PUBLIC_ADMIN_API_URL + "/api/v1"`, attaches `Authorization: Bearer <token>` from the Zustand store, `get/post` helpers, throws on non-2xx). NEVER call `fetch` directly elsewhere.
- Zustand `store.ts`: `{ token, admin, setAuth, clear, theme, toggleTheme }`, token persisted to `localStorage`.
- `lib/rbac.ts`: `hasPermission(admin, perm)` over `admin.permissions`.

- [ ] **Step 1:** Implement `store.ts` (Zustand + persist token), `lib/api.ts` (apiClient reading token from store), `lib/query.ts` (QueryClient), `app/providers.tsx`.
- [ ] **Step 2:** Implement `login/page.tsx`: email+password form (labels via `t()`), on submit `apiClient.post("/admin/auth/login", form-encoded)`, store `access_token`, fetch `/admin/me`, `setAuth`, `router.push("/overview")`. Show error on 401. Use `@fennex/ui` inputs/button.
- [ ] **Step 3:** Wire `app/providers.tsx` into `app/layout.tsx`.
- [ ] **Step 4: Verify** `cd apps/admin && npm run typecheck` passes. Visual check: `/login` renders and a bad password shows an error (note for manual verification).
- [ ] **Step 5: Commit** `feat(admin): admin apiClient, auth store, login page` (with trailer).

---

### Task 9: AdminShell — nav rail, top bar, theme, RoleGate, command-palette stub

**Files (create):** `apps/admin/components/shell/{AdminShell,NavRail,TopBar,CommandPalette}.tsx`, `apps/admin/components/common/RoleGate.tsx`, `apps/admin/app/(console)/layout.tsx`.

**Interfaces:**
- `AdminShell` renders `NavRail` (grouped nav from the spec IA), `TopBar` (search trigger, theme toggle, admin menu with logout), and `{children}`.
- `(console)/layout.tsx` is a guard: if no token in store → `router.replace("/login")`; else ensure `/admin/me` is loaded into the store, then render `AdminShell`.
- `RoleGate({permission, children})` renders children only if `hasPermission`.
- `CommandPalette` (cmdk) is a stub that lists nav destinations and navigates (⌘K).

- [ ] **Step 1:** Build `NavRail` with the grouped sections (Overview, Customers, Revenue, AI & SEO, Operations, Trust, Settings) — links present, only Overview active in this phase; others render but route to placeholder pages (create thin `page.tsx` stubs that render the section title + "Coming in Phase 1b"). All labels via `t()`, styling via Tailwind CSS variables + `cn()`.
- [ ] **Step 2:** Build `TopBar` (theme toggle flips `data-theme` / `dark` class like the web app; admin menu → logout clears store, calls `/admin/auth/logout`, redirects to `/login`).
- [ ] **Step 3:** Build `CommandPalette` (cmdk) opening on ⌘K, filtering nav items.
- [ ] **Step 4:** Implement the `(console)/layout.tsx` auth guard + `RoleGate`.
- [ ] **Step 5: Verify** `npm run typecheck` passes; visual note: logged-in user sees the shell, logout works, ⌘K opens.
- [ ] **Step 6: Commit** `feat(admin): admin shell (nav, topbar, theme, command palette, RoleGate)` (with trailer).

---

### Task 10: Executive dashboard page (Tremor KPIs + charts)

**Files (create):** `apps/admin/app/(console)/overview/page.tsx` (replace placeholder), `apps/admin/components/kpi/{KpiGrid,StatCard}.tsx`, `apps/admin/components/charts/{AreaTrend,LineTrend}.tsx` (Tremor wrappers), `apps/admin/lib/format.ts` (`money(micros)`, `pct`, `compactNumber`).

**Interfaces:** Consumes `/admin/overview/kpis` and `/admin/overview/series` via `apiClient` + TanStack Query.

- [ ] **Step 1:** `lib/format.ts` — `money(micros) => $ from micros/1e6`, `pct`, `compactNumber`.
- [ ] **Step 2:** `StatCard`/`KpiGrid` using Tremor `Card`/`Metric`/`Text` + a `BadgeDelta`; render MRR, Cost, Margin %, Profit, Active Orgs, Signups, AI tokens, requests, SEO count from the kpis query.
- [ ] **Step 3:** `AreaTrend`/`LineTrend` (Tremor `AreaChart`/`LineChart`) rendering the series query; a range selector (24h/7d/30d/90d) driving a query param; an export button stub (disabled with a tooltip "CSV export — Phase 1b").
- [ ] **Step 4:** `overview/page.tsx` composes KpiGrid + two charts (Revenue vs Cost, Margin) with loading/empty/error states (honest empty state when no data). Strings via `t()`; colors via Tremol/Tailwind tokens, not hard-coded.
- [ ] **Step 5: Verify** `cd apps/admin && npm run typecheck` passes and `npm run build` compiles. Visual note: with the API running and seeded usage, the dashboard shows live KPIs and charts; drill/export are stubs.
- [ ] **Step 6: Commit** `feat(admin): executive dashboard (KPIs + trend charts)` (with trailer).

---

## Self-Review

- **Spec coverage (Phase 1a slice):** staff auth (T2/T3), RBAC 7 roles (T1/T2), `usage_daily` backbone + nightly rollup (T4/T5), Executive dashboard KPIs+charts (T6/T10), `apps/admin` shell with grouped nav/command palette/theme (T7/T9), apiClient+login (T8). Section pages beyond Overview are intentionally deferred to Phase 1b (thin stubs only). Infra deferred per spec.
- **Placeholder scan:** no "TBD"; every backend task carries real test + code; frontend tasks carry concrete component responsibilities verified by `typecheck`/`build` (repo has no FE test framework). Two verify-against-source notes are explicit (UUID PK helper in T1; `UsageEvent` column names in T5) — resolve by reading the named file, not guessing.
- **Type/interface consistency:** `create_admin_token`/`get_current_admin`/`require_admin`/`AdminContext`/`permissions_for` names are consistent across T2/T3/T6. `usage_daily` PK and columns identical in T4/T5/T6. Migration chain `l8h9i0j1k2l3 → m9i0j1k2l3m4 → n0j1k2l3m4n5` single-headed.
- **Money:** micro-dollars integer everywhere; `cost_usd`/`money()` divide by 1e6 only at the edge. Revenue allocation deferred (documented), margin computed at platform level from `billing` MRR − `usage_daily` COGS.

## Open items (resolve during implementation, not blockers)

- Confirm the exact `UsageEvent` column names (`seo_count`/`seo_unit`, `model` nullability) in `models/usage_event.py` and adjust T5's aggregation.
- Confirm the repo's UUID PK convention (helper vs inline) from `models/organization.py` and match it in T1/T4.
- Confirm where v1 routers are aggregated (`api/v1/__init__.py` vs `main.py`) for T3/T6 registration.
- MRR source: confirm the `billing` model's active-subscription/price fields for T6; if none exist yet, T6 returns `mrr_usd = 0` and `margin_pct = null` with a code comment, and MRR lands when billing-plans (the parallel branch) merges.
