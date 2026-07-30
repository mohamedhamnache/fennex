# Mirage auto-masking — design

Date: 2026-07-30
Status: approved; amended 2026-07-30 after the Task 0 verification gate

## Amendment log

Task 0 (the verification gate) settled both open assumptions against Replicate's
live API and surfaced two facts the original design did not account for. See
`docs/superpowers/plans/2026-07-30-mirage-auto-masking-task0-findings.md`.

1. **Polarity confirmed, not inverted.** `FLUX_FILL_WHITE_IS_FILL = True`. The
   schema states "Black areas will be preserved while white areas will be
   inpainted", corroborated by the model's own default example and the repo's
   existing convention. The polarity table below stands unchanged.
2. **Segmenter pinned.** `tmappdev/lang-segment-anything`, version
   `891411c38a6ed2d44c004b7b9e44217df7a5b07848f29ddefd2e28bc7cbf93bc`, input
   fields `image` and `text_prompt`. No hot deployment, so `version=` is
   required. Its output does NOT need inverting.
3. **NEW — the segmenter's mask is not binary.** Multiple matched instances come
   back as distinct grey levels (observed `0`/`211`/`255` for two cars). flux-fill
   reads grey as partial alpha, so a `211` region returns a half-blended ghost.
   The prompted tier must binarise (`>0 -> 255`).
4. **NEW — the segmenter has no no-match signal.** Prompting `"elephant"` on an
   elephant-free image returned `succeeded` with a clean, confident mask over a
   car, at an identical 12.61% area to the real car mask. There is no confidence
   field on the input schema, and a mask-area sanity guard would NOT catch this
   because the bogus mask is a plausible size. This drove the confirmation
   decision below.

## Problem

Mirage is meant to satisfy intent, not expose operations: one request may fan out
into several internal tool calls, and the user should never be asked to choose an
internal step. The orchestration for that already exists —
`parse_ai_command_steps` turns one natural-language request into an ordered plan,
and `ai_command.py` chains the steps so each runs on the previous step's output.

What does not exist is segmentation. Five operations require a mask
(`replace_background`, `remove_object`, `insert_object`, `generative_fill`,
`smart_erase`), and the only source of one is the user hand-painting it on a
canvas. So the spec's headline example — "replace the background with green
marble, preserve the product" — dead-ends at
`apps/api/app/api/v1/routers/editing.py`:

```
return EditOut(ok=False, error="Please paint the area on the image first, then apply.")
```

The planner is also steered away from these operations on purpose
(`ai_command_service.py`): *"Prefer operations that do NOT require a mask. Only
include a mask operation if the user clearly refers to a painted selection."*

`remove_background` exists but calls Remove.bg and returns a cutout image, not a
mask usable by flux-fill. The missing piece is mask derivation, not orchestration.

## Scope

Auto-masking covers both request shapes:

- **Product vs background** — "replace the background", "put it on marble".
- **Arbitrary object by description** — "remove the person on the left".

Applied at both entry points:

- The conversational AI-command path (`ai_command.py`), where Mirage interprets
  free text.
- The manual Edit panel (`editing.py`), where the user picks a tool from a list.
  Painting still wins when the user has painted; auto-masking fills in only when
  they have not.

## Architecture

One new module, `apps/api/app/services/mask_service.py`, with a single entry
point both routers call when a mask-requiring operation arrives without a painted
mask:

```
resolve_mask(image_url, operation, target, org_id, db) -> MaskResolution
```

It returns either a `mask_url`, or an ambiguous result carrying a question for
the user. Two tiers:

- **Product tier** (no `target`) — reuse the Remove.bg cutout. Its alpha channel
  already is a foreground segmentation; threshold it to a binary L-mode mask. No
  new model, no new dependency.
- **Prompted tier** (`target` given) — a text-prompted segmenter on Replicate.

Tier selection is purely on `target` presence — no keyword sniffing of the
target text. That keeps the rule trivially predictable, but it means the planner
must **omit** `target` when the region is the operation's default (the background
for `replace_background`, the main subject for `remove_object` / `smart_erase`).
A planner that emits `target: "the background"` would route to the paid
segmenter for a case the free product tier already handles. The planner
instructions state this explicitly, and a test asserts the omission for the
common phrasings.

Rejected alternatives:

- *Explicit `segment` step in the LLM chain.* Matches the spec's mental model most
  literally and makes the chain inspectable, but only helps the conversational
  path — the manual panel has no planner, so it would need the service layer
  anyway. Would also require the chain loop to carry a mask channel alongside the
  image URL, since a segment step yields a mask, not an image.
- *Auto-derive inside each `editing_service` function.* Least call-site churn, but
  buries a network call and credit spend inside functions that read as thin
  wrappers, and the ambiguity gate cannot surface a question from that depth.

### Mask polarity

The convention in this codebase is **white = the region to be replaced**,
confirmed from `_pillow_content_fill` in `editing_service.py`:

```python
inv_mask = ImageOps.invert(mask.convert("L"))  # white = keep, black = fill
```

Pre-inversion, white is the fill area. Per-operation:

| Operation | White region (no target) |
|---|---|
| `replace_background` | background — `invert(alpha)` |
| `remove_object`, `smart_erase` | foreground subject — `alpha` |
| `insert_object`, `generative_fill` | undefined — the ambiguous case |

The ambiguity gate falls out of this table rather than being bolted on: "put a
bottle in the frame" has no derivable region. Background and subject-removal
cases never ask.

### Refactor

`remove_background` currently gets the Remove.bg cutout and immediately uploads
it, discarding the alpha. Extract `_removebg_cutout(image_url) -> PILImage` so
`remove_background` and `mask_service` share it, rather than re-downloading the
uploaded result to recover the alpha.

## Planner changes

