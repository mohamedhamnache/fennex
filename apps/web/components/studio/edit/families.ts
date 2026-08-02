/** Composition families.
 *
 *  A family is a layout, not a design: it decides where the edited photo goes,
 *  where the colour fields go, and where the type sits inside them. One family
 *  yields many templates by varying only the palette and the copy.
 *
 *  Three rules are enforced by this module rather than by discipline:
 *
 *  1. READABILITY. Text over an arbitrary photo is unreadable on light images.
 *     Every text layer here is produced by `panel()`, and `panel()` always
 *     emits its backing field first. There is no exported way to author a bare
 *     text layer, so a family in this file structurally cannot place one.
 *     `analyzeText()` re-checks the finished layer list — including whether
 *     anything painted since has covered the run — so the guarantee survives
 *     hand-editing and re-colouring passes, and `text-templates.ts` gates the
 *     shipped set on it at module load in development.
 *
 *  2. HIERARCHY. Sizes come from `TYPE_STEPS`, derived from TYPE_SCALE, and a
 *     line names a step rather than a pixel size. The 5:1 headline-to-support
 *     ratio therefore holds across every family and cannot be flattened by an
 *     individual template.
 *
 *  3. CONTRAST. A line does not choose a colour. The field names a palette role
 *     and the type takes the role guaranteed to contrast with it — ink on
 *     surface, onAccent on accent. `resolvePalette` promises 4.5:1 for those
 *     two pairs and no others, so accent-on-surface, which passes in one
 *     category palette and fails in the next, cannot be written here at all.
 *
 *  Positions are percentages of the canvas, authored against the same ~800px
 *  reference canvas the rest of the template system assumes.
 */

import type { TemplateLayerDef, TemplateShapeDef, TemplateTextDef } from "./text-templates";
import type { Palette } from "./palette";
import { FONT_ROLES, TYPE_SCALE } from "./palette";
import type { ClipSpec } from "./scene/types";
import { shapeAspect } from "./shapes";

/** The reference canvas template geometry is authored against. */
export const REFERENCE_WIDTH = 800;

export interface FamilyCopy {
  headline: string;
  subhead?: string;
  support?: string;
}

// ── Type steps ────────────────────────────────────────────────────────────────

/** Every size a family may use, all derived from TYPE_SCALE. `display` is the
 *  poster step; nothing else may invent a size. */
export const TYPE_STEPS = {
  display: Math.round(TYPE_SCALE.headline * 1.4),
  headline: TYPE_SCALE.headline,
  subhead: TYPE_SCALE.subhead,
  support: TYPE_SCALE.support,
} as const;

export type TypeStep = keyof typeof TYPE_STEPS;
export type FontKey = keyof typeof FONT_ROLES;

/** Approximate advance width per glyph as a fraction of font size. Deliberately
 *  generous: it drives the authoring-time fit guard, where over-estimating
 *  costs a warning and under-estimating ships an overflowing headline.
 *
 *  `mono` is the exception: JetBrains Mono is monospaced, so every glyph has
 *  the same 0.6em advance width. That is not an estimate, so do not "correct"
 *  it upward the way the others are padded. */
const WIDTH_FACTOR: Record<FontKey, number> = { impact: 0.46, modern: 0.56, support: 0.52, mono: 0.6 };

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

// ── Fields ────────────────────────────────────────────────────────────────────

/** Shapes that read as a solid field behind type. Rings, frames, lines, arrows
 *  and sparkles are excluded on purpose: they are outlines, so text sitting on
 *  one is still text on a bare photo. */
export type FieldShape =
  | "rect" | "rounded" | "pill" | "circle" | "seal" | "burst"
  | "ribbon" | "tag" | "bubble" | "blob";

const FIELD_SHAPES: FieldShape[] = [
  "rect", "rounded", "pill", "circle", "seal", "burst", "ribbon", "tag", "bubble", "blob",
];

export function isFieldShape(shape: string): shape is FieldShape {
  return (FIELD_SHAPES as string[]).includes(shape);
}

/** Below this a scrim stops hiding the photo's texture and the type starts to
 *  fight it. `panel()` clamps to it, so a translucent field cannot be authored. */
export const MIN_FIELD_OPACITY = 0.72;

/** Non-rectangular fields only reliably back type near their centre, so the fit
 *  guard measures against an inscribed box rather than the bounding box. */
