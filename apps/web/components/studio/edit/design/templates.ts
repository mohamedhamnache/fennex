/** Six layouts, on three orthogonal axes.
 *
 *  A layout owns no colours, no treatment and no words. It asks for roles and is
 *  handed a `Colourway`; it asks for a ground and is handed a `GroundKind`; it
 *  asks for copy and is handed a `LayoutCopy`. Six layouts times twelve
 *  colourways times six grounds is a library rather than six pictures, and the
 *  samey-ness that survived 34 hand-built templates has nowhere left to come
 *  from.
 *
 *  The six, with the pairing each was approved as:
 *
 *    layout      ground        colourway     headline
 *    Sound Pro   flat          Sorbet        6.5%
 *    Counter     blocked       Peach to sky  6.0%
 *    Culvert     photographic  Slate         7.0%
 *    Bass Line   gradient      Blurple      11.0%
 *    Half Price  duotone       Sunset       12.0%
 *    Late Set    textured      Ember        10.5%
 *
 *  WHAT CHANGED WHEN THESE STOPPED BEING A PROBE. Each of the six was welded to
 *  one ground and one set of words, because six templates are six pictures and a
 *  picture can be written out longhand. Thirty-four cannot: the previous set was
 *  34 hand-built one-offs and still looked related, so the axes have to be real
 *  or the same thing happens again with better artwork. Three things had to
 *  generalise, and each was a constraint rather than a rename.
 *
 *  1. GROUND. `ground()` returns the backdrop that type on it should declare, so
 *     swapping the treatment mostly follows — except that `blocked` has a SECOND
 *     backdrop below its boundary. A layout with a CTA at 60% was correct on a
 *     flat ground and silently wrong on a blocked one, because it declared the
 *     upper colour. Every layout now resolves each run through `backdropAt`,
 *     which picks the lower backdrop below `BLOCK_SPLIT_PCT` and is the identity
 *     on every other ground.
 *
 *  2. COPY. Pill and chip widths were hand-set to the words that shipped inside
 *     them. With copy as an argument they are measured from the run instead, so
 *     a longer label widens its chip rather than overflowing it, and a row of
 *     chips is flowed across the frame from its own measured widths.
 *
 *  3. WHAT A RUN SITS ON. A run over a glass chip or a ghost pill is over
 *     translucent artwork, so it still meets the ground's colour but no longer
 *     sits on the ground's field. The probe hard-coded the resulting claim to the
 *     one colourway it shipped in; `overArtwork()` derives it, which keeps the
 *     measured ratio identical and the geometry honest on all six grounds.
 *
 *  THE FIVE POINTS govern every one of them, and each layout's comment says how
 *  it satisfies each. Depth, luminosity, soft geometry, density, dimensional
 *  hero. Two are worth restating because they are the ones that get under-served:
 *  luminosity does NOT require a gradient — a flat ground with a lit subject on
 *  it is luminous, which is what Sound Pro is for — and empty space has to read
 *  as breathing room AROUND rich elements rather than as a lack of ideas, which
 *  is what got the first pair of quiet templates called basic and then old.
 *
 *  What was cut, and why: Small Batch and the first Culvert were editorial-Swiss
 *  — a visible grid, hairline rules, a folio in the margin, small type in a lot
 *  of white. That was the sophisticated look a decade ago and now reads as a
 *  corporate annual report. Restraint without richness is not elegance.
 *
 *  Rules that still hold, because they are correctness rather than taste:
 *  colours come from a colourway and never from a literal; no string names a
 *  product of ours; every layout places the edited photo; and across the six,
 *  blend, rotation, a non-rounded-rect clip and a cutout are all exercised.
 */

import type { TemplateLayerDef } from "../text-templates";
import { REFERENCE_WIDTH, cutout, photo } from "../families";
import { type Colourway, colourway, colourwaysFor, type ColourRegister } from "./colourways";
import { type GroundKind, type Zone, BLOCK_SPLIT_PCT, ground, groundsFor } from "./ground";
import {
  type Backdrop, type Measurable, type RunSpec,
  centerOn, centreOf, compose, estWidthPct, overArtwork, rotateAbout,
} from "./type";
import {
  type IconName, cross, dotCluster, flare, ghostPill, glassPill, glow, grain, halftone,
  icon, scallopedSeal, solidPill, starburst, tornEdge,
} from "./vector";

// ── Copy ──────────────────────────────────────────────────────────────────────

/** One chip: a fact about the subject, with a glyph. */
export interface ChipCopy {
  icon: IconName;
  label: string;
}

/**
 * The words a layout needs, in the vocabulary all six share.
 *
 * Every field is required even though no layout uses all of them. That is
 * deliberate: an optional field is a field a copy table can forget, and the
 * failure mode is a call to action that renders as the string "undefined" and
 * looks, in a thumbnail, like a design choice. `LayoutNeed` states how many of
 * the list-valued fields each layout consumes and `buildTemplate` refuses to
 * build with fewer.
 */
export interface LayoutCopy {
  /** A small uppercase label. Section, category, occasion. */
  kicker: string;
  /** The handwritten line above a cap-line. Used by the three loud layouts. */
  script: string;
  /** One to three headline lines. The LAST is set at 700 and the rest at 400,
   *  which is the weight break that replaced a size ladder. */
  head: string[];
  /** Standfirst or supporting lines, one per rendered line. */
  body: string[];
  chips: ChipCopy[];
  /** Primary call to action. */
  cta: string;
  /** Secondary call to action, in a ghost pill beside the primary. */
  cta2: string;
  /** The sticker. Two or three words at most — it is set inside a seal. */
  badge: string;
  /** The line on the torn paper, or along the bottom bar: date, place, time. */
  footer: string;
}

// ── Measuring copy into artwork ──────────────────────────────────────────────
//
// The probe hand-set every pill width to the words inside it. That is correct
// for six fixed compositions and wrong for thirty-four built from a copy table:
// the first label a percent longer than the one it replaced runs out of its
// chip. Widths are therefore measured from the run, with the same estimator the
// centring already uses, so artwork follows its copy rather than the other way
// round.

const CHIP_RUN = { sizePct: 1.15, font: "mono" as const, uppercase: true, trackingPct: 0.12 };
/** Icon inset plus the gap to the label — where a chip's text starts. */
const CHIP_GUTTER = 6.4;
/** Trailing space inside a chip, so the label does not touch the pill's curve. */
const CHIP_TAIL = 3.2;

function chipWidth(label: string): number {
  return Number((CHIP_GUTTER + estWidthPct({ ...CHIP_RUN, text: label }) + CHIP_TAIL).toFixed(2));
}

