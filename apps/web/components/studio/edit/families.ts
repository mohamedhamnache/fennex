/** The edited photo as a layer, and what a text run actually sits on.
 *
 *  WHAT THIS FILE USED TO BE. Seven composition families — typeWrap,
 *  duotoneWash, offsetStack, ruleGrid, hardEdge, priceSlab, negativeSpace — and
 *  the `panel()` primitive they were all built from. `panel()` emitted a colour
 *  field and the type on it in one call, and no family could place a bare text
 *  layer because there was no exported way to author one. That was the right
 *  shape for the rule it enforced: every run on an opaque field at 4.5:1.
 *
 *  The product owner rejected the 34 templates that rule produced, twice, and
 *  the second verdict named the rule rather than the output — "there is no
 *  creativity in the design", "very old and not attractive". A contrast floor
 *  that can only be satisfied by a box behind every word does not constrain a
 *  design, it draws one. The approved system in `design/` measures contrast and
 *  reports it, and lets type sit in a region the template darkened instead.
 *
 *  So the seven families and `panel()` are gone, along with the type ladder that
 *  fixed every headline at 10% of canvas width and the field vocabulary only
 *  `panel()` used. Nothing imported them once `TEXT_TEMPLATES` was rebuilt.
 *
 *  WHAT SURVIVES IS NOT THE FAMILIES, and is worth keeping for reasons that have
 *  nothing to do with them:
 *
 *    `photo` / `cutout`   placing the edited image, whole or background-free.
 *                         Every layout in the new system still starts here.
 *
 *    `analyzeText`        what a run resolves onto once paint order is taken
 *                         into account. This is the check that makes a declared
 *                         backdrop verifiable rather than a comment: the new
 *                         system's `verifyFieldClaims` is built on it, and the
 *                         443-cell matrix found 906 false claims through it.
 *
 *    `REFERENCE_WIDTH`    the canvas geometry is authored against.
 *
 *  KNOW `analyzeText`'S LIMIT. It walks the list in paint order and resolves each
 *  run against what is already painted, so it says nothing about layers appended
 *  AFTER a run. A layout that paints over its own type is making a claim this
 *  module cannot check and owes an argument for why the type stays legible
 *  regardless of the photograph.
 *
 *  Positions are percentages of the canvas, authored against the same ~800px
 *  reference canvas the rest of the template system assumes.
 */

import type { TemplateLayerDef, TemplateShapeDef, TemplateTextDef } from "./text-templates";
import { FONT_ROLES, relativeLuminance } from "./palette";
import type { BlendMode, ClipSpec } from "./scene/types";
import { shapeAspect } from "./shapes";
import { REFERENCE_CANVAS_WIDTH } from "./scene/measure";

/** The reference canvas template geometry is authored against.
 *
 *  Aliased rather than re-declared: `templateToLayers` divides the authored px
 *  by this same number to reach the layer model's percentages, so an authoring
 *  guard measuring against a different 800 than the converter uses would pass
 *  templates that ship overflowing. */
export const REFERENCE_WIDTH = REFERENCE_CANVAS_WIDTH;

type FontKey = keyof typeof FONT_ROLES;

// ── Measuring a run ───────────────────────────────────────────────────────────

/** Approximate advance width per glyph as a fraction of font size. Deliberately
 *  generous: over-estimating costs a warning and under-estimating ships an
 *  overflowing headline.
 *
 *  `mono` is the exception: JetBrains Mono is monospaced, so every glyph has the
 *  same 0.6em advance width. That is not an estimate, so do not "correct" it
 *  upward the way the others are padded. */
const WIDTH_FACTOR: Record<FontKey, number> = {
  impact: 0.46, modern: 0.56, support: 0.52, mono: 0.6,
  // Caveat is a narrow, slanted script: its glyphs advance well under half an
  // em. Padded upward like the others, for the same reason.
  script: 0.45,
};

function factorFor(fontFamily: string): number {
  for (const key of Object.keys(FONT_ROLES) as FontKey[]) {
    if (fontFamily === FONT_ROLES[key]) return WIDTH_FACTOR[key];
  }
  return 0.6;
}

