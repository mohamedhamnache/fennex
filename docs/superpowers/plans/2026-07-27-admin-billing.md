# Admin Console — Phase 1b Batch 4: Billing & Plans — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give the console real revenue visibility — MRR/ARR, **gross margin = plan revenue − metered COGS** (now that all LLM usage is metered), ARPU, MRR-by-plan, a Stripe-events (invoices/failed-payments) feed, and a Plans config page — and make the Executive dashboard's MRR/margin real instead of the `0` fallback.

**Architecture:** New read-only `/api/v1/admin/billing/*` router. Revenue is derived from `Organization.plan_tier` × a canonical **plan-price map** (the reseller spec's locked prices) over *paying* orgs (those with a `stripe_subscription_id`); COGS from `usage_daily`/`org_usage`; the invoices/failed-payments feed from `SubscriptionEvent` (the Stripe webhook log). A shared `plan_revenue` helper is reused by both `/admin/billing/kpis` and `/admin/overview` (to fix the MRR=0 fallback). No migration. Frontend: 2 pages on the admin design system. Builds on Batches 1-3 (merged). Spec: `docs/superpowers/specs/2026-07-27-admin-dashboard-design.md` §4, §15.

**Tech Stack:** FastAPI, SQLAlchemy 2 async; Next.js 14, TanStack Query, Tremor, Lucide.

## Global Constraints

- Branch `feat/admin-billing` (off main; has metering + analytics). Single alembic head `r5scaletier1`. **No migration.**
- **Money = integer micro-dollars for COGS** (`cost_usd = cost_micros/1e6`); **plan prices are whole USD dollars** from the canonical map (not micros — do not divide). Keep the two straight.
- **All endpoints read-only, `require_admin("read")`** → 401 without a token. Register in `apps/api/app/api/v1/router.py`.
- **HONEST revenue:** MRR is derived from `plan_tier` × the canonical price map over paying orgs — NOT fetched live from Stripe. Label it as "estimated from plan tier" in the UI. Enterprise price is custom/unknown → excluded from the price map (counts as $0 MRR contribution; surface enterprise org count separately). Churn/CAC/LTV are NOT computed (no historical subscription/cost-of-acquisition data) — omit them or show "—", never fabricate.
- **Backend tests:** HOST in-memory SQLite, `asyncio_mode="auto"`; mirror `apps/api/tests/test_admin_orgs.py` (ASGITransport + `app.dependency_overrides[get_db]`, bearer via `create_admin_token`).
- **Frontend:** admin `apiClient` (never `fetch`); the admin design system (cool dark-first tokens, Inter/JetBrains Mono, shared `DataTable`/`StatCard`/`card-base`/`badge`); Tailwind CSS-variable tokens ONLY (no hex/rgb), Lucide icons (no emoji), `font-mono tabular-nums` for numerics, ui-ux-pro-max polish, honest empty/loading/error states, responsive. Verify each with `npm run typecheck` + `npm run build`.
- **No emoji.** Commit `feat(admin):`; trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Data facts (verified — read the models/config to confirm)
- `Organization`: `plan_tier` (PlanTier: free/starter/pro/agency/scale/enterprise), `stripe_subscription_id` (str|null — non-null ≈ active paying sub), `stripe_customer_id`, `trial_ends_at` (datetime|null), `suspended_at`. A **paying** org = `plan_tier in {starter,pro,agency,scale,enterprise}` AND `stripe_subscription_id IS NOT NULL` AND `suspended_at IS NULL`. A **trialing** org = `trial_ends_at > now()` AND `stripe_subscription_id IS NULL`.
- Canonical monthly plan prices (USD, reseller spec §5): `{"free": 0, "starter": 29, "pro": 99, "agency": 299, "scale": 799}` (enterprise omitted → custom). Put this map in `app/core/billing.py` next to `PLAN_LIMITS`, as `PLAN_PRICE_USD`.
- `app/core/billing.py`: `PLAN_LIMITS: dict[str, dict[str,int]]` (per-plan projects/articles/images/social/... limits; `-1` = unlimited).
- COGS: sum `cost_micros` from `usage_daily` (or `org_usage`) for the **current calendar month** → `/1e6`. `SubscriptionEvent`: `org_id, stripe_event_id, event_type (str, e.g. invoice.paid / invoice.payment_failed / customer.subscription.*), payload (JSONB), processed_at`.

---

### Task 1: Plan-price map + MRR helper + billing KPIs + wire Executive MRR

**Files:** Modify `apps/api/app/core/billing.py` (add `PLAN_PRICE_USD`); Create `apps/api/app/services/admin/revenue.py`; Create `apps/api/app/api/v1/routers/admin_billing.py`; Modify `apps/api/app/api/v1/router.py` (register) + `apps/api/app/api/v1/routers/admin_overview.py` (wire real MRR); Test `apps/api/tests/test_admin_billing_kpis.py`.

**Interfaces:**
- `app/core/billing.py`: `PLAN_PRICE_USD: dict[str, int] = {"free":0,"starter":29,"pro":99,"agency":299,"scale":799}`.
- `app/services/admin/revenue.py`: `async def plan_revenue(db) -> dict` → `{ "mrr_usd": float, "paying_orgs": int, "trialing_orgs": int, "enterprise_orgs": int, "by_plan": [{plan, orgs, mrr_usd}] }`. Query Organizations; a paying org contributes `PLAN_PRICE_USD.get(plan_tier, 0)`; group by plan for `by_plan`; count trialing + enterprise separately. Reused by billing KPIs AND the overview endpoint.
- `GET /admin/billing/kpis` (require_admin("read")) → `{ mrr_usd, arr_usd (=mrr*12), mtd_cost_usd (metered COGS this month), gross_margin_pct (=(mrr-mtd_cost)/mrr or null when mrr==0), arpu_usd (=mrr/paying_orgs or 0), paying_orgs, trialing_orgs, enterprise_orgs, failed_payments_30d (count SubscriptionEvent event_type ilike 'invoice.payment_failed' in last 30d), by_plan: [{plan, orgs, mrr_usd}] }`.
- Wire `admin_overview.py`: replace `mrr_usd = 0.0` with `plan_revenue(db)["mrr_usd"]`; `margin_pct` then computes for real.

- [ ] **Step 1: Write the failing test** — seed Organizations across tiers (some with `stripe_subscription_id` = paying, some trialing via `trial_ends_at` future + no sub, a free, an enterprise, a suspended-paid) + a couple `usage_daily`/`org_usage` current-month cost rows + a `SubscriptionEvent` with `event_type='invoice.payment_failed'`. Assert: `mrr_usd` = sum of paying orgs' prices (suspended + trial + free excluded); `arr_usd = mrr*12`; `paying_orgs`/`trialing_orgs`/`enterprise_orgs` counts; `gross_margin_pct` = (mrr - mtd_cost)/mrr; `arpu_usd`; `failed_payments_30d`≥1; `by_plan` sums per plan; 401 without token. Read the models to satisfy NOT NULL when seeding.
- [ ] **Step 2: Run → RED (404).**
- [ ] **Step 3: Implement** `PLAN_PRICE_USD`, `plan_revenue`, the kpis endpoint, register it, and swap the overview MRR to `plan_revenue`. mtd cost = current-month `cost_micros` sum /1e6.
- [ ] **Step 4: Run → GREEN. Also run `apps/api/tests/test_admin_overview.py`** (the overview MRR change must not break it — it may now assert mrr>0 when paying orgs seeded, or stay 0 when none; adjust the overview test only if its seed has no paying orgs, in which case mrr stays 0 and margin null — keep it green). **Full suite** — ignore the 10 known pre-existing failures; no NEW failures. **Commit** `feat(admin): billing KPIs + plan-revenue MRR (wired into overview)` (trailer).

---

### Task 2: Plans config + Stripe-events endpoints

**Files:** Modify `apps/api/app/api/v1/routers/admin_billing.py`; Test `apps/api/tests/test_admin_billing_plans.py`.

**Interfaces (both `require_admin("read")`):**
- `GET /admin/billing/plans` → `{ items: [{plan, price_usd, org_count, mrr_usd, limits: {projects, articles, images, social}}] }`. For each plan in PLAN_PRICE_USD: `price_usd` from the map, `limits` a subset of `PLAN_LIMITS[plan]` (projects/articles/images/social), `org_count` = orgs on that tier, `mrr_usd` = paying orgs on that tier × price.
- `GET /admin/billing/events?type=&page=&page_size=` → `{ items: [{id, org_id, event_type, amount_usd: float|null, processed_at}], total, page, page_size }`. From `SubscriptionEvent`, newest first; `amount_usd` parsed from `payload` when present (Stripe amounts are integer cents under keys like `amount_paid`/`amount_due`/`data.object.amount_paid` → /100; null if not found — guard defensively). Optional `type` filter (ilike on event_type).

- [ ] **Step 1: Write the failing test** — seed Organizations across tiers + `SubscriptionEvent` rows (invoice.paid with `payload={"data":{"object":{"amount_paid":9900}}}`, invoice.payment_failed). Assert: `/plans` returns each plan with price_usd, org_count, mrr_usd, limits; `/events` returns rows newest-first with amount_usd=99.0 parsed from the paid event and null when absent; `type=` filter narrows; 401 without token.
- [ ] **Step 2: Run → RED (404).**
- [ ] **Step 3: Implement** both (defensive payload amount parsing; pagination). 
- [ ] **Step 4: Run → GREEN. Full suite** — no NEW failures. **Commit** `feat(admin): plans config + billing events endpoints` (trailer).

---

### Task 3: Billing page (frontend)

**Files:** Replace `apps/admin/app/(console)/billing/page.tsx`; Modify `apps/admin/lib/admin-types.ts` (add `BillingKpis`, `BillingEvent`).

**Interfaces:** Consumes `GET /admin/billing/kpis` and `GET /admin/billing/events`.

- [ ] **Step 1:** Add types: `BillingKpis = {mrr_usd, arr_usd, mtd_cost_usd, gross_margin_pct: number|null, arpu_usd, paying_orgs, trialing_orgs, enterprise_orgs, failed_payments_30d, by_plan: {plan:string; orgs:number; mrr_usd:number}[]}`; `BillingEvent = {id:string; org_id:string|null; event_type:string; amount_usd:number|null; processed_at:string}`; `Paginated<BillingEvent>`.
- [ ] **Step 2:** Build the page: a **KPI row** (StatCard): MRR (money), ARR (money), Gross margin % (pct, "—" when null), ARPU (money), Paying orgs, Trialing orgs. A small "revenue is estimated from plan tier" caption (honest). An **MRR-by-plan** breakdown (Tremor BarList or a small table: plan badge, orgs, MRR). A **recent Stripe events** DataTable (When, Org, Event type badge — green for `invoice.paid`, destructive for `*payment_failed`, Amount money/"—"), with a `type` filter and pagination; a **failed-payments** highlight (the `failed_payments_30d` count as a warning stat when >0). Honest empty state (no events / no revenue). Loading/error states. Match `providers`/`overview` page patterns.
- [ ] **Step 3: Verify** typecheck + build. **Commit** `feat(admin): billing page (MRR/margin + events)` (trailer).

---

### Task 4: Plans page (frontend)

**Files:** Replace `apps/admin/app/(console)/plans/page.tsx`; Modify `lib/admin-types.ts` (add `PlanRow`).

**Interfaces:** Consumes `GET /admin/billing/plans`. `PlanRow = {plan:string; price_usd:number; org_count:number; mrr_usd:number; limits:{projects:number; articles:number; images:number; social:number}}`.

- [ ] **Step 1:** Add `PlanRow`.
- [ ] **Step 2:** Build the page: a **plan card grid** (or DataTable) — one per plan: plan name badge, price (`$29/mo`), org count, MRR contribution (money), and the key limits (projects/articles/images/social; render `-1` as "Unlimited"). Sort free→scale. A total-MRR summary. Honest empty state. Loading/error. Tokens only, Lucide, mono for numbers. Match the design system.
- [ ] **Step 3: Verify** typecheck + build. **Commit** `feat(admin): plans config page` (trailer).

---

## Self-Review

- **Spec coverage:** Billing §4 (MRR/ARR/margin/ARPU + invoices/failed-payments feed) and Plans §15 (plan config + per-plan MRR). Churn/CAC/LTV honestly omitted (no data). Makes the Executive dashboard's MRR/margin real (Task 1 wires `plan_revenue` into overview).
- **Placeholder scan:** none; backend tasks carry real tests; frontend tasks typecheck/build-verified; "estimated from plan tier" caption is honest, not a TODO.
- **Type/interface consistency:** `plan_revenue` reused by kpis + overview; `PLAN_PRICE_USD` single source; `BillingKpis`/`BillingEvent`/`PlanRow` match endpoints field-for-field. No migration → head stays `r5scaletier1`. Plan prices are whole USD (not micros); COGS is micros/1e6 — kept distinct.
- **Correctness:** paying = plan_tier paid AND stripe_subscription_id AND not suspended; trial/free/suspended excluded from MRR. Grouped queries (no N+1). Defensive Stripe payload amount parsing (null when absent).

## Open items (resolve during implementation)
- Confirm the exact Stripe `payload` shape for invoice amounts in this codebase (webhook handler) — parse defensively, null when the key isn't found.
- Confirm the overview test's seed: if it seeds no paying orgs, MRR stays 0/margin null (test unchanged); only adjust if it now expects a value.