/** Width of a call-to-action pill around its run. The floor keeps a two-word
 *  CTA from reading as a badge; the padding is what makes it a button. */
function ctaWidth(run: Measurable, minPct = 18): number {
  return Number(Math.max(minPct, estWidthPct(run) + 9).toFixed(2));
}

/** Flow a row of chips across `[x0, x0 + span]`, each at its measured width.
 *
 *  The gap is whatever is left over, floored at a value that still reads as a
 *  gap: copy long enough to exhaust the row is a copy-table defect, and the
 *  authoring check reports it as an overflow rather than this function quietly
 *  overlapping two chips to hide it. */
function flowRow(labels: string[], x0: number, span: number): { xPct: number; widthPct: number }[] {
  const widths = labels.map(chipWidth);
  const used = widths.reduce((a, b) => a + b, 0);
  const gaps = Math.max(1, labels.length - 1);
  const gap = Math.max(1.5, (span - used) / gaps);
  let x = x0;
  return widths.map((w) => {
    const out = { xPct: Number(x.toFixed(2)), widthPct: w };
    x += w + gap;
    return out;
  });
}

// ── What a template is ───────────────────────────────────────────────────────

export interface BuiltTemplate {
  id: string;
  name: string;
  /** What it is for. The six span a deliberate range of jobs. */
  subject: "product" | "editorial" | "event" | "quote" | "sale" | "portrait";
  /** How loud it is meant to be. */
  intent: "quiet" | "mid" | "loud";
  /** How the colour is applied. Independent of the colourway. */
  ground: GroundKind;
  /** One line describing the ground, from the ground builder itself. */
  groundNote: string;
  colourway: Colourway;
  /** The run that answers "how big is the headline". Must match a run's text. */
  headline: string;
  /** The arrangement, in one line. */
  note: string;
  layers: TemplateLayerDef[];
  runs: RunSpec[];
}

/** How much copy a layout consumes. Checked rather than trusted. */
export interface LayoutNeed {
  head: number;
  body: number;
  chips: number;
}

export interface BuildSpec {
  cw: Colourway;
  ground: GroundKind;
  copy: LayoutCopy;
  /** Grain and torn-edge seed. Explicit, so a template's geometry fingerprint
   *  does not move between reloads. */
  seed?: number;
}

/** A layout: everything about a template except its colours, its treatment and
 *  its words. */
export interface Layout {
  id: string;
  name: string;
  /** Grounds this layout is composed for. Not every layout takes every
   *  treatment — see the note on `LAYOUTS`. */
  grounds: GroundKind[];
  /** The ground it was approved in. */
  defaultGround: GroundKind;
  /** Colourway registers this layout renders correctly in. */
  accepts: ColourRegister[];
  /** The colourway it was approved in. */
  defaultColourway: string;
  needs: LayoutNeed;
  build: (s: BuildSpec) => BuiltTemplate;
}

/** Headline size as a percentage of canvas width.
 *
 *  The number the first rejection was about. The old ladder put every headline
 *  at 10.0% and every display at 14.0%; the owner's taste turned out to be
 *  6-12% WITH a rich vocabulary, not 3-4% with restraint. Returns null when
 *  `headline` names no run, which is a bookkeeping error and reported as one. */
export function headlinePct(t: BuiltTemplate): number | null {
  return t.runs.find((r) => r.text === t.headline)?.sizePct ?? null;
}

/** Largest type size in the composition, ornaments included. */
export function loudestPct(t: BuiltTemplate): number {
  return Math.max(...t.runs.map((r) => r.sizePct));
}

/** Resolve a run's backdrop from where it sits.
 *
 *  Only `blocked` has two, and this is the identity on the other five. It exists
 *  because the alternative — each layout knowing which grounds have a boundary —
 *  is exactly the knowledge that was baked into the probe and is what stops a
 *  layout being ground-agnostic. */
function backdropAt(g: { on: Backdrop; onSecond?: Backdrop }): (yPct: number) => Backdrop {
  return (yPct) => (yPct >= BLOCK_SPLIT_PCT && g.onSecond ? g.onSecond : g.on);
}

// ── 1. Sound Pro — product ───────────────────────────────────────────────────
//
// The layout that proves luminosity is not the same thing as a gradient. On its
// default flat ground there is one confident colour and every bit of depth comes
// from the glow the product stands on and the layering over it.
//
//   DEPTH       a radial glow under the cutout, the CTAs and the lockup sitting
//               over the ground, the product bleeding past the right edge.
//   LUMINOSITY  the glow, plus a soft halftone bloom behind the product. Lit,
//               not printed, whatever the ground underneath is.
//   SOFT GEO    two pill CTAs, a disc lockup mark, a dot cluster. No rectangle
//               and no hairline anywhere in it.
//   DENSITY     lockup, two CTAs, a dot cluster, a halftone bloom, a
//               micro-label. The air on the left is around rich elements.
//   SUBJECT     cut out, huge, bleeding off the right edge, lifted by the glow.
//
// Headline 6.5%, two lines at ONE size split by weight — the hierarchy the old
// four-rung ladder had no vocabulary for.

const SOUND_PRO_ZONES: Zone[] = [{ xPct: 3, yPct: 4, widthPct: 50, heightPct: 62 }];

