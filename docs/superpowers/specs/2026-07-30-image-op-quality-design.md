# Image operation quality — design

Date: 2026-07-30
Status: approved, not yet implemented

## Problem

Image AI operations produce poor results. Two complaints, both reproducible from
the code:

1. **Removal invents a new object instead of removing one.**
2. **Output loses quality and resolution.**

These are not eighteen separate bugs. They are four systemic causes plus an
unverified model roster.

### Cause 1 — destructive edits are routed through a generative model

`remove_object` calls `_analyze_background` (GPT-4o-mini) to describe the
background, then passes that description to `flux-fill-pro` as a text prompt.
flux-fill's `guidance` defaults to **60** — strong adherence to the prompt over
the image. So the system asks a strongly-guided generative model to paint
"a wooden table surface" into the masked hole, and it does exactly that,
frequently including objects.

This is the direct cause of complaint 1. It is a design error, not a tuning
problem: a model with a prompt channel will generate from the prompt.

### Cause 2 — resolution is destroyed on specific paths

- `_sd_inpaint_size` caps at **768px**, and the caller then upscales back to the
  original with `_download_and_upload_url(..., resize_to=(orig_w, orig_h))`.
  Downscale, inpaint, upscale is irreversible blur. This is the removal fallback.
- `ic-light` (relight) outputs **512x640** by default. Larger inputs are crushed.

### Cause 3 — a lossy encode round-trip on every operation

`flux-fill`'s `output_format` defaults to **jpg**. That lossy JPEG is then
downloaded, decoded, `.convert("RGBA")`'d and re-encoded as PNG by
`_download_and_upload_url` / `_upload_result`. The result carries JPEG artifacts
at PNG file size — the worst of both. The conversion is applied to output that
needed no transformation at all.

### Cause 4 — wrong or missing models

- `smart_erase` is a Pillow Gaussian-blur content fill, not inpainting.
- `generate_shadow` points at `fal-ai/shadow-generation`, which does not exist on
  Replicate (its metadata endpoint 404s).

Four model-level defects surfaced on 2026-07-30 alone (`ic-light` 404 plus wrong
field names, `codeformer` 404, `shadow-generation` nonexistent) in a roster that
had never been verified against the live API.

## Goals

- Output resolution equals input resolution. Where a model makes that impossible,
  an explicit per-operation policy applies (upscale, or fail loudly). A silent
  downscale is never acceptable.
- Removal removes. It must be structurally incapable of inventing content.
- No lossy re-encoding of output that needed no transformation.
- Every AI-backed operation verified against the live API.

Quality is prioritised over per-edit cost (decided 2026-07-30). Note that the
headline change is also cheaper: LaMa replaces both a GPT-4o-mini vision call and
a flux-fill call on the removal path.

Out of scope: preserving the input container format (a JPEG in does not have to
return a JPEG out). "Size" here means pixel dimensions, not file size.

## Approach

Chosen: **a central output contract plus a per-operation model audit.**

Rejected:
- *Fix each operation independently.* The forced-RGBA conversion and the missing
  resolution assertion would each need fixing in ~18 places; whichever are missed
  stay broken silently, which is how the current state arose.
- *Declarative operation registry.* Each op declares model, version, field
  mapping and resolution policy as data, enforced by an engine. Most robust and
  makes the audit mechanical, but it is a large refactor of partly-working code
  and risks destabilising the operations that are currently fine.

## Section 1 — the output contract

Applies to ALL operations, including the Pillow ones.

Replace `_download_and_upload_url` with a finalizer that:

- **Passes bytes through untouched when no transformation is needed.** If the
  model returns a PNG, store exactly those bytes. No decode, no re-encode, no
  colour-mode conversion. This is the single largest free quality win.
  Transformation IS needed in exactly three cases: the operation is itself a
  local Pillow transform (crop, rotate, filter and friends); the resolution
  policy requires an upscale; or the returned format is one our storage or
  clients cannot serve. Dimensions are read from the header rather than by
  decoding the full image, so the resolution assertion does not itself force a
  decode.
- **Never forces RGBA.** Alpha is added only by operations that genuinely produce
  transparency (background removal). A photo stays RGB.
- **Never resizes unless the caller explicitly asks.** The `resize_to`
  round-trip disappears from every path that is not itself a resize.
- **Asserts output resolution against input**, applying an explicit per-operation
  policy when they differ: upscale, or fail loudly. Never silently return a
  smaller image, which is today's behaviour.

Alongside it, request lossless output wherever the model supports it —
`flux-fill`'s `output_format` accepts `png` and currently defaults to `jpg`.

For the Pillow operations the same principles apply locally: preserve the source
colour mode instead of forcing RGBA, and encode losslessly.

**Deliberately excluded: a blanket "always upscale to match" rule.** Upscaling a
model's downscaled output is not equivalent to never downscaling it — it
fabricates detail. Where a model has a hard cap, the audit decides per operation
whether an upscale pass is acceptable for that operation or whether the model
should be replaced.

## Section 2 — removal

The current code conflates destructive and creative edits. They are different
operations needing different model classes:

| Intent | Operations | Model class | Prompt |
|---|---|---|---|
| Remove | `remove_object`, `smart_erase` | Reconstructive (LaMa) | None |
| Create | `replace_background`, `insert_object`, `generative_fill` | Generative (flux-fill) | Yes |

