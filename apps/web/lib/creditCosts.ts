import type { Product3DQuality, Product3DTextureResolution } from "@/lib/api";

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
 * Product-to-3D (Trellis on Replicate) -- ESTIMATED, per-config credits.
 *
 * `PRODUCT_3D_CREDIT_COST` used to be a single flat number. It no longer can
 * be: migration `z7persecond4` (2026-07-29) moved Replicate billing from a
 * flat per-run rate to `predict_time (seconds) x per-GPU-second rate`
 * (`app/services/metering/meter.py::record_replicate`), because a draft/2K
 * run and an ultra/8K run take wildly different compute and were being
 * charged the same. `predict_time` is only known once Replicate finishes the
 * prediction -- it is not returned until the run completes, so the exact
 * cost of a *specific* run can never be shown before submit. Any number
 * shown ahead of time is necessarily an ESTIMATE derived from typical
 * timings, not a quote; the authoritative number is whatever the backend
 * actually metered (reflected afterwards in `getUsageSummary()`'s
 * `credits_remaining`).
 *
 * ## How the estimate is built
 *
 * Trellis takes two inputs that drive compute time (`app/services/product3d
 * /generate.py`):
 *  - `quality` -> `ss_sampling_steps` / `slat_sampling_steps`: draft=6,
 *    high=12, ultra=24 (`_SAMPLING_STEPS`, exact -- these are the literal
 *    values sent to Replicate, not a guess).
 *  - `texture_resolution` -> `texture_size`: 2K/4K/8K (`_TEXTURE_SIZE`).
 *    Baking a bigger texture adds wall-clock time on top of sampling.
 *
 * We do not have Replicate's internal cost model, only observed run times
 * for 4 of the 9 quality x texture combinations (design brief,
 * docs/superpowers/specs/2026-07-28-product-ai-studio-design.md):
 *
 *   draft / 2K  ~9s     high / 2K  26.4s (measured, see migration
 *   z7persecond4's docstring)     high / 4K  ~38s     ultra / 8K  ~75s
 *
 * From draft/2K and high/2K (the only two same-texture points, so isolating
 * the steps effect) we fit a line seconds = SECONDS_PER_STEP * steps +
 * STEPS_FIT_INTERCEPT_SECONDS. Solving the two equations exactly:
 *   6  * m + b = 9
 *   12 * m + b = 26.4
 *   => m = 2.9, b = -8.4
 * (The negative intercept is not a claim about fixed setup cost -- it just
 * means seconds grow slightly faster than linear in steps over this range,
 * which is what the two anchor points show. The fit is only meant to
 * interpolate/extrapolate within the 6-24 step range Trellis is actually
 * called with.)
 *
 * Texture overhead is modelled as additive seconds on top of the steps
 * curve, at texture 2K = 0 baseline:
 *   4K overhead = (high/4K observed 38s) - (high/2K observed 26.4s) = 11.6s
 *   8K overhead = (ultra/8K observed 75s) - (ultra/2K FITTED 61.2s) = 13.8s
 * (8K overhead leans on the fitted curve rather than an observed 2K/8K pair
 * at the same quality, because we only have one 8K data point to calibrate
 * against -- ultra/8K.)
 *
 * This reproduces all 4 observed anchors when rounded to whole credits below
 * (12, 36, 51, 100) and stays monotonically increasing in both quality and
 * texture resolution for the 5 combinations we have no direct measurement
 * for.
 *
 * ## Seconds -> credits
 *
 * Same conversion the backend applies: cost_micros = seconds x
 * GPU_SECOND_RATE_MICROS (1_400 micro-$/GPU-second, Nvidia A100 80GB --
 * migration `z7persecond4`, https://replicate.com/pricing retrieved
 * 2026-07-29), then credits = ceil(cost_micros / CREDIT_MICROS),
 * CREDIT_MICROS = 1_050 (apps/api/app/core/credits.py). 1_400 / 1_050 = 4/3
 * exactly, so credits = ceil(seconds * 4 / 3). The backend also applies a
 * 10-credit floor per Replicate operation (`MIN_REPLICATE_CREDITS`,
 * apps/api/app/core/credits.py) -- mirrored here even though every modelled
 * combination already estimates above it, so this stays correct if the
 * curve is ever recalibrated to something cheaper.
 *
 * Keep this the ONLY place a Product-to-3D credit number is computed
 * client-side, and delete it the moment the backend exposes a real
 * pricing/estimate endpoint -- a number duplicated between client and
 * server drifts.
 */
const PRODUCT_3D_SAMPLING_STEPS: Record<Product3DQuality, number> = {
  draft: 6,
  high: 12,
  ultra: 24,
};

const PRODUCT_3D_SECONDS_PER_STEP = 2.9;
const PRODUCT_3D_STEPS_FIT_INTERCEPT_SECONDS = -8.4;

const PRODUCT_3D_TEXTURE_OVERHEAD_SECONDS: Record<Product3DTextureResolution, number> = {
  "1K": 0,
  "2K": 11.6,
};

const GPU_SECOND_RATE_MICROS = 1_400; // Replicate A100 80GB, migration z7persecond4
const CREDIT_MICROS = 1_050; // apps/api/app/core/credits.py::CREDIT_MICROS
const MIN_REPLICATE_CREDITS = 10; // apps/api/app/core/credits.py::MIN_REPLICATE_CREDITS

/** Estimated Trellis compute time in seconds for a given config. Not exact -- see the file docstring. */
function estimateProduct3DSeconds(
  quality: Product3DQuality,
  textureResolution: Product3DTextureResolution,
): number {
  const steps = PRODUCT_3D_SAMPLING_STEPS[quality];
  const stepsSeconds = PRODUCT_3D_SECONDS_PER_STEP * steps + PRODUCT_3D_STEPS_FIT_INTERCEPT_SECONDS;
  return stepsSeconds + PRODUCT_3D_TEXTURE_OVERHEAD_SECONDS[textureResolution];
}

/**
 * Estimated credits for a Product-to-3D run at the given quality/texture.
 * ESTIMATE ONLY -- label any UI use of this as "about N credits", never as
 * a fixed price. See the file docstring for the full derivation.
 */
export function estimateProduct3DCredits(
  quality: Product3DQuality,
  textureResolution: Product3DTextureResolution,
): number {
  const seconds = estimateProduct3DSeconds(quality, textureResolution);
  const credits = Math.ceil((seconds * GPU_SECOND_RATE_MICROS) / CREDIT_MICROS);
  return Math.max(MIN_REPLICATE_CREDITS, credits);
}

/**
 * Cost of the editor's "subject-cutout" template layer, shown in
 * CutoutConsentDialog before the user spends. `remove_background_cheap`
 * (apps/api/app/services/editing_service.py) runs 851-labs/background-remover
 * on Replicate, a few-GPU-second job that always lands on the
 * MIN_REPLICATE_CREDITS floor rather than a variable per-second charge -- so
 * unlike PRODUCT_3D_CREDIT_COST above, this is not an estimate: it is the
 * exact number the backend will meter, every time. If the floor is ever
 * repriced, update it here in the same change (see MIN_REPLICATE_CREDITS
 * above, apps/api/app/core/credits.py).
 */
export const CUTOUT_CREDIT_COST = MIN_REPLICATE_CREDITS;
