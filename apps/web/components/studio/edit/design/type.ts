/** Probe primitives — type set to its composition.
 *
 *  This module exists to answer one question before thirty-four templates are
 *  rebuilt: does a system with continuous type sizes, real weight contrast and
 *  type outside a box produce work worth looking at?
 *
 *  What it changes relative to `families.ts`:
 *
 *  1. SIZE IS CONTINUOUS. A run states its size as a percentage of canvas
 *     width, chosen for the composition it belongs to. There is no ladder and
 *     no mandated headline-to-support ratio, because a fixed multiple also
 *     fixes the absolute scale: with support at a readable 16px a 5:1 rule
 *     forces the headline to 80px, which is 10% of canvas width per line.
 *     Editorial work sets a headline at 4-6%. Both are reachable here, and a
 *     template that goes loud is making a decision rather than obeying one.
 *
 *  2. HIERARCHY COMES FROM CONTRAST BETWEEN ELEMENTS. Size, weight, colour,
 *     tracking, spacing and position, in whatever combination the composition
 *     needs. `weight` is 400 or 700 — those are the two the renderer paints,
 *     see the note on `RunSpec.weight`.
 *
 *  3. TYPE MAY LEAVE THE BOX, but only into a region the template OWNS: an
 *     edge it has darkened, a corner it has bled, a band it controls. Every run
 *     still names what it sits on, as a `Backdrop`, and the report below
 *     measures contrast against exactly that. The difference from `panel()` is
 *     that the darkening is part of the composition instead of a safety field
 *     behind every word.
 *
 *  What it does NOT change: contrast is still measured and still reported. It
 *  is a warning rather than a gate, so it can no longer force a box — but a run
 *  that claims an opaque field it does not have is still a defect, and
 *  `verifyFieldClaims` fails on it.
 *
 *  Positions and sizes are authored against the same ~800px reference canvas as
 *  the rest of the template system.
 */

import type { TemplateLayerDef, TemplateShapeDef, TemplateTextDef } from "../text-templates";
import type { BlendMode } from "../scene/types";
import type { ShapeId } from "../shapes";
import {
  FONT_ROLES, MIN_CONTRAST, compositeOver, contrastRatio, mixHex, worstCaseContrast,
} from "../palette";
import { REFERENCE_WIDTH, analyzeText } from "../families";

export type FontKey = keyof typeof FONT_ROLES;

/** Percentage of canvas width to reference px. `sizePct: 4.25` is a 34px
 *  headline on the 800px reference canvas — and, being a percentage, is the
 *  same fraction of the frame at every export size. */
export function refPx(pct: number): number {
  return (pct / 100) * REFERENCE_WIDTH;
}

/** Vertical advance for the next line of a run, in canvas percent.
 *  `factor` is the leading as a multiple of the type size: ~1.05 for display
 *  type set tight, ~1.4 for a standfirst set open. */
export function lead(sizePct: number, factor: number): number {
  return sizePct * factor;
}

// ── What a run sits on ────────────────────────────────────────────────────────

/**
 * The backdrop a run is authored against. Stating it is what keeps the contrast
 * report honest once type is allowed off a solid field: the geometry alone
 * cannot tell "this run is over a corner the template darkened to 85%" from
 * "this run is over whatever the customer uploaded".
 *
 *  - `field` — an opaque colour field. Contrast is exact, and the claim is
 *    verified against the layer list by `verifyFieldClaims`.
 *  - `prepared` — a region the template darkened itself, at a stated alpha.
 *    Contrast is measured against that region composited over the two worst
 *    photographs, so the number reported is a floor for the stated alpha.
 *  - `wash` — a monotone blend over the photo. `multiply` can only drive the
 *    field darker and `screen` only lighter, so contrast against the field's
 *    own colour is a floor for the correctly-paired ink; the extreme is
 *    included so a mispairing reports the truth instead of a flattering number.
 *  - `owned` — a gradient or mesh the template painted itself, so the type is
 *    over artwork rather than over a photograph and every colour it can meet is
 *    known. Contrast is the WORST of them, which is the only honest number: a
 *    run that clears the light end of a mesh and fails the dark end has failed.
 *  - `photograph` — nothing prepared at all. Unmeasurable, always a warning.
 */
