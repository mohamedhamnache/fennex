/** Composition families.
 *
 *  A family is a layout, not a design: it decides where the edited photo goes,
 *  where the colour fields go, and where the type sits inside them. One family
 *  yields many templates by varying only the palette and the copy.
 *
 *  Two rules are enforced by this module rather than by discipline:
 *
 *  1. READABILITY. Text over an arbitrary photo is unreadable on light images.
 *     Every text layer here is produced by `panel()`, and `panel()` always
 *     emits its backing field first. There is no exported way to author a bare
 *     text layer, so a family in this file structurally cannot place one.
 *     `findUnbackedText()` re-checks the finished layer list, so the guarantee
 *     survives later hand-editing of a template too.
 *
 *  2. HIERARCHY. Sizes come from `TYPE_STEPS`, derived from TYPE_SCALE, and a
 *     line names a step rather than a pixel size. The 5:1 headline-to-support
 *     ratio therefore holds across every family and cannot be flattened by an
 *     individual template.
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

/** FONT_ROLES holds bare family names. "Source Sans 3" is not a valid unquoted
 *  CSS identifier (the trailing "3" cannot start an ident), which makes both
 *  `ctx.font = "16px Source Sans 3"` and `document.fonts.load(...)` reject it.
 *  Quoting here keeps the roles untouched while emitting something every
 *  consumer can parse. */
function cssFamily(name: string): string {
  const quoted = /^[A-Za-z][A-Za-z-]*$/.test(name) ? name : `'${name}'`;
  return `${quoted}, sans-serif`;
}

export const FONT_STACKS: Record<FontKey, string> = {
  impact: cssFamily(FONT_ROLES.impact),
  modern: cssFamily(FONT_ROLES.modern),
  support: cssFamily(FONT_ROLES.support),
};

/** Approximate advance width per glyph as a fraction of font size. Deliberately
 *  generous: it drives the authoring-time fit guard, where over-estimating
 *  costs a warning and under-estimating ships an overflowing headline. */
const WIDTH_FACTOR: Record<FontKey, number> = { impact: 0.46, modern: 0.56, support: 0.52 };

