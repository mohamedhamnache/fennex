# Template Redesign: Seven Families for 2026

**Date:** 2026-08-02
**Status:** Approved
**Scope:** `apps/web` template families and set; `apps/api` background-removal supplier.
**Supersedes the family set from:** `docs/superpowers/specs/2026-07-31-image-editor-templates-design.md` (the renderer architecture in that spec stands; only the families and templates are replaced).

## Problem

The 34-template set built on the first seven families does not look good enough to
ship. Three specific causes, two of them measured rather than felt.

**The set is less varied than its count.** Fingerprinting every template's layer
list with the text blanked out gives **27 distinct arrangements across 34
templates**. Seven pairs are geometrically identical:

```
ec_split_bundle      == pr_split_launch
ec_price_clearance   == pr_price_flash
ec_bento_gift        == bl_bento_recap
so_scrim_golden_hour == pr_scrim_event
so_scrim_behind      == bl_scrim_deep_work
so_frame_intro       == bl_frame_essay
so_poster_drop       == pr_poster_webinar
```

Only 13 of 34 use a non-default composition parameter, so a single default
arrangement carries 21 templates. The picker's default "All" tab shows them
together.

**Capabilities were built and never used.** The renderer supports blend modes,
per-layer rotation, and arbitrary clipping. Across all 34 templates: zero layers
set `blend`, zero rotate, and the clip set is exactly `{shape:"circle"}` plus
three `roundedPct` values. The duotone and collage vocabulary exists and is
unused.

**Sample copy carries Fennex's own brand.** Nine of 34 templates ship strings
like `"Shop the full collection at fennex.studio"` and `"8 min read · by
Fennex"`. A customer applies one, burns it, and publishes an image directing
their audience to fennex.studio.

## What 2026 actually looks like

Researched rather than assumed. The governing finding, from Kittl: **AI can make
anything look polished, so polish no longer stands out; what wins now feels
human.** The current set is polished and safe, which is precisely the failure
mode.

Consistent across sources:

- **Type as hero** — oversized, edge-to-edge, layered, unexpected alignment,
  vertical typography (Fontfabric)
- **Overlap and collage** — photos overlapping, elements deliberately not
  aligned (ManyPixels)
- **Subject cutouts layered over geometric forms** (Digital Synopsis)
- **Neo-brutalism** — raw layouts, hard edges, intentional friction, impact over
  polish
- **Exposed grids, uneven spacing, monospace as label type**
- **Ultra-high contrast and large editorial type** for mobile scannability
  (Versa Creative)

Sources are listed at the end.

## Goals

- Seven families that each use at least one capability the current set ignores.
- 34 distinct arrangements, not 27.
- Sample copy a customer can publish unedited.

## Non-goals

- Changing the renderer. `SceneSvg`, the rasteriser, and the readability and
  contrast guarantees all stand.
- Layer-level undo. Covered by the separate cancel/swap spec.

---

## 1. The seven families

| Family | Structure | Capability it exercises |
| --- | --- | --- |
| **Type Wrap** | Oversized headline edge-to-edge; the subject cutout sits in front of it so words pass behind the subject | Cutout, display type |
| **Duotone Wash** | Full-bleed photo flooded with an accent field in `multiply` or `screen`, large type over it | Blend modes |
| **Offset Stack** | Two photo plates overlapping at slight angles, deliberately unaligned, monospace caption in the overlap | Rotation, collage |
| **Rule Grid** | Hairline rules exposing the grid; monospace label rotated vertically down one edge; photo in a tall inset column | Rotation, mono, exposed grid |
| **Hard Edge** | Zero corner rounding, thick keylines, colour block butted hard against the photo, uppercase display type, no shadows | Neo-brutalism |
| **Price Slab** | Product photo with an oversized slab numeral overlapping it, monospace microcopy | Scale contrast |
| **Negative Space** | Type breathing in a large empty field, photo reduced to a small clipped plate | Restraint |

**Distinctness is a requirement, not an aspiration.** The 34 instances must
produce 34 distinct geometric fingerprints. The check that found the seven
collisions — hash the layer list with text blanked — runs in the sweep and fails
the build set if any two templates collide.

