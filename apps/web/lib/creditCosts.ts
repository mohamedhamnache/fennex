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

/**
 * Anthropic `claude-haiku-4-5-20251001` token prices in micro-$, seeded by
 * migrations `h3w4x5y6z7a8` (input/output) and used by every LLM-backed
 * estimate below. Same caveat as the Replicate rates above: an LLM charge is
 * token-shaped and therefore never exactly knowable before the call, so
 * anything derived from these is an ESTIMATE and must be labelled "about".
 */
const HAIKU_INPUT_MICROS_PER_TOKEN = 1.0;
const HAIKU_OUTPUT_MICROS_PER_TOKEN = 5.0;

/** Round a token-priced LLM cost to whole credits the way the backend does. */
function llmCredits(inputTokens: number, outputTokens: number): number {
  const micros =
    inputTokens * HAIKU_INPUT_MICROS_PER_TOKEN + outputTokens * HAIKU_OUTPUT_MICROS_PER_TOKEN;
  // LLM credits are NOT floored -- the MIN_REPLICATE_CREDITS floor applies
  // only to Replicate ("edit" kind) operations. See
  // apps/api/app/core/credits.py::replicate_operation_credits.
  return Math.max(1, Math.ceil(micros / CREDIT_MICROS));
}

/**
 * Mirage's "Rephrase" control, shown on the button before it spends.
 *
 * It calls `POST /images/improve-prompt` with `mode: "edit_instruction"`
 * (apps/api/app/api/v1/routers/images.py), which runs ONE
 * `claude-haiku-4-5-20251001` call through `call_llm` and is metered
 * ambiently against the org.
 *
 * Unlike every other LLM estimate here, this one is NOT token-derived. The
 * feature carries a pricing floor -- `FEATURE_MIN_CREDITS["improve_prompt"]`
 * in apps/api/app/core/credits.py -- so a rephrase bills a flat
 * MIN_REPLICATE_CREDITS regardless of how few tokens it actually spent.
 *
 * Its real token cost is ~2 credits' worth: `_IMPROVE_EDIT_SYSTEM` is a
 * detailed prompt-engineering brief (~600 tokens) and the answer runs to a
 * few sentences (~200), so 600 * 1.0 + 200 * 5.0 = 1600 micro-$. The floor
 * prices the action as an operation rather than at cost, and comfortably
 * covers the richer system prompt.
 *
 * This is therefore an exact figure, not an estimate, for any rephrase that
 * lands under the floor -- which is all of them short of a pathological
 * input. If the floor is ever raised or removed, change it in credits.py and
 * here in the same commit, or the button will quote a price the ledger does
 * not charge.
 */
export const PROMPT_REPHRASE_CREDIT_COST = Math.max(
  MIN_REPLICATE_CREDITS, llmCredits(140, 40),
);

/**
 * Reading an image attached to a Mirage message, shown on the attachment chip
 * before the message is sent.
 *
 * `POST /images/interpret-attachment` makes exactly ONE vision call
 * (`claude-haiku-4-5-20251001`, metered ambiently through `call_llm_vision`)
 * that returns BOTH the chosen interpretation and a description of the image.
 * One call, not two, is deliberate: the description is fetched even when the
 * verdict is "insert", so switching the interpretation afterwards costs
 * nothing at all and the number shown here is the same whichever way the
 * classification lands.
 *
 *   input  ~= ~1600 image tokens for a normal photo (Anthropic bills roughly
 *             width*height/750) + ~250 for the system prompt and command
 *   output ~= the small JSON verdict + one-paragraph description -> 250
 *   1850 * 1.0 + 250 * 5.0 = 3100 micro-$ -> ceil(3100 / 1050) = 3 credits
 *
 * This is the ATTACHMENT READ only. Inserting the image costs nothing further
 * (it lands as a client-side layer). Using it as a reference then spends
 * whatever the edit itself costs, which is the normal Mirage per-message
 * charge and is unchanged by this feature.
 */
export const ATTACHMENT_INTERPRET_CREDIT_COST = llmCredits(1850, 250);

/**
 * SEO credits a week of scheduled rank tracking spends, per tracked keyword.
 *
 * The cron asks the Standard queue for depth 10 -- one 10-result page, which
 * DataForSEO bills at $0.0006 -- and `rank_check_standard` is weighted at 1
 * credit per page (apps/api/app/core/credits.py::SEO_CREDIT_WEIGHT).
 *
 * So the monthly cost of enabling it is roughly:
 *     tracked keywords x 1 credit x 4.33 weeks
 *
 * Shown beside the toggle because this is the only setting in the product that
 * starts spending on a schedule. Everything else bills when a user asks for it;
 * this bills whether or not anyone looks at the result.
 */
export const RANK_TRACKING_WEEKLY_CREDITS = 1;