export type Backdrop =
  | { kind: "field"; color: string }
  | { kind: "prepared"; color: string; alpha: number }
  | { kind: "wash"; color: string; blend: BlendMode }
  | { kind: "owned"; colors: readonly string[] }
  | { kind: "photograph" };

/** The two extremes a photograph can drive a monotone wash to. */
const BLACKEST = "#000000";
const WHITEST = "#ffffff";

// ── Deriving colours a palette does not carry ────────────────────────────────
//
// A palette is five roles, and a mesh wants four or five COLOURS that belong to
// each other. The rule that colours come from roles is about not writing hex
// literals into templates, not about never computing one: everything below is a
// function of a role, so a brand kit still moves the whole composition.

/** `hex` mixed toward white. A pastel derived from an accent, for the soft
 *  register — mint, cream and blush are all somebody's accent at 88% tint. */
export function tint(hex: string, amount: number): string {
  return mixHex(hex, "#ffffff", amount);
}

/** `hex` rotated around the colour wheel, keeping its saturation and lightness.
 *  This is what makes a two-role palette produce a three-hue mesh that still
 *  reads as one brand: the neighbours are the accent's own hue, moved. */
export function hueShift(hex: string, degrees: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => (parseInt(full.slice(i, i + 2), 16) || 0) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
  }
  hue = (((hue * 60 + degrees) % 360) + 360) % 360;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(hue / 60) % 6;
  const rgbs: [number, number, number][] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ];
  const [rr, gg, bb] = rgbs[seg];
  const to = (v: number) => Math.round(Math.min(255, Math.max(0, (v + m) * 255)))
    .toString(16).padStart(2, "0");
  return `#${to(rr)}${to(gg)}${to(bb)}`;
}

// ── Type ──────────────────────────────────────────────────────────────────────

export interface RunSpec {
  text: string;
  /** Type size as a percentage of canvas width. Continuous, per composition. */
  sizePct: number;
  font: FontKey;
  /** A palette role's value. Templates name roles; nothing here takes a hex. */
  color: string;
  xPct: number;
  yPct: number;
  /** 400 or 700. `SceneSvg` paints `fontWeight={bold ? 700 : 400}`, and that
   *  file is off-limits on this branch, so those are the two weights that
   *  actually reach the canvas — asking for 500 or 800 here would look right in
   *  this file and render as 400 on screen. */
  weight?: 400 | 700;
  uppercase?: boolean;
  /** Tracking as a percentage of canvas width; negative tightens. Display type
   *  wants negative, small uppercase labels want positive. */
  trackingPct?: number;
  opacity?: number;
  rotation?: number;
  italic?: boolean;
  /** Drop shadow. Off by default: on a prepared region it muddies the edge, and
   *  the region is what carries the legibility. */
  shadow?: boolean;
  /** Background pill colour. A pill is its own opaque field. */
  bg?: string;
  /** Decorative type — an oversized quote mark, a numeral used as texture.
   *  Reported, not measured, because a contrast number on an ornament is noise
   *  that trains a reader to ignore the warnings that matter. */
  ornament?: boolean;
  /** What this run sits on. */
  on: Backdrop;
}

function toTextDef(s: RunSpec): TemplateTextDef {
  return {
    kind: "text",
    type: "text",
    text: s.text,
    xPct: s.xPct,
    yPct: s.yPct,
    fontSize: refPx(s.sizePct),
    letterSpacing: s.trackingPct !== undefined ? refPx(s.trackingPct) : undefined,
    color: s.color,
    bgColor: s.bg,
    bold: (s.weight ?? 400) >= 700,
    italic: s.italic ?? false,
    fontFamily: FONT_ROLES[s.font],
    visible: true,
    uppercase: s.uppercase,
    opacity: s.opacity,
    rotation: s.rotation,
    shadow: s.shadow ?? false,
    fontRole: s.sizePct >= 2.5 ? "heading" : "body",
  };
}

// ── Measuring, for placement ──────────────────────────────────────────────────