function soundPro(s: BuildSpec): BuiltTemplate {
  const { cw, copy } = s;
  const seed = s.seed ?? 5;
  const c = compose();
  const g = ground(s.ground, cw, { seed, zones: SOUND_PRO_ZONES });
  const at = backdropAt(g);
  const on = at(26);
  const line = { sizePct: 6.5, font: "modern" as const, trackingPct: -0.1, color: cw.ink };
  const quiet = { sizePct: 1.65, font: "support" as const, opacity: 0.8, color: cw.ink };
  const cta = { sizePct: 1.3, font: "mono" as const, uppercase: true, trackingPct: 0.2 };

  const buy = { ...cta, text: copy.cta, color: cw.onAccent };
  const compare = { ...cta, text: copy.cta2, color: cw.ink };
  const buyW = ctaWidth(buy, 20);
  const compareW = ctaWidth(compare, 20);
  const compareX = Number((6 + buyW + 3).toFixed(2));
  // The secondary CTA sits inside a ghost pill, which is artwork painted over
  // the ground, so it is not on a bare field and does not claim to be. Same
  // colour, same number, true of the geometry.
  const onGhost = overArtwork(at(57));

  c.add(
    ...g.layers,
    halftone({ xPct: 50, yPct: 10, widthPct: 58, heightPct: 58 }, cw.accent, {
      opacity: 0.18, rings: 8,
    }),
    solidPill({ xPct: 6, yPct: 7, widthPct: 3, heightPct: 3 }, cw.accent),
    glow({ xPct: 50, yPct: 68, widthPct: 50, heightPct: 16 }, cw.accent, { alpha: 0.5 }),
    cutout({ xPct: 52, yPct: 16, widthPct: 56, heightPct: 72, fit: "contain" }),
    dotCluster({ xPct: 6, yPct: 76, widthPct: 8, heightPct: 11 }, cw.accent, 3, 4, { opacity: 0.4 }),
    solidPill({ xPct: 6, yPct: 57, widthPct: buyW, heightPct: 7 }, cw.accent),
    ghostPill({ xPct: compareX, yPct: 57, widthPct: compareW, heightPct: 7 }, cw.ink, { weight: 0.05 }),
  );

  c.type(
    {
      text: copy.kicker, sizePct: 1.2, font: "mono", uppercase: true, trackingPct: 0.25,
      color: cw.ink, xPct: 10.5, yPct: 7.9, on: overArtwork(at(7.9)),
    },
    { ...line, weight: 400, text: copy.head[0], xPct: 6, yPct: 26, on },
    { ...line, weight: 700, text: copy.head[1], xPct: 6, yPct: 34.2, on },
    { ...quiet, text: copy.body[0], xPct: 6, yPct: 45, on: at(45) },
    { ...quiet, text: copy.body[1], xPct: 6, yPct: 47.6, on: at(47.6) },
    { ...buy, xPct: centerOn(6, buyW, buy), yPct: 59.4, on: { kind: "owned", colors: [cw.accent] } },
    { ...compare, xPct: centerOn(compareX, compareW, compare), yPct: 59.4, on: onGhost },
  );

  c.add(grain({ xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }, cw.ink, {
    opacity: 0.09, blend: "overlay", seed, scale: 0.95,
  }));

  return {
    id: "soundpro",
    name: "Sound Pro",
    subject: "product",
    intent: "mid",
    ground: s.ground,
    groundNote: g.note,
    colourway: cw,
    headline: copy.head[0],
    note: "A lit subject on a quiet ground: a headline split by weight at a constant size, two pill CTAs, and the product cut out over a glow, bleeding past the right edge.",
    layers: c.layers,
    runs: c.runs,
  };
}

// ── 2. Counter — event ───────────────────────────────────────────────────────
//
//   DEPTH       the cutout crosses the ground's boundary where it has one, which
//               is what stops a blocked ground reading as two stripes; chips and
//               a seal sit over everything.
//   LUMINOSITY  a glow at the subject's feet, and on a blocked ground the two
//               areas are two tones of one colourway rather than two colours.
//   SOFT GEO    pill chips, a scalloped seal, a disc CTA. The one hard line
//               available to it is the block boundary, and the subject breaks it.
//   DENSITY     three icon chips, a seal, a CTA, a kicker, two support lines.
//   SUBJECT     cut out, dropped off the bottom edge, crossing the boundary.
//
// Headline 6.0%, centred, the same weight split as Sound Pro at a different
// scale and a different axis of symmetry.

const COUNTER_ZONES: Zone[] = [
  { xPct: 6, yPct: 10, widthPct: 88, heightPct: 34 },
  { xPct: 6, yPct: 44, widthPct: 88, heightPct: 22 },
];

function counter(s: BuildSpec): BuiltTemplate {
  const { cw, copy } = s;
  const seed = s.seed ?? 13;
  const cmp = compose();
  const g = ground(s.ground, cw, { seed, zones: COUNTER_ZONES });
  const at = backdropAt(g);
  const on = at(19);
  // The chip labels sit on translucent pills laid over the lower area, so they
  // are not on a bare field and must not claim to be.
  const onChip = overArtwork(at(59.3));
  const line = { sizePct: 6, font: "modern" as const, trackingPct: -0.08, color: cw.ink };
  const quiet = { sizePct: 1.55, font: "support" as const, opacity: 0.82, color: cw.ink };
  const chip = { ...CHIP_RUN, color: cw.ink };

  const kicker = {
    text: copy.kicker, sizePct: 1.25, font: "mono" as const, uppercase: true,
    trackingPct: 0.3, color: cw.ink,
  };
  const one = { ...line, weight: 400 as const, text: copy.head[0] };
  const two = { ...line, weight: 700 as const, text: copy.head[1] };
  const s1 = { ...quiet, text: copy.body[0] };
  const s2 = { ...quiet, text: copy.body[1] };
  const book = {
    text: copy.cta, sizePct: 1.2, font: "mono" as const, uppercase: true,
    trackingPct: 0.2, color: cw.onAccent,
  };
  const bookW = ctaWidth(book, 24);
  const bookX = Number((50 - bookW / 2).toFixed(2));

  const seal = { xPct: 76, yPct: 7, widthPct: 17, heightPct: 17 };
  const sealTurn = 11;
  const sealLabel = {
    text: copy.badge, sizePct: 1.1, font: "mono" as const, uppercase: true,
    trackingPct: 0.12, color: cw.onAccent,
  };
  const sealAnchor = rotateAbout(
    {
      xPct: centreOf(seal).xPct - estWidthPct(sealLabel) / 2,
      yPct: centreOf(seal).yPct - sealLabel.sizePct * 0.6,
    },
    centreOf(seal),
    sealTurn,
  );

  const flowed = flowRow(copy.chips.map((x) => x.label), 9, 78);
  const chips = copy.chips.map((ch, i) => ({ ...ch, ...flowed[i] }));

  cmp.add(
    ...g.layers,
    scallopedSeal(seal, cw.accent, {
      rotation: sealTurn, bumps: 13, keyline: { color: cw.stops[0], width: 0.1 },
    }),
    solidPill({ xPct: bookX, yPct: 46, widthPct: bookW, heightPct: 6.4 }, cw.accent),
    ...chips.flatMap((ch) => [
      glassPill({ xPct: ch.xPct, yPct: 57, widthPct: ch.widthPct, heightPct: 6 }, cw.ink, cw.ink, {
        fillAlpha: 0.1, borderAlpha: 0.3,
      }),
      icon({ name: ch.icon, xPct: ch.xPct + 1.8, yPct: 58.3, sizePct: 3.4 }, cw.ink, { weight: 1.9 }),
    ]),
    glow({ xPct: 24, yPct: 68, widthPct: 52, heightPct: 14 }, cw.accent, { alpha: 0.5 }),
    cutout({ xPct: 22, yPct: 42, widthPct: 56, heightPct: 66, fit: "contain" }),
  );

  cmp.type(
    { ...kicker, xPct: centerOn(0, 100, kicker), yPct: 13, on },
    { ...one, xPct: centerOn(0, 100, one), yPct: 19, on },
    { ...two, xPct: centerOn(0, 100, two), yPct: 27.2, on },
    { ...s1, xPct: centerOn(0, 100, s1), yPct: 37, on },
    { ...s2, xPct: centerOn(0, 100, s2), yPct: 39.6, on },
    { ...book, xPct: centerOn(bookX, bookW, book), yPct: 48.2, on: { kind: "owned", colors: [cw.accent] } },
    ...chips.map((ch) => ({
      ...chip, text: ch.label, xPct: Number((ch.xPct + CHIP_GUTTER).toFixed(2)), yPct: 59.3, on: onChip,
    })),
    { ...sealLabel, ...sealAnchor, rotation: sealTurn, on: { kind: "owned", colors: [cw.accent] } },
  );

  cmp.add(grain({ xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }, cw.ink, {
    opacity: 0.08, blend: "overlay", seed, scale: 0.95,
  }));

  return {
    id: "counter",
    name: "Counter",
    subject: "event",
    intent: "mid",
    ground: s.ground,
    groundNote: g.note,
    colourway: cw,
    headline: copy.head[0],
    note: "A centred weight-split headline over a subject cut out and dropped off the bottom edge, with a row of icon chips and a die-cut seal.",
    layers: cmp.layers,
    runs: cmp.runs,
  };
}