/** Estimated width of a text run, as a percentage of canvas width. */
function estWidthPct(text: string, fontSize: number, factor: number, letterSpacing = 0): number {
  const n = text.length;
  const px = n * fontSize * factor + Math.max(0, n - 1) * letterSpacing;
  return (px / REFERENCE_WIDTH) * 100;
}

/** Height of a single text run, as a percentage of canvas height. */
function runHeightPct(fontSize: number): number {
  return ((fontSize * 1.2) / REFERENCE_WIDTH) * 100;
}

// ── What counts as a field ────────────────────────────────────────────────────

/** Shapes that read as a solid field behind type. Rings, frames, lines, arrows
 *  and sparkles are excluded on purpose: they are outlines, so text sitting on
 *  one is still text on a bare photo. */
type FieldShape =
  | "rect" | "rounded" | "pill" | "circle" | "seal" | "burst"
  | "ribbon" | "tag" | "bubble" | "blob";

const FIELD_SHAPES: FieldShape[] = [
  "rect", "rounded", "pill", "circle", "seal", "burst", "ribbon", "tag", "bubble", "blob",
];

function isFieldShape(shape: string): shape is FieldShape {
  return (FIELD_SHAPES as string[]).includes(shape);
}

/** Below this a scrim stops hiding the photo's texture and the type starts to
 *  fight it, so a shape this translucent is treated as an occluder rather than
 *  as something a run can sit on. The zone scrims in `design/type.ts` are built
 *  from steps well under this figure and declare a `prepared` region for exactly
 *  that reason — they are not claiming to be fields. */
const MIN_FIELD_OPACITY = 0.72;

/** Non-rectangular fields only reliably back type near their centre, so the box
 *  maths measures against an inscribed box rather than the bounding box. */
const INSCRIBE = 0.72;
const RECTANGULAR: FieldShape[] = ["rect", "rounded", "pill", "ribbon", "tag"];

/**
 * The blend modes with a monotone luminance bound, and which way each one moves.
 * A field using anything else cannot carry type.
 *
 *   multiply(a, b) = a*b/255 is channel-wise non-increasing, so every channel of
 *     the wash is at most the field's, so L(wash) <= L(field), so a LIGHTER
 *     ink's contrast against the wash is at least its contrast against the
 *     field — for every photograph, not on average.
 *   screen(a, b) = 255 - (255-a)(255-b)/255 is the exact mirror: L(wash) >=
 *     L(field), so a DARKER ink is bounded the same way.
 *
 * So a wash carrying type inherits the field colour's own contrast as a floor.
 * The direction is not free, and the wrong pairing has no bound at all — which
 * is what `washPairing` below reports. `design/ground.ts` derives the direction
 * from the colourway's register so the mispairing is not expressible.
 */
const WASH_DIRECTION: Partial<Record<BlendMode, "lighter" | "darker">> = {
  multiply: "lighter",
  screen: "darker",
};

/** Whether `ink` is on the side of `fieldColor` that the wash's bound protects.
 *  Returns null when the field does not wash at all. */
function washPairing(field: TemplateShapeDef): ((ink: string) => boolean) | null {
  const blend = field.blend;
  if (!blend || blend === "normal") return null;
  const direction = WASH_DIRECTION[blend];
  const fieldLum = relativeLuminance(field.color);
  if (!direction) return () => false; // unbounded mode: no ink is safe on it
  return (ink) => direction === "lighter"
    ? relativeLuminance(ink) > fieldLum
    : relativeLuminance(ink) < fieldLum;
}

// ── Boxes ─────────────────────────────────────────────────────────────────────

interface Box { x: number; y: number; w: number; h: number }

/** Geometry-only view of a field, so the box maths needs no palette. */
interface FieldGeometry {
  shape: FieldShape;
  xPct: number;
  yPct: number;
  widthPct: number;
  /** Omit for badges, so the shape keeps its own aspect ratio. */
  heightPct?: number;
  shadow?: boolean;
}

function fieldBox(f: FieldGeometry): Box {
  const h = f.heightPct ?? f.widthPct / shapeAspect(f.shape, !!f.shadow);
  return { x: f.xPct, y: f.yPct, w: f.widthPct, h };
}

