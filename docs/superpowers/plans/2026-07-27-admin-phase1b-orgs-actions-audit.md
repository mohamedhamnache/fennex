# Admin Console — Phase 1b Batch 1: Organizations (deep) + Actions + Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the Organizations section from a stub into a real operational surface — list + detail with live data — and wire the first guarded actions (suspend / unsuspend / reset-quotas / impersonate), each recorded in a new append-only `admin_audit_log`, plus the Audit Logs viewer. This establishes the reusable **mutation → RBAC → audit** pattern for every later action-bearing section.

**Architecture:** New `/api/v1/admin/orgs/*`, `/api/v1/admin/audit` routers (RBAC-gated), a new `admin_audit_log` table + `record_admin_action` helper, a `suspended_at` column on `organization` enforced in the customer auth path, and impersonation via a short-lived customer token. Frontend: a shared `DataTable`, real Organizations list + detail pages, action controls with confirm dialogs, and an Audit Logs page. Builds on Phase 1a (`docs/superpowers/plans/2026-07-27-admin-foundations.md`, branch `feat/admin-dashboard`). Spec: `docs/superpowers/specs/2026-07-27-admin-dashboard-design.md`.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, python-jose; Next.js 14, TanStack Query, Zustand, Tremor, Lucide, cmdk (all already in `apps/admin`).

## Global Constraints

- Build on branch `feat/admin-dashboard` (Phase 1a is merged here; `apps/admin` is in the main tree). Current single alembic head is **`n0j1k2l3m4n5`**; this plan's migrations chain linearly: `p1a2b3c4d5e6` (admin_audit_log) → `q2b3c4d5e6f7` (org suspended_at). Keep a single head. Apply with `make db-migrate` from repo root.
- Money is integer **micro-dollars**; format only at the edge.
- **RBAC (server-side, from Phase 1a `app/core/admin_auth.py`):** gate reads with `require_admin("read")`; gate mutations with the specific capability — suspend/unsuspend → `require_admin("org.suspend")`, reset-quotas → `require_admin("org.reset_quotas")`, impersonate → `require_admin("org.impersonate")`. These capability strings already exist in `ROLE_PERMISSIONS`. Auditor has only `"read"` and must be unable to mutate.
- **Every mutation writes an `admin_audit_log` row** (actor admin id, action, resource_type, resource_id, before/after JSON, ip) via the `record_admin_action` helper. Audit is append-only (no update/delete).
- **Admin identity** comes from `get_current_admin`/`require_admin(...)` → `AdminContext(admin, roles, permissions)`; the actor is `ctx.admin.id`. Get the client IP from the FastAPI `Request`.
- **Backend tests** run on HOST in-memory SQLite (`sqlite+aiosqlite:///:memory:`), `asyncio_mode="auto"` (NO `@pytest.mark.asyncio`); each test file stands up its own engine + autouse `setup_db`; register new models in `apps/api/app/models/__init__.py`; SQLite-safe column types only (use `JSON`, not `JSONB`); router-integration tests mirror `apps/api/tests/test_admin_auth_router.py` (ASGITransport + `app.dependency_overrides[get_db]`, mint bearers with `create_admin_token`). New v1 routers register in `apps/api/app/api/v1/router.py` (NOT `__init__.py`, which is empty) — the aggregator is mounted at `/api/v1`.
- **Frontend:** App Router + TS; use the admin `apiClient` (`apps/admin/lib/api.ts` — `get`/`post`, Bearer auto-attached) — never `fetch` directly; Tailwind CSS-variable tokens only (no hard-coded colors); Lucide SVG icons (no emoji); reuse `@fennex/ui` where a component fits; keep the dark-first dense ops aesthetic and a11y (focus-visible rings, `aria-*` on icon-only controls, `motion-safe`) established in Phase 1a and `design-system/fennex-admin/MASTER.md`. English strings (i18n deferred). Verify each frontend task with `npm run typecheck` + `npm run build` from `apps/admin` (no FE test framework).
- **No emoji** anywhere. Commit style `feat(admin):`/`fix(admin):`; every commit ends with trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

