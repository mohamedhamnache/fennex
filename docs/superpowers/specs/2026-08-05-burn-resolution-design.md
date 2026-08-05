# Burn at a Chosen Resolution

**Date:** 2026-08-05
**Status:** Approved in principle, queued behind the template probe
**Scope:** `apps/web` — the flatten path.

## Problem

Applying a template and flattening it produces an image at **the source
photograph's dimensions**, and nothing else. `handleBurnLayers` reads
`baseImg.naturalWidth / naturalHeight` and rasterises the scene at exactly that
size.

So a template applied to a 1024x1024 generation yields a 1024x1024 finished
asset. For a marketing image that is small, and there is no way to ask for more.

The existing export dialog offers 2048 / 1080 / 720, but that path resizes an
**already-flattened raster** server-side. Asking it for 2048 from a 1024 burn
upscales pixels; it does not recover detail.

## Why this is now cheap

Until recently the composition was not resolution-independent: font sizes were
baked in display pixels, so rendering the same layers at a different size
produced a different picture. That was one of two Criticals fixed before merge.

Type metrics are now percentages of canvas width resolved at paint time, and
`rasterizeScene({ width, height, ... })` already accepts any size. The scene will
render correctly at 2048 or 4096 today — nothing is asking it to.

## What changes

The flatten action gains a resolution choice:

- **Match source** — today's behaviour, the default.
- **2x source** — the common case, one click.
- **Platform presets** — 1080x1080, 1080x1920, 1200x628.
- **Custom** — a width, height derived from the composition's aspect.

`handleBurnLayers` passes the chosen size to `rasterizeScene` instead of the
measured natural size. That is the whole mechanism; everything downstream already
handles an arbitrary size, because the upload path records the dimensions of the
bytes it stores.

## What this does and does not improve — state it in the UI

**Genuinely sharper at any size:** type, shapes, gradients, rules, pills and
badges. These are vector and re-render at the target resolution.

**Not improved:** the photograph. A 1024px source rendered into a 2048px scene is
upscaled. The composition around it gets sharper; the photo does not.

This matters most for the template families that are mostly type and colour —
a poster or a price slab gains a great deal. A full-bleed photograph gains
almost nothing, and a user who expects otherwise will think the feature is
broken. The control must say so plainly rather than implying a 4K result from a
small source.

## Constraints

- Aspect ratio follows the composition, not the source. Layer geometry is in
  canvas percentages, so a template renders correctly into any frame; the
  photograph inside it is fitted by its existing `fit` mode.
- Memory: a 4096x4096 RGBA canvas is ~67MB before PNG encoding. Cap the custom
  input and fail with a clear message rather than a tab crash.
- Cost: none. Rasterising is local; no supplier call is involved.

## Verification

- `npm run typecheck`, zero errors.
- Burn the same template at match-source and at 2x, and confirm the type is
  sharper at 2x while the layout is identical — the resolution-independence the
  Critical 2 fix established.
- Confirm the stored dimensions match the requested size, since the upload path
  measures the bytes.
- The non-1:1 sweep case must still pass. It exists because two Criticals shipped
  through a sweep that only ever rendered 1:1.

## Sequencing

**Queued behind the six-template probe.** Both touch `apps/web`, and a parallel
writer on this repo already caused one silent revert: an `apps/api` commit swept
seven `apps/web` files in a stale state and undid two Critical fixes. Files being
disjoint was not enough, because the git index is shared. One writer at a time.