function factorFor(fontFamily: string): number {
  for (const key of Object.keys(FONT_STACKS) as FontKey[]) {
    if (fontFamily === FONT_STACKS[key]) return WIDTH_FACTOR[key];
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

export interface FieldSpec {
  shape: FieldShape;
  color: string;
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
  color: string;
  xPct: number;
  yPct: number;
  /** Centre the run on the field horizontally; xPct is then ignored. */
  center?: boolean;
  uppercase?: boolean;
  letterSpacing?: number;
  opacity?: number;
  bold?: boolean;
  italic?: boolean;
  /** Keep the authored colour when a brand kit is applied. */
  lockColor?: boolean;
}

interface Box { x: number; y: number; w: number; h: number }

function fieldBox(f: FieldSpec): Box {
  const h = f.heightPct ?? f.widthPct / shapeAspect(f.shape, !!f.shadow);
  return { x: f.xPct, y: f.yPct, w: f.widthPct, h };
}

function inscribed(f: FieldSpec): Box {
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
 */
export function panel(
  field: FieldSpec,
  lines: PanelLine[],
  opts?: { above?: TemplateLayerDef[] },
): TemplateLayerDef[] {
  const shape: TemplateShapeDef = {
    kind: "shape",
    shape: field.shape,
    color: field.color,
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
    const fontFamily = FONT_STACKS[line.font];
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
      color: line.color,
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

/** Scrim stack: full-bleed photo, a scrim across the lower half, headline
 *  stacked low with the support line under it. The workhorse social crop. */
export function scrimStack(p: Palette, copy: FamilyCopy): TemplateLayerDef[] {
  return [
    photo(),
    ...panel(
      { shape: "rect", color: p.surface, xPct: 0, yPct: 45, widthPct: 100, heightPct: 55, opacity: 0.82 },
      [
        { text: copy.headline, step: "headline", font: "impact", color: p.ink, xPct: 8, yPct: 62, uppercase: true, letterSpacing: -1 },
        { text: copy.subhead, step: "subhead", font: "modern", color: p.accent, xPct: 8, yPct: 76 },
        { text: copy.support, step: "support", font: "support", color: p.ink, xPct: 8, yPct: 88, opacity: 0.85 },
      ],
    ),
  ];
}

/** Framed inset: the photo clipped to a circle and offset high on a colour
 *  field, with the type occupying the lower third. Editorial, calm. */
export function framedInset(p: Palette, copy: FamilyCopy): TemplateLayerDef[] {
  return panel(
    { shape: "rect", color: p.surface, xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 },
    [
      { text: copy.headline, step: "headline", font: "impact", color: p.ink, xPct: 10, yPct: 66, uppercase: true, letterSpacing: -1 },
      { text: copy.subhead, step: "subhead", font: "modern", color: p.accent, xPct: 10, yPct: 82 },
      { text: copy.support, step: "support", font: "support", color: p.ink, xPct: 10, yPct: 90, opacity: 0.8 },
    ],
    { above: [photo({ xPct: 14, yPct: 8, widthPct: 72, heightPct: 52, clip: { shape: "circle" } })] },
  );
}

/** Split block: photo hard against the left edge, a full-height colour block on
 *  the right carrying the whole message. The catalogue layout. */
export function splitBlock(p: Palette, copy: FamilyCopy): TemplateLayerDef[] {
  return [
    photo({ xPct: 0, yPct: 0, widthPct: 52, heightPct: 100 }),
    ...panel(
      { shape: "rect", color: p.surface, xPct: 52, yPct: 0, widthPct: 48, heightPct: 100 },
      [
        { text: copy.headline, step: "headline", font: "impact", color: p.ink, xPct: 58, yPct: 26, uppercase: true, letterSpacing: -1 },
        { text: copy.subhead, step: "subhead", font: "modern", color: p.accent, xPct: 58, yPct: 44 },
        { text: copy.support, step: "support", font: "support", color: p.ink, xPct: 58, yPct: 56, opacity: 0.85 },
      ],
    ),
  ];
}

/** Editorial band: full-bleed photo with an opaque caption band across the
 *  foot. The headline steps down to subhead size because the band is the
 *  emphasis, not the type. */
export function editorialBand(p: Palette, copy: FamilyCopy): TemplateLayerDef[] {
  return [
    photo(),
    ...panel(
      { shape: "rect", color: p.surface, xPct: 0, yPct: 72, widthPct: 100, heightPct: 28, opacity: 1 },
      [
        { text: copy.headline, step: "subhead", font: "modern", color: p.ink, xPct: 8, yPct: 76 },
        { text: copy.support, step: "support", font: "support", color: p.ink, xPct: 8, yPct: 88, opacity: 0.8 },
      ],
    ),
  ];
}

/** Price corner: full-bleed photo, a scalloped seal in the accent carrying the
 *  offer, and a foot band for the product line. */
export function priceCorner(p: Palette, copy: FamilyCopy): TemplateLayerDef[] {
  return [
    photo(),
    ...panel(
      { shape: "seal", color: p.accent, xPct: 66, yPct: 8, widthPct: 28, shadow: true },
      [{ text: copy.headline, step: "subhead", font: "impact", color: p.onAccent, xPct: 66, yPct: 19.5, center: true, uppercase: true }],
    ),
    ...panel(
      { shape: "rect", color: p.surface, xPct: 0, yPct: 80, widthPct: 100, heightPct: 20, opacity: 0.9 },
      [
        { text: copy.subhead, step: "subhead", font: "modern", color: p.ink, xPct: 8, yPct: 84 },
        { text: copy.support, step: "support", font: "support", color: p.ink, xPct: 8, yPct: 93, opacity: 0.85 },
      ],
    ),
  ];
}

/** Poster stack: type first. A display headline owns the top third, the photo
 *  sits under it as a rounded plate, support closes the page. */
export function posterStack(p: Palette, copy: FamilyCopy): TemplateLayerDef[] {
  return panel(
    { shape: "rect", color: p.surface, xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 },
    [
      { text: copy.headline, step: "display", font: "impact", color: p.ink, xPct: 8, yPct: 14, uppercase: true, letterSpacing: -3 },
      { text: copy.subhead, step: "subhead", font: "modern", color: p.accent, xPct: 8, yPct: 92 },
      { text: copy.support, step: "support", font: "support", color: p.ink, xPct: 62, yPct: 94, opacity: 0.8 },
    ],
    { above: [photo({ xPct: 10, yPct: 34, widthPct: 80, heightPct: 56, clip: { roundedPct: 4 } })] },
  );
}

/** Bento: a tall rounded photo cell beside two stacked cells, one accent and
 *  one surface. Reads as a modern card grid rather than a poster. */
export function bento(p: Palette, copy: FamilyCopy): TemplateLayerDef[] {
  return [
    photo({ xPct: 4, yPct: 4, widthPct: 56, heightPct: 92, clip: { roundedPct: 5 } }),
    ...panel(
      { shape: "rounded", color: p.accent, xPct: 63, yPct: 4, widthPct: 33, heightPct: 44 },
      [{ text: copy.headline, step: "headline", font: "impact", color: p.onAccent, xPct: 66, yPct: 16, uppercase: true, letterSpacing: -1 }],
    ),
    ...panel(
      { shape: "rounded", color: p.surface, xPct: 63, yPct: 52, widthPct: 33, heightPct: 44 },
      [
        { text: copy.subhead, step: "subhead", font: "modern", color: p.ink, xPct: 66, yPct: 60 },
        { text: copy.support, step: "support", font: "support", color: p.ink, xPct: 66, yPct: 74, opacity: 0.85 },
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

/**
 * Every text layer must sit on something opaque: its own background pill, or a
 * solid field shape painted earlier in the list that contains its whole run.
 *
 * `panel()` guarantees this at authoring time; this re-checks the finished
 * layer list, so it also catches a hand-written template and any damage a
 * later re-colouring pass does. `widthPct` lets a caller substitute real text
 * measurement for the estimate.
 */
export function findUnbackedText(
  layers: TemplateLayerDef[],
  opts?: { widthPct?: (layer: TemplateTextDef) => number },
): ReadabilityIssue[] {
  const issues: ReadabilityIssue[] = [];
  const fields: Box[] = [];

  for (const layer of layers) {
    if (layer.kind === "image") continue;
    if (layer.kind === "shape") {
      const shape = layer as TemplateShapeDef;
      if (!isFieldShape(shape.shape)) continue;
      if ((shape.opacity ?? 1) < MIN_FIELD_OPACITY) continue;
      fields.push(inscribed({
        shape: shape.shape,
        color: shape.color,
        xPct: shape.xPct,
        yPct: shape.yPct,
        widthPct: shape.widthPct,
        heightPct: shape.heightPct,
        shadow: shape.shadow,
      }));
      continue;
    }

    const text = layer as TemplateTextDef;
    if (text.visible === false) continue;
    if (text.bgColor) continue; // self-backed pill

    const rendered = text.uppercase ? text.text.toUpperCase() : text.text;
    const w = opts?.widthPct
      ? opts.widthPct(text)
      : estWidthPct(rendered, text.fontSize, factorFor(text.fontFamily), text.letterSpacing ?? 0);
    const h = runHeightPct(text.fontSize);
    const box: Box = { x: text.xPct, y: text.yPct, w, h };

    const covered = fields.some(
      (f) =>
        box.x >= f.x - 0.5 &&
        box.y >= f.y - 0.5 &&
        box.x + box.w <= f.x + f.w + 0.5 &&
        box.y + box.h <= f.y + f.h + 0.5,
    );
    if (!covered) {
      issues.push({
        text: text.text,
        reason: fields.length === 0 ? "no field behind it" : "runs outside every field behind it",
      });
    }
  }

  return issues;
}