function inscribed(f: FieldGeometry): Box {
  const b = fieldBox(f);
  if (RECTANGULAR.includes(f.shape)) return b;
  return {
    x: b.x + (b.w * (1 - INSCRIBE)) / 2,
    y: b.y + (b.h * (1 - INSCRIBE)) / 2,
    w: b.w * INSCRIBE,
    h: b.h * INSCRIBE,
  };
}

/** Axis-aligned box a run occupies once rotated about its anchor.
 *
 *  `SceneSvg` rotates a text group with `rotate(deg, x, y)`, where x/y is the
 *  run's own anchor — not its centre — so the same origin is used here. The
 *  percentages are mixed across axes by the rotation, which is only exact on a
 *  square canvas; `runHeightPct` already makes that assumption (it divides a
 *  pixel height by the reference *width*), so the approximation is the module's
 *  existing one rather than a new one. */
function rotatedBox(b: Box, deg?: number): Box {
  if (!deg) return b;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners: [number, number][] = [[0, 0], [b.w, 0], [b.w, b.h], [0, b.h]];
  const xs = corners.map(([dx, dy]) => b.x + dx * cos - dy * sin);
  const ys = corners.map(([dx, dy]) => b.y + dx * sin + dy * cos);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.w <= outer.x + outer.w + 0.5 &&
    inner.y + inner.h <= outer.y + outer.h + 0.5
  );
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function shapeFieldBox(shape: TemplateShapeDef): Box {
  return inscribed({
    shape: shape.shape as FieldShape,
    xPct: shape.xPct,
    yPct: shape.yPct,
    widthPct: shape.widthPct,
    heightPct: shape.heightPct,
    shadow: shape.shadow,
  });
}

function imageBox(def: { xPct: number; yPct: number; widthPct: number; heightPct?: number }): Box {
  return { x: def.xPct, y: def.yPct, w: def.widthPct, h: def.heightPct ?? def.widthPct };
}

// ── Photos ────────────────────────────────────────────────────────────────────

export interface PhotoSpec {
  xPct?: number;
  yPct?: number;
  widthPct?: number;
  heightPct?: number;
  fit?: "cover" | "contain";
  /** Only `circle`, `roundedPct` and `insetPct` are rendered as authored.
   *  `SceneSvg` degrades every other `ShapeId` to a rounded rect, so a layout
   *  asking for one would look right in this file and wrong on screen. */
  clip?: ClipSpec;
  opacity?: number;
  rotation?: number;
  blend?: BlendMode;
}

/** The edited photo, placed. Defaults to full bleed. */
export function photo(spec: PhotoSpec = {}): TemplateLayerDef {
  return {
    kind: "image",
    source: "subject",
    xPct: spec.xPct ?? 0,
    yPct: spec.yPct ?? 0,
    widthPct: spec.widthPct ?? 100,
    heightPct: spec.heightPct ?? 100,
    fit: spec.fit ?? "cover",
    clip: spec.clip,
    opacity: spec.opacity,
    rotation: spec.rotation,
    blend: spec.blend,
  };
}

/** The edited photo with its background removed. Costs credits to produce, so
 *  a template using this triggers a consent dialog before it applies. */
export function cutout(spec: PhotoSpec = {}): TemplateLayerDef {
  return { ...photo(spec), source: "subject-cutout" } as TemplateLayerDef;
}

// ── What a run sits on ────────────────────────────────────────────────────────

/** What a text run actually sits on, once paint order is taken into account. */
export interface TextBacking {
  /** Index of the text layer within the layer list it was analysed from. */
  index: number;
  text: string;
  /** The text layer's own colour, for a contrast check by the caller. */
  color: string;
  /** Colour of the field the run resolves onto, or null when nothing backs it. */
  fieldColor: string | null;
  /** Effective opacity of that field. Below 1 the photo shows through it. */
  fieldOpacity: number;
  /** Null when the run is properly backed. */
  reason: string | null;
}

