# Admin Console — Phase 1b Batch 3: AI & SEO Analytics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the four analytics stubs (Providers, Models, DataForSEO, Usage) into real, read-only cost/usage intelligence over the data Fennex already captures — the reseller's COGS/margin lens.

**Architecture:** One new read-only `/api/v1/admin/analytics/*` router aggregating `usage_daily` (fast trends/rollups) + `usage_event` (finer grain: `seo_unit`), joined to `provider_account`, `model_catalog`, and `organization`. Four new frontend pages with KPI cards + Tremor charts + tables. No mutations, no migration. Builds on Batches 1-2 (merged to main). Spec: `docs/superpowers/specs/2026-07-27-admin-dashboard-design.md` §5-8.

**Tech Stack:** FastAPI, SQLAlchemy 2 async; Next.js 14, TanStack Query, Tremor, Lucide.

## Global Constraints

- Branch `feat/admin-analytics` (off main, has Batches 1-2 + the new admin design system). Current single alembic head `r5scaletier1`. **No migration in this batch.**
- **Money = integer micro-dollars**; `cost_usd = cost_micros / 1_000_000`; format at the edge.
- **All endpoints read-only, gated by `require_admin("read")`** → 401 without a token. Register in `apps/api/app/api/v1/router.py`.
- **HONEST DATA (critical):** `usage_event`/`usage_daily` record tokens, `seo_count`, and `cost` — but NOT latency, request status, success/failure, or rate limits. Do NOT fabricate those. Any such metric renders a "Not instrumented yet" state on the frontend; endpoints simply omit them. This is a deliberate reseller-COGS view, not an APM.
- **`usage_daily.unit`** is the event kind (`'llm'` | `'seo'`), NOT the seo endpoint. Per-SEO-endpoint (serp/keyword_ideas) breakdown must come from `usage_event.seo_unit`. Provider/model/cost aggregates use `usage_daily` (grouped, no N+1).
- **Backend tests:** HOST in-memory SQLite, `asyncio_mode="auto"`; mirror `apps/api/tests/test_admin_orgs.py` (ASGITransport + `app.dependency_overrides[get_db]`, bearer via `create_admin_token`). Register models already exist.
- **Frontend:** App Router + TS; admin `apiClient` (never `fetch`); **the admin design system on main** (cool dark-first tokens, Inter/JetBrains Mono, `card-base`, `badge`, shared `DataTable`, `StatCard`) — tokens only, NO hard-coded colors, Lucide icons, no emoji. **Apply ui-ux-pro-max:** dense-but-legible dashboard layout, `font-mono tabular-nums` for all numerics, Tremor charts themed to the cool palette (use Tremor color names `indigo`/`blue`/`violet`/`cyan`/`emerald` consistently; ensure axis/legend legibility on the dark bg), subtle motion, honest empty/loading/error states, responsive (tables scroll in their card). Verify each with `npm run typecheck` + `npm run build`.
- **No emoji.** Commit `feat(admin):`; trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Data facts (verified — read the models to confirm)
- `usage_daily`: `day, org_id, provider, model, unit('llm'|'seo'), requests, input_tokens, output_tokens, cache_read_tokens, seo_count, cost_micros`.
- `usage_event`: `org_id, ts, kind('llm'|'seo'), provider, model, feature, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, seo_unit, seo_count, cost_micros`.
- `provider_account`: `kind, provider, label, is_active, priority, monthly_budget_cents`.
- `model_catalog`: `band(cheap|standard|premium), provider, model, priority, is_active`.
- `Organization`: `id, name, slug`. `cost_rate`: pricing (not required for these aggregates — cost is already stored).
- Range param `{24h,7d,30d,90d}` → start date; default `30d`. "Month-to-date" = from the 1st of the current month.

---

### Task 1: Providers + Models analytics endpoints

**Files:** Create `apps/api/app/api/v1/routers/admin_analytics.py`; Modify `apps/api/app/api/v1/router.py`; Test `apps/api/tests/test_admin_analytics_ai.py`.

**Interfaces (both `require_admin("read")`):**
- `GET /admin/analytics/providers?range=30d` → `{ items: [ProviderRow], totals: {requests, cost_usd} }` where `ProviderRow = {provider, kind, is_configured: bool, is_active: bool, requests, input_tokens, output_tokens, cost_micros, cost_usd, model_count, monthly_budget_usd: float|null, mtd_cost_usd}`.
  - Aggregate `usage_daily` grouped by `provider` over the range (sum requests/tokens/cost). `is_configured`/`is_active`/`monthly_budget_usd` from `provider_account` (a provider may appear in usage but not be configured, or vice-versa — LEFT combine so both sets are represented; `is_configured=False` when no provider_account row). `model_count` = count of `model_catalog` rows for that provider (any band). `mtd_cost_usd` = sum cost for that provider from the 1st of the current month (separate query, not the range).