Remove the "prefer operations that do NOT require a mask" instruction and the
`(user must paint mask on canvas first)` header from `_OPERATIONS_REFERENCE`.
Mask operations gain an optional `target` — the planner's job becomes naming what
to act on in plain language, never producing a mask:

```
- replace_background: prompt(str), target(str, optional — OMIT for the background)
- remove_object:      target(str, optional — OMIT for the main subject)
- smart_erase:        target(str, optional — OMIT for the main subject)
- insert_object:      prompt(str), target(str, REQUIRED — where to insert)
- generative_fill:    prompt(str), target(str, REQUIRED — region to fill)
```

Segmentation stays invisible to the planner. `target` is for naming a *specific*
object only — omitting it selects the operation's default region via the free
product tier, so the instructions emphasise omission over restating the default.

## Prompted-tier confirmation (amendment 4)

Because the segmenter cannot signal a no-match, the **prompted tier does not
apply its mask directly**. It returns the derived mask for the user to confirm,
and the edit runs only on re-submission with that mask.

**The product tier is unaffected and stays fully autonomous.** It has no target
to miss — Remove.bg separates subject from background, so "replace the
background" never asks. Confirmation guards the case that is actually risky
rather than adding friction to the common one, which keeps the Mirage spec's
"never ask, just execute" promise everywhere it can be kept.

Re-submission reuses the existing painted-mask path: the client sends the
confirmed mask back and it is treated exactly as if the user had painted it.
That needs one new input, a `mask_url` param alongside today's `mask_base64`.

**Security requirement on that input:** an arbitrary client-supplied URL must not
be fetched. A submitted `mask_url` is accepted only when it is a `data:` URL or
matches this deployment's own storage prefix (`app.core.storage._public_url`)
under the `masks/` key prefix. Anything else is rejected. Without this the
parameter is a request-forgery vector.

## Resolution flow

Identical in both routers:

1. Painted mask supplied (`mask_base64`, or a validated `mask_url` from a
   confirmation round-trip) → use it. Auto-masking never overrides a deliberate
   selection.
2. No painted mask → `resolve_mask(...)`.
3. Product tier resolves → apply directly.
4. Prompted tier resolves → return the mask for confirmation, do not apply.
5. Ambiguous → return the question instead of guessing.

In a chained request the mask resolves per-step against the evolving image, so
step N masks against step N−1's output. This falls out of the existing loop and
is what makes "replace the background, then upscale" work.

## Disambiguation contract

v1 does **not** build a candidate-object picker. That would require the segmenter
to return multiple named regions, a capability not yet confirmed; building an API
around an unverified capability is the failure mode this spec is trying to avoid.

Ambiguous resolutions return a plain actionable question: *"Tell me which part to
change — for example 'the background' or 'the bottle'."*

Each router keeps its existing error convention rather than growing a new one:

- `editing.py` returns `EditOut(ok=False, error=...)`, replacing the
  "paint the area first" dead-end.
- `ai_command.py` raises 422 with a structured detail, which already reaches the
  frontend as `ApiError.detail` through existing handling in `apps/web/lib/api.ts`.
  No new frontend plumbing.

## Metering

`remove_background` is unmetered today: the Replicate path records usage via
`record_replicate` inside `_replicate_run`, the Remove.bg path records nothing.
Tolerable while it is a deliberate button press; not tolerable once auto-masking
calls it on every background edit. Both suppliers get metered — the Remove.bg
call in the product tier, and the segmenter prediction in the prompted tier
(already covered by `_replicate_run`).

Cost shape: a background replace goes from one billable supplier call to two
(mask + fill). Inherent to auto-masking, but it belongs in COGS visibly rather
than being discovered later.

## Testing

No test file covers `ai_command.py`'s dispatch or the mask path today, which is
why a swapped-argument bug in `_DISPATCH` survived (three operations passed the
mask into the `prompt` slot and the prompt text into `mask_url`; fixed separately,
covered by `tests/test_ai_command_dispatch.py`).

New coverage:

- Alpha → binary mask conversion, against a synthetic RGBA image with known
  opaque and transparent regions.
- The polarity table — one test per operation asserting which region comes back
  white. Highest-value test in the set: inverted polarity is silent and ruins
  every edit.
- Tier selection: `target` absent → product tier, `target` present → prompted tier.
- Planner omits `target` for default-region phrasings ("replace the background",
  "remove the object"), so the common case never reaches the paid segmenter.
- Ambiguity gate: `insert_object` / `generative_fill` with no target returns the
  question and makes no supplier call.
- Both routers: painted mask wins when present, auto-resolution fires only when
  absent.

The suite has 10 pre-existing failures unrelated to this work
(`test_strands_runtime.py`, `test_edit_model.py`), confirmed present on an
unmodified checkout. They stay untouched and must not mask new regressions.

## Assumptions to verify first

Both land before any dependent code, because either one being wrong invalidates
work built on top of it:

1. **Pin a text-prompted segmenter on Replicate** — model and version hash
   verified against the live API, with an active deployment. Not chosen from
   memory.
2. **Confirm flux-fill's white = inpaint polarity** against a real prediction.
   The table above is inferred from in-repo code, not from the model's schema.
   Getting it backwards inverts every edit.

## Out of scope for v1

- Mask caching. Each masked edit costs one Remove.bg call. Revisit if edit volume
  grows.
- Candidate-object picker.
- The manual paint tool itself, which is unchanged — it just stops being mandatory.

Frontend mask visualisation was originally listed here. Amendment 4 moves it
**into** scope: confirming a prompted-tier mask requires showing it, so the
client must render the returned mask over the source image with approve and
cancel affordances. This is the single largest cost of the confirmation
decision and it is accepted deliberately, in exchange for never silently
applying a confidently-wrong segmentation.