// ── 3. Culvert — editorial ───────────────────────────────────────────────────
//
// Rebuilt from nothing. The version the owner saw was editorial-Swiss and was
// called basic and then old; what survives is the subject matter, not one line
// of the design. No grid, no hairline, no folio, no white column, no 4% type.
//
//   DEPTH       four planes: the ground, the region the template darkened, a
//               circle-cut detail lifted off it by its own glow, and the
//               stickers and chips over everything.
//   LUMINOSITY  a screen-blend flare across the top and a glow behind the
//               detail disc, so the light is in the scene.
//   SOFT GEO    a circular detail, pill chips, a scalloped seal, a halftone
//               patch. Nothing rectangular is visible except the frame.
//   DENSITY     label pill, two icon chips, a seal, a dot cluster, a halftone
//               patch, a detail disc.
//   SUBJECT     on a photographic ground the picture IS the ground, full bleed,
//               with a second crop of it lifted off the surface; on every other
//               ground that lifted disc is where the subject lives.
//
// Headline 7%, three lines, the last one at 700 — a weight break rather than a
// size break, so the type block stays one shape.

const CULVERT_ZONES: Zone[] = [{ xPct: 3, yPct: 7, widthPct: 50, heightPct: 62 }];

function culvert(s: BuildSpec): BuiltTemplate {
  const { cw, copy } = s;
  const seed = s.seed ?? 21;
  const c = compose();
  const g = ground(s.ground, cw, { seed, zones: CULVERT_ZONES });
  const at = backdropAt(g);
  const on = at(17);
  const head = { sizePct: 7, font: "modern" as const, trackingPct: -0.09, color: cw.ink };
  const stand = { sizePct: 2.1, font: "support" as const, opacity: 0.85, color: cw.ink };
  const chipText = { ...CHIP_RUN, color: cw.ink };

  const seal = { xPct: 7, yPct: 74, widthPct: 18, heightPct: 18 };
  const sealTurn = -12;
  const sealLabel = {
    text: copy.badge, sizePct: 1.15, font: "mono" as const, uppercase: true,
    trackingPct: 0.15, color: cw.onAccent,
  };
  const sealAnchor = rotateAbout(
    {
      xPct: centreOf(seal).xPct - estWidthPct(sealLabel) / 2,
      yPct: centreOf(seal).yPct - sealLabel.sizePct * 0.6,
    },
    centreOf(seal),
    sealTurn,
  );

  const chips = copy.chips.map((ch, i) => ({
    ...ch, yPct: 52 + i * 8, widthPct: chipWidth(ch.label),
  }));

  c.add(
    ...g.layers,
    flare({ xPct: 30, yPct: -12, widthPct: 82, heightPct: 38 }, cw.accent, {
      blend: "screen", alpha: 0.34, coreAlpha: 0.5,
    }),
    halftone({ xPct: 62, yPct: 4, widthPct: 30, heightPct: 30 }, cw.accent, { opacity: 0.22, rings: 6 }),
    // A crop of the photograph cut to a disc and lifted off the ground by its
    // own glow. This is the layer that gives an editorial page a z-axis without
    // a single box.
    glow({ xPct: 56, yPct: 54, widthPct: 44, heightPct: 44 }, cw.accent, { alpha: 0.45 }),
    photo({ xPct: 62, yPct: 60, widthPct: 32, heightPct: 32, clip: { shape: "circle" } }),
    glassPill({ xPct: 6, yPct: 9, widthPct: 20, heightPct: 5.4 }, cw.ink, cw.ink, {
      fillAlpha: 0.12, borderAlpha: 0.35,
    }),
    ...chips.flatMap((ch) => [
      glassPill({ xPct: 6, yPct: ch.yPct, widthPct: ch.widthPct, heightPct: 6.2 }, cw.ink, cw.ink, {
        fillAlpha: 0.14, borderAlpha: 0.36,
      }),
      icon({ name: ch.icon, xPct: 7.8, yPct: ch.yPct + 1.3, sizePct: 3.6 }, cw.ink, { weight: 1.9 }),
    ]),
    dotCluster({ xPct: 40, yPct: 88, widthPct: 8, heightPct: 10 }, cw.accent, 3, 4, { opacity: 0.5 }),
    scallopedSeal(seal, cw.accent, {
      rotation: sealTurn, bumps: 14, keyline: { color: cw.ink, width: 0.08 },
    }),
  );

  c.type(
    {
      text: copy.kicker, sizePct: 1.15, font: "mono", uppercase: true, trackingPct: 0.2,
      color: cw.ink, xPct: 9.4, yPct: 10.4, on: overArtwork(on),
    },
    { ...head, weight: 400, text: copy.head[0], xPct: 6, yPct: 17, on },
    { ...head, weight: 400, text: copy.head[1], xPct: 6, yPct: 24.8, on },
    { ...head, weight: 700, text: copy.head[2], xPct: 6, yPct: 32.6, on },
    { ...stand, text: copy.body[0], xPct: 6, yPct: 43, on: at(43) },
    { ...stand, text: copy.body[1], xPct: 6, yPct: 46, on: at(46) },
    ...chips.map((ch) => ({
      ...chipText, text: ch.label, xPct: 6 + CHIP_GUTTER, yPct: ch.yPct + 2.3,
      on: overArtwork(at(ch.yPct + 2.3)),
    })),
    { ...sealLabel, ...sealAnchor, rotation: sealTurn, on: { kind: "owned", colors: [cw.accent] } },
  );

  c.add(grain({ xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }, cw.ink, {
    opacity: 0.11, blend: "overlay", seed, scale: 0.9,
  }));

  return {
    id: "culvert",
    name: "Culvert",
    subject: "editorial",
    intent: "mid",
    ground: s.ground,
    groundNote: g.note,
    colourway: cw,
    headline: copy.head[0],
    note: "Three headline lines in a region the template darkened, a flare across the top, and a circle-cut crop of the photograph lifted off the ground by a glow.",
    layers: c.layers,
    runs: c.runs,
  };
}