/** Approximate advance width per glyph as a fraction of type size, matching the
 *  table `families.ts` uses. Generous on purpose: over-estimating costs a
 *  centred run half a percent of asymmetry, under-estimating ships a run past
 *  the edge of the frame. `mono` is exact — JetBrains Mono advances 0.6em for
 *  every glyph, so do not "correct" it upward the way the others are padded. */
const WIDTH_FACTOR: Record<FontKey, number> = {
  impact: 0.46, modern: 0.56, support: 0.52, mono: 0.6, script: 0.45,
};

export interface Measurable {
  text: string;
  sizePct: number;
  font: FontKey;
  uppercase?: boolean;
  trackingPct?: number;
}

/** Estimated width of a run as a percentage of canvas width. */
export function estWidthPct(s: Measurable): number {
  const n = (s.uppercase ? s.text.toUpperCase() : s.text).length;
  return n * s.sizePct * WIDTH_FACTOR[s.font] + Math.max(0, n - 1) * (s.trackingPct ?? 0);
}

/** The `xPct` that centres a run inside `[x0, x0 + width]`.
 *
 *  `SceneSvg` anchors text at `x` with the default `text-anchor: start`, so
 *  centring is arithmetic done here rather than a property set on the layer.
 *  Doing it at authoring time also means the centred position is visible in the
 *  emitted layer, which is what lets the sweep's distinctness fingerprint tell
 *  two centred templates apart. */
export function centerOn(x0: number, width: number, s: Measurable): number {
  return Number((x0 + (width - estWidthPct(s)) / 2).toFixed(2));
}

/**
 * A point rotated about a centre, in canvas percent.
 *
 * This exists for one specific problem: putting a label on a knocked-off-square
 * sticker. `SceneSvg` rotates a SHAPE about its own centre and a TEXT RUN about
 * its anchor — two different origins — so setting the same angle on both leaves
 * the label sliding off the badge. The fix is to place the anchor where it
 * would END UP if the badge and the label had been rotated together: rotate the
 * label's unrotated anchor about the badge's centre, then give the label the
 * same angle. It then pivots in place and the pair moves as one object.
 *
 * Exact only on a square canvas, since `xPct` is a percentage of width and
 * `yPct` of height. The whole probe is authored and measured at 1:1.
 */
export function rotateAbout(
  point: { xPct: number; yPct: number },
  centre: { xPct: number; yPct: number },
  degrees: number,
): { xPct: number; yPct: number } {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.xPct - centre.xPct;
  const dy = point.yPct - centre.yPct;
  return {
    xPct: Number((centre.xPct + dx * cos - dy * sin).toFixed(2)),
    yPct: Number((centre.yPct + dx * sin + dy * cos).toFixed(2)),
  };
}

/** The centre of a box, for `rotateAbout`. */
export function centreOf(box: { xPct: number; yPct: number; widthPct: number; heightPct: number }): {
  xPct: number; yPct: number;
} {
  return { xPct: box.xPct + box.widthPct / 2, yPct: box.yPct + box.heightPct / 2 };
}

// ── Fields, rules and prepared regions ────────────────────────────────────────

export interface FieldSpec {
  /** Defaults to `rect`. */
  shape?: ShapeId;
  color: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  opacity?: number;
  rotation?: number;
  blend?: BlendMode;
  gradient?: boolean;
  /** Second gradient stop. `transparent(role)` fades a field into the photo. */
  color2?: string;
}

/** A flat colour field. Unlike `panel()` this emits no type, which is the
 *  point: type is authored separately and names what it sits on. */
export function field(f: FieldSpec): TemplateShapeDef {
  return {
    kind: "shape",
    shape: f.shape ?? "rect",
    color: f.color,
    xPct: f.xPct,
    yPct: f.yPct,
    widthPct: f.widthPct,
    heightPct: f.heightPct,
    opacity: f.opacity,
    rotation: f.rotation,
    blend: f.blend,
    gradient: f.gradient,
    color2: f.color2,
  };
}

/** A hairline rule in a palette colour. */
export function rule(color: string, xPct: number, yPct: number, widthPct: number, weightPct = 0.3): TemplateShapeDef {
  return field({ color, xPct, yPct, widthPct, heightPct: weightPct });
}

