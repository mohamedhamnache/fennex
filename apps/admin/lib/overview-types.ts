/** Shapes returned by `GET /admin/overview/kpis` and `/admin/overview/series`
 * (`apps/api/app/api/v1/routers/admin_overview.py`). Kept as a standalone
 * module so the KPI grid, the chart wrappers, and the page fetcher share one
 * definition. */

export type OverviewRange = "24h" | "7d" | "30d" | "90d";

export interface OverviewKpis {
  total_orgs: number;
  active_orgs: number;
  total_users: number;
  /** AI + infra spend for the range, in micros (1 USD = 1_000_000 micros). */
  cost_micros: number;
  cost_usd: number;
  ai_input_tokens: number;
  ai_output_tokens: number;
  ai_requests: number;
  seo_count: number;
  mrr_usd: number;
  /** `(mrr_usd - cost_usd) / mrr_usd` — a fraction, not a whole percent.
   * `null` when there's no MRR yet to compare cost against (pre
   * billing-plans). */
  margin_pct: number | null;
}

export type SeriesMetric = "cost" | "tokens" | "requests";

export interface SeriesPoint {
  day: string;
  value: number;
}

export interface OverviewSeries {
  points: SeriesPoint[];
}
