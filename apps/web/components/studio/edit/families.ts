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
 *     `analyzeText()` re-checks the finished layer list — including anything
 *     painted between a run's field and the run itself — so the guarantee
 *     survives hand-editing and re-colouring passes, and `text-templates.ts`
 *     gates the shipped set on it at module load in development.
 *
 *     Know its limit. `analyzeText` walks the list in paint order and resolves
 *     each run against what is already painted, so it says nothing about layers
 *     appended AFTER a run. A family that paints over its own type — only
 *     `typeWrap` does, with its cutout — is making a claim the module cannot
 *     check, and owes an argument for why the type stays legible regardless of
 *     the photograph. `typeWrap`'s is written out at that family.
 *
 *  2. HIERARCHY. Sizes come from `TYPE_STEPS`, derived from TYPE_SCALE, and a
 *     line names a step rather than a pixel size. The 7:1 display-to-support
 *     ratio therefore holds across every family and cannot be flattened by an
 *     individual template.
 *
 *  3. CONTRAST. A line does not choose a colour. The field names a palette role
 *     and the type takes a role guaranteed to contrast with it. `resolvePalette`
 *     promises 4.5:1 for exactly three pairs — ink on surface, onAccent on
 *     accent, and accentInk on surface — so a line picks between `ink` and
 *     `accentInk` on a surface field and has no choice at all on an accent one.
 *     Raw `accent` on `surface` is the pairing that measured 3.80:1 in the
 *     default ecommerce palette; `accentInk` is the same hue moved in lightness
 *     until it clears, and is the only way coloured type is expressible here.
 *
 *  These seven families are built to use the renderer, not just to be safe with
 *  it. The set they replaced set zero blends, zero rotations and clipped with
 *  one circle and three rounded rects across 34 templates; every family below
 *  earns its place with at least one of a blend mode, a non-zero rotation, a
 *  non-rounded-rect clip, or a background-free subject cutout.
 *
 *  Positions are percentages of the canvas, authored against the same ~800px
 *  reference canvas the rest of the template system assumes.
 */

import type { TemplateLayerDef, TemplateShapeDef, TemplateTextDef } from "./text-templates";
import type { Palette } from "./palette";
import { FONT_ROLES, TYPE_SCALE, relativeLuminance } from "./palette";
import type { BlendMode, ClipSpec } from "./scene/types";
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
 *  fight it. `panel()` clamps to it, so a translucent field cannot be authored.
 *
 *  No family below authors a translucent field at all. A scrim is a way of
 *  half-committing to a colour, and half-committing is what made the previous
 *  set read as safe; these fields are opaque and their edges are hard. */
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
  /** Composite this field against what is already painted.
   *
   *  A blended field is a wash over a photograph, so its final colour depends
   *  on a photograph the template has never seen. That does NOT make it
   *  unusable for type, because two of the modes are monotone:
   *
   *    multiply(a, b) = a*b/255 is channel-wise non-increasing, so every
   *      channel of the wash is at most the accent's, so L(wash) <= L(accent),
   *      so a LIGHTER ink's contrast against the wash is at least its contrast
   *      against the accent — for every photograph, not on average.
   *    screen(a, b) = 255 - (255-a)(255-b)/255 is the mirror: L(wash) >=
   *      L(accent), so a DARKER ink is bounded the same way.
   *
   *  So a wash carrying type inherits the palette's own onAccent/accent
   *  guarantee as a floor. The direction is not free: multiply demands the
   *  lighter ink and screen the darker one, and the wrong pairing has no bound
   *  at all. `panel()` warns on it and `analyzeText()` reports it as unbacked,
   *  so it cannot ship. Every other mode is unbounded in both directions and
   *  may only be used on a field with no lines. */
  blend?: BlendMode;
}