const INSCRIBE = 0.72;
const RECTANGULAR: FieldShape[] = ["rect", "rounded", "pill", "ribbon", "tag"];

/** Which palette role paints the field. This, not a free colour, is what a
 *  family chooses — see `panel()` for why. */
export type FieldRole = "surface" | "accent";

export interface FieldSpec {
  shape: FieldShape;
  role: FieldRole;
  xPct: number;
  yPct: number;
  widthPct: number;
  /** Omit for badges so the shape keeps its own aspect ratio. */
  heightPct?: number;
  opacity?: number;
  gradient?: boolean;
  shadow?: boolean;
}

export interface PanelLine {
  /** Optional copy. An absent or blank line is dropped, not rendered empty. */
  text?: string;
  step: TypeStep;
  font: FontKey;
  xPct: number;
  yPct: number;
  /** Centre the run on the field horizontally; xPct is then ignored. */
  center?: boolean;
  /** Set the run in the accent as a pill. A pill is its own field, so this is
   *  the one way accent colour can touch type and stay contrast-guaranteed. */
  emphasis?: boolean;
  uppercase?: boolean;
  letterSpacing?: number;
  opacity?: number;
  bold?: boolean;
  italic?: boolean;
  /** Keep the authored colour when a brand kit is applied. */
  lockColor?: boolean;
}

interface Box { x: number; y: number; w: number; h: number }

/** Geometry-only view of a field, so box maths does not need the palette. */
type FieldGeometry = Pick<FieldSpec, "shape" | "xPct" | "yPct" | "widthPct" | "heightPct" | "shadow">;

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

function warn(message: string): void {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(`[families] ${message}`);
  }
}

/**
 * A colour field plus the type that sits on it.
 *
 * This is the only text-producing function in the module. It emits the field
 * first, then any `above` layers (a photo tucked between the field and the
 * type), then one text layer per non-empty line. Because families compose only
 * `panel()` and `photo()`, a family cannot place text over a bare photograph.
 *
 * A line does not choose its colour. The field names a palette role and the
 * type takes the role that role guarantees contrast against: ink on surface,
 * onAccent on accent. Those are the only two pairs `resolvePalette` promises
 * clear 4.5:1 — accent-on-surface, which reads well in one palette and fails
 * in the next, is simply not expressible. `emphasis` sets a run as an accent
 * pill instead, which is contrast-guaranteed because the pill is its own field.
 */
export function panel(
  p: Palette,
  field: FieldSpec,
  lines: PanelLine[],
  opts?: { above?: TemplateLayerDef[] },
): TemplateLayerDef[] {
  const shape: TemplateShapeDef = {
    kind: "shape",
    shape: field.shape,
    color: p[field.role],
    xPct: field.xPct,
    yPct: field.yPct,
    widthPct: field.widthPct,
    heightPct: field.heightPct,
    opacity: Math.max(MIN_FIELD_OPACITY, field.opacity ?? 1),
    gradient: field.gradient,
    shadow: field.shadow,
  };

  const fit = inscribed(field);
  const texts: TemplateTextDef[] = [];

  for (const line of lines) {
    const text = line.text?.trim();
    if (!text) continue;

    const fontSize = TYPE_STEPS[line.step];
    const fontFamily = FONT_ROLES[line.font];
    const rendered = line.uppercase ? text.toUpperCase() : text;
    const w = estWidthPct(rendered, fontSize, WIDTH_FACTOR[line.font], line.letterSpacing ?? 0);
    const h = runHeightPct(fontSize);
    const x = line.center ? fit.x + (fit.w - w) / 2 : line.xPct;

    if (x < fit.x - 0.5 || x + w > fit.x + fit.w + 0.5 || line.yPct < fit.y - 0.5 || line.yPct + h > fit.y + fit.h + 0.5) {
      warn(`"${text}" does not fit its ${field.shape} field; shorten the copy or grow the field`);
    }

    texts.push({
      kind: "text",
      type: "text",
      text,
      xPct: Number(x.toFixed(2)),
      yPct: line.yPct,
      fontSize,
      color: line.emphasis ? p.onAccent : field.role === "accent" ? p.onAccent : p.ink,
      bgColor: line.emphasis ? p.accent : undefined,
      // Default to regular weight. Anton ships one weight and Inter is loaded
      // at 400-600, so asking for bold would synthesise a face the export
      // cannot reproduce. Weight is not how hierarchy is expressed here; the
      // type step is.
      bold: line.bold ?? false,
      italic: line.italic ?? false,
      fontFamily,
      visible: true,
      uppercase: line.uppercase,
      letterSpacing: line.letterSpacing,
      opacity: line.opacity,
      // The field already carries the contrast; a drop shadow on top of it only
      // muddies the edge.
      shadow: false,
      fontRole: line.step === "support" ? "body" : "heading",
      lockColor: line.lockColor,
    });
  }

  // `above` layers are painted over the field and under the type, so one that
  // overlaps a run replaces the field as what that run actually sits on. Catch
  // it here as well as in analyzeText, so it is a warning at authoring time
  // rather than a surprise in the sweep.
  for (const extra of opts?.above ?? []) {
    if (extra.kind !== "image" && extra.kind !== "shape") continue;
    const eb = {
      x: extra.xPct,
      y: extra.yPct,
      w: extra.widthPct,
      h: extra.heightPct ?? extra.widthPct,
    };
    for (const t of texts) {
      const tb = {
        x: t.xPct,
        y: t.yPct,
        w: estWidthPct(
          t.uppercase ? t.text.toUpperCase() : t.text,
          t.fontSize,
          factorFor(t.fontFamily),
          t.letterSpacing ?? 0,
        ),
        h: runHeightPct(t.fontSize),
      };
      if (eb.x < tb.x + tb.w && tb.x < eb.x + eb.w && eb.y < tb.y + tb.h && tb.y < eb.y + eb.h) {
        warn(`an "above" layer covers "${t.text}"; it would sit on that layer, not on the field`);
      }
    }
  }

  return [shape, ...(opts?.above ?? []), ...texts];
}