// ── 4. Bass Line — product, loud ─────────────────────────────────────────────
//
// Reference 1, answered directly, and the layout the gradient ground was built
// for — one of six treatments, not the default.
//
//   DEPTH       flare, halftone disc, glow, cutout, chips: five planes.
//   LUMINOSITY  a lit mesh where the ground is one, plus a screen-blend flare
//               behind the subject on every ground.
//   SOFT GEO    discs, pills, a starburst. The only straight edges are frame.
//   DENSITY     four chips, two dot clusters, two x-marks, a sticker, a CTA,
//               a contact line with an icon.
//   SUBJECT     cut out, centred, huge, standing on its own glow.
//
// The cap-line is 11% — above the old set's 10% headline, and that is the
// argument rather than an accident: one element in six is allowed to be this
// size, so it reads as a decision.

function bassLine(s: BuildSpec): BuiltTemplate {
  const { cw, copy } = s;
  const seed = s.seed ?? 11;
  const c = compose();
  const g = ground(s.ground, cw, { seed });
  const at = backdropAt(g);
  const on = at(13.5);
  const chip = { ...CHIP_RUN, color: cw.ink };

  // Ink, not accentInk. A gradient ground can run through the accent's own hue —
  // in Sunset it literally ends there — and a coloured script over it measured
  // 1.49:1. On a mesh the only colour with a floor against every stop is the ink.
  const script = { text: copy.script, sizePct: 5, font: "script" as const, color: cw.ink };
  const caps = {
    text: copy.head[0], sizePct: 11, font: "impact" as const, uppercase: true,
    trackingPct: -0.4, color: cw.ink,
  };
  const order = {
    text: copy.cta, sizePct: 1.35, font: "mono" as const, uppercase: true,
    trackingPct: 0.25, color: cw.onAccent,
  };
  const orderW = ctaWidth(order, 26);
  const orderX = Number((94 - orderW).toFixed(2));

  const burst = { xPct: 76, yPct: 5, widthPct: 17, heightPct: 17 };
  const burstTurn = 14;
  const burstLabel = {
    text: copy.badge, sizePct: 1.3, font: "mono" as const, uppercase: true,
    trackingPct: 0.15, color: cw.onAccent,
  };
  const burstAnchor = rotateAbout(
    {
      xPct: centreOf(burst).xPct - estWidthPct(burstLabel) / 2,
      yPct: centreOf(burst).yPct - burstLabel.sizePct * 0.6,
    },
    centreOf(burst),
    burstTurn,
  );

  // Two chips down each margin, clear of the centred cutout. The right-hand pair
  // is right-aligned to the frame, so a longer label grows inward rather than
  // off the edge.
  const chips = copy.chips.slice(0, 4).map((ch, i) => {
    const w = chipWidth(ch.label);
    const left = i < 2;
    return {
      ...ch,
      widthPct: w,
      xPct: left ? [2, 5][i] : Number((94 - w).toFixed(2)),
      yPct: left ? [31, 47][i] : [35, 51][i - 2],
    };
  });

  c.add(
    ...g.layers,
    flare({ xPct: 6, yPct: 22, widthPct: 88, heightPct: 36 }, cw.accent, {
      blend: "screen", alpha: 0.36, coreAlpha: 0.5,
    }),
    halftone({ xPct: 22, yPct: 26, widthPct: 56, heightPct: 56 }, cw.ink, {
      opacity: 0.22, blend: "screen", rings: 8,
    }),
    dotCluster({ xPct: 4, yPct: 7, widthPct: 8, heightPct: 11 }, cw.ink, 3, 4, { opacity: 0.5 }),
    dotCluster({ xPct: 88, yPct: 80, widthPct: 8, heightPct: 11 }, cw.ink, 3, 4, { opacity: 0.5 }),
    cross({ xPct: 92, yPct: 30, widthPct: 3.6, heightPct: 3.6 }, cw.accentInk, { opacity: 0.9 }),
    cross({ xPct: 9, yPct: 74, widthPct: 3, heightPct: 3 }, cw.accentInk, { opacity: 0.75 }),
    glow({ xPct: 26, yPct: 64, widthPct: 48, heightPct: 15 }, cw.accent, { alpha: 0.55 }),
    cutout({ xPct: 24, yPct: 22, widthPct: 52, heightPct: 54, fit: "contain" }),
    ...chips.flatMap((ch) => [
      glassPill({ xPct: ch.xPct, yPct: ch.yPct, widthPct: ch.widthPct, heightPct: 6.6 }, cw.ink, cw.ink, {
        fillAlpha: 0.16, borderAlpha: 0.4,
      }),
      icon({ name: ch.icon, xPct: ch.xPct + 2, yPct: ch.yPct + 1.4, sizePct: 3.8 }, cw.ink, { weight: 1.9 }),
    ]),
    starburst(burst, cw.accent, {
      rotation: burstTurn, points: 14, innerRatio: 0.72,
      keyline: { color: cw.ink, width: 0.08 },
    }),
    solidPill({ xPct: orderX, yPct: 88.5, widthPct: orderW, heightPct: 7 }, cw.accent),
    icon({ name: "phone", xPct: 5, yPct: 89.8, sizePct: 3.4 }, cw.ink, { weight: 1.9 }),
  );

  c.type(
    { ...script, xPct: centerOn(0, 100, script), yPct: 8.5, on },
    { ...caps, xPct: centerOn(0, 100, caps), yPct: 13.5, on },
    ...chips.map((ch) => ({
      ...chip, text: ch.label, xPct: Number((ch.xPct + CHIP_GUTTER).toFixed(2)), yPct: ch.yPct + 2.3,
      on: overArtwork(at(ch.yPct + 2.3)),
    })),
    {
      text: copy.footer, sizePct: 1.3, font: "mono", color: cw.ink,
      xPct: 9.6, yPct: 90.6, on: at(90.6),
    },
    { ...order, xPct: centerOn(orderX, orderW, order), yPct: 90.8, on: { kind: "owned", colors: [cw.accent] } },
    { ...burstLabel, ...burstAnchor, rotation: burstTurn, on: { kind: "owned", colors: [cw.accent] } },
  );

  c.add(grain({ xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }, cw.ink, {
    opacity: 0.15, blend: "overlay", seed, scale: 0.85,
  }));

  return {
    id: "bassline",
    name: "Bass Line",
    subject: "product",
    intent: "loud",
    ground: s.ground,
    groundNote: g.note,
    colourway: cw,
    headline: copy.head[0],
    note: "Script over a heavy cap-line at 11%, a cutout hero on a flare and a halftone disc, four glass chips down the margins and a die-cut starburst.",
    layers: c.layers,
    runs: c.runs,
  };
}