### Supporting changes

**Monospace becomes a fourth font role.** `FONT_ROLES` gains `mono: "'JetBrains
Mono', monospace"`, loaded through the same `globals.css` Google Fonts import as
Anton and Source Sans 3 — not `next/font`, whose hashed family names break
`document.fonts.check` and canvas `ctx.font` lookups.

**Accent type is permitted on fields that pair with it.** The current rule bans
accent-coloured text outright, which is a large part of why the set reads flat.
Replace it with a pairing rule: a text run may take the accent role when its
field's role is guaranteed to contrast with accent. The 4.5:1 guarantee is
unchanged; only the permitted pairings widen.

**Sample copy is brand-neutral.** No `fennex.studio`, no "by Fennex", nothing a
customer would have to notice and delete.

---

## 2. The cutout

Type Wrap needs a background-free subject. That is a paid AI operation, so it
cannot happen silently — metering every supplier call and never hiding spend is a
standing rule for this product.

### Supplier: Replicate, not remove.bg

The editor's existing background removal calls remove.bg at $0.20 per image,
which meters to **191 AI credits**. A Pro plan's 18,000 credits buys 94
removals.

`851-labs/background-remover` on Replicate runs on cheap GPU and lands on the
`MIN_REPLICATE_CREDITS` floor of **10 credits** — 19x cheaper, roughly 1,800
removals on the same plan.

Verified live against the Replicate API on 2026-08-02, not recalled:

```
model:    851-labs/background-remover
version:  a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc
official: false          (community model -> per-GPU-second billing)
run_count: 28,906,672
inputs:   image, format, reverse, threshold, background_type
```

A cost rate must be seeded in the same change that introduces the model. An
unrated model bills nothing and silently loses the margin.

**The existing Remove BG tool should switch to the same supplier**, which is the
same saving on every call customers already make. That is a separate change and
is not in this spec's scope, but it should not be forgotten.

### Consent

Applying Type Wrap prompts before spending: the dialog names the operation and
the exact credit cost, and does not apply the template if declined. One dialog,
stating a real number.

### Quality gate before it ships

Community background removers vary on hair and fur edges, which is exactly where
this layout is unforgiving — the type passes behind the subject, so a bad matte
is visible as a halo over the words. Before Type Wrap ships, run the model
against real photographs including one with hair against a busy background and
compare against remove.bg output. If the edges are not good enough, Type Wrap
falls back to remove.bg and its dialog states 191 credits instead.

---

## 3. Verification

`apps/web` has no test framework. Verification is `npm run typecheck`, the
executed-under-Node checks the previous families use, and the dev sweep route.

Existing checks that continue to apply unchanged: no unbacked text runs, no
canvas overflow, no authoring-guard warnings, and WCAG contrast at or above
4.5:1 across authored mode and every brand kit.

New checks:

1. **Distinctness.** 34 templates must produce 34 distinct geometric
   fingerprints. Fails on any collision.
2. **Brand neutrality.** No template string may contain "fennex" in any casing.
3. **Capability coverage.** Every family must set at least one of `blend`,
   `rotation`, a non-rounded-rect clip, or a cutout source. A family that sets
   none has not earned its place.

Browser checks that remain a human pass: whether the seven families actually
look good, and whether the cutout matte is clean enough for type to pass behind
the subject.

---

## Sources

- Kittl, 10 graphic design trends 2026 — https://www.kittl.com/blogs/graphic-design-trends-2026/
- Fontfabric, Top 10 design and typography trends for 2026 — https://www.fontfabric.com/blog/10-design-trends-shaping-the-visual-typographic-landscape-in-2026/
- ManyPixels, 2026 graphic design trends — https://www.manypixels.co/blog/graphic-design/trends
- Digital Synopsis, Top 20 graphic design trends for 2026 — https://digitalsynopsis.com/design/graphic-design-trends-2026/
- Versa Creative, Top social media design trends 2026 — https://versacreative.com/blog/top-social-media-design-trends-2026/