/** The same colour at zero alpha, for the far stop of a fade.
 *
 *  The `00` is an alpha channel appended to a colour the palette chose, not a
 *  colour of its own — no template names it and no template can pass a hex to
 *  it. `shapeDataUri` writes the stop straight into `stop-color`, where an
 *  8-digit hex is CSS Color 4 and is what `parseShapeStyle` already expects
 *  when it reads a shape back (`#[0-9a-fA-F]{3,8}`). */
export function transparent(hex: string): string {
  return `${hex.slice(0, 7)}00`;
}

/**
 * A corner of the frame darkened by the template, dissolving diagonally into
 * the photograph.
 *
 * `shapeDataUri` rotates its gradient 45 degrees about the centre of the shape,
 * so on a square box the fade runs corner to corner: opaque at the top-left,
 * gone at the bottom-right. Nesting two or three squares of decreasing size
 * compounds the alpha where the type sits — 1-(1-a)(1-b) — and leaves a single
 * soft edge on the way out, which is the difference between a prepared corner
 * and a box with a gradient in it.
 *
 * `sizes` are square edge lengths in canvas percent, largest first.
 */
export function cornerScrim(color: string, sizes: number[]): TemplateShapeDef[] {
  return sizes.map((s) =>
    field({ color, xPct: 0, yPct: 0, widthPct: s, heightPct: s, gradient: true, color2: transparent(color) }),
  );
}

/**
 * An edge of the frame darkened by the template, as a stepped ramp.
 *
 * Each step is the same colour at the same low alpha, anchored to the bottom of
 * the region and shorter than the one before, so `k` steps overlap where the
 * type sits and the accumulated alpha is 1-(1-a)^k — an exponential ramp, dense
 * at the edge and gone at the top. Built from plain opaque-model rects rather
 * than a gradient stop on purpose: this one renders identically in every path
 * the scene takes, and the corner scrim above is the variant that leans on the
 * gradient. If one of the two turns out wrong in the browser the other still
 * stands.
 *
 * `alphaAt(depth)` reports what a run at a given depth is actually sitting on,
 * so the contrast report and the picture cannot disagree.
 */
export interface EdgeScrim {
  layers: TemplateShapeDef[];
  /** Accumulated alpha at `yPct`, 0 at the top of the ramp. */
  alphaAt: (yPct: number) => number;
}

export function edgeScrim(
  color: string,
  opts: { yPct: number; heightPct: number; steps?: number; stepAlpha?: number },
): EdgeScrim {
  const steps = opts.steps ?? 8;
  const a = opts.stepAlpha ?? 0.26;
  const bottom = opts.yPct + opts.heightPct;
  const layers = Array.from({ length: steps }, (_, i) => {
    const h = (opts.heightPct * (steps - i)) / steps;
    return field({ color, xPct: 0, yPct: bottom - h, widthPct: 100, heightPct: h, opacity: a });
  });
  const alphaAt = (yPct: number): number => {
    const covering = layers.filter((l) => yPct >= l.yPct - 0.001).length;
    return 1 - (1 - a) ** covering;
  };
  return { layers, alphaAt };
}

// ── Composition ───────────────────────────────────────────────────────────────

/** A composition under construction: the layer list the renderer consumes, and
 *  the run specs the report reads. Both come out of the same calls, so a
 *  template cannot describe type it does not paint. */
export interface Composition {
  readonly layers: TemplateLayerDef[];
  readonly runs: RunSpec[];
  add: (...layers: TemplateLayerDef[]) => Composition;
  type: (...specs: RunSpec[]) => Composition;
}

export function compose(): Composition {
  const layers: TemplateLayerDef[] = [];
  const runs: RunSpec[] = [];
  const self: Composition = {
    layers,
    runs,
    add(...l) {
      layers.push(...l);
      return self;
    },
    type(...specs) {
      for (const s of specs) {
        runs.push(s);
        layers.push(toTextDef(s));
      }
      return self;
    },
  };
  return self;
}

// ── Reporting ─────────────────────────────────────────────────────────────────

export interface RunReport {
  text: string;
  /** Type size as a percentage of canvas width — the number the "text is too
   *  big" complaint is actually about. 10% is what the rejected set shipped;
   *  editorial reference is 4-6%. */
  sizePct: number;
  sizePx: number;
  font: FontKey;
  weight: number;
  trackingPct: number;
  uppercase: boolean;
  ornament: boolean;
  backdrop: string;
  /** Null when nothing bounds it. */
  ratio: number | null;
  level: "ok" | "warn";
}