// ── Photos ────────────────────────────────────────────────────────────────────

export interface PhotoSpec {
  xPct?: number;
  yPct?: number;
  widthPct?: number;
  heightPct?: number;
  fit?: "cover" | "contain";
  clip?: ClipSpec;
  opacity?: number;
  rotation?: number;
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
  };
}

// ── The seven families ────────────────────────────────────────────────────────
//
// Each family takes exactly one optional composition parameter, defaulting to
// the arrangement the family was designed around. That single knob is the only
// structural variation a template may ask for: the whole point of a family is
// that its instances differ by palette and copy, and a second knob is how you
// get back to the unrelated one-offs this set replaced. If a variant needs more
// than one knob it is a different family, not a parameter.

/** Which half of the frame the scrim covers. */
export type ScrimAnchor = "bottom" | "top";

/** Scrim stack: full-bleed photo, a scrim across half the frame, headline
 *  stacked into it with the support line under it. The workhorse social crop. */
export function scrimStack(
  p: Palette,
  copy: FamilyCopy,
  anchor: ScrimAnchor = "bottom",
): TemplateLayerDef[] {
  // The whole block moves together: the type keeps its position inside the
  // scrim, the scrim changes which half of the photo it sits on.
  const dy = anchor === "top" ? -45 : 0;
  return [
    photo(),
    ...panel(
      p,
      // 0.88, not 0.82. A scrim exists to establish a known field over an
      // unknown photograph, so it has to be opaque enough that the worst
      // photograph still leaves the type readable. At 0.82 a mid-luminance
      // brand surface fell to 4.16:1 worst-case (sage #7a9a5a) and 4.46:1
      // (mid grey) -- both under AA, and no ink colour fixes it: near-black is
      // already the better of the two candidates there, white being 2.50:1.
      // 0.86 is the exact threshold; 0.88 leaves margin. editorialBand's band
      // is already 0.9 and clears for the same reason.
      { shape: "rect", role: "surface", xPct: 0, yPct: 45 + dy, widthPct: 100, heightPct: 55, opacity: 0.88 },
      [
        { text: copy.headline, step: "headline", font: "impact", xPct: 8, yPct: 62 + dy, uppercase: true, letterSpacing: -1 },
        { text: copy.subhead, step: "subhead", font: "modern", emphasis: true, xPct: 8, yPct: 76 + dy },
        { text: copy.support, step: "support", font: "support", xPct: 8, yPct: 88 + dy, opacity: 0.85 },
      ],
    ),
  ];
}

/** How the inset photo is cropped. Both are clips `SceneSvg` renders natively;
 *  every other `ShapeId` degrades silently to a rounded rect, so the family
 *  does not offer them. */
export type InsetCrop = "circle" | "rounded";

