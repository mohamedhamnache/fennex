# Admin Console — Phase 1b Batch 2: Users — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the Users section from a stub into a real operational surface — list + detail with live data — and wire guarded user actions (deactivate / reactivate / lock / unlock), each enforced in customer auth and written to the existing admin audit log.

**Architecture:** New `/api/v1/admin/users/*` router (RBAC-gated), reusing Batch 1's `record_admin_action` audit helper and `require_admin`. A new `user.manage` capability. Enforcement of `is_active`/`locked` in the customer `get_current_user` (so the actions actually block access). Frontend: real Users list + detail pages with action controls, reusing the shared `DataTable`/`ConfirmDialog`/`RoleGate`. Builds on Batch 1 (`docs/superpowers/plans/2026-07-27-admin-phase1b-orgs-actions-audit.md`, now merged to main). Spec: `docs/superpowers/specs/2026-07-27-admin-dashboard-design.md` §3.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic; Next.js 14, TanStack Query, Zustand, Tremor, Lucide (all present in `apps/admin`).

## Global Constraints

- Build on branch `feat/admin-p1b-users` (off main, which has Batch 1). Current single alembic head is **`r5scaletier1`**; if a migration is needed it chains from it (Task 2 may NOT need one — see below). Single head. Apply via `make db-migrate`.
- **RBAC (server-side, from `app/core/admin_auth.py`):** reads gated by `require_admin("read")`; user mutations gated by a new `require_admin("user.manage")`. Add `"user.manage"` to `ROLE_PERMISSIONS` for `super_admin` and `support` only. Auditor (read-only) must be unable to mutate.
- **Every mutation writes an `admin_audit_log` row** (via `record_admin_action` from `app/services/admin/audit.py`), atomically with the mutation (single commit). resource_type="user".
- **Enforcement:** deactivate (`is_active=False`) and lock (`locked=True`) must actually block the user in customer `get_current_user` — verify current behavior first and add an additive 403 branch if missing (mirror Batch 1's `suspended_at` enforcement; happy path byte-identical).
- **Backend tests** run on HOST in-memory SQLite (`sqlite+aiosqlite`), `asyncio_mode="auto"` (NO `@pytest.mark.asyncio`); each test file stands up its own engine + autouse `setup_db`; router-integration tests mirror `apps/api/tests/test_admin_orgs.py` (ASGITransport + `app.dependency_overrides[get_db]`, bearers via `create_admin_token`). New v1 routers register in `apps/api/app/api/v1/router.py`.
- **Frontend:** App Router + TS; use the admin `apiClient` (never `fetch` directly); Tailwind CSS-variable tokens only (no hard-coded colors); Lucide icons (no emoji); reuse `@fennex/ui`, the shared `DataTable`/`ConfirmDialog`/`RoleGate`/`StatCard`; dark-first dense ops aesthetic + a11y (focus-visible, aria on icon-only, motion-safe) per `design-system/fennex-admin/MASTER.md`. English strings. Verify each frontend task with `npm run typecheck` + `npm run build` from `apps/admin`.
- **No emoji** anywhere. Commit style `feat(admin):`; every commit ends with trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Model facts (verified)
- `User` (`app/models/user.py`): id, org_id, email (unique), hashed_password, full_name, avatar_url, `role` (UserRole enum: owner/admin/seo_manager/content_writer/editor/designer/marketing_manager/viewer — serialize `.value`), `is_active` (bool, default True), `locked` (bool, default False), `locked_reason` (str|None), language, TimestampMixin (created_at/updated_at). **No `last_login` column** — do not invent one; "last active" shows `updated_at`.
- No session/refresh-token store exists → "revoke sessions" is OUT OF SCOPE for this batch (documented; a later batch if a session store is added).
- `Organization` (for the user's org name): id, name, slug, plan_tier, suspended_at.
- `record_admin_action(db, *, actor_admin_id, action, resource_type, resource_id, before, after, ip, result="ok")` — commit-neutral (only `db.add`).

---

### Task 1: Users list + detail endpoints

**Files:** Create `apps/api/app/api/v1/routers/admin_users.py`; Modify `apps/api/app/api/v1/router.py`; Test `apps/api/tests/test_admin_users.py`.

**Interfaces:**
- `GET /api/v1/admin/users?q=&org_id=&role=&active=&page=&page_size=` (require_admin("read")) → `{ items: [{id, email, full_name, role, org_id, org_name, is_active, locked, language, created_at, updated_at}], total, page, page_size }`. `org_name` via join to Organization.
- `GET /api/v1/admin/users/{id}` (require_admin("read")) → the above plus `avatar_url`, `locked_reason`, and `org: {id, name, slug, plan_tier}`. 404 if not found.

- [ ] **Step 1: Write the failing test** — seed 2 Organizations + 3 Users (varied role/is_active/org), mint a super_admin bearer, assert: list returns all with correct `org_name`; `q=` filters by email/full_name (ilike); `role=` filters; `active=false` filters inactive; `GET /users/{id}` returns detail incl. nested `org`; unknown id → 404; no-token → 401. Mirror `test_admin_orgs.py` fixture. Read `User`/`Organization` models to satisfy NOT NULL when seeding.

- [ ] **Step 2: Run → RED (404).**

- [ ] **Step 3: Implement** the router — join User→Organization for org_name (single query, no N+1); filters (`q` ilike on email/full_name, `org_id`, `role`, `active` bool); pagination offset/limit; `total` = filtered count. Serialize `role.value`. Register in `router.py` alongside `admin_orgs`/`admin_audit` (`from app.api.v1.routers import admin_users` + `api_router.include_router(admin_users.router)`; router `prefix="/admin"` → `/api/v1/admin/users`).

- [ ] **Step 4: Run → GREEN. Full suite** (`cd apps/api && python -m pytest -q`; ignore the 10 known pre-existing failures; no NEW failures). **Commit** `feat(admin): users list + detail endpoints` (trailer).

---

### Task 2: User actions (deactivate/reactivate/lock/unlock) + capability + enforcement

**Files:** Modify `apps/api/app/api/v1/routers/admin_users.py`, `apps/api/app/core/admin_auth.py` (add `user.manage`), `apps/api/app/core/dependencies.py` (enforce is_active/locked if not already); Test `apps/api/tests/test_admin_user_actions.py`. (No migration — no new columns.)

**Interfaces:**
- `POST /admin/users/{id}/deactivate` body `{reason?}` (require_admin("user.manage")) → `is_active=False`; audit `user.deactivate` (before `{is_active:true}`, after `{is_active:false, reason}`). Already-inactive → no-op 200.
- `POST /admin/users/{id}/reactivate` (require_admin("user.manage")) → `is_active=True`; audit `user.reactivate`.
- `POST /admin/users/{id}/lock` body `{reason?}` (require_admin("user.manage")) → `locked=True`, `locked_reason=reason`; audit `user.lock`.
- `POST /admin/users/{id}/unlock` (require_admin("user.manage")) → `locked=False`, `locked_reason=None`; audit `user.unlock`.
- All: 404 when user missing; IP via `Request.client.host` (None-safe); `record_admin_action(..., resource_type="user", resource_id=str(user.id), ...)`; single commit.

- [ ] **Step 1: Add the capability** — in `app/core/admin_auth.py`, add `"user.manage"` to `ROLE_PERMISSIONS["super_admin"]` and `ROLE_PERMISSIONS["support"]` (NOT auditor/finance/marketing).

- [ ] **Step 2: Verify + enforce customer auth** — read `app/core/dependencies.py` `get_current_user`. Confirm whether an inactive (`is_active=False`) or locked (`locked=True`) user is already rejected. If NOT, add an additive branch: after the user is loaded (and the existing suspended-org check), if `not user.is_active` or `user.locked` → raise `HTTPException(403, "User account disabled")`. Keep the happy path byte-identical when active+unlocked. (If already enforced, note it and skip.)

- [ ] **Step 3: Write the failing test** (`tests/test_admin_user_actions.py`) — seed a user (is_active=True, locked=False). Mint `super_admin` AND `auditor` bearers. Assert: super_admin deactivate → 200 + `is_active` False + one `admin_audit_log` row `action=="user.deactivate"`; **auditor deactivate → 403 with NO state change and NO audit row**; lock sets locked/locked_reason + audits `user.lock`; unlock clears them; reactivate sets is_active True; 404 for unknown user id. Also (enforcement) a test that a deactivated OR locked user hitting a `get_current_user`-protected route gets 403 (mirror Batch 1's `test_org_suspension_enforced.py` for the route choice).

- [ ] **Step 4: Run → RED.**

- [ ] **Step 5: Implement** the four action endpoints (mirror `admin_orgs.py`'s action style) + the enforcement branch.

- [ ] **Step 6: Run → GREEN** (esp. auditor-403-no-write + the enforcement 403). **Full suite** — no NEW failures (confirm no existing customer-auth test broke). **Commit** `feat(admin): user actions (deactivate/lock) + capability + auth enforcement` (trailer).

---

### Task 3: Users list page (frontend)

**Files:** Replace `apps/admin/app/(console)/users/page.tsx` (stub); Modify `apps/admin/lib/admin-types.ts` (add `AdminUserRow`/`AdminUserDetail`).

**Interfaces:** Consumes `GET /admin/users` via `apiClient.get<Paginated<AdminUserRow>>()` + TanStack Query (key includes q/role/active/page). `AdminUserRow = {id,email,full_name,role,org_id,org_name,is_active,locked,language,created_at,updated_at}`; `AdminUserDetail` adds `avatar_url,locked_reason,org:{id,name,slug,plan_tier}`.

- [ ] **Step 1:** Add the two types to `lib/admin-types.ts`.
- [ ] **Step 2:** Build the page with the shared `DataTable`. Columns: Name (`full_name` → link `/users/${id}`), Email (mono), Role (badge), Org (`org_name` → could link `/orgs/${org_id}`), Status (Active/Inactive + Locked pill — destructive token for inactive/locked), Created. Toolbar: debounced search → `q`, role `<select>`, "Inactive only" toggle → `active=false`. Pagination. Loading/empty/error states. Tokens only, Lucide icons, no emoji.
- [ ] **Step 3: Verify** `cd apps/admin && npm run typecheck` + `npm run build`. **Commit** `feat(admin): users list page` (trailer).

---

### Task 4: User detail page + action controls (frontend)

**Files:** Create `apps/admin/app/(console)/users/[id]/page.tsx`.

**Interfaces:** Consumes `GET /admin/users/{id}` (AdminUserDetail). Layout: header (full_name, email, role badge, Status pills) + a small profile/org card (org name → link `/orgs/{org_id}`, plan, language, created/updated) + an **Actions** panel. Actions (each `RoleGate` permission `user.manage`, each via shared `ConfirmDialog` + `useMutation` invalidating `["admin","user",id]`):
- Deactivate (shown when active) → `POST /admin/users/{id}/deactivate` {reason}.
- Reactivate (shown when inactive) → `POST /admin/users/{id}/reactivate`.
- Lock (shown when unlocked) → `POST /admin/users/{id}/lock` {reason}.
- Unlock (shown when locked) → `POST /admin/users/{id}/unlock`.

- [ ] **Step 1:** Build the detail page (header + profile/org card) with loading/empty/error.
- [ ] **Step 2:** Build the Actions panel (RoleGate + ConfirmDialog + useMutation; destructive variant for deactivate/lock; reason input where applicable; surface errors; invalidate on success). Mutually-exclusive button visibility per current state.
- [ ] **Step 3: Verify** typecheck + build. **Commit** `feat(admin): user detail page + guarded actions` (trailer).

---

## Self-Review

- **Spec coverage:** Users §3 (list/detail + deactivate/lock actions, audited + enforced). Session revocation is explicitly out of scope (no session store). Analytics sections (§5-8) and Billing are later batches.
- **Placeholder scan:** none; backend tasks carry real tests; frontend tasks typecheck/build-verified; "last login" honestly omitted (no column) — uses `updated_at`.
- **Type/interface consistency:** `record_admin_action` reused unchanged; `user.manage` capability added once (Task 2) and consumed by the frontend RoleGate (Task 4); `AdminUserRow`/`AdminUserDetail` identical between Task 1 (endpoint) and Task 3/4 (frontend). No migration → head stays `r5scaletier1`.
- **Security:** user mutations gated by `user.manage` (auditor blocked, asserted); every mutation audited atomically; deactivate/lock actually enforced in customer auth (Task 2), not cosmetic.

## Open items (resolve during implementation)
- Confirm whether `get_current_user` already rejects inactive/locked users; only add the 403 branch if missing (avoid double-enforcement).
- Confirm the minimal existing `get_current_user`-protected GET route to assert enforcement against (reuse the one Batch 1's `test_org_suspension_enforced.py` used).
