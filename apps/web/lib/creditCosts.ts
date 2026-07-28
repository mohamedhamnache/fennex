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