- `GET /admin/analytics/models?range=30d` → `{ items: [ModelRow], cheapest: {provider, model}|null }` where `ModelRow = {provider, model, band: str|null, requests, input_tokens, output_tokens, cost_micros, cost_usd, cost_per_1k_tokens: float}`.
  - Aggregate `usage_daily` where `unit='llm'` and `model != ''` grouped by `(provider, model)`. `band` from `model_catalog` (null if unknown). `cost_per_1k_tokens = cost_usd / ((input_tokens+output_tokens)/1000)` guarded for zero tokens (→ 0). `cheapest` = the active `model_catalog` row with band `cheap` and lowest priority (a hint the UI can show as "recommended cheaper default").

- [ ] **Step 1: Write the failing test** — seed provider_account (openai configured w/ budget; anthropic configured), model_catalog (a few models incl. bands), and `usage_daily` rows across providers/models (llm + seo) + one current-month row. Assert: providers list includes openai/anthropic with summed requests/cost_usd, correct model_count, `is_configured`, `monthly_budget_usd`, and `mtd_cost_usd`; models list groups by (provider,model) for llm with band + cost_per_1k; 401 without token. Read the models to satisfy NOT NULL when seeding.
- [ ] **Step 2: Run → RED (404).**
- [ ] **Step 3: Implement** both endpoints (grouped queries, LEFT combine providers, guarded cost_per_1k, mtd query). Register the router in `router.py`.
- [ ] **Step 4: Run → GREEN. Full suite** (`cd apps/api && python -m pytest -q`; ignore the 10 known pre-existing failures; no NEW failures). **Commit** `feat(admin): provider + model analytics endpoints` (trailer).

---

### Task 2: DataForSEO + Usage-explorer analytics endpoints

**Files:** Modify `apps/api/app/api/v1/routers/admin_analytics.py`; Test `apps/api/tests/test_admin_analytics_seo.py`.

**Interfaces (both `require_admin("read")`):**
- `GET /admin/analytics/seo?range=30d` → `{ total_requests, total_seo_count, cost_micros, cost_usd, by_unit: [{unit, count, cost_usd}], top_consumers: [{org_id, org_name, seo_count, cost_usd}] }`.
  - `total_*`/`cost` from `usage_event` where `kind='seo'` (or `usage_daily` unit='seo') over range. `by_unit` groups `usage_event.seo_unit` (serp/keyword_ideas) — sum `seo_count` + cost per unit. `top_consumers` = top 10 orgs by seo cost (group `usage_event`/`usage_daily` by org_id where seo, join `organization` for `org_name`), desc.
- `GET /admin/analytics/usage?metric=cost|tokens|requests|seo&group_by=provider|model|org|unit&range=30d` → `{ groups: [{key, label, value}], series: [{day, value}] }`.
  - From `usage_daily`. `metric` maps: cost→sum(cost_micros)→usd, tokens→sum(input+output), requests→sum(requests), seo→sum(seo_count). `group_by` groups the aggregate (for `org`, `label`=org_name via join; else label=key). `series` = the metric summed per `day` across the range (for a trend line). Sensible defaults (metric=cost, group_by=provider).

- [ ] **Step 1: Write the failing test** — seed `usage_event` seo rows (serp + keyword_ideas across 2 orgs) + `usage_daily` rows (varied provider/model/day). Assert: `/seo` returns correct total_seo_count, by_unit split (serp vs keyword_ideas), top_consumers ordered desc with org_name; `/usage?metric=cost&group_by=provider` returns provider groups summing cost_usd and a non-empty daily series; `metric=seo&group_by=unit` works; 401 without token.
- [ ] **Step 2: Run → RED (404).**
- [ ] **Step 3: Implement** both endpoints (usage_event for seo_unit + top consumers with org join; usage_daily for the explorer group/series). 
- [ ] **Step 4: Run → GREEN. Full suite** — no NEW failures. **Commit** `feat(admin): dataforseo + usage-explorer analytics endpoints` (trailer).

---

### Task 3: Providers page (frontend)

**Files:** Replace `apps/admin/app/(console)/providers/page.tsx`; Modify `apps/admin/lib/admin-types.ts` (add `ProviderRow`).

**Interfaces:** Consumes `GET /admin/analytics/providers` via `apiClient` + Query (key includes range). `ProviderRow` per the Task-1 contract.