// ── 5. Half Price — sale, loud ───────────────────────────────────────────────
//
// The layout the duotone ground was built for: the photograph mapped into two of
// the colourway's hues, a look the system could not previously produce at all.
//
//   DEPTH       the treated environment behind, the product cut out in front, a
//               halftone between them, chips over everything.
//   LUMINOSITY  on duotone the first pass lifts the picture into the accent hue
//               so it glows rather than being tinted; on every other ground the
//               glow under the subject does the same job.
//   SOFT GEO    pill chips, a disc CTA, a scalloped seal, a dot cluster.
//   DENSITY     three chips, a seal, a dot cluster, an x-mark, a CTA.
//   SUBJECT     cut out, bleeding off the right edge, over its own glow.
//
// The cap-line is 12%, the loudest thing in the set, on a sale, where being the
// loudest thing in the room is the job.

const HALF_PRICE_ZONES: Zone[] = [
  { xPct: 3, yPct: 16, widthPct: 38, heightPct: 30 },
  { xPct: 3, yPct: 54, widthPct: 66, heightPct: 42 },
];

function halfPrice(s: BuildSpec): BuiltTemplate {
  const { cw, copy } = s;
  const seed = s.seed ?? 17;
  const c = compose();
  const g = ground(s.ground, cw, { seed, zones: HALF_PRICE_ZONES });
  const at = backdropAt(g);
  const chip = { ...CHIP_RUN, color: cw.ink };

  const script = { text: copy.script, sizePct: 4.5, font: "script" as const, color: cw.ink };
  const caps = {
    text: copy.head[0], sizePct: 12, font: "impact" as const, uppercase: true,
    trackingPct: -0.45, color: cw.ink,
  };
  const shop = {
    text: copy.cta, sizePct: 1.3, font: "mono" as const, uppercase: true,
    trackingPct: 0.22, color: cw.onAccent,
  };
  const shopW = ctaWidth(shop, 26);

  const seal = { xPct: 30, yPct: 4, widthPct: 19, heightPct: 19 };
  const sealTurn = -10;
  const sealLabel = {
    text: copy.badge, sizePct: 1.15, font: "mono" as const, uppercase: true,
    trackingPct: 0.12, color: cw.onAccent,
  };
  const sealAnchor = rotateAbout(
    {
      xPct: centreOf(seal).xPct - estWidthPct(sealLabel) / 2,
      yPct: centreOf(seal).yPct - sealLabel.sizePct * 0.6,
    },
    centreOf(seal),
    sealTurn,
  );

  const chips = copy.chips.map((ch, i) => ({
    ...ch, yPct: 20 + i * 9, widthPct: chipWidth(ch.label),
  }));

  c.add(
    ...g.layers,
    halftone({ xPct: 46, yPct: 6, widthPct: 52, heightPct: 52 }, cw.ink, {
      opacity: 0.2, blend: "screen", rings: 7,
    }),
    // Clear of the cap-line: a glow is an image layer, so where it overlaps a
    // run it becomes what that run sits on, and the wash claim stops being true.
    glow({ xPct: 54, yPct: 45, widthPct: 44, heightPct: 14 }, cw.accent, { alpha: 0.5 }),
    // Ends at 62%, above the cap-line rather than across it: at 12% the headline
    // is around half the frame wide and the two boxes overlapped, which made its
    // wash claim false.
    cutout({ xPct: 44, yPct: 8, widthPct: 62, heightPct: 54, fit: "contain" }),
    ...chips.flatMap((ch) => [
      glassPill({ xPct: 5, yPct: ch.yPct, widthPct: ch.widthPct, heightPct: 6.4 }, cw.ink, cw.ink, {
        fillAlpha: 0.16, borderAlpha: 0.4,
      }),
      icon({ name: ch.icon, xPct: 6.9, yPct: ch.yPct + 1.3, sizePct: 3.7 }, cw.ink, { weight: 1.9 }),
    ]),
    dotCluster({ xPct: 5, yPct: 6, widthPct: 8, heightPct: 11 }, cw.ink, 3, 4, { opacity: 0.5 }),
    cross({ xPct: 37, yPct: 51, widthPct: 3.2, heightPct: 3.2 }, cw.accentInk, { opacity: 0.85 }),
    scallopedSeal(seal, cw.accent, {
      rotation: sealTurn, bumps: 13, keyline: { color: cw.ink, width: 0.08 },
    }),
    solidPill({ xPct: 6, yPct: 87, widthPct: shopW, heightPct: 7 }, cw.accent),
  );

  c.type(
    ...chips.map((ch) => ({
      ...chip, text: ch.label, xPct: 5 + CHIP_GUTTER, yPct: ch.yPct + 2.2,
      on: overArtwork(at(ch.yPct + 2.2)),
    })),
    { ...script, xPct: 6, yPct: 57, on: at(57) },
    { ...caps, xPct: 5, yPct: 62.5, on: at(62.5) },
    {
      text: copy.body[0],
      sizePct: 1.6, font: "support", opacity: 0.9, color: cw.ink, xPct: 6, yPct: 79, on: at(79),
    },
    { ...shop, xPct: centerOn(6, shopW, shop), yPct: 89.3, on: { kind: "owned", colors: [cw.accent] } },
    { ...sealLabel, ...sealAnchor, rotation: sealTurn, on: { kind: "owned", colors: [cw.accent] } },
  );

  c.add(grain({ xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }, cw.ink, {
    opacity: 0.14, blend: "overlay", seed, scale: 0.85,
  }));

  return {
    id: "halfprice",
    name: "Half Price",
    subject: "sale",
    intent: "loud",
    ground: s.ground,
    groundNote: g.note,
    colourway: cw,
    headline: copy.head[0],
    note: "A treated photograph as the ground, the product cut out in front of it bleeding off the right, chips stacked in a column and a die-cut seal.",
    layers: c.layers,
    runs: c.runs,
  };
}

