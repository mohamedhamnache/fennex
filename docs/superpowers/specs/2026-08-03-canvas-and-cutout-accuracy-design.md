# Convert to Canvas Accuracy, and the Remove BG Resolution Bug

**Date:** 2026-08-03
**Status:** Approved (scope), pending spec review
**Scope:** `apps/api` — the decompose endpoint and the background-removal service.

## Two problems, one root

Both features hand a job to a supplier that is wrong for it, and neither meters
what it spends.

### Problem 1 — Convert to Canvas is inaccurate

`decompose_image_to_canvas` (`apps/api/app/api/v1/routers/images.py:1151`) asks
Claude or GPT to return, as JSON, the pixel coordinates of every text element and
object in the image. Vision-language models are weak at precise localisation;
that is what detection models exist for. The object masks then come from a
**local `rembg`** (u2net) inside `_build_layers`.

Published comparisons put rembg's ceiling at edge quality — it loses roughly 40%
of fine strands on hair and struggles with transparency. BiRefNet is the current
state of the art for exactly this.

So the feature is inaccurate in two independent ways: the boxes are guessed, and
the masks are cut with an ageing model.

### Problem 2 — Remove BG silently downscales, and charges 191 credits for it

`_removebg_cutout` (`editing_service.py:266`) calls remove.bg with
`size: "auto"`. Measured against the production database:

| source | output | output MP |
| --- | --- | --- |
| 2160x2160 | 500x500 | 0.250 |
| 1024x1024 | 500x500 | 0.250 |
| 1080x1920 | 408x612 | 0.250 |
| 1792x1024 | 559x447 | 0.250 |

Every degraded result is **exactly 0.25 megapixels** — remove.bg's preview tier.
`size: "auto"` resolves to the highest resolution the account's credits allow,
and it is resolving to preview. Meanwhile `remove_background` calls
`_upload_result` directly, with no `finalize()` and no `ResolutionPolicy`, so
nothing detects the change.

The customer pays **191 AI credits** ($0.20 flat, per
`r7removebg3_removebg_cost_rate`) and receives a quarter-megapixel image.

Two of the four also lost aspect ratio, which a resolution cap alone does not
explain. That remains uninvestigated and is called out in Verification below.

### Neither path is metered correctly

The decompose endpoint has no `meter`, no `record_*` and no `require_credits`
anywhere — not in the endpoint, not in `_decompose_with_anthropic`, not in
`_decompose_with_openai`. Every conversion is unbilled supplier spend, which
breaks the standing rule that every LLM, Replicate or Remove.bg call is metered
and drawn from AI credits.

## Goals

- Replace guessed coordinates with detected ones.
- Replace u2net masks with BiRefNet masks.
- Stop Remove BG returning a quarter-megapixel image.
- Meter every supplier call in both paths.

## Non-goals

- Changing the canvas editor's front end. The `DecomposeResult` contract is
  unchanged; only how its fields are produced changes.
- Changing the template or renderer work on this branch.

---

## 1. Convert to Canvas

All four models verified live against the Replicate API on 2026-08-03. Do not
"correct" these identifiers from memory.

```
lucataco/florence-2-large   version da53547e17d45b9cfb48...   2,146,684 runs
men1scus/birefnet           version f74986db0355b58403ed...   6,965,360 runs
```

Florence-2's `task_input` is an enum, and two of its modes are exactly the jobs
currently being guessed:

- **`OCR with Region`** returns text with bounding boxes.
- **`Object Detection`** returns objects with bounding boxes.

BiRefNet takes `image` and `resolution`.

### The new pipeline

1. **Florence-2, `OCR with Region`** — text elements and their real boxes,
   replacing the LLM's guessed `text_elements`.
2. **Florence-2, `Object Detection`** — object boxes, replacing the LLM's guessed
   `objects`.
3. **BiRefNet** — a pixel-accurate foreground alpha, replacing `rembg_remove`
   inside `_build_layers`. Connected-component splitting against the detected
   boxes stays as it is; only the mask source changes.
4. **LaMa inpainting** — unchanged, still fills the background behind removed
   objects.

The LLM call is dropped entirely. Nothing it was asked for survives: names for
objects come from Florence-2's detection labels.

### Cost, stated honestly

Four Replicate calls per conversion, each landing on `MIN_REPLICATE_CREDITS`:
**roughly 40 credits**, not the 25 estimated when the scope was approved. The
estimate assumed two calls and missed that Florence-2 must run twice — once per
task mode — and that LaMa still runs.

If 40 is too high, the cheapest reduction is dropping `Object Detection` and
deriving object boxes from BiRefNet's connected components alone, which is what
`_build_layers` already does. That saves 10 credits and loses the object labels.

## 2. Remove BG

Switch `remove_background` to `men1scus/birefnet`, which is:

- **higher accuracy** than both remove.bg's tier-limited output and u2net;
- **full resolution**, controlled by the `resolution` input rather than by
  whatever the account's credits allow;
- **10 credits** instead of 191.

`remove_background_cheap` (added earlier on this branch, using
`851-labs/background-remover`) stays as the fast path for the template cutout.
BiRefNet becomes the quality path for the user-facing Remove BG button.

**Resolution policy.** The current code applies none. The new implementation must
assert that the output matches the source frame, and fail loudly if it does not —
a silent resolution change is what made this bug invisible for weeks.

`_removebg_cutout` is used by `mask_service` to derive product-tier masks and is
NOT changed here; only the user-facing `remove_background` switches supplier.

## 3. Metering

Every new call goes through `_replicate_run`, which already meters at the single
supplier chokepoint, so no per-caller metering is added.

Cost rates for `lucataco/florence-2-large` and `men1scus/birefnet` must be seeded
in the same migration that introduces them. An unrated model bills nothing.

The decompose endpoint gains `require_credits("ai")`, matching the sibling image
operations.

---

## Verification

`apps/api` has pytest. Mocked tests prove wiring, not quality, so both are
needed.

**Automated:**
1. Decompose calls Florence-2 twice with the two task modes, and BiRefNet once —
   asserted on the model and version strings.
2. The endpoint is gated by `require_credits("ai")`.
3. `remove_background` calls BiRefNet, not remove.bg.
4. A resolution mismatch in `remove_background` raises rather than storing.
5. The full suite passes; 10 failures are pre-existing and must be confirmed as
   such by stashing.

**Against real images, because mocks cannot judge a matte:**
6. Run BiRefNet and remove.bg on the same photograph including one with hair
   against a busy background, and compare edges. If BiRefNet is not clearly
   better, this spec's premise is wrong and Remove BG should stay on remove.bg
   with `size: "full"` instead.
7. Confirm BiRefNet returns the source resolution.
8. Run the decompose pipeline on a real marketing image and compare the detected
   text boxes against the LLM's previous guesses.

**Open question, deliberately not answered here:** two of the four measured
downscales also changed aspect ratio (1080x1920 to 408x612, 1792x1024 to
559x447). A 0.25 MP cap preserves aspect; these did not. Either remove.bg is
also cropping, or `source_image_id` does not point at the true immediate parent.
Resolve this before closing the bug, because if it is cropping then switching
supplier fixes the symptom and leaves the cause.
