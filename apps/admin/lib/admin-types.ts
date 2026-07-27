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