// ── 6. Late Set — portrait, loud ─────────────────────────────────────────────
//
// The layout the textured ground was built for — a halftone field over a flat
// colour, texture as the surface itself rather than as an accent behind the
// subject. Arranged on a diagonal: subject bleeding off the left, type block
// right, a torn strip of paper across the bottom.
//
//   DEPTH       flare, ground, glow, cutout, torn paper laid over the subject's
//               feet, sticker over the paper. Six planes.
//   LUMINOSITY  a screen-blend flare, so the surface is lit rather than printed.
//   SOFT GEO    starburst, pills, discs, and a ripped edge instead of a rule.
//   DENSITY     two chips, a starburst, a dot cluster, an x-mark, a CTA, a
//               micro-line on the paper.
//   SUBJECT     cut out, bleeding off the left edge, lifted by its own glow,
//               and the largest thing in the frame.

const LATE_SET_ZONES: Zone[] = [{ xPct: 50, yPct: 9, widthPct: 46, heightPct: 60 }];

function lateSet(s: BuildSpec): BuiltTemplate {
  const { cw, copy } = s;
  const seed = s.seed ?? 33;
  const c = compose();
  const g = ground(s.ground, cw, { seed, zones: LATE_SET_ZONES });
  const at = backdropAt(g);
  const on = at(17.5);
  const onPaper = { kind: "owned" as const, colors: [cw.ink] };
  const chipText = { ...CHIP_RUN, color: cw.ink };

  const script = { text: copy.script, sizePct: 4.6, font: "script" as const, color: cw.accentInk };
  const caps = {
    text: copy.head[0], sizePct: 10.5, font: "impact" as const, uppercase: true,
    trackingPct: -0.35, color: cw.ink,
  };
  const tickets = {
    text: copy.cta, sizePct: 1.35, font: "mono" as const, uppercase: true,
    trackingPct: 0.25, color: cw.onAccent,
  };
  const ticketsW = ctaWidth(tickets, 26);
  const ticketsX = Number((92 - ticketsW).toFixed(2));

  const burst = { xPct: 34, yPct: 60, widthPct: 19, heightPct: 19 };
  const burstTurn = -14;
  const burstLabel = {
    text: copy.badge, sizePct: 1.2, font: "mono" as const, uppercase: true,
    trackingPct: 0.15, color: cw.onAccent,
  };
  const burstAnchor = rotateAbout(
    {
      xPct: centreOf(burst).xPct - estWidthPct(burstLabel) / 2,
      yPct: centreOf(burst).yPct - burstLabel.sizePct * 0.6,
    },
    centreOf(burst),
    burstTurn,
  );

  const chips = copy.chips.map((ch, i) => ({
    ...ch, yPct: 38 + i * 9, widthPct: chipWidth(ch.label),
  }));

  c.add(
    ...g.layers,
    flare({ xPct: -12, yPct: 16, widthPct: 84, heightPct: 34 }, cw.accent, {
      blend: "screen", alpha: 0.42, coreAlpha: 0.6,
    }),
    glow({ xPct: 0, yPct: 64, widthPct: 50, heightPct: 14 }, cw.accent, { alpha: 0.55 }),
    cutout({ xPct: -6, yPct: 14, widthPct: 58, heightPct: 72, fit: "contain" }),
    dotCluster({ xPct: 88, yPct: 6, widthPct: 8, heightPct: 11 }, cw.ink, 3, 4, { opacity: 0.5 }),
    cross({ xPct: 47, yPct: 7, widthPct: 3.4, heightPct: 3.4 }, cw.accentInk, { opacity: 0.85 }),
    ...chips.flatMap((ch) => [
      glassPill({ xPct: 53, yPct: ch.yPct, widthPct: ch.widthPct, heightPct: 6.4 }, cw.ink, cw.ink, {
        fillAlpha: 0.16, borderAlpha: 0.4,
      }),
      icon({ name: ch.icon, xPct: 54.9, yPct: ch.yPct + 1.3, sizePct: 3.8 }, cw.ink, { weight: 1.9 }),
    ]),
    solidPill({ xPct: ticketsX, yPct: 60, widthPct: ticketsW, heightPct: 7 }, cw.accent),
    // Over the glow and the subject's feet, which is what makes it read as laid
    // on top rather than as a band in the layout.
    tornEdge({ xPct: 0, yPct: 72, widthPct: 100, heightPct: 28 }, cw.ink, {
      teeth: 30, roughness: 0.3, seed: 9,
    }),
    starburst(burst, cw.accent, {
      rotation: burstTurn, points: 14, innerRatio: 0.72,
      keyline: { color: cw.ink, width: 0.08 },
    }),
  );

  c.type(
    { ...script, xPct: 54, yPct: 12, on: at(12) },
    { ...caps, xPct: 53, yPct: 17.5, on },
    {
      text: copy.body[0],
      sizePct: 1.6, font: "support", opacity: 0.9, color: cw.ink, xPct: 53.5, yPct: 30.5, on: at(30.5),
    },
    ...chips.map((ch) => ({
      ...chipText, text: ch.label, xPct: 53 + CHIP_GUTTER, yPct: ch.yPct + 2.4,
      on: overArtwork(at(ch.yPct + 2.4)),
    })),
    { ...tickets, xPct: centerOn(ticketsX, ticketsW, tickets), yPct: 62.3, on: { kind: "owned", colors: [cw.accent] } },
    { ...burstLabel, ...burstAnchor, rotation: burstTurn, on: { kind: "owned", colors: [cw.accent] } },
    {
      text: copy.footer,
      sizePct: 1.35, font: "mono", uppercase: true, trackingPct: 0.1,
      color: cw.stops[0], xPct: 6, yPct: 93.4, on: onPaper,
    },
  );

  return {
    id: "lateset",
    name: "Late Set",
    subject: "portrait",
    intent: "loud",
    ground: s.ground,
    groundNote: g.note,
    colourway: cw,
    headline: copy.head[0],
    note: "Subject cut out and bleeding off the left over a flare, type block right, torn paper across the bottom with a sticker laid over it.",
    layers: c.layers,
    runs: c.runs,
  };
}