/** Framed inset: the photo cropped and offset high on a colour field, with the
 *  type occupying the lower third. Editorial, calm. */
export function framedInset(
  p: Palette,
  copy: FamilyCopy,
  crop: InsetCrop = "circle",
): TemplateLayerDef[] {
  const clip: ClipSpec = crop === "circle" ? { shape: "circle" } : { roundedPct: 6 };
  return panel(
    p,
    { shape: "rect", role: "surface", xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 },
    [
      { text: copy.headline, step: "headline", font: "impact", xPct: 10, yPct: 66, uppercase: true, letterSpacing: -1 },
      { text: copy.subhead, step: "subhead", font: "modern", emphasis: true, xPct: 10, yPct: 82 },
      { text: copy.support, step: "support", font: "support", xPct: 10, yPct: 90, opacity: 0.8 },
    ],
    { above: [photo({ xPct: 14, yPct: 8, widthPct: 72, heightPct: 52, clip })] },
  );
}

/** Which edge the photo is hard against. */
export type BlockSide = "left" | "right";

/** Split block: photo hard against one edge, a full-height colour block on the
 *  other carrying the whole message. The catalogue layout. */
export function splitBlock(
  p: Palette,
  copy: FamilyCopy,
  side: BlockSide = "left",
): TemplateLayerDef[] {
  const photoX = side === "left" ? 0 : 48;
  const blockX = side === "left" ? 52 : 0;
  const textX = blockX + 6;
  return [
    photo({ xPct: photoX, yPct: 0, widthPct: 52, heightPct: 100 }),
    ...panel(
      p,
      { shape: "rect", role: "surface", xPct: blockX, yPct: 0, widthPct: 48, heightPct: 100 },
      [
        { text: copy.headline, step: "headline", font: "impact", xPct: textX, yPct: 26, uppercase: true, letterSpacing: -1 },
        { text: copy.subhead, step: "subhead", font: "modern", emphasis: true, xPct: textX, yPct: 44 },
        { text: copy.support, step: "support", font: "support", xPct: textX, yPct: 56, opacity: 0.85 },
      ],
    ),
  ];
}

/** Which edge the caption band runs along. */
export type BandEdge = "foot" | "head";

/** Editorial band: full-bleed photo with an opaque caption band across one
 *  edge. The headline steps down to subhead size because the band is the
 *  emphasis, not the type. */
export function editorialBand(
  p: Palette,
  copy: FamilyCopy,
  edge: BandEdge = "foot",
): TemplateLayerDef[] {
  const bandY = edge === "foot" ? 72 : 0;
  return [
    photo(),
    ...panel(
      p,
      { shape: "rect", role: "surface", xPct: 0, yPct: bandY, widthPct: 100, heightPct: 28, opacity: 1 },
      [
        { text: copy.headline, step: "subhead", font: "modern", xPct: 8, yPct: bandY + 4 },
        { text: copy.support, step: "support", font: "support", xPct: 8, yPct: bandY + 16, opacity: 0.8 },
      ],
    ),
  ];
}

/** Which top corner the seal sits in. */
export type BadgeCorner = "right" | "left";

/** Price corner: full-bleed photo, a scalloped seal in the accent carrying the
 *  offer, and a foot band for the product line. */
export function priceCorner(
  p: Palette,
  copy: FamilyCopy,
  corner: BadgeCorner = "right",
): TemplateLayerDef[] {
  // `center: true` measures against the seal's own box, so moving the seal
  // carries its type with it.
  const sealX = corner === "right" ? 66 : 6;
  return [
    photo(),
    ...panel(
      p,
      { shape: "seal", role: "accent", xPct: sealX, yPct: 8, widthPct: 28, shadow: true },
      [{ text: copy.headline, step: "subhead", font: "impact", xPct: sealX, yPct: 19.5, center: true, uppercase: true }],
    ),
    ...panel(
      p,
      { shape: "rect", role: "surface", xPct: 0, yPct: 80, widthPct: 100, heightPct: 20, opacity: 0.9 },
      [
        { text: copy.subhead, step: "subhead", font: "modern", xPct: 8, yPct: 84 },
        { text: copy.support, step: "support", font: "support", xPct: 8, yPct: 93, opacity: 0.85 },
      ],
    ),
  ];
}

/** How the poster plate is cropped. */
export type PlateShape = "rounded" | "circle";

