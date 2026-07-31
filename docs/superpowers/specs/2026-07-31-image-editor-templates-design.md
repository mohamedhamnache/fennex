# Image Editor: Template Engine and Composition Redesign

**Date:** 2026-07-31
**Status:** Approved
**Scope:** `apps/web` — the image editor's layer renderer, template model, template set, and template picker.

## Problem

The image editor's templates look basic. Two causes, and the second explains the first.

**The renderer cannot express modern layout.** Templates are limited to background
colour, shapes, and text:

```ts
export type TemplateLayerDef = TemplateTextDef | TemplateShapeDef;
```

There is no image layer, so no template can place a photo. `globalCompositeOperation`
appears nowhere, so there are no blend modes — no colour washes, no duotones, nothing
that reads as part of the photo rather than stuck on top of it. `clip()` appears
nowhere, so there is no image-in-shape and no rounded or circular crop.

**Every capability costs double.** The editor has two renderers that must agree
pixel-for-pixel:

- The **editing surface is DOM** — layers are absolutely positioned HTML elements
  styled with CSS (`EditCanvas.tsx:680`). Text outline, letter-spacing, background
  pill and shadow exist because CSS gives them away free.
- The **export is a hand-written canvas-2D reimplementation** of the same layers —
  120 lines in `app/(dashboard)/[projectId]/images/edit/[imageId]/page.tsx:351-470`,
  with its own `ctx.font`, `measureText`, `strokeText`, `fillText`, manual
  letter-spacing and manual shadow.

Adding one capability means writing it twice and keeping the two in sync by hand.
That, not a lack of design ambition, is why the 31 templates are shapes on a colour
field. Redesigning them within the current limits would only rearrange the same
primitives.

## Goals

- One renderer, not two.
- Templates that place photos, clip them to shapes, and blend layers.
- A set of compositions built from reusable layout families rather than one-offs.
- A picker that previews templates against the user's own image.

## Non-goals

- Changing how AI edit operations work. This is the layer and template system only.
- General refactoring of `EditControlsPanel.tsx` beyond the two extractions this
  work forces.
- Backend changes. Templates are frontend state; they seed layers and are not
  referenced after apply.

---

## 1. Architecture: one renderer

Layers become a declarative scene rendered to **SVG**. The same markup serves both
jobs:

- **Live editing** — inlined in the DOM, beneath a layer of transparent hit-boxes.
- **Export** — the same markup serialized and rasterized to PNG at full resolution.

Today the layer overlays in `EditCanvas.tsx:717` are *both* the visuals and the
interaction surface: one absolutely positioned element per layer carries the CSS that
paints it and the pointer handlers that move it. Splitting those is part of this
work. Visual truth moves into a single `<svg>`; the per-layer elements remain, keep
their existing pointer handlers and geometry, and become transparent hit-boxes
carrying selection chrome. Inline text editing keeps its existing `<input>` overlay.
Geometry is already expressed in canvas percentages, so the handlers themselves do
not change — only what they paint.

WYSIWYG stops being a property maintained by hand and becomes structural.

SVG supplies all three missing capabilities natively:

| Gap | Mechanism |
| --- | --- |
| Images in templates | `<image>` — a first-class node |
| Blend modes | `mix-blend-mode` |
| Clipping and masking | `<clipPath>`, `<mask>` |

It also provides text `stroke`, gradients and filters, which the canvas path
currently reimplements.

### Known risks

**SVG has no automatic text wrapping.** Multi-line headlines need explicit line
breaking. The existing canvas path already breaks lines manually, so this is a port
rather than a new problem.

**Rasterizing SVG that references remote images taints the canvas** and makes
`toDataURL` throw. Every referenced image must be inlined as a data URI before
rasterization.

This is narrower than it first appears. `shapes.ts` already emits every shape and
background as an SVG data URI consumed as an ordinary image layer — its header notes
this was done precisely to avoid CORS on the burn canvas. So shapes, backgrounds and
clip sources are already safe. Only the **subject photo and user-uploaded image
layers** need inlining.

---

## 2. Scene model

### The photo slot

Today a template can only sit *on top of* the image being edited. Every composition
is decoration layered over a photo it knows nothing about.

An image layer whose source is the edited image lets a template place that photo
*into* a designed frame — offset in a circle, bled off one edge, half-bleed beside a
colour block. This is the change that moves the set from a sticker pack to layouts.

```ts
export interface TemplateImageDef {
  kind: "image";
  source: "subject" | { url: string };   // "subject" = the image being edited
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct?: number;
  fit?: "cover" | "contain";
  clip?: ClipSpec;
  blend?: BlendMode;
  opacity?: number;
  rotation?: number;
}
```

When a template uses `source: "subject"`, the base image stops being the backdrop and
becomes a placed element. The existing `hideBaseImage` flag in the burn path already
supports this.

### Clipping

Clipping reuses the existing `ShapeId` vocabulary in `shapes.ts` rather than
inventing a parallel one, so all ~20 shapes become crop masks.

```ts
type ClipSpec =
  | { shape: ShapeId }                      // circle, blob, hexagon, ribbon…
  | { roundedPct: number }
  | { insetPct: [number, number, number, number] };
```

### Blend modes

A single optional `blend?: BlendMode` on any layer, restricted to modes that render
identically in SVG's `mix-blend-mode` and canvas's `globalCompositeOperation`:

```
multiply | screen | overlay | soft-light | darken | lighten
```

Modes where the two diverge are excluded deliberately. Shipping a mode that previews
one way and exports another would reintroduce the drift this architecture removes.

### Gradients

Gradients already exist on shapes. The model extends them to full-bleed overlay
layers, which is how a photo gets a wash dark enough to carry white text.