/** The six layouts.
 *
 *  `grounds` is curated rather than all six for every layout. `photographic`
 *  darkens the region a layout writes in, and Bass Line writes across the whole
 *  frame — top centre, both margins and a bottom bar — so its zone would be the
 *  picture. A scrim over the entire photograph is not a region the template
 *  owns, it is the safety box this system exists to get rid of, so Bass Line
 *  takes the five treatments where its density has somewhere to sit.
 *
 *  `accepts` is what the colour matrix is built from. A layout that only
 *  rendered in one register would be carrying colour assumptions it should not,
 *  and the matrix is what makes that visible; every layout takes all three,
 *  because every colour decision in all six comes from a role. */
export const LAYOUTS: Layout[] = [
  {
    id: "soundpro", name: "Sound Pro",
    grounds: ["flat", "gradient", "textured", "blocked", "photographic", "duotone"],
    defaultGround: "flat",
    accepts: ["soft", "vibrant", "dark"], defaultColourway: "sorbet",
    needs: { head: 2, body: 2, chips: 0 }, build: soundPro,
  },
  {
    id: "counter", name: "Counter",
    grounds: ["blocked", "flat", "gradient", "textured", "photographic", "duotone"],
    defaultGround: "blocked",
    accepts: ["soft", "vibrant", "dark"], defaultColourway: "peachsky",
    needs: { head: 2, body: 2, chips: 3 }, build: counter,
  },
  {
    id: "culvert", name: "Culvert",
    grounds: ["photographic", "duotone", "textured", "flat", "blocked", "gradient"],
    defaultGround: "photographic",
    accepts: ["soft", "vibrant", "dark"], defaultColourway: "slate",
    needs: { head: 3, body: 2, chips: 2 }, build: culvert,
  },
  {
    id: "bassline", name: "Bass Line",
    grounds: ["gradient", "flat", "textured", "duotone", "blocked"],
    defaultGround: "gradient",
    accepts: ["soft", "vibrant", "dark"], defaultColourway: "blurple",
    needs: { head: 1, body: 0, chips: 4 }, build: bassLine,
  },
  {
    id: "halfprice", name: "Half Price",
    grounds: ["duotone", "photographic", "flat", "textured", "gradient", "blocked"],
    defaultGround: "duotone",
    accepts: ["soft", "vibrant", "dark"], defaultColourway: "sunset",
    needs: { head: 1, body: 1, chips: 3 }, build: halfPrice,
  },
  {
    id: "lateset", name: "Late Set",
    grounds: ["textured", "flat", "gradient", "duotone", "photographic", "blocked"],
    defaultGround: "textured",
    accepts: ["soft", "vibrant", "dark"], defaultColourway: "ember",
    needs: { head: 1, body: 1, chips: 2 }, build: lateSet,
  },
];

export function layoutById(id: string): Layout {
  const found = LAYOUTS.find((l) => l.id === id);
  if (!found) throw new Error(`[design] unknown layout "${id}"`);
  return found;
}

/** Copy short enough for every layout to render, for a caller that wants a
 *  layout without supplying words — the colour matrix, mainly, where the
 *  question is the colour and the words would be noise. */
export const PLACEHOLDER_COPY: LayoutCopy = {
  kicker: "Feature",
  script: "Just landed",
  head: ["Headline one", "Headline two", "Third line"],
  body: ["A supporting line that runs to about here,", "and a second one under it."],
  chips: [
    { icon: "bolt", label: "Fast charging" },
    { icon: "check", label: "Two-year cover" },
    { icon: "droplet", label: "Splash proof" },
    { icon: "mic", label: "Voice assistant" },
  ],
  cta: "Shop now",
  cta2: "Compare",
  badge: "New",
  footer: "Fri 26 Sep / The old print works / 22:00",
};

/** Where a copy table is short of what a layout consumes. Empty is correct. */
export function copyShortfall(l: Layout, copy: LayoutCopy): string[] {
  const out: string[] = [];
  if (copy.head.length < l.needs.head) out.push(`${l.id}: needs ${l.needs.head} head line(s), has ${copy.head.length}`);
  if (copy.body.length < l.needs.body) out.push(`${l.id}: needs ${l.needs.body} body line(s), has ${copy.body.length}`);
  if (copy.chips.length < l.needs.chips) out.push(`${l.id}: needs ${l.needs.chips} chip(s), has ${copy.chips.length}`);
  return out;
}

/** Build one layout in one ground, one colourway and one set of words.
 *
 *  Throws on short copy rather than rendering a template with a missing call to
 *  action: an absent line reaches the layer model as the string "undefined",
 *  which is a defect that ships looking like a design choice. */
export function buildTemplate(l: Layout, s: BuildSpec): BuiltTemplate {
  const short = copyShortfall(l, s.copy);
  if (short.length) throw new Error(`[design] ${short.join("; ")}`);
  if (!l.grounds.includes(s.ground)) {
    throw new Error(`[design] ${l.id} is not composed for a ${s.ground} ground`);
  }
  if (!groundsFor(s.cw).includes(s.ground)) {
    throw new Error(`[design] colourway ${s.cw.id} may not take a ${s.ground} ground`);
  }
  return l.build(s);
}

/** Every colourway a layout renders correctly in. */
export function colourwaysForLayout(l: Layout): Colourway[] {
  return colourwaysFor(l.accepts);
}

/** Every (ground, colourway) pair a layout may be built in — the matrix the
 *  verification harness walks, which is how an incompatible pairing is found by
 *  measurement rather than by looking at the handful that happened to ship. */
export function matrixFor(l: Layout): { ground: GroundKind; cw: Colourway }[] {
  return l.grounds.flatMap((gk) =>
    colourwaysForLayout(l)
      .filter((cw) => groundsFor(cw).includes(gk))
      .map((cw) => ({ ground: gk, cw })),
  );
}

/** The six as the owner approved them: default ground, default colourway,
 *  placeholder words. Kept so the sweep can still show the reference set the
 *  judgement was made on, side by side with what shipped. */
export const APPROVED_SIX: BuiltTemplate[] = LAYOUTS.map((l) =>
  buildTemplate(l, {
    cw: colourway(l.defaultColourway),
    ground: l.defaultGround,
    copy: PLACEHOLDER_COPY,
  }),
);

/** Reference points for reading the headline sizes above. */
export const HEADLINE_REFERENCE = {
  /** What the rejected set shipped, from its `headline` type step at 80px. */
  rejectedHeadline: (80 / REFERENCE_WIDTH) * 100,
  /** And its display step, at 112px. */
  rejectedDisplay: (112 / REFERENCE_WIDTH) * 100,
  /** Where the owner's taste actually sits, once "the text is too big" turned
   *  out to mean "make it designed" rather than "make it smaller". */
  approved: [6, 12] as const,
};