/** Poster stack: type first. A display headline owns the top third, the photo
 *  sits under it as a plate, support closes the page. */
export function posterStack(
  p: Palette,
  copy: FamilyCopy,
  plate: PlateShape = "rounded",
): TemplateLayerDef[] {
  const clip: ClipSpec = plate === "circle" ? { shape: "circle" } : { roundedPct: 4 };
  return panel(
    p,
    { shape: "rect", role: "surface", xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 },
    [
      { text: copy.headline, step: "display", font: "impact", xPct: 8, yPct: 14, uppercase: true, letterSpacing: -3 },
      { text: copy.subhead, step: "subhead", font: "modern", emphasis: true, xPct: 8, yPct: 92 },
      { text: copy.support, step: "support", font: "support", xPct: 62, yPct: 94, opacity: 0.8 },
    ],
    { above: [photo({ xPct: 10, yPct: 34, widthPct: 80, heightPct: 56, clip })] },
  );
}

/** Bento: a tall rounded photo cell beside two stacked cells, one accent and
 *  one surface. Reads as a modern card grid rather than a poster. */
export function bento(
  p: Palette,
  copy: FamilyCopy,
  side: BlockSide = "left",
): TemplateLayerDef[] {
  const photoX = side === "left" ? 4 : 40;
  const cellX = side === "left" ? 63 : 4;
  const textX = cellX + 3;
  return [
    photo({ xPct: photoX, yPct: 4, widthPct: 56, heightPct: 92, clip: { roundedPct: 5 } }),
    ...panel(
      p,
      { shape: "rounded", role: "accent", xPct: cellX, yPct: 4, widthPct: 33, heightPct: 44 },
      [{ text: copy.headline, step: "headline", font: "impact", xPct: textX, yPct: 16, uppercase: true, letterSpacing: -1 }],
    ),
    ...panel(
      p,
      { shape: "rounded", role: "surface", xPct: cellX, yPct: 52, widthPct: 33, heightPct: 44 },
      [
        { text: copy.subhead, step: "subhead", font: "modern", xPct: textX, yPct: 60 },
        { text: copy.support, step: "support", font: "support", xPct: textX, yPct: 74, opacity: 0.85 },
      ],
    ),
  ];
}

export const FAMILIES = {
  scrimStack,
  framedInset,
  splitBlock,
  editorialBand,
  priceCorner,
  posterStack,
  bento,
} as const;

export type FamilyId = keyof typeof FAMILIES;

// ── Readability verification ─────────────────────────────────────────────────

export interface ReadabilityIssue {
  text: string;
  reason: string;
}

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

/**
 * Resolve what every text run sits on.
 *
 * A run is backed when it has its own background pill, or when some earlier
 * field-shape layer contains its whole box AND nothing painted between that
 * field and the text covers the run. That second half matters: `panel()`'s
 * `above` layers sit between the field and the type, so a photo passed there
 * would replace the field as the run's actual backdrop while still leaving a
 * field somewhere earlier in the list. Image layers and opaque non-field
 * shapes both count as occluders, so a template cannot smuggle a photograph
 * under its own headline.
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
      const usable = isFieldShape(shape.shape) && (shape.opacity ?? 1) >= MIN_FIELD_OPACITY;
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
    const box: Box = { x: text.xPct, y: text.yPct, w, h: runHeightPct(text.fontSize) };

    // Latest field first: the last thing painted under the run wins.
    const candidates = painted.filter((p) => p.field && contains(p.box, box)).reverse();
    const backing = candidates.find(
      (c) => !painted.some((p) => p.index > c.index && overlaps(p.hitBox, box)),
    );

    if (backing?.field) {
      out.push({
        index,
        text: text.text,
        color: text.color,
        fieldColor: backing.field.color,
        fieldOpacity: backing.field.opacity ?? 1,
        reason: null,
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

/**
 * Every text layer must sit on something opaque: its own background pill, or a
 * solid field painted earlier and not covered since.
 *
 * `panel()` guarantees this at authoring time; this re-checks the finished
 * layer list, so it also catches a hand-written template and any damage a
 * later re-colouring pass does.
 */
export function findUnbackedText(
  layers: TemplateLayerDef[],
  opts?: { widthPct?: (layer: TemplateTextDef) => number },
): ReadabilityIssue[] {
  return analyzeText(layers, opts)
    .filter((b) => b.reason !== null)
    .map((b) => ({ text: b.text, reason: b.reason as string }));
}
