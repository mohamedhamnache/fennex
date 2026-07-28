/**
 * Client-side credit-cost estimates for operations whose price the backend
 * does not (yet) expose through an API. `getUsageSummary()` (see `lib/api.ts`,
 * consumed by `components/billing/CreditMeter.tsx`) reports the signed-in
 * org's used/remaining credit balance, but there is no endpoint that returns
 * a per-operation rate table -- so there is nothing to fetch this number
 * from today.
 *
 * Keep this file the ONLY place a raw credit number is hardcoded in the web
 * app. If the backend later exposes a pricing/rate endpoint, replace the
 * constant below with a query against it and delete this file rather than
 * hardcoding the number again at the call site.
 *
 * Source: docs/superpowers/specs/2026-07-28-product-ai-studio-design.md,
 * section 4 -- `black-forest-labs/flux-kontext-pro` is seeded at 40,000
 * micro-$ ($0.04) per run by migration `y5kontextrate9`, which bills 39 AI
 * credits per Product Showcase generation.
 */
export const PRODUCT_SHOWCASE_CREDIT_COST = 39;

/**
 * Product-to-3D (Trellis on Replicate). Format conversions (GLB pass-through,
 * OBJ via trimesh) are NOT separate Replicate calls and carry no supplier
 * cost of their own -- only the Trellis run does -- so this figure is flat
 * regardless of which formats the user selects.
 *
 * Source: docs/superpowers/specs/2026-07-28-product-ai-studio-design.md,
 * section 4 -- Trellis is listed at 100,000 micro-$ ($0.10/run) as an
 * explicit PLACEHOLDER, not yet seeded as a `cost_rates` row the way
 * `y5kontextrate9` seeded flux-kontext-pro (task-8-brief.md: "the Trellis
 * rate is a placeholder until real per-run pricing is confirmed"). Converted
 * to credits the same way the backend does it -- ceil(cost_micros /
 * CREDIT_MICROS), CREDIT_MICROS = 1_050 (apps/api/app/core/credits.py) --
 * ceil(100_000 / 1_050) = 96. Replace once the real rate is seeded.
 */
export const PRODUCT_3D_CREDIT_COST = 96;
