/**
 * Number formatting for the admin console's KPI cards and chart tooltips.
 * Every helper is null/undefined/NaN-safe and renders "—" rather than
 * fabricating a value — the overview endpoints legitimately return zeroes
 * (no usage yet) and `null` (MRR not wired up until billing-plans merges),
 * and both cases need an honest, non-alarming empty display.
 */

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function formatUsd(usd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(usd) >= 1000 ? 0 : 2,
  }).format(usd);
}

/** Format a USD amount stored in micros (1 USD = 1_000_000 micros) — the
 * unit `cost_micros` (KPIs) and the `cost` series metric are both in. */
export function money(micros: number | null | undefined): string {
  if (!isFiniteNumber(micros)) return "—";
  return formatUsd(micros / 1_000_000);
}

/** Format a plain USD amount that's already in dollars (e.g. `mrr_usd`). */
export function moneyUsd(usd: number | null | undefined): string {
  if (!isFiniteNumber(usd)) return "—";
  return formatUsd(usd);
}

/** Format a fraction (e.g. `margin_pct`'s `(mrr - cost) / mrr`) as a
 * percentage. `null` (no MRR to compare against yet) renders "—". */
export function pct(fraction: number | null | undefined, digits = 1): string {
  if (!isFiniteNumber(fraction)) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** Format a small per-unit USD amount (e.g. cost per 1k tokens) that needs
 * sub-cent precision — `moneyUsd`'s 2-decimal rounding would flatten
 * $0.03 vs $0.07 (a >2x efficiency difference) down to indistinguishable
 * cents. Renders "—" for null/undefined and a plain "$0.0000" for an exact
 * zero (a real value, e.g. a model row with no tokens yet — not "no data"). */
export function moneyPer1k(usd: number | null | undefined): string {
  if (!isFiniteNumber(usd)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(usd);
}

/** Compact integer formatting for large counts (tokens, requests): 12400 ->
 * "12.4K". */
export function compactNumber(n: number | null | undefined): string {
  if (!isFiniteNumber(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}