### Brand awareness

`fontRole`, `lockColor` and `brandTemplate` are unchanged. Image layers respect them
by not overriding brand colour on adjacent text.

---

## 3. The template set

The set is built from **seven composition families**, each instantiated per category.
A family is a layout archetype; the category supplies copy slots and palette.

| Family | Structure | Primary categories |
| --- | --- | --- |
| Scrim stack | Full-bleed photo, gradient overlay, headline stacked low | Social, blog |
| Split block | Photo half-bleed one side, solid colour field the other | Ecommerce, promo |
| Framed inset | Photo clipped to a shape, offset on a colour field | Social, promo |
| Editorial band | Full photo, solid band across the lower third | Blog, quote cards |
| Price corner | Product photo, disc or ribbon badge carrying the offer | Ecommerce |
| Poster stack | Oversized display type overlapping the photo | Promo |
| Bento | Two or three photo slots plus a text cell | Ecommerce, blog |

Seven families across four categories yields roughly 34–38 templates, comparable in
count to today's 31 but each a real layout. The existing four categories
(ecommerce, social, blog, promo) are unchanged.

### Typography

Three roles, not free-form fonts:

| Role | Face | Use |
| --- | --- | --- |
| Impact | Anton or Bebas Neue, all-caps, tight tracking | Headline only |
| Modern | Inter 800, `letterSpacing: -1.5px` at hero sizes | Default heading |
| Support | Source Sans 3 / Nunito Sans | Body, disclaimers, price detail |

One rule is enforced in the template definitions: **a 5:1 size ratio between headline
and support text**. Flat hierarchy is the most common reason a composition reads as
amateur, and it is the easiest thing to get right mechanically.

Font pairings are drawn from the `ui-ux-pro-max` typography database
(`Bold Statement`, `Gen Z Brutal`, `Bold Typography Mobile`). The skill's
`--design-system` query misrouted to mobile app UI patterns, which are not applicable
to canvas compositions and are not used here.

### Colour

Templates declare palette **roles** — surface, ink, accent, on-accent — resolved from
the project brand where one exists, with per-category defaults as fallback. No
template hardcodes a hex.

### Readability constraint

Text placed over a photo must sit on a scrim, band, or solid field. Bare text on an
arbitrary photo is unreadable on light images. This is a property of the family, not
of individual templates, so it cannot be forgotten per-template.

---

## 4. Picker and editor shell

The picker already has category filtering and live miniatures
(`EditControlsPanel.tsx:1742`, `:1776`). This sharpens it.

**Previews render through the same SVG scene renderer** at small scale. Because
families have a photo slot, each thumbnail shows the user's actual image in the
layout. This also removes the miniature as a third approximation to keep in sync.

**Browsing at ~38 templates.** Category tabs stay; a name and keyword filter is added
("sale", "quote", "bundle").

**Applying a template lands in an editable state** — already implemented.
`applyTemplate` (`EditControlsPanel.tsx:457`) selects the first foreground layer,
skipping the background, and switches to the text tool. No work needed; it is
recorded here so it is not rebuilt.

What this work does add: templates ship with placeholder copy sized to the slot, so a
composition never previews with text whose length breaks the layout once replaced.

**Panel extraction.** `EditControlsPanel.tsx` is 2,495 lines and holds the template
picker, every tool's controls, and the mask-confirm UI. Two extractions along
boundaries this work forces:

- `TemplatePicker.tsx` — the picker
- `LayersPanel.tsx` — the layers list

The rest of the file stays where it is.

---

## 5. Verification

`apps/web` has no test framework; the project verifies with `npm run typecheck` and
visual browser testing. Verification therefore concentrates on the one thing that can
break silently: **the rasterized export not matching the preview.**

Three failure modes, each quiet rather than loud:

1. **Fonts.** Rasterizing before Anton or Bebas Neue has loaded renders the export in
   a fallback face — preview correct, download wrong. The export path must
   `await document.fonts.ready` and explicitly wait on the faces the scene uses.
2. **Tainted canvas.** Every image the scene references is inlined as a data URI
   before rasterization, including the subject photo.
3. **Blend-mode divergence.** Constrained by the allowed set, and confirmed in the
   sweep.

**The sweep.** A dev-only route renders all ~38 templates against a fixed test photo
and exports each, showing preview and export side by side on one page. One scroll
reveals family drift, headline overflow, or a scrim too light to carry its text. This
substitutes for a test suite and is cheap because the renderer is declarative.

**Backwards compatibility.** Every new field (`source`, `clip`, `blend`, `fit`) is
optional, so layers already saved against existing images render unchanged. Replacing
the 31 templates does not touch saved work.

---

## 6. Order of work

1. Build the SVG scene renderer. Prove equivalence by rendering each of the current
   31 templates through both the new renderer and the existing DOM path, and
   confirming visually that they match. The current set is the fixture; it is not
   replaced until step 5.
2. Switch the export path to rasterize that scene. Delete the canvas-2D
   reimplementation at `page.tsx:351-470`. **One renderer from here on.**
3. Extend the scene model — image layers, clipping, blend modes, gradient overlays.
4. Extract `TemplatePicker.tsx` and `LayersPanel.tsx`.
5. Build the seven families and the ~34–38 templates.
6. Add the sweep route; run the visual pass.

Step 2 is load-bearing: everything after it is additive, and nothing before it
changes what users see. If work stops early, it stops somewhere coherent.

---

## Deferred

These were requested alongside this work and are deliberately out of scope, each
needing its own spec:

- Blank-canvas start (begin an edit from an empty image)
- Prompt rephrase in Mirage chat, metered against AI credits
- Image upload in Mirage chat