/** The blend modes with a monotone luminance bound, and which way each one
 *  moves. A field using anything else cannot carry type. */
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
   *  one of the two ways accent colour can touch type and stay guaranteed. */
  emphasis?: boolean;
  /** Set the run in `accentInk` — the accent's hue, shifted in lightness until
   *  it clears 4.5:1 on `surface`. Only meaningful on a surface field; on an
   *  accent field the run stays `onAccent`, because accentInk is derived
   *  against surface and carries no promise against accent. */
  accent?: boolean;
  uppercase?: boolean;
  letterSpacing?: number;
  opacity?: number;
  bold?: boolean;
  italic?: boolean;
  /** Degrees clockwise about the run's own anchor point, matching SceneSvg's
   *  `rotate(deg, x, y)` on the text group. The fit guard and `analyzeText`
   *  both measure the rotated footprint, so a vertical label still has to sit
   *  inside its field. */
  rotation?: number;
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
 * `panel()`, `photo()` and `cutout()`, a family cannot place text over a bare
 * photograph.
 *
 * Called with no lines it is just a field — which is how a family emits a
 * decorative slab, a hairline rule or a blended wash without a second
 * shape-producing entry point existing.
 *
 * A line does not choose its colour. The field names a palette role and the
 * type takes a role that role guarantees contrast against: on an accent field,
 * `onAccent`; on a surface field, `ink`, or `accentInk` when the line asks for
 * `accent`. Those three pairs are what `resolvePalette` promises at 4.5:1 —
 * raw accent on surface, which reads well in one palette and fails in the next,
 * is still not expressible. `emphasis` sets a run as an accent pill, which is
 * guaranteed because the pill is its own field.
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
    blend: field.blend,
  };

  const fit = inscribed(field);
  const texts: TemplateTextDef[] = [];
  const washAccepts = washPairing(shape);

  for (const line of lines) {
    const text = line.text?.trim();
    if (!text) continue;

    const color = line.emphasis
      ? p.onAccent
      : field.role === "accent"
        ? p.onAccent
        : line.accent
          ? p.accentInk
          : p.ink;

    // A pill carries its own opaque background inside the text group, which the
    // field's blend never touches; anything else on a wash has to sit on the
    // side of it the wash's monotone bound protects.
    if (washAccepts && !line.emphasis && !washAccepts(color)) {
      warn(`"${text}" is ${color} on a ${field.blend} wash of ${shape.color}; that wash runs the wrong way for this ink and has no contrast floor`);
    }

    const fontSize = TYPE_STEPS[line.step];
    const fontFamily = FONT_ROLES[line.font];
    const rendered = line.uppercase ? text.toUpperCase() : text;
    const w = estWidthPct(rendered, fontSize, WIDTH_FACTOR[line.font], line.letterSpacing ?? 0);
    const h = runHeightPct(fontSize);
    const x = line.center ? fit.x + (fit.w - w) / 2 : line.xPct;
    const box = rotatedBox({ x, y: line.yPct, w, h }, line.rotation);

    if (box.x < fit.x - 0.5 || box.x + box.w > fit.x + fit.w + 0.5 || box.y < fit.y - 0.5 || box.y + box.h > fit.y + fit.h + 0.5) {
      warn(`"${text}" does not fit its ${field.shape} field; shorten the copy or grow the field`);
    }

    texts.push({
      kind: "text",
      type: "text",
      text,
      xPct: Number(x.toFixed(2)),
      yPct: line.yPct,
      fontSize,
      color,
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
      rotation: line.rotation,
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
      const tb = rotatedBox({
        x: t.xPct,
        y: t.yPct,
        w: estWidthPct(
          t.uppercase ? t.text.toUpperCase() : t.text,
          t.fontSize,
          factorFor(t.fontFamily),
          t.letterSpacing ?? 0,
        ),
        h: runHeightPct(t.fontSize),
      }, t.rotation);
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
  /** Only `circle`, `roundedPct` and `insetPct` are rendered as authored.
   *  `SceneSvg` degrades every other `ShapeId` to a rounded rect, so a family
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

// ── The seven families ────────────────────────────────────────────────────────
//
// Each family takes exactly one optional composition parameter, defaulting to
// the arrangement the family was designed around. That single knob is the only
// structural variation a template may ask for: the whole point of a family is
// that its instances differ by palette and copy, and a second knob is how you
// get back to the unrelated one-offs this set replaced. If a variant needs more
// than one knob it is a different family, not a parameter.
//
// Each family's doc comment states the character budget its copy is authored
// to, measured at the tighter of its two variants. `panel()` warns in
// development when a run overruns its field, so the budgets are checkable
// rather than folklore.

/** Which side of the frame the type block occupies; the subject stands on the
 *  other. */
export type TypeWrapSide = "left" | "right";

/** Type Wrap: the headline is the artwork. A display run crosses the whole
 *  frame on a flat colour field, and the subject — cut out of its background —
 *  is painted last, so the words pass behind it.
 *
 *  The cutout is deliberately NOT passed to `panel()`'s `above`: `above` paints
 *  under the type, which would put the words in front of the subject and leave
 *  them sitting on a photograph. Painted last, the type keeps its guaranteed
 *  field and the subject occludes it, which is the whole effect.
 *
 *  That last layer is outside every check in this module — `analyzeText` only
 *  resolves a run against what is painted BEFORE it — so the legibility
 *  argument is geometric and belongs here.
 *
 *  `SceneSvg` sets `dominantBaseline="text-before-edge"`, so a run's anchor is
 *  the top of its em box and one em is `fontSize / REFERENCE_WIDTH` of the
 *  frame: 14 points of it at the display step. Measured against Anton, capitals
 *  start 0.27em below the anchor and the baseline sits 1.03em below it, so the
 *  headline's caps span `yPct + 3.78` to `yPct + 14.42` and are 10.64 points
 *  tall. The cutout box begins at yPct 20 and can, with a tall subject and
 *  `contain`, fill everything below that.
 *
 *    yPct 14 -> caps 17.78..28.42, only 2.22 points (20.9%) permanently clear
 *    yPct  8 -> caps 11.78..22.42, 8.22 points (77.3%) permanently clear
 *
 *  So the subject reaches at most the bottom quarter of the letterforms, which
 *  is the overlap the family wants, and three quarters of the headline is
 *  legible whatever the user uploads. The subhead and support lines are ranged
 *  into the half of the frame the cutout box does not occupy and are clear of
 *  it horizontally at their full budgets, so the headline is the only run the
 *  subject can touch at all.
 *
 *  Budgets: headline 16, subhead 18, support 38. */
export function typeWrap(
  p: Palette,
  copy: FamilyCopy,
  side: TypeWrapSide = "left",
): TemplateLayerDef[] {
  const textX = side === "left" ? 4 : 54;
  const subjectX = side === "left" ? 50 : 0;
  return [
    ...panel(
      p,
      { shape: "rect", role: "surface", xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 },
      [
        // yPct 8, not 14, and the difference is the whole guarantee. See the
        // cap-height arithmetic in this family's doc comment: at 14 the
        // subject could cover four fifths of the headline, at 8 it can reach
        // at most the bottom quarter of it.
        { text: copy.headline, step: "display", font: "impact", xPct: 4, yPct: 8, uppercase: true, letterSpacing: -4 },
        { text: copy.subhead, step: "subhead", font: "mono", xPct: textX, yPct: 60, uppercase: true, accent: true },
        { text: copy.support, step: "support", font: "mono", xPct: textX, yPct: 90 },
      ],
    ),
    // `contain`, not `cover`: a cutout has no background to crop into, and
    // slicing one cuts the subject's head off.
    cutout({ xPct: subjectX, yPct: 20, widthPct: 50, heightPct: 80, fit: "contain" }),
  ];
}

/** How the type is set into the wash. `centre` stacks it on the middle of the
 *  frame; `stagger` steps it diagonally from top-left to bottom-right. */
export type WashLayout = "centre" | "stagger";

/** The wash direction the palette can carry.
 *
 *  Not a parameter. `multiply` is channel-wise non-increasing, so the wash is
 *  never lighter than the accent and only the LIGHTER of the two ink candidates
 *  keeps a contrast floor; `screen` is the mirror and demands the darker one.
 *  `onAccent` is already whichever of those two the palette resolved, so the
 *  palette has effectively chosen the direction, and letting a template
 *  override it would only let it choose the unbounded pairing. */
function washFor(p: Palette): BlendMode {
  return relativeLuminance(p.onAccent) > relativeLuminance(p.accent) ? "multiply" : "screen";
}

/** Duotone Wash: one photograph, flooded edge to edge with the accent through a
 *  blend mode, with the type set straight into the wash. No block, no band, no
 *  panel — the colour cast is the whole composition.
 *
 *  Type on a wash is safe here because the mode is monotone, not because the
 *  photograph is expected to cooperate: `multiply` can only drive the accent
 *  darker and `screen` can only drive it lighter, so with the ink on the right
 *  side of it, contrast against the wash is at least contrast against the raw
 *  accent — which is the `onAccent`/`accent` pair `resolvePalette` already
 *  guarantees at 4.5:1. `washFor` picks the direction the palette can carry,
 *  `panel()` warns on the wrong pairing and `analyzeText` reports it unbacked,
 *  so the unbounded combination cannot ship.
 *
 *  Budgets: headline 14, subhead 37, support 63. */
export function duotoneWash(
  p: Palette,
  copy: FamilyCopy,
  layout: WashLayout = "centre",
): TemplateLayerDef[] {
  const centre = layout === "centre";
  return [
    photo(),
    ...panel(
      p,
      { shape: "rect", role: "accent", xPct: 0, yPct: 0, widthPct: 100, heightPct: 100, blend: washFor(p) },
      centre
        ? [
          { text: copy.subhead, step: "subhead", font: "mono", xPct: 0, yPct: 32, center: true, uppercase: true },
          { text: copy.headline, step: "display", font: "impact", xPct: 0, yPct: 40, center: true, uppercase: true, letterSpacing: -4 },
          { text: copy.support, step: "support", font: "mono", xPct: 0, yPct: 60, center: true },
        ]
        : [
          { text: copy.subhead, step: "subhead", font: "mono", xPct: 6, yPct: 10, uppercase: true },
          { text: copy.headline, step: "display", font: "impact", xPct: 12, yPct: 34, uppercase: true, letterSpacing: -4 },
          { text: copy.support, step: "support", font: "mono", xPct: 24, yPct: 82 },
        ],
    ),
  ];
}

/** How far the two plates are pulled apart. */
export type StackSpread = "tight" | "wide";

/** Offset Stack: two photo plates dropped at opposing angles so they overlap
 *  and deliberately fail to align, with a mono caption slab landing across the
 *  overlap. Collage, not grid.
 *
 *  Budgets: headline 21, subhead 15, support 33. */
export function offsetStack(
  p: Palette,
  copy: FamilyCopy,
  spread: StackSpread = "tight",
): TemplateLayerDef[] {
  const wide = spread === "wide";
  const plateW = wide ? 54 : 56;
  const plateH = wide ? 40 : 44;
  const capX = wide ? 40 : 34;
  const capY = wide ? 44 : 47;
  return [
    ...panel(
      p,
      { shape: "rect", role: "surface", xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 },
      [{ text: copy.headline, step: "headline", font: "impact", xPct: 5, yPct: 3, uppercase: true, letterSpacing: -2 }],
    ),
    photo({ xPct: wide ? 2 : 6, yPct: 20, widthPct: plateW, heightPct: plateH, rotation: -3 }),
    photo({ xPct: wide ? 44 : 38, yPct: wide ? 52 : 46, widthPct: plateW, heightPct: plateH, rotation: 2 }),
    ...panel(
      p,
      { shape: "rect", role: "surface", xPct: capX, yPct: capY, widthPct: 44, heightPct: 12 },
      [
        { text: copy.subhead, step: "subhead", font: "mono", xPct: capX + 2, yPct: capY + 1.5, uppercase: true, accent: true },
        { text: copy.support, step: "support", font: "mono", xPct: capX + 2, yPct: capY + 7.5 },
      ],
    ),
  ];
}

/** Which side the photo column stands on; the vertical label runs down the
 *  opposite edge. */
export type GridSide = "left" | "right";

/** Rule Grid: the layout grid left visible. Accent hairlines mark the
 *  divisions, the photo is cut into a tall column with a hard rectangular
 *  inset, and a monospace label runs vertically down the outer edge.
 *
 *  The rules and the column go through `panel()`'s `above`, so both the fit
 *  guard and `analyzeText` see them: a rule that crossed a run would be caught
 *  as an occluder rather than discovered on screen.
 *
 *  Budgets: headline 21, subhead 39, support 40 (the vertical label). */
export function ruleGrid(
  p: Palette,
  copy: FamilyCopy,
  side: GridSide = "left",
): TemplateLayerDef[] {
  const columnX = side === "left" ? 6 : 50;
  const dividerX = side === "left" ? 52 : 48;
  const railX = side === "left" ? 95.5 : 2.5;
  return panel(
    p,
    { shape: "rect", role: "surface", xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 },
    [
      { text: copy.headline, step: "headline", font: "impact", xPct: 6, yPct: 4, uppercase: true, letterSpacing: -2 },
      { text: copy.subhead, step: "subhead", font: "modern", xPct: 6, yPct: 23 },
      { text: copy.support, step: "support", font: "mono", xPct: railX, yPct: 88, rotation: -90, uppercase: true, accent: true },
    ],
    {
      above: [
        ...panel(p, { shape: "rect", role: "accent", xPct: 6, yPct: 20, widthPct: 88, heightPct: 0.4 }, []),
        ...panel(p, { shape: "rect", role: "accent", xPct: 6, yPct: 90, widthPct: 88, heightPct: 0.4 }, []),
        ...panel(p, { shape: "rect", role: "accent", xPct: dividerX, yPct: 30, widthPct: 0.4, heightPct: 56 }, []),
        photo({ xPct: columnX, yPct: 30, widthPct: 44, heightPct: 56, clip: { insetPct: [3, 0, 3, 0] } }),
      ],
    },
  );
}

/** Which half of the frame the photograph occupies. */
export type EdgeAnchor = "top" | "bottom";

/** Hard Edge: neo-brutalist. Rectangles only, no rounding, no gradient, no
 *  shadow, no translucency. The photograph is trimmed with a rectangular inset
 *  clip and a thick accent keyline is butted straight into the cut, so the two
 *  meet without a seam and without a transition.
 *
 *  Budgets: headline 15, subhead 36, support 76. */
export function hardEdge(
  p: Palette,
  copy: FamilyCopy,
  anchor: EdgeAnchor = "top",
): TemplateLayerDef[] {
  const top = anchor === "top";
  const photoY = top ? 0 : 42;
  const keylineY = top ? 53 : 42;
  const blockY = top ? 58 : 0;
  // The keyline overlaps the trimmed edge by a hair rather than meeting it
  // exactly: butted at the same coordinate, rounding in the rasteriser can
  // leave a one-pixel seam of the photo showing through.
  const inset: ClipSpec = { insetPct: top ? [0, 0, 7, 0] : [7, 0, 0, 0] };
  return [
    photo({ xPct: 0, yPct: photoY, widthPct: 100, heightPct: 58, clip: inset }),
    ...panel(p, { shape: "rect", role: "accent", xPct: 0, yPct: keylineY, widthPct: 100, heightPct: 5 }, []),
    ...panel(
      p,
      { shape: "rect", role: "surface", xPct: 0, yPct: blockY, widthPct: 100, heightPct: 42 },
      [
        { text: copy.headline, step: "display", font: "impact", xPct: 4, yPct: blockY + 4, uppercase: true, letterSpacing: -4 },
        { text: copy.subhead, step: "subhead", font: "mono", xPct: 4, yPct: blockY + 24, uppercase: true, accent: true },
        { text: copy.support, step: "support", font: "mono", xPct: 4, yPct: blockY + 34 },
      ],
    ),
  ];
}

/** Where the numeral slab lands across the plate. */
export type SlabPlace = "corner" | "centre";

/** Price Slab: extreme scale contrast. The product sits on a circular plate,
 *  and a display-step numeral on a hard accent slab cuts across it, with the
 *  product line and monospace microcopy in a band below.
 *
 *  The numeral is `copy.subhead` — the price is the loudest thing in the
 *  composition, and `copy.headline` is the product line that names it.
 *
 *  Budgets: headline 21, subhead 7 (the numeral), support 79. */
export function priceSlab(
  p: Palette,
  copy: FamilyCopy,
  place: SlabPlace = "corner",
): TemplateLayerDef[] {
  const slabX = place === "corner" ? 6 : 27;
  return [
    ...panel(p, { shape: "rect", role: "surface", xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }, []),
    photo({ xPct: 14, yPct: 4, widthPct: 72, heightPct: 62, clip: { shape: "circle" } }),
    ...panel(
      p,
      { shape: "rect", role: "accent", xPct: slabX, yPct: 50, widthPct: 46, heightPct: 22 },
      [{ text: copy.subhead, step: "display", font: "impact", xPct: slabX, yPct: 52, center: true, letterSpacing: -2 }],
    ),
    ...panel(
      p,
      { shape: "rect", role: "surface", xPct: 0, yPct: 76, widthPct: 100, heightPct: 24 },
      [
        { text: copy.headline, step: "headline", font: "impact", xPct: 5, yPct: 78, uppercase: true, letterSpacing: -2 },
        { text: copy.support, step: "support", font: "mono", xPct: 5, yPct: 92 },
      ],
    ),
  ];
}

/** Which end of the field the type occupies. */
export type SpaceAnchor = "high" | "low";

/** Negative Space: restraint. Type takes about a quarter of a large flat field
 *  and the photograph is demoted to a small plate, tilted two degrees off
 *  square so the emptiness reads as deliberate rather than unfinished.
 *
 *  Budgets: headline 21, subhead 36, support 77. */
export function negativeSpace(
  p: Palette,
  copy: FamilyCopy,
  anchor: SpaceAnchor = "high",
): TemplateLayerDef[] {
  const high = anchor === "high";
  const typeY = high ? 10 : 62;
  const plateY = high ? 52 : 8;
  return panel(
    p,
    { shape: "rect", role: "surface", xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 },
    [
      { text: copy.headline, step: "headline", font: "impact", xPct: 8, yPct: typeY, uppercase: true, letterSpacing: -2 },
      { text: copy.subhead, step: "subhead", font: "mono", xPct: 8, yPct: typeY + 16, uppercase: true, accent: true },
      { text: copy.support, step: "support", font: "mono", xPct: 8, yPct: typeY + 24 },
    ],
    {
      above: [
        photo({ xPct: 56, yPct: plateY, widthPct: 38, heightPct: 34, clip: { roundedPct: 2 }, rotation: -2 }),
      ],
    },
  );
}

export const FAMILIES = {
  typeWrap,
  duotoneWash,
  offsetStack,
  ruleGrid,
  hardEdge,
  priceSlab,
  negativeSpace,
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
 * A field that blends is not a field: its composited colour depends on the
 * photograph beneath it, so a run over one is treated as unbacked rather than
 * measured against a colour it will not have.
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
      // On a wash, the reported field colour is the accent rather than what the
      // wash composites to — which is the point: monotonicity makes the accent
      // the FLOOR, so a contrast measured against it holds for every
      // photograph. That only works if the ink is on the side the bound
      // protects, so a run that is not gets reported unbacked rather than
      // measured against a number that does not apply to it.
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