- [ ] **Step 1:** Add `ProviderRow` type.
- [ ] **Step 2:** Build the page: a range selector (24h/7d/30d/90d) driving the query; a KPI row (StatCard: total providers active, total AI requests, total cost, ...); a **provider card grid OR DataTable** — per provider: name, kind badge (LLM/SEO), Status (Configured/Active vs "Not configured" pill), Requests (mono), Tokens (compact), Cost (money, mono), Model count, and a **budget bar** (mtd_cost_usd vs monthly_budget_usd when set). Include a small "Latency & error rate — not instrumented yet" note where the spec expects them (honest). Loading/empty/error states.
- [ ] **Step 3: Verify** typecheck + build. **Commit** `feat(admin): AI providers analytics page` (trailer).

---

### Task 4: Models page (frontend)

**Files:** Replace `apps/admin/app/(console)/models/page.tsx`; Modify `lib/admin-types.ts` (add `ModelRow`).

**Interfaces:** Consumes `GET /admin/analytics/models`. `ModelRow` per Task 1.

- [ ] **Step 1:** Add `ModelRow` type.
- [ ] **Step 2:** Build the page: range selector; KPI row (models in use, total LLM cost, blended cost/1k tokens); a `DataTable` of models — Provider, Model (mono), Band badge (cheap/standard/premium — token-colored), Requests, Input/Output tokens (compact mono), Cost (money mono), **Cost / 1k tokens** (mono, the efficiency column). Sort by cost desc by default. Show the `cheapest` recommendation as a small callout ("Cheapest default: {provider}/{model}"). "Latency & success rate — not instrumented yet" honest note. A simple bar chart (Tremor) of cost by model (top N). Loading/empty/error.
- [ ] **Step 3: Verify** typecheck + build. **Commit** `feat(admin): model analytics page` (trailer).

---

### Task 5: DataForSEO page (frontend)

**Files:** Replace `apps/admin/app/(console)/dataforseo/page.tsx`; Modify `lib/admin-types.ts` (add `SeoAnalytics` type).

**Interfaces:** Consumes `GET /admin/analytics/seo`.

- [ ] **Step 1:** Add the `SeoAnalytics` type (matching Task-2 shape).
- [ ] **Step 2:** Build the page: range selector; KPI row (total SEO requests, total credits/seo_count, total cost); a **by-endpoint** breakdown (serp vs keyword_ideas — small table or Tremor donut/bar of count + cost per unit); a **Top consumers** `DataTable` (org name → link `/orgs/${org_id}`, seo_count mono, cost money mono, desc). "Failed requests & latency — not instrumented yet" honest note. Loading/empty/error.
- [ ] **Step 3: Verify** typecheck + build. **Commit** `feat(admin): DataForSEO analytics page` (trailer).

---

### Task 6: Usage explorer page (frontend)

**Files:** Replace `apps/admin/app/(console)/usage/page.tsx`; Modify `lib/admin-types.ts` (add `UsageExplorer` type).

**Interfaces:** Consumes `GET /admin/analytics/usage?metric=&group_by=&range=`.

- [ ] **Step 1:** Add the `UsageExplorer` type (`{groups:[{key,label,value}], series:[{day,value}]}`).
- [ ] **Step 2:** Build the explorer: controls — **metric** select (Cost / Tokens / Requests / SEO credits), **group-by** select (Provider / Model / Org / Unit), range selector; a Tremol area/line **trend chart** (`series`, value formatted per metric — money for cost, compact for counts); a **breakdown** below (`groups` — a horizontal bar list or Tremol BarList/DataTable: label + value, sorted desc, org labels link to `/orgs/${key}` when group_by=org). Loading/empty/error; honest empty state when no usage. The value formatter must switch on metric (cost→money, else compactNumber).
- [ ] **Step 3: Verify** typecheck + build. **Commit** `feat(admin): usage explorer page` (trailer).

---

## Self-Review

- **Spec coverage:** Providers §5, Models §6, DataForSEO §7, Usage §8 — all the cost/usage dimensions the captured data supports. Latency/error/success/rate-limit metrics are honestly omitted (not instrumented) rather than faked.
- **Placeholder scan:** none; backend tasks carry real tests; frontend tasks typecheck/build-verified; "not instrumented" notes are deliberate, not TODOs.
- **Type/interface consistency:** `ProviderRow`/`ModelRow`/`SeoAnalytics`/`UsageExplorer` identical between the endpoint (T1/T2) and the pages (T3-T6). No migration → head stays `r5scaletier1`. `cost_usd = cost_micros/1e6` everywhere.
- **Data correctness:** provider/model/cost from `usage_daily` (grouped, no N+1); seo_unit + top-consumers from `usage_event`; mtd is a distinct current-month query; cost_per_1k guarded for zero tokens.

## Open items (resolve during implementation)
- Confirm whether to source SEO totals from `usage_event` (kind='seo') vs `usage_daily` (unit='seo') — prefer `usage_event` for the seo_unit breakdown and org top-consumers; either is fine for totals (use one consistently).
- Tremor chart color theming on the new dark palette — pick a consistent cool set and confirm axis/legend contrast.