/**
 * Resolve what every text run sits on.
 *
 * A run is backed when it has its own background pill, or when some earlier
 * field-shape layer contains its whole box AND nothing painted between that
 * field and the text covers the run. That second half matters: a photo or a
 * piece of artwork painted between a field and the type replaces the field as
 * the run's actual backdrop while still leaving a field somewhere earlier in the
 * list. Image layers and opaque non-field shapes both count as occluders, so a
 * template cannot smuggle a photograph under its own headline.
 *
 * A field that blends is not a field: its composited colour depends on the
 * photograph beneath it, so a run over one is measured against the field's own
 * colour only where the wash's monotone bound protects that run's ink, and
 * reported as unbacked where it does not.
 *
 * `widthPct` lets a caller substitute real text measurement for the authoring
 * estimate.
 */
export function analyzeText(
  layers: TemplateLayerDef[],
  opts?: { widthPct?: (layer: TemplateTextDef) => number },
): TextBacking[] {
  /** `box` is the area the layer can back type over (inscribed for a field);
   *  `hitBox` is its full extent, which is what occludes something below it. */
  interface Painted { box: Box; hitBox: Box; index: number; field: TemplateShapeDef | null }
  const painted: Painted[] = [];
  const out: TextBacking[] = [];

  layers.forEach((layer, index) => {
    if (layer.kind === "image") {
      const b = imageBox(layer);
      painted.push({ box: b, hitBox: b, index, field: null });
      return;
    }
    if (layer.kind === "shape") {
      const shape = layer as TemplateShapeDef;
      const blend = shape.blend;
      // A wash backs type only in the two modes with a monotone luminance
      // bound; whether this run's ink is on the protected side of it is
      // checked below, once the run that lands on it is known.
      const washable = !blend || blend === "normal" || !!WASH_DIRECTION[blend];
      const usable = isFieldShape(shape.shape) && (shape.opacity ?? 1) >= MIN_FIELD_OPACITY && washable;
      const hitBox = imageBox(shape);
      painted.push({
        box: usable ? shapeFieldBox(shape) : hitBox,
        hitBox,
        index,
        field: usable ? shape : null,
      });
      return;
    }

    const text = layer as TemplateTextDef;
    if (text.visible === false) return;

    if (text.bgColor) {
      out.push({ index, text: text.text, color: text.color, fieldColor: text.bgColor, fieldOpacity: 1, reason: null });
      return;
    }

    const rendered = text.uppercase ? text.text.toUpperCase() : text.text;
    const w = opts?.widthPct
      ? opts.widthPct(text)
      : estWidthPct(rendered, text.fontSize, factorFor(text.fontFamily), text.letterSpacing ?? 0);
    const box = rotatedBox(
      { x: text.xPct, y: text.yPct, w, h: runHeightPct(text.fontSize) },
      text.rotation,
    );

    // Latest field first: the last thing painted under the run wins.
    const candidates = painted.filter((p) => p.field && contains(p.box, box)).reverse();
    const backing = candidates.find(
      (c) => !painted.some((p) => p.index > c.index && overlaps(p.hitBox, box)),
    );

    if (backing?.field) {
      // On a wash, the reported field colour is the field's own rather than what
      // the wash composites to — which is the point: monotonicity makes it the
      // FLOOR, so a contrast measured against it holds for every photograph.
      // That only works if the ink is on the side the bound protects, so a run
      // that is not gets reported unbacked rather than measured against a number
      // that does not apply to it.
      const accepts = washPairing(backing.field);
      const mispaired = accepts !== null && !accepts(text.color);
      out.push({
        index,
        text: text.text,
        color: text.color,
        fieldColor: backing.field.color,
        fieldOpacity: backing.field.opacity ?? 1,
        reason: mispaired
          ? `its ${backing.field.blend} wash runs the wrong way for this ink, so nothing bounds the contrast`
          : null,
      });
    } else {
      out.push({
        index,
        text: text.text,
        color: text.color,
        fieldColor: null,
        fieldOpacity: 1,
        reason: candidates.length > 0
          ? "a layer painted after its field covers the run"
          : painted.some((p) => p.field)
            ? "runs outside every field behind it"
            : "no field behind it",
      });
    }
  });

  return out;
}