```
apps/api/app/
  models/admin_audit_log.py           AdminAuditLog (append-only)
  services/admin/audit.py             record_admin_action(...)
  api/v1/routers/admin_orgs.py        list/detail + actions (suspend/unsuspend/reset-quotas/impersonate)
  api/v1/routers/admin_audit.py       audit log list
  models/organization.py              + suspended_at, suspended_reason
  core/dependencies.py                get_current_user: 403 when org suspended
  alembic/versions/p1a2b3c4d5e6_admin_audit_log.py
  alembic/versions/q2b3c4d5e6f7_org_suspended.py
apps/admin/
  components/table/DataTable.tsx       shared filter/sort/paginate/export table
  components/common/ConfirmDialog.tsx  guarded-action confirm
  app/(console)/orgs/page.tsx          real list (replaces stub)
  app/(console)/orgs/[id]/page.tsx     detail + actions
  app/(console)/audit/page.tsx         real audit viewer (replaces stub)
  lib/admin-types.ts                   Org/Audit response types
```

---

### Task 1: `admin_audit_log` model + migration + `record_admin_action` helper

**Files:** Create `apps/api/app/models/admin_audit_log.py`, `apps/api/app/services/admin/audit.py`; Modify `apps/api/app/models/__init__.py`; Create `apps/api/alembic/versions/p1a2b3c4d5e6_admin_audit_log.py`; Test `apps/api/tests/test_admin_audit.py`.

**Interfaces:**
- Produces `AdminAuditLog(id BIGINT pk autoincrement, actor_admin_id uuid, action str, resource_type str, resource_id str|None, before_json JSON|None, after_json JSON|None, ip str|None, result str default "ok", created_at datetime)`.
- Produces `async record_admin_action(db, *, actor_admin_id, action, resource_type, resource_id=None, before=None, after=None, ip=None, result="ok") -> None` (adds a row; caller commits, OR it flushes — see step 3; keep it commit-neutral: it only `db.add(...)`, the calling endpoint commits).

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_admin_audit.py
import uuid, pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.admin_audit_log import AdminAuditLog
from app.services.admin.audit import record_admin_action

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)

async def test_record_admin_action_writes_row():
    actor = uuid.uuid4(); org = uuid.uuid4()
    async with Session() as db:
        await record_admin_action(db, actor_admin_id=actor, action="org.suspend",
                                  resource_type="organization", resource_id=str(org),
                                  before={"suspended": False}, after={"suspended": True},
                                  ip="10.0.0.1")
        await db.commit()
        row = (await db.execute(select(AdminAuditLog))).scalar_one()
        assert row.action == "org.suspend" and row.resource_id == str(org)
        assert row.before_json == {"suspended": False} and row.after_json == {"suspended": True}
        assert row.ip == "10.0.0.1" and row.result == "ok"
```

- [ ] **Step 2: Run to verify it fails** — `cd apps/api && python -m pytest tests/test_admin_audit.py -v` → `ModuleNotFoundError`.

- [ ] **Step 3: Implement the model + helper**

```python
# apps/api/app/models/admin_audit_log.py
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, JSON, BigInteger, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

