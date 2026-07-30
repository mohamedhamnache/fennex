# Task 0 findings — image operation model audit

Date: 2026-07-30
Method: every value below came from a live Replicate API response fetched during
this task. Nothing is recalled or inferred. Values that could not be confirmed
would be marked UNVERIFIED; none were.

## Probe caveat

The Replicate rate limiter fires BEFORE the model lookup, so a 429 on the
hot-endpoint probe says nothing about whether a model exists. Every probe below
was retried with backoff until it returned a non-429. Interpretation:

- **404** on `POST /v1/models/{owner}/{name}/predictions` = no active deployment,
  `version=` is required.
- **422** = the deployment exists; the empty input was merely invalid.

## Roster

| Model | Deployment | Version pinned | Used by |
|---|---|---|---|
| `black-forest-labs/flux-fill-pro` | yes (422) | no | replace_background, insert_object, generative_fill |
| `allenhooo/lama` | no (404) | `cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72` | remove_object, smart_erase |
| `nightmareai/real-esrgan` | yes (422) | no | upscale |
| `sczhou/codeformer` | no (404) | `cc4956dd26fa5a7185d5660cc9100fab1b8070a1d1654a8bb5eb6d443b020bb2` | restore_face |
| `zsxkib/ic-light` | no (404) | `d41bcb10d8c159868f4cfbd7c6a2ca01484f7d39e4613419d5952c61562f1ba7` | relight |
| `bria/product-shadow` | yes (422) | `ffed8143e81736c5fb32ed63ba7362935d8228687fa3b5173eab2fbf86f54ee6` | generate_shadow (NEW) |
| `fal-ai/shadow-generation` | **does not exist** (metadata 404) | n/a | generate_shadow (REMOVED) |

Note that deployment status does not follow from owner type: `nightmareai` and
`allenhooo` are both community owners, and only one of them has a deployment.

## Decision A — generate_shadow: REPLACE with `bria/product-shadow`

`fal-ai/shadow-generation` does not exist; its metadata endpoint 404s, so there
was no version to pin and the operation could never have succeeded.

Replacement: **`bria/product-shadow`** — "Add consistent, customizable shadows to
product cutouts", which is exactly this operation's job. 4,118 runs (low, but the
model is recent and purpose-built; the alternatives returned by search were
general image editors, not shadow tools).

Live schema:

```
required: ["image"]
  image              string   (the product image)
  shadow_type        enum     ["regular", "float"]     default "regular"
  shadow_offset_x    integer  default 0
  shadow_offset_y    integer  default 15
  shadow_intensity   integer  default 60   (0-100)
  shadow_blur        integer  default None
  shadow_color       string   default "#000000"
  shadow_width       integer  default None
  shadow_height      integer  default 70
  background_color   string   default "#FFFFFF"
  preserve_alpha     boolean  default True
  force_rmbg         boolean  default False
  content_moderation boolean  default False
output: a single URI string
```

**Every field the old code sent was wrong**, independently of the model not
existing:

| Old code sent | Reality |
|---|---|
| `foreground_image` | the field is `image` |
| `shadow_type: "natural_shadow"` | enum is `regular` or `float` only |
| `shadow_direction: "<direction>"` | no such field; direction is expressed as `shadow_offset_x` / `shadow_offset_y` |

So the operation needed a rewrite, not just a model swap. Direction maps onto the
offset pair, keeping the model's own defaults for magnitude.

Version is pinned even though a deployment exists. This model is commercial and
recent, the field mapping depends on its exact schema, and a silent model update
that renamed a field would break the operation quietly. `version=` works whether
or not a deployment exists, so pinning costs nothing.

## Decision B — relight: set_dimensions plus an upscale fallback

`zsxkib/ic-light`'s `width` and `height` are ENUMS:

```
[256, 320, 384, 448, 512, 576, 640, 704, 768, 832, 896, 960, 1024]
```

A value outside the list is silently ignored and the model falls back to its
512x640 default — which is why a large photo came back small.

Strategy: clamp each side down to the largest allowed value not exceeding the
source, and send those explicitly. Because the enum caps at **1024**, parity is
unreachable for any larger input, so `finalize` is called with
`ResolutionPolicy.UPSCALE` whenever the clamp could not match the source, and
`PRESERVE` when it could.

Replacing the model was considered and rejected: no alternative in the search
results was a purpose-built relighting model, and an upscale pass on a capped
model is a smaller, more honest compromise than swapping in a general image
editor whose behaviour for this task is unverified.

This decision was implemented as part of Task 3 rather than Task 5, since the
enum had already been verified against the live schema.

## Confidence

The schema facts (field names, enums, output shapes, deployment status) are
directly observed and high confidence. The judgement calls are Decision A's
choice of `bria/product-shadow` over withdrawal, and Decision B's preference for
an upscale pass over a model swap. Both are reversible.

`bria/product-shadow` has no cost_rates row yet. It will bill at the generic
`replicate/second` fallback of 1400 micro-$/sec until one is seeded, which is
correct only if it runs on A100 80GB — unverified. This belongs in the deferred
full repricing pass, together with the dead `fal-ai/shadow-generation` rate row
that still exists for a model that does not.
