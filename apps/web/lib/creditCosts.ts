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
 * section 4. Trellis is seeded by migration `h4trellisrate6` at 35,000
 * micro-$ ($0.035/run) -- Replicate's published figure for `firtoz/trellis`.
 * Converted to credits the same way the backend does -- ceil(cost_micros /
 * CREDIT_MICROS), CREDIT_MICROS = 1_050 (apps/api/app/core/credits.py) --
 * ceil(35_000 / 1_050) = 34.
 *
 * This is still a supplier price we looked up rather than one reconciled
 * against a Replicate invoice, so it can move. Keep it here, in one place,
 * and delete both constants the moment the backend exposes a per-operation
 * cost endpoint -- a number duplicated between client and server drifts.
 */
export const PRODUCT_3D_CREDIT_COST = 34;