Removal moves to `allenhooo/lama`, version
`cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72`, taking only
`image` and `mask` (both required), returning a single URI string — compatible
with `_replicate_run`'s existing string contract. 20.8M runs, resolution-robust.

With no prompt channel, hallucinating a replacement object is structurally
impossible rather than tuned against.

Three things are deleted, not fixed:

- **`_analyze_background`** — it exists solely to build the prompt that causes
  the hallucination. Deleting it removes a supplier call, its latency and its
  cost from every removal.
- **The entire SD-inpaint fallback**: `_sd_inpaint_size`, `_MODEL_SD_INPAINT` and
  `_SD_INPAINT_VERSION`.
- **`smart_erase`'s `_pillow_content_fill`** Gaussian-blur smear.

Caller counts verified in the source, not assumed: `_analyze_background` is used
only by `remove_object`; `_sd_inpaint_size`, `_MODEL_SD_INPAINT` and
`_SD_INPAINT_VERSION` only by `remove_object`'s fallback branch; and
`_pillow_content_fill` only by `smart_erase`. Every one becomes dead code once
removal moves to LaMa, so this is a clean deletion rather than an orphaning.

`smart_erase` and `remove_object` both become "reconstruct what is under the
mask" and collapse onto one implementation. Both operation NAMES are retained —
the planner vocabulary and the UI reference them — backed by a single code path.

Also cleaned up: **`smart_erase` accepts an `openai_key` parameter it never
uses**, and `editing.py` decrypts and injects one for it on every call. That
plumbing goes away with the parameter.

The creative operations keep flux-fill, which is correct for them, and receive
the `output_format: png` fix. `guidance` is deliberately NOT lowered on
`replace_background`: when the user asks for a green marble backdrop, strong
prompt adherence is wanted. High guidance was only wrong because it was pointed
at a removal task.

## Section 3 — the model audit

Every AI-backed operation is verified against the live Replicate API on five
points: the model exists; it has an active deployment or is version-pinned; field
names match the live schema; parameters suit the task; output resolution matches
input.

Pillow-only operations (crop, resize, rotate, flip, adjust, filter, denoise,
sharpen) are exempt from the model audit — no model, no hallucination risk — but
are still bound by the Section 1 contract.

| Operation | Model | Known state |
|---|---|---|
| replace_background, insert_object, generative_fill | `black-forest-labs/flux-fill-pro` | Works. Needs `output_format: png` |
| remove_object, smart_erase | `allenhooo/lama` (new) | Verified, version pinned |
| upscale | `nightmareai/real-esrgan` | Works — hot endpoint answers 422, so it has a deployment |
| restore_face | `sczhou/codeformer` | Version pinned 2026-07-30 |
| relight | `zsxkib/ic-light` | Pinned 2026-07-30, but outputs 512x640 |
| background_removal | Remove.bg (external) | Works |

Two operations need decisions the audit cannot make mechanically:

1. **`generate_shadow` has no model.** `fal-ai/shadow-generation` does not exist.
   A real model must be found and verified, or the operation withdrawn from the
   planner vocabulary and the UI — leaving it in place is shipping a guaranteed
   failure users can trigger.
2. **`relight` cannot meet resolution parity with `ic-light`.** The model exposes
   `width`/`height`, but the enum caps at **1024**. For larger inputs parity is
   impossible with this model. Either accept an upscale pass for this operation
   or replace the model. Decide with evidence during the audit.

Expect the audit to surface more. The four defects found on 2026-07-30 came from
spot-checks, not a systematic pass.

## Section 4 — verification

Unit tests pin model IDs, versions, field names, and the resolution assertion —
the same shape as the tests that caught the 2026-07-30 defects, which asserted
call arguments rather than just that a call happened.

**Mocked tests cannot judge whether an edit looks good.** They would have passed
on every defect behind this spec, because those are syntactically correct calls
to badly-chosen models with badly-chosen parameters. Automated coverage proves
wiring; it cannot prove quality.

The implementation therefore ends with a mandatory manual pass, one real edit per
operation on a real image, with a named before/after check:

- **remove_object / smart_erase** — the masked object is gone and the region is
  plausible background. If a NEW object appears, the model or mask is wrong.
- **replace_background** — only the background changed; the product is untouched.
  If the product changed and the background did not, mask polarity is inverted.
- **relight** — output dimensions equal input dimensions.
- **upscale, restore_face** — output is larger/cleaner with no dimension loss.
- **Every operation** — output resolution equals input resolution unless the
  operation is itself a resize.

## Open decisions — gated as the plan's first task

These two cannot be answered from the code; they need live API evidence. They are
NOT deferred ambiguity: the implementation plan opens with a verification gate
that settles both against the real API before any dependent code is written, the
same pattern that caught four model defects on 2026-07-30. Answering them by
plausibility is precisely how `fal-ai/shadow-generation` — a model that does not
exist — reached production.

1. Which model replaces `fal-ai/shadow-generation`, or whether `generate_shadow`
   is withdrawn from the planner vocabulary and UI.
2. Whether `relight` accepts an upscale pass or changes model, given
   `ic-light`'s 1024 dimension cap.

The gate's output is a findings document recording, for each model: its ID and
version, whether it has a deployment, its exact input field names from the live
schema, and its output shape. Any value that cannot be verified is recorded as
UNVERIFIED rather than guessed.
