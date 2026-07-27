/** Shapes returned by the Phase 1b admin org/audit endpoints
 * (`apps/api/app/api/v1/routers/admin_orgs.py`, `admin_audit.py` — built in
 * parallel on the backend track). Kept as a standalone module so the
 * organizations list/detail pages and the audit log page share one
 * definition, mirroring `lib/overview-types.ts`. */

/** Generic page envelope returned by every paginated admin list endpoint. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** One row of `GET /admin/orgs`. */
export interface AdminOrgRow {
  id: string;
  name: string;
  slug: string;
  plan_tier: string;
  byok_enabled: boolean;
  suspended: boolean;
  user_count: number;
  project_count: number;
  /** AI + infra spend, in micros (1 USD = 1_000_000 micros). */
  cost_micros: number;
  cost_usd: number;
  ai_requests: number;
  seo_count: number;
  created_at: string;
}

/** `GET /admin/orgs/{id}` — the row plus billing/trial detail and the org's
 * projects. */
export interface AdminOrgDetail extends AdminOrgRow {
  suspended_reason: string | null;
  trial_ends_at: string | null;
  stripe_customer_id: string | null;
  projects: {
    id: string;
    name: string;
    domain: string;
    created_at: string;
  }[];
}

/** `POST /admin/orgs/{id}/impersonate` — a short-lived session token scoped
 * to the org's owner, plus enough of the owner's identity to show it in the
 * confirmation dialog. There's no cross-app auto-login yet (see
 * `orgs/[id]/page.tsx`), so this is only ever displayed, never redirected
 * with. */
export interface AdminImpersonateResult {
  access_token: string;
  token_type: string;
  user: {
    id: string;
    email: string;
    full_name: string | null;
  };
  expires_in: number;
}

/** One row of `GET /admin/users`. */
export interface AdminUserRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  org_id: string;
  org_name: string;
  is_active: boolean;
  locked: boolean;
  language: string;
  created_at: string;
  updated_at: string;
}

/** `GET /admin/users/{id}` — the row plus profile/org detail used by the
 * user detail page. */
export interface AdminUserDetail extends AdminUserRow {
  avatar_url: string | null;
  locked_reason: string | null;
  org: {
    id: string;
    name: string;
    slug: string;
    plan_tier: string;
  };
}

/** One row of `GET /admin/audit`. */
export interface AdminAuditRow {
  id: number;
  actor_admin_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  before_json: unknown;
  after_json: unknown;
  ip: string | null;
  result: string;
  created_at: string;
}

/** One row of `GET /admin/analytics/providers` (`admin_analytics.py`, Phase
 * 1b Batch 3). One entry per AI provider Fennex integrates with — both LLM
 * providers (Anthropic, OpenAI, ...) and SEO data providers (DataForSEO,
 * ...), distinguished by `kind`. `monthly_budget_usd` is `null` when no
 * budget has been configured for the provider, in which case the page skips
 * the budget bar rather than dividing by a phantom limit. */
export interface ProviderRow {
  provider: string;
  kind: string;
  is_configured: boolean;
  is_active: boolean;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  /** Cost for the selected range, in micros (1 USD = 1_000_000 micros). */
  cost_micros: number;
  /** Same cost, pre-converted to dollars. */
  cost_usd: number;
  model_count: number;
  monthly_budget_usd: number | null;
  /** Month-to-date spend against `monthly_budget_usd`, independent of the
   * selected range (a range like "24h" would otherwise make the budget bar
   * look emptier than the actual monthly commitment). */
  mtd_cost_usd: number;
}

/** One row of `GET /admin/analytics/models` (`admin_analytics.py`, Phase 1b
 * Batch 3). One entry per `(provider, model)` pair actually used in the
 * range — `band` comes from `model_catalog` (cheap/standard/premium) and is
 * `null` for a model Fennex called but never registered in the catalog,
 * which the page renders as an honest "unclassified" state rather than
 * guessing a tier. */
export interface ModelRow {
  provider: string;
  model: string;
  band: string | null;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  /** Cost for the selected range, in micros (1 USD = 1_000_000 micros). */
  cost_micros: number;
  /** Same cost, pre-converted to dollars. */
  cost_usd: number;
  /** `cost_usd / (total_tokens / 1000)` — 0 when the row has zero tokens,
   * never a divide-by-zero. The efficiency column: two models can have
   * similar total spend but very different cost per unit of work. */
  cost_per_1k_tokens: number;
}

/** `GET /admin/analytics/seo` (`admin_analytics.py`, Phase 1b Batch 3) — spend
 * and volume against the DataForSEO integration for the selected range.
 * `by_unit` breaks total usage down per DataForSEO unit (`serp`,
 * `keyword_ideas`, ...); `top_consumers` ranks orgs by SEO credit spend,
 * highest first. */
export interface SeoAnalytics {
  total_requests: number;
  total_seo_count: number;
  /** Cost for the selected range, in micros (1 USD = 1_000_000 micros). */
  cost_micros: number;
  /** Same cost, pre-converted to dollars. */
  cost_usd: number;
  by_unit: {
    unit: string;
    count: number;
    cost_usd: number;
  }[];
  top_consumers: {
    org_id: string;
    org_name: string;
    seo_count: number;
    cost_usd: number;
  }[];
}

/** `GET /admin/billing/kpis` (`admin_billing.py`, Phase 1b Batch 4) — revenue
 * and margin, estimated from plan tier (no direct Stripe MRR API call).
 * `gross_margin_pct` is `(mrr_usd - mtd_cost_usd) / mrr_usd`, a fraction —
 * `null` when there's no MRR yet to compare cost against, rendered "—" by
 * `lib/format.ts#pct` rather than a misleading 0%. `by_plan` is sorted
 * server-side by `mrr_usd` descending. */
export interface BillingKpis {
  mrr_usd: number;
  arr_usd: number;
  /** AI + infra spend, month-to-date, in dollars. */
  mtd_cost_usd: number;
  gross_margin_pct: number | null;
  arpu_usd: number;
  paying_orgs: number;
  trialing_orgs: number;
  enterprise_orgs: number;
  /** Failed Stripe payments in the trailing 30 days. */
  failed_payments_30d: number;
  by_plan: {
    plan: string;
    orgs: number;
    mrr_usd: number;
  }[];
}

/** One row of `GET /admin/billing/events` — a recent Stripe webhook event
 * (invoice paid, payment failed, subscription updated, ...). `org_id` and
 * `amount_usd` are `null` when the event isn't tied to an org or doesn't
 * carry an amount (e.g. a non-invoice event), rendered "—" rather than a
 * fabricated value. */
export interface BillingEvent {
  id: string;
  org_id: string | null;
  event_type: string;
  amount_usd: number | null;
  processed_at: string;
}

/** `GET /admin/analytics/usage` (`admin_analytics.py`, Phase 1b Batch 3) — the
 * cross-cutting usage explorer: one metric (`cost`, `tokens`, `requests`,
 * `seo`), grouped one way at a time (`provider`, `model`, `org`, `unit`), over
 * a range. `groups.value` and `series.value` are both already in the unit
 * the selected metric implies (dollars for `cost`, a raw count otherwise) —
 * the page's formatter switches on `metric`, not on inspecting the numbers. */
export interface UsageExplorer {
  groups: { key: string; label: string; value: number }[];
  series: { day: string; value: number }[];
}