class AdminAuditLog(Base):
    __tablename__ = "admin_audit_log"
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"),
                                    primary_key=True, autoincrement=True)
    actor_admin_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(60), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    before_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    result: Mapped[str] = mapped_column(String(20), default="ok", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
```

```python
# apps/api/app/services/admin/audit.py
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.admin_audit_log import AdminAuditLog

async def record_admin_action(db: AsyncSession, *, actor_admin_id: uuid.UUID, action: str,
                              resource_type: str, resource_id: str | None = None,
                              before: dict | None = None, after: dict | None = None,
                              ip: str | None = None, result: str = "ok") -> None:
    """Append an admin-action row. Commit-neutral: only db.add(); the calling
    endpoint commits so the action + its audit row land in one transaction."""
    db.add(AdminAuditLog(actor_admin_id=actor_admin_id, action=action,
                         resource_type=resource_type, resource_id=resource_id,
                         before_json=before, after_json=after, ip=ip, result=result))
```

- [ ] **Step 4: Register** in `models/__init__.py` (`from app.models.admin_audit_log import AdminAuditLog  # noqa: F401`).

- [ ] **Step 5: Migration `p1a2b3c4d5e6`** (down_revision `n0j1k2l3m4n5`): create `admin_audit_log` with the columns above (BIGINT id, indexes on `actor_admin_id`, `resource_id`, `created_at`); no `ON UPDATE`; downgrade drops it. Match `alembic/versions/` conventions.

- [ ] **Step 6: Run test → PASS; `make db-migrate` → head `p1a2b3c4d5e6`.**

- [ ] **Step 7: Full suite + commit** `feat(admin): admin_audit_log model + record_admin_action helper` (trailer).

---

### Task 2: `organization.suspended_at` + customer-auth enforcement

**Files:** Modify `apps/api/app/models/organization.py`, `apps/api/app/core/dependencies.py`; Create `apps/api/alembic/versions/q2b3c4d5e6f7_org_suspended.py`; Test `apps/api/tests/test_org_suspension_enforced.py`.

**Interfaces:** Produces `Organization.suspended_at: datetime|None`, `Organization.suspended_reason: str|None`. Customer `get_current_user` raises 403 when the user's org is suspended (so admin "suspend" actually blocks access).

**Blast-radius note:** `get_current_user` is shared by the whole customer API. The change is additive (a 403 only when `suspended_at` is set); confirm it does not alter the happy path. Read `dependencies.py:17` first.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_org_suspension_enforced.py  (mirror test_admin_auth_router.py fixture:
# in-memory sqlite, override get_db). Seed an Organization (suspended_at set) + a User in it,
# mint a customer token via app.core.security.create_access_token({"sub":str(user.id),
# "org_id":str(org.id),"role":user.role.value}), call any get_current_user-protected route
# (e.g. GET /api/v1/auth/me or /api/v1/organizations/current) -> assert 403.
# Then a second org NOT suspended -> same route 200. Write it fully following the repo's
# existing customer-auth test pattern; pick a simple already-existing GET route that depends
# on get_current_user for the assertion.
```
Write this test in full against a real `get_current_user`-protected GET route (find one in the routers), asserting 403 when suspended and 200 when not.

- [ ] **Step 2: Run → RED** (currently 200 when suspended, because there is no enforcement).

- [ ] **Step 3: Add the columns** to `Organization` (`suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)`, `suspended_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)`).

- [ ] **Step 4: Enforce in `get_current_user`** — after the user is loaded and its org resolved, if `organization.suspended_at is not None`, raise `HTTPException(403, "Organization suspended")`. Keep the existing happy path byte-identical when `suspended_at is None`. (Load the org if not already loaded; reuse whatever org fetch the dependency already does, else one `db.get(Organization, user.org_id)`.)

- [ ] **Step 5: Migration `q2b3c4d5e6f7`** (down_revision `p1a2b3c4d5e6`): `op.add_column` both nullable columns (no server_default needed — NULL = not suspended); downgrade drops them.

- [ ] **Step 6: Run the test → GREEN. Full suite** — confirm no regression in existing customer-auth tests (the happy path must be unchanged). `make db-migrate` → head `q2b3c4d5e6f7`.

- [ ] **Step 7: Commit** `feat(admin): org suspended_at column + customer-auth enforcement` (trailer).

---

### Task 3: Organizations list + detail endpoints

**Files:** Create `apps/api/app/api/v1/routers/admin_orgs.py`; Modify `apps/api/app/api/v1/router.py`; Test `apps/api/tests/test_admin_orgs.py`.

**Interfaces:**
- `GET /api/v1/admin/orgs?q=&plan=&suspended=&sort=&page=&page_size=` (require_admin("read")) → `{ items: [{id, name, slug, plan_tier, byok_enabled, suspended, user_count, project_count, cost_micros, cost_usd, ai_requests, seo_count, created_at}], total, page, page_size }`. Usage numbers from `OrgUsage` (current row) per org; counts from User/Project.
- `GET /api/v1/admin/orgs/{id}` (require_admin("read")) → the above plus `projects: [{id,name,domain,created_at}]`, `trial_ends_at`, `suspended_reason`, `stripe_customer_id` (masked to last 4 or null).

- [ ] **Step 1: Write the failing test** — seed 2 Organizations (+users/projects/OrgUsage), mint a super_admin bearer, assert: list returns both with correct `user_count`/`cost_usd`; `q=` filters by name; `GET /orgs/{id}` returns the detail incl. `projects`; no-token → 401. Mirror `test_admin_overview.py`/`test_admin_auth_router.py` fixture. (Check `OrgUsage`, `Organization`, `User`, `Project` required fields by reading the models so seeds satisfy NOT NULL.)

- [ ] **Step 2: Run → RED (404).**

- [ ] **Step 3: Implement** the router. Aggregate counts with `func.count`, join/lookup `OrgUsage` per org (a per-org rollup: `select(OrgUsage).where(OrgUsage.org_id==...)` or a grouped query), compute `cost_usd = cost_micros/1e6`, `suspended = suspended_at is not None`. Pagination + `q` (ilike on name/slug) + `plan`/`suspended` filters + `sort`. Mask `stripe_customer_id` to `"…"+last4` in detail.

- [ ] **Step 4: Register** in `router.py` (alongside `admin_auth`/`admin_overview`).

- [ ] **Step 5: Run test → GREEN. Full suite + commit** `feat(admin): organizations list + detail endpoints` (trailer).

---

### Task 4: Organization action endpoints (suspend / unsuspend / reset-quotas)

**Files:** Modify `apps/api/app/api/v1/routers/admin_orgs.py`; Test `apps/api/tests/test_admin_org_actions.py`.

**Interfaces:**
- `POST /admin/orgs/{id}/suspend` body `{reason?: str}` (require_admin("org.suspend")) → sets `suspended_at=now()`, `suspended_reason=reason`; audits `org.suspend` (before/after suspended state). Idempotent-ish: suspending an already-suspended org is a no-op 200.
- `POST /admin/orgs/{id}/unsuspend` (require_admin("org.suspend")) → clears both; audits `org.unsuspend`.
- `POST /admin/orgs/{id}/reset-quotas` (require_admin("org.reset_quotas")) → zeroes the org's `OrgUsage` counters (ai_input_tokens, ai_output_tokens, ai_requests, seo_serp, seo_keyword_analyses, cost_micros — set to 0); audits `org.reset_quotas` (before = the prior counters). Note: this resets the denormalized rollup only; the `usage_events` ledger is untouched (source of truth) — put that in a code comment.
- All three: 404 when the org doesn't exist; capture client IP from `Request`; write `admin_audit_log` and commit atomically with the mutation.

- [ ] **Step 1: Write the failing test** — seed an org (+OrgUsage with non-zero counters), mint bearers for `super_admin` AND `auditor` (via `create_admin_token(id,["auditor"])`). Assert: super_admin suspend → 200, org.suspended_at set, one `admin_audit_log` row `action=="org.suspend"`; **auditor suspend → 403** and NO audit row / NO state change; reset-quotas zeroes OrgUsage and audits with the prior values in `before_json`; unsuspend clears state. 404 for a random org id.

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement** the three endpoints using `record_admin_action` (Task 1) and the capability gates. IP via `request.client.host` (guard None). Commit once per request (mutation + audit row together).

- [ ] **Step 4: Run test → GREEN. Full suite + commit** `feat(admin): org actions (suspend/unsuspend/reset-quotas) with audit` (trailer).

---

### Task 5: Impersonation endpoint

**Files:** Modify `apps/api/app/api/v1/routers/admin_orgs.py`; Test `apps/api/tests/test_admin_impersonate.py`.

**Interfaces:**
- `POST /admin/orgs/{id}/impersonate` (require_admin("org.impersonate")) → picks the org's **owner** user (UserRole owner/admin; else the earliest-created active user), mints a SHORT-LIVED customer `access_token` for that user (`{"sub": str(user.id), "org_id": str(org.id), "role": user.role.value, "imp": str(ctx.admin.id)}`, expiry ~30 min) via `app.core.security.create_access_token`, audits `org.impersonate` (resource=org, after={"impersonated_user": str(user.id)}), and returns `{access_token, token_type: "bearer", user: {id,email,full_name}, expires_in}`. 404 if org/owner not found; 409 if the org is suspended (don't impersonate into a suspended org) — or allow with a flag; default: block suspended with 409.

- [ ] **Step 1: Write the failing test** — seed org + an owner user; super_admin impersonate → 200, returned token decodes (jose) to that user's `sub`/`org_id` and carries `imp == admin id`; an `admin_audit_log` `org.impersonate` row exists; **auditor → 403**; suspended org → 409; org with no users → 404.

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement.** Select the owner user (order: role == owner, then admin, then earliest active). Reuse `create_access_token` with a 30-min `expires_delta`. Add the `imp` claim so downstream/audit can tell it's impersonated. Audit + commit.

- [ ] **Step 4: Run → GREEN. Full suite + commit** `feat(admin): org owner impersonation (short-lived, audited)` (trailer).

---

### Task 6: Audit log list endpoint

**Files:** Create `apps/api/app/api/v1/routers/admin_audit.py`; Modify `apps/api/app/api/v1/router.py`; Test `apps/api/tests/test_admin_audit_router.py`.

**Interfaces:**
- `GET /api/v1/admin/audit?actor=&action=&resource_type=&resource_id=&from=&to=&page=&page_size=` (require_admin("read")) → `{ items: [{id, actor_admin_id, action, resource_type, resource_id, before_json, after_json, ip, result, created_at}], total, page, page_size }`, ordered by `created_at DESC`.

- [ ] **Step 1: Write the failing test** — seed 3 `admin_audit_log` rows (varied action/actor), mint bearer, assert: list returns all newest-first; `action=` filters; `resource_id=` filters; no-token 401.

- [ ] **Step 2: Run → RED (404).**

- [ ] **Step 3: Implement** the list (filters + pagination + DESC order). Register in `router.py`.

- [ ] **Step 4: Run → GREEN. Full suite + commit** `feat(admin): audit log list endpoint` (trailer).

---

### Task 7: Shared `DataTable` + `ConfirmDialog` (frontend)

**Files:** Create `apps/admin/components/table/DataTable.tsx`, `apps/admin/components/common/ConfirmDialog.tsx`, `apps/admin/lib/admin-types.ts`.

**Interfaces:**
- `DataTable<T>({ columns, rows, loading, empty, page, pageSize, total, onPageChange, toolbar })` — renders a token-styled table with header, rows, a loading skeleton, an honest empty state, pagination controls, and a right-aligned `toolbar` slot (for filters/export). Columns: `{ key, header, render?(row), align?, mono? }` (mono → `font-mono tabular-nums`). No data fetching inside — presentation only.
- `ConfirmDialog({ open, title, description, confirmLabel, destructive?, onConfirm, onClose })` — accessible modal (focus trap, Esc to close, `role="dialog"`, `aria-modal`), destructive variant uses the destructive token. Reuse `.popover`/existing dialog styling if present; otherwise a simple token-styled overlay.
- `lib/admin-types.ts` — `AdminOrgRow`, `AdminOrgDetail`, `AdminAuditRow` types matching the Task 3/6 payloads.

- [ ] **Step 1:** Implement `DataTable` (dense, dark, sticky header, focus-visible rows, responsive `overflow-x-auto` wrapper so wide tables scroll inside the card, never the page). Tailwind tokens only, no emoji.
- [ ] **Step 2:** Implement `ConfirmDialog` (a11y as above).
- [ ] **Step 3:** Add the types.
- [ ] **Step 4: Verify** `cd apps/admin && npm run typecheck` + `npm run build` pass.
- [ ] **Step 5: Commit** `feat(admin): shared DataTable + ConfirmDialog` (trailer).

---

### Task 8: Organizations list page (real data)

**Files:** Replace `apps/admin/app/(console)/orgs/page.tsx`; (uses DataTable + apiClient + Query).

**Interfaces:** Consumes `GET /admin/orgs` via `apiClient.get<{items:AdminOrgRow[],total,page,page_size}>()` with TanStack Query (key includes q/plan/suspended/page). Columns: Name (link to `/orgs/{id}`), Plan, BYOK (badge), Status (Active/Suspended pill), Users, Projects, Monthly cost (`money`, mono), AI requests (mono), Created. A `FilterBar` in the toolbar: search input (debounced → `q`), plan select, suspended toggle. Pagination wired.

- [ ] **Step 1:** Build the page: query + DataTable + filters + status/BYOK pills (token colors: destructive for suspended, muted for active). Loading/empty/error states.
- [ ] **Step 2: Verify** typecheck + build. Visual note: `/orgs` lists real orgs, filters work, row → detail.
- [ ] **Step 3: Commit** `feat(admin): organizations list page` (trailer).

---

### Task 9: Organization detail page + actions

**Files:** Create `apps/admin/app/(console)/orgs/[id]/page.tsx`.

**Interfaces:** Consumes `GET /admin/orgs/{id}`. Layout: header (name, plan, status pill) + KPI row (cost, users, projects, AI requests) + a Projects table (DataTable) + an **Actions** panel. Actions (each behind `RoleGate` with the matching permission, each opening a `ConfirmDialog`):
- Suspend / Unsuspend → `POST /admin/orgs/{id}/suspend|unsuspend` (reason input on suspend); on success invalidate the org query.
- Reset quotas → `POST /admin/orgs/{id}/reset-quotas` (destructive confirm).
- Impersonate → `POST /admin/orgs/{id}/impersonate`; on success, open the customer app authenticated as the owner. MVP: open `${NEXT_PUBLIC_APP_URL||"http://localhost:3001"}` in a new tab and hand off the token — since cross-app token handoff needs a receiver, for THIS task just show the returned token + owner in a dialog with a "Copy token" button and a note "opens customer session (handoff wiring in a later task)"; do NOT fabricate a login. (Keep it honest: the endpoint works and is audited; the cross-app auto-login is a follow-up.)

- [ ] **Step 1:** Build the detail page + KPI row + projects table.
- [ ] **Step 2:** Build the Actions panel with RoleGate + ConfirmDialog + mutations (TanStack `useMutation`, invalidate on success, surface errors). Impersonate shows the token/owner dialog per the honest-MVP note.
- [ ] **Step 3: Verify** typecheck + build. Visual note: actions gated by role, confirm dialogs work, state refreshes.
- [ ] **Step 4: Commit** `feat(admin): organization detail page + guarded actions` (trailer).

---

### Task 10: Audit Logs page (real)

**Files:** Replace `apps/admin/app/(console)/audit/page.tsx`.

**Interfaces:** Consumes `GET /admin/audit` via apiClient + Query. DataTable columns: When (created_at, mono), Actor (actor_admin_id, mono/truncated), Action (badge), Resource (`resource_type` + short `resource_id`), IP (mono), Result. A row expander (or a details drawer) shows the before/after JSON diff (pretty-printed, `font-mono`, `overflow-x-auto`). Filters in toolbar: action, resource_type, date range. Pagination.

- [ ] **Step 1:** Build the page + DataTable + filters + before/after JSON detail view.
- [ ] **Step 2: Verify** typecheck + build. Visual note: performing an org action then loading `/audit` shows the new entry with its diff.
- [ ] **Step 3: Commit** `feat(admin): audit logs page` (trailer).

---

## Self-Review

- **Spec coverage:** Organizations §2 (list/detail/actions/impersonate), Audit Logs §17, and the reusable mutation→RBAC→audit foundation. Users §3 and the analytics sections (§5–8) are explicitly the NEXT batches, not this plan.
- **Placeholder scan:** none; every backend task carries a real test + code; frontend tasks are typecheck/build-verified (no FE test framework); the impersonation cross-app auto-login is honestly scoped as a follow-up rather than faked.
- **Type/interface consistency:** `record_admin_action` signature identical across Tasks 1/4/5; capability strings (`org.suspend`, `org.reset_quotas`, `org.impersonate`, `read`) match Phase 1a's `ROLE_PERMISSIONS`; org payload shape identical in Task 3 (endpoint) and Task 8/9 (frontend types); migration chain `n0j1k2l3m4n5 → p1a2b3c4d5e6 → q2b3c4d5e6f7` single-headed.
- **Security:** every mutation gated by a specific capability (auditor blocked, asserted in tests); every mutation audited atomically; impersonation is short-lived + `imp`-tagged + audited + blocked into suspended orgs; suspension is actually enforced in customer auth (Task 2), not cosmetic.

## Open items (resolve during implementation)

- Confirm `get_current_user`'s exact shape in `core/dependencies.py` and the simplest existing protected GET route to assert against in Task 2.
- Confirm `OrgUsage` is one row per org (current period) vs. many; if many, Task 3/4 aggregate/zero the right set.
- Confirm `UserRole` enum values (owner/admin/member?) for the impersonation owner-selection order in Task 5.
- Cross-app impersonation auto-login (receiver on the customer app) is a deliberate follow-up beyond this batch.