function backdropLabel(b: Backdrop): string {
  switch (b.kind) {
    case "field": return `opaque field ${b.color}`;
    case "prepared": return `prepared region ${b.color} at ${(b.alpha * 100).toFixed(0)}%`;
    case "wash": return `${b.blend} wash of ${b.color}`;
    case "owned": return `own gradient (${b.colors.length} stops, worst ${b.colors.join(" ")})`;
    case "photograph": return "the photograph";
  }
}

/** Worst-case contrast of a run against the backdrop it was authored on.
 *
 *  Run opacity is folded in first: a standfirst at 0.8 is not its own colour,
 *  it is that colour composited onto whatever it sits on, and reporting the
 *  undimmed ratio would overstate every quiet run in the set. */
function runRatio(s: RunSpec): number | null {
  const b = s.on;
  if (b.kind === "photograph") return null;
  if (b.kind === "owned") {
    const alpha = s.opacity ?? 1;
    return Math.min(
      ...b.colors.map((c) => contrastRatio(alpha < 1 ? compositeOver(s.color, c, alpha) : s.color, c)),
    );
  }
  const alpha = s.opacity ?? 1;
  const ink = alpha < 1 ? compositeOver(s.color, b.color, alpha) : s.color;
  if (b.kind === "field") return contrastRatio(ink, b.color);
  if (b.kind === "prepared") return worstCaseContrast(ink, b.color, b.alpha);
  const extreme = b.blend === "multiply" ? BLACKEST : b.blend === "screen" ? WHITEST : null;
  const base = contrastRatio(ink, b.color);
  return extreme === null
    ? Math.min(base, contrastRatio(ink, BLACKEST), contrastRatio(ink, WHITEST))
    : Math.min(base, contrastRatio(ink, extreme));
}

export function runReports(runs: RunSpec[]): RunReport[] {
  return runs.map((s) => {
    const ratio = s.ornament ? null : runRatio(s);
    return {
      text: s.text,
      sizePct: s.sizePct,
      sizePx: refPx(s.sizePct),
      font: s.font,
      weight: s.weight ?? 400,
      trackingPct: s.trackingPct ?? 0,
      uppercase: !!s.uppercase,
      ornament: !!s.ornament,
      backdrop: s.ornament ? "decorative" : backdropLabel(s.on),
      ratio,
      level: s.ornament ? "ok" : ratio === null || ratio < MIN_CONTRAST ? "warn" : "ok",
    };
  });
}

/**
 * Every `field` claim, checked against the geometry.
 *
 * This is the one part of the readability rule that stays hard. A run may sit
 * in a prepared region and take a contrast warning for it — that is the trade
 * this branch makes deliberately — but a run that says it is on an opaque field
 * and is not is simply wrong about itself, and everything downstream that reads
 * the report inherits the error.
 *
 * `prepared` and `wash` claims are not cross-checked here, and deliberately so:
 * `analyzeText` resolves a shape by its layer opacity, which cannot see a
 * gradient stop's alpha, so it reports a corner scrim as a solid field. A check
 * that fired on that would be noise.
 */
export function verifyFieldClaims(layers: TemplateLayerDef[], runs: RunSpec[]): string[] {
  const backings = analyzeText(layers);
  const problems: string[] = [];
  runs.forEach((s, i) => {
    const b = backings[i];
    if (!b) {
      problems.push(`"${s.text}" has no analysed backing (run/layer order drifted)`);
      return;
    }
    if (s.on.kind !== "field" && s.on.kind !== "wash") return;
    if (!b.fieldColor) {
      problems.push(`"${s.text}" claims ${backdropLabel(s.on)} but ${b.reason ?? "nothing backs it"}`);
      return;
    }
    if (b.fieldColor.toLowerCase() !== s.on.color.toLowerCase()) {
      problems.push(`"${s.text}" claims ${backdropLabel(s.on)} but sits on ${b.fieldColor}`);
    }
  });
  return problems;
}
