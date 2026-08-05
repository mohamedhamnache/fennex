/** Six layouts, on two orthogonal axes.
 *
 *  A layout no longer owns its colours or its treatment. It asks for roles and
 *  a ground, and a `Colourway` supplies the first while a `GroundKind` supplies
 *  the second — so six layouts times twelve colourways times six grounds is a
 *  library rather than six pictures, and the samey-ness that survived 34
 *  hand-built templates has nowhere left to come from.
 *
 *  The six, with the pairing each ships as:
 *
 *    layout      register  ground        colourway   headline
 *    Sound Pro   soft      flat          Sorbet       6.5%
 *    Counter     soft      blocked       Peach to sky 6.0%
 *    Culvert     dark      photographic  Slate        7.0%
 *    Bass Line   vibrant   gradient      Blurple     11.0%
 *    Half Price  vibrant   duotone       Sunset      12.0%
 *    Late Set    vibrant   textured      Ember       10.5%
 *
 *  NO GROUND APPEARS MORE THAN ONCE. That is stricter than the rule asked for,
 *  and it is deliberate: six layouts is the whole set a human is judging, so a
 *  repeated treatment would cost a sixth of the evidence.
 *
 *  THE FIVE POINTS govern every one of them, and each layout's comment says how
 *  it satisfies each. Depth, luminosity, soft geometry, density, dimensional
 *  hero. Two are worth restating because they are the ones that get under-served:
 *  luminosity does NOT require a gradient — a flat ground with a lit subject on
 *  it is luminous, which is what Sound Pro is for — and empty space has to read
 *  as breathing room AROUND rich elements rather than as a lack of ideas, which
 *  is what got the first pair of quiet templates called basic and then old.
 *
 *  What was cut, and why, since two of these replaced templates the owner had
 *  already seen: Small Batch and the first Culvert were editorial-Swiss — a
 *  visible grid, hairline rules, a folio in the margin, small type in a lot of
 *  white. That was the sophisticated look a decade ago and now reads as a
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
import { type GroundKind, ground } from "./ground";
import {
  type RunSpec, centerOn, centreOf, compose, estWidthPct, rotateAbout,
} from "./type";
import {
  type IconName, cross, dotCluster, flare, ghostPill, glassPill, glow, grain, halftone,
  icon, scallopedSeal, solidPill, starburst, tornEdge,
} from "./vector";

export interface ProbeTemplate {
  id: string;
  name: string;
  /** What it is for. The six span a deliberate range of jobs. */
  subject: "product" | "editorial" | "event" | "quote" | "sale" | "portrait";
  /** Which of the owner's two approved directions this one answers to.
   *
   *  `vibrant` is reference 1: a script line over a heavy cap-line, a cutout
   *  hero with a glow, scattered chips with icons, stickers, dot clusters, a
   *  solid CTA. `soft` is reference 2: pale luminous colour, a headline split by
   *  WEIGHT at a constant size, two CTAs, a cutout bleeding past an edge, and
   *  generous space around rich elements. */
  register: "vibrant" | "soft";
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

/** A layout: everything about a template except its colours. */
export interface Layout {
  id: string;
  name: string;
  ground: GroundKind;
  /** Colourway registers this layout renders correctly in. */
  accepts: ColourRegister[];
  /** The colourway it ships as. */
  defaultColourway: string;
  build: (cw: Colourway) => ProbeTemplate;
}

/** Headline size as a percentage of canvas width.
 *
 *  The number the first rejection was about. The old ladder put every headline
 *  at 10.0% and every display at 14.0%; the owner's taste turned out to be
 *  6-12% WITH a rich vocabulary, not 3-4% with restraint. Returns null when
 *  `headline` names no run, which is a bookkeeping error and reported as one. */
export function headlinePct(t: ProbeTemplate): number | null {
  return t.runs.find((r) => r.text === t.headline)?.sizePct ?? null;
}

/** Largest type size in the composition, ornaments included. */
export function loudestPct(t: ProbeTemplate): number {
  return Math.max(...t.runs.map((r) => r.sizePct));
}

// ── 1. Sound Pro — product, soft, FLAT ground ────────────────────────────────
//
// The template that proves luminosity is not the same thing as a gradient. The
// ground is one confident colour; every bit of depth comes from the glow the
// product stands on and the layering over it.
//
//   DEPTH       a radial glow under the cutout, the CTAs and the lockup sitting
//               over the field, the product bleeding past the right edge.
//   LUMINOSITY  the glow, plus a soft halftone bloom behind the product. Lit,
//               not printed, on a flat ground.
//   SOFT GEO    two pill CTAs, a disc lockup mark, a dot cluster. No rectangle
//               and no hairline anywhere in it.
//   DENSITY     lockup, two CTAs, a dot cluster, a halftone bloom, a
//               micro-label. The air on the left is around rich elements.
//   SUBJECT     cut out, huge, bleeding off the right edge, lifted by the glow.
//
// Headline 6.5%, two lines at ONE size split by weight — the hierarchy the old
// four-rung ladder had no vocabulary for.

function soundPro(cw: Colourway): ProbeTemplate {
  const c = compose();
  const g = ground("flat", cw);
  const on = g.on;
  const onAccentPill = { kind: "owned", colors: [cw.accent] } as const;
  const line = { sizePct: 6.5, font: "modern", trackingPct: -0.1, color: cw.ink } as const;
  const quiet = { sizePct: 1.65, font: "support", opacity: 0.8, color: cw.ink } as const;
  const cta = { sizePct: 1.3, font: "mono", uppercase: true, trackingPct: 0.2 } as const;

  const buy = { ...cta, text: "Buy now", color: cw.onAccent };
  const compare = { ...cta, text: "Compare", color: cw.ink };
  // The secondary CTA sits inside a ghost pill, which is artwork painted over
  // the ground, so it is not on a bare field and does not claim to be. Same
  // colour, same number, true of the geometry.
  const onGhost = { kind: "prepared", color: cw.stops[1], alpha: 1 } as const;

  c.add(
    ...g.layers,
    halftone({ xPct: 50, yPct: 10, widthPct: 58, heightPct: 58 }, cw.accent, {
      opacity: 0.18, rings: 8,
    }),
    solidPill({ xPct: 6, yPct: 7, widthPct: 3, heightPct: 3 }, cw.accent),
    glow({ xPct: 50, yPct: 68, widthPct: 50, heightPct: 16 }, cw.accent, { alpha: 0.5 }),
    cutout({ xPct: 52, yPct: 16, widthPct: 56, heightPct: 72, fit: "contain" }),
    dotCluster({ xPct: 6, yPct: 76, widthPct: 8, heightPct: 11 }, cw.accent, 3, 4, { opacity: 0.4 }),
    solidPill({ xPct: 6, yPct: 57, widthPct: 20, heightPct: 7 }, cw.accent),
    ghostPill({ xPct: 29, yPct: 57, widthPct: 22, heightPct: 7 }, cw.ink, { weight: 0.05 }),
  );

  c.type(
    {
      text: "Audio", sizePct: 1.2, font: "mono", uppercase: true, trackingPct: 0.25,
      color: cw.ink, xPct: 10.5, yPct: 7.9, on,
    },
    { ...line, weight: 400, text: "Sound Pro", xPct: 6, yPct: 26, on },
    { ...line, weight: 700, text: "A56 Headset", xPct: 6, yPct: 34.2, on },
    { ...quiet, text: "Forty hours between charges, and a case", xPct: 6, yPct: 45, on },
    { ...quiet, text: "that charges from the same cable.", xPct: 6, yPct: 47.6, on },
    { ...buy, xPct: centerOn(6, 20, buy), yPct: 59.4, on: onAccentPill },
    { ...compare, xPct: centerOn(29, 22, compare), yPct: 59.4, on: onGhost },
  );

  c.add(grain({ xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }, cw.ink, {
    opacity: 0.09, blend: "overlay", seed: 5, scale: 0.95,
  }));

  return {
    id: "pb_product_soundpro",
    name: "Sound Pro",
    subject: "product",
    register: "soft",
    intent: "mid",
    ground: "flat",
    groundNote: g.note,
    colourway: cw,
    headline: "Sound Pro",
    note: "Flat ground, lit subject: one confident colour, a headline split by weight at a constant size, and the product cut out over a glow and bleeding past the right edge.",
    layers: c.layers,
    runs: c.runs,
  };
}

// ── 2. Counter — event, soft, BLOCKED ground ─────────────────────────────────
//
//   DEPTH       the cutout crosses the boundary between the two blocks, which
//               is what stops a blocked ground reading as two stripes; chips and
//               a seal sit over both.
//   LUMINOSITY  a glow at the subject's feet on the lower block, and the two
//               blocks are two tones of one colourway rather than two colours.
//   SOFT GEO    pill chips, a scalloped seal, a disc CTA. The one hard line in
//               the set is the block boundary, and the subject breaks it.
//   DENSITY     three icon chips, a seal, a CTA, a kicker, two support lines.
//   SUBJECT     cut out, dropped off the bottom edge, crossing the boundary.
//
// Headline 6.0%, centred, same weight split as Sound Pro at a different scale
// and a different axis of symmetry.

function counter(cw: Colourway): ProbeTemplate {
  const cmp = compose();
  const g = ground("blocked", cw);
  const on = g.on;
  // The chip labels sit on translucent pills laid over the lower block, so they
  // are not on a bare field and must not claim to be. The pill is 10% ink over
  // that block, so the block's colour is what the contrast is measured against.
  const onChip = { kind: "prepared", color: cw.stops[1], alpha: 1 } as const;
  const line = { sizePct: 6, font: "modern", trackingPct: -0.08, color: cw.ink } as const;
  const quiet = { sizePct: 1.55, font: "support", opacity: 0.82, color: cw.ink } as const;
  const chip = { sizePct: 1.15, font: "mono", uppercase: true, trackingPct: 0.12, color: cw.ink } as const;

  const kicker = {
    text: "Opening night", sizePct: 1.25, font: "mono", uppercase: true,
    trackingPct: 0.3, color: cw.ink,
  } as const;
  const one = { ...line, weight: 400 as const, text: "Doors open" };
  const two = { ...line, weight: 700 as const, text: "at seven" };
  const s1 = { ...quiet, text: "Twelve seats at the counter." };
  const s2 = { ...quiet, text: "Booking by phone only." };
  const book = {
    text: "Reserve a table", sizePct: 1.2, font: "mono", uppercase: true,
    trackingPct: 0.2, color: cw.onAccent,
  } as const;

  const seal = { xPct: 76, yPct: 7, widthPct: 17, heightPct: 17 };
  const sealTurn = 11;
  const sealLabel = {
    text: "Walk-ins", sizePct: 1.1, font: "mono", uppercase: true,
    trackingPct: 0.12, color: cw.onAccent,
  } as const;
  const sealAnchor = rotateAbout(
    {
      xPct: centreOf(seal).xPct - estWidthPct(sealLabel) / 2,
      yPct: centreOf(seal).yPct - sealLabel.sizePct * 0.6,
    },
    centreOf(seal),
    sealTurn,
  );

  const chips: { icon: IconName; label: string; xPct: number; widthPct: number }[] = [
    { icon: "phone", label: "Booking by phone", xPct: 9, widthPct: 25 },
    { icon: "check", label: "Twelve seats", xPct: 37.5, widthPct: 21 },
    { icon: "bolt", label: "Kitchen till late", xPct: 62, widthPct: 25 },
  ];

  cmp.add(
    ...g.layers,
    scallopedSeal(seal, cw.accent, {
      rotation: sealTurn, bumps: 13, keyline: { color: cw.stops[0], width: 0.1 },
    }),
    solidPill({ xPct: 37, yPct: 46, widthPct: 26, heightPct: 6.4 }, cw.accent),
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
    { ...book, xPct: centerOn(37, 26, book), yPct: 48.2, on: { kind: "owned", colors: [cw.accent] } },
    ...chips.map((ch) => ({ ...chip, text: ch.label, xPct: ch.xPct + 6.4, yPct: 59.3, on: onChip })),
    { ...sealLabel, ...sealAnchor, rotation: sealTurn, on: { kind: "owned", colors: [cw.accent] } },
  );

  cmp.add(grain({ xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }, cw.ink, {
    opacity: 0.08, blend: "overlay", seed: 13, scale: 0.95,
  }));

  return {
    id: "pb_event_counter",
    name: "Counter",
    subject: "event",
    register: "soft",
    intent: "mid",
    ground: "blocked",
    groundNote: g.note,
    colourway: cw,
    headline: "Doors open",
    note: "Two flat blocks with the subject cut out and crossing the boundary; centred weight-split headline, a row of icon chips and a die-cut seal.",
    layers: cmp.layers,
    runs: cmp.runs,
  };
}

// ── 3. Culvert — editorial, dark, PHOTOGRAPHIC ground ────────────────────────
//
// Rebuilt from nothing. The version the owner saw was editorial-Swiss and was
// called basic and then old; what survives is the subject matter, not one line
// of the design. No grid, no hairline, no folio, no white column, no 4% type.
//
//   DEPTH       four planes: the photograph, the corner the template darkened,
//               a circle-cut detail lifted off it by its own glow, and the
//               stickers and chips over everything.
//   LUMINOSITY  a screen-blend flare across the top and a glow behind the
//               detail disc, so the light is in the scene.
//   SOFT GEO    a circular detail, pill chips, a scalloped seal, a halftone
//               patch. Nothing rectangular is visible except the frame.
//   DENSITY     label pill, two icon chips, a seal, a dot cluster, a halftone
//               patch, a detail disc.
//   SUBJECT     the photograph IS the ground, full bleed, at the largest size a
//               subject can be, with a second crop of it lifted off the surface.
//
// Headline 7%, three lines, the last one at 700 — a weight break rather than a
// size break, so the type block stays one shape.

function culvert(cw: Colourway): ProbeTemplate {
  const c = compose();
  const g = ground("photographic", cw);
  const on = g.on;
  const head = { sizePct: 7, font: "modern", trackingPct: -0.09, color: cw.ink } as const;
  const stand = { sizePct: 2.1, font: "support", opacity: 0.85, color: cw.ink } as const;
  const chipText = { sizePct: 1.1, font: "mono", uppercase: true, trackingPct: 0.12, color: cw.ink } as const;

  const seal = { xPct: 7, yPct: 74, widthPct: 18, heightPct: 18 };
  const sealTurn = -12;
  const sealLabel = {
    text: "No 214", sizePct: 1.15, font: "mono", uppercase: true,
    trackingPct: 0.15, color: cw.onAccent,
  } as const;
  const sealAnchor = rotateAbout(
    {
      xPct: centreOf(seal).xPct - estWidthPct(sealLabel) / 2,
      yPct: centreOf(seal).yPct - sealLabel.sizePct * 0.6,
    },
    centreOf(seal),
    sealTurn,
  );

  const chips: { icon: IconName; label: string; yPct: number; widthPct: number }[] = [
    { icon: "droplet", label: "Water desk", yPct: 52, widthPct: 24 },
    { icon: "check", label: "12 min read", yPct: 60, widthPct: 25 },
  ];

  c.add(
    ...g.layers,
    flare({ xPct: 30, yPct: -12, widthPct: 82, heightPct: 38 }, cw.accent, {
      blend: "screen", alpha: 0.34, coreAlpha: 0.5,
    }),
    halftone({ xPct: 62, yPct: 4, widthPct: 30, heightPct: 30 }, cw.accent, { opacity: 0.22, rings: 6 }),
    // A second crop of the same photograph, cut to a disc and lifted off the
    // ground by its own glow. This is the layer that gives an editorial page a
    // z-axis without a single box.
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
      text: "Reporting", sizePct: 1.15, font: "mono", uppercase: true, trackingPct: 0.2,
      color: cw.ink, xPct: 9.4, yPct: 10.4, on,
    },
    { ...head, weight: 400, text: "The river", xPct: 6, yPct: 17, on },
    { ...head, weight: 400, text: "under the", xPct: 6, yPct: 24.8, on },
    { ...head, weight: 700, text: "ring road", xPct: 6, yPct: 32.6, on },
    { ...stand, text: "Forty years after it was culverted,", xPct: 6, yPct: 43, on },
    { ...stand, text: "a city is digging it back up.", xPct: 6, yPct: 46, on },
    ...chips.map((ch) => ({ ...chipText, text: ch.label, xPct: 12.6, yPct: ch.yPct + 2.3, on })),
    { ...sealLabel, ...sealAnchor, rotation: sealTurn, on: { kind: "owned", colors: [cw.accent] } },
  );

  c.add(grain({ xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }, cw.ink, {
    opacity: 0.11, blend: "overlay", seed: 21, scale: 0.9,
  }));

  return {
    id: "pb_editorial_culvert",
    name: "Culvert",
    subject: "editorial",
    register: "soft",
    intent: "mid",
    ground: "photographic",
    groundNote: g.note,
    colourway: cw,
    headline: "The river",
    note: "The photograph is the ground; the type lives in a corner the template darkened, and a circle-cut detail of the same frame is lifted off it by a glow.",
    layers: c.layers,
    runs: c.runs,
  };
}

// ── 4. Bass Line — product, vibrant, GRADIENT ground ─────────────────────────
//
// Reference 1, answered directly, and the one template where the gradient is
// the ground — one of six, not the default.
//
//   DEPTH       flare, halftone disc, glow, cutout, chips: five planes.
//   LUMINOSITY  a lit mesh plus a screen-blend flare behind the subject.
//   SOFT GEO    discs, pills, a starburst. The only straight edges are frame.
//   DENSITY     four chips, two dot clusters, two x-marks, a sticker, a CTA,
//               a contact line with an icon.
//   SUBJECT     cut out, centred, huge, standing on its own glow.
//
// The cap-line is 11% — above the old set's 10% headline, and that is the
// argument rather than an accident: one element in six is allowed to be this
// size, so it reads as a decision.

function bassLine(cw: Colourway): ProbeTemplate {
  const c = compose();
  const g = ground("gradient", cw);
  const on = g.on;
  const chip = { sizePct: 1.15, font: "mono", uppercase: true, trackingPct: 0.12, color: cw.ink } as const;

  // Ink, not accentInk. A gradient ground can run through the accent's own hue —
  // in Sunset it literally ends there — and a coloured script over it measured
  // 1.49:1. On a mesh the only colour with a floor against every stop is the ink.
  const script = { text: "Special sale", sizePct: 5, font: "script", color: cw.ink } as const;
  const caps = {
    text: "Headphones", sizePct: 11, font: "impact", uppercase: true,
    trackingPct: -0.4, color: cw.ink,
  } as const;
  const order = {
    text: "Order now", sizePct: 1.35, font: "mono", uppercase: true,
    trackingPct: 0.25, color: cw.onAccent,
  } as const;

  const burst = { xPct: 76, yPct: 5, widthPct: 17, heightPct: 17 };
  const burstTurn = 14;
  const burstLabel = {
    text: "New", sizePct: 1.3, font: "mono", uppercase: true,
    trackingPct: 0.15, color: cw.onAccent,
  } as const;
  const burstAnchor = rotateAbout(
    {
      xPct: centreOf(burst).xPct - estWidthPct(burstLabel) / 2,
      yPct: centreOf(burst).yPct - burstLabel.sizePct * 0.6,
    },
    centreOf(burst),
    burstTurn,
  );

  const chips: { icon: IconName; label: string; xPct: number; yPct: number; widthPct: number }[] = [
    { icon: "droplet", label: "Water resistance", xPct: 2, yPct: 31, widthPct: 27 },
    { icon: "waveform", label: "Enhanced bass", xPct: 5, yPct: 47, widthPct: 24 },
    { icon: "mic", label: "Voice assistant", xPct: 68, yPct: 35, widthPct: 26 },
    { icon: "bolt", label: "Fast charging", xPct: 70, yPct: 51, widthPct: 24 },
  ];

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
    solidPill({ xPct: 66, yPct: 88.5, widthPct: 28, heightPct: 7 }, cw.accent),
    icon({ name: "phone", xPct: 5, yPct: 89.8, sizePct: 3.4 }, cw.ink, { weight: 1.9 }),
  );

  c.type(
    { ...script, xPct: centerOn(0, 100, script), yPct: 8.5, on },
    { ...caps, xPct: centerOn(0, 100, caps), yPct: 13.5, on },
    ...chips.map((ch) => ({ ...chip, text: ch.label, xPct: ch.xPct + 6.6, yPct: ch.yPct + 2.3, on })),
    { text: "+32 9 000 00 00", sizePct: 1.3, font: "mono", color: cw.ink, xPct: 9.6, yPct: 90.6, on },
    { ...order, xPct: centerOn(66, 28, order), yPct: 90.8, on: { kind: "owned", colors: [cw.accent] } },
    { ...burstLabel, ...burstAnchor, rotation: burstTurn, on: { kind: "owned", colors: [cw.accent] } },
  );

  c.add(grain({ xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }, cw.ink, {
    opacity: 0.15, blend: "overlay", seed: 11, scale: 0.85,
  }));

  return {
    id: "pb_product_bassline",
    name: "Bass Line",
    subject: "product",
    register: "vibrant",
    intent: "loud",
    ground: "gradient",
    groundNote: g.note,
    colourway: cw,
    headline: "Headphones",
    note: "Script over a heavy cap-line at 11%, a cutout hero on a lit mesh with a flare and a halftone disc behind it, four glass chips and a die-cut starburst.",
    layers: c.layers,
    runs: c.runs,
  };
}

// ── 5. Half Price — sale, vibrant, DUOTONE ground ────────────────────────────
//
// The ground is the photograph mapped into two of the colourway's hues, which
// is a look the system could not previously produce at all. Screen first,
// multiply last: multiply can only drive a field darker, so light type on it has
// a contrast floor whatever photograph a customer drops in.
//
//   DEPTH       duotone environment behind, product cut out in front, halftone
//               between them, chips over everything.
//   LUMINOSITY  the screen pass lifts the highlights into the accent hue, so
//               the picture glows rather than being tinted.
//   SOFT GEO    pill chips, a disc CTA, a scalloped seal, a dot cluster.
//   DENSITY     three chips, a seal, a dot cluster, an x-mark, a CTA.
//   SUBJECT     cut out, bleeding off the right edge, over its own glow.
//
// The cap-line is 12%, the loudest thing in the set, on a sale, where being the
// loudest thing in the room is the job.

function halfPrice(cw: Colourway): ProbeTemplate {
  const c = compose();
  const g = ground("duotone", cw);
  const on = g.on;
  const chip = { sizePct: 1.15, font: "mono", uppercase: true, trackingPct: 0.12, color: cw.ink } as const;
  // A translucent chip over a multiply wash. The wash's own bound still holds —
  // multiply can only drive the field darker, so contrast against the shadow
  // hue is a floor for every photograph — but `analyzeText` reads the pill as an
  // occluder and cannot model a translucent layer over a bounded wash. Declared
  // as the region it is, against the same colour the wash claim would use, so
  // the number is identical and the claim is true of the geometry.
  const onChip = { kind: "prepared", color: cw.surface, alpha: 1 } as const;

  const script = { text: "Weekend only", sizePct: 4.5, font: "script", color: cw.ink } as const;
  const caps = {
    text: "Half price", sizePct: 12, font: "impact", uppercase: true,
    trackingPct: -0.45, color: cw.ink,
  } as const;
  const shop = {
    text: "Shop the sale", sizePct: 1.3, font: "mono", uppercase: true,
    trackingPct: 0.22, color: cw.onAccent,
  } as const;

  const seal = { xPct: 30, yPct: 4, widthPct: 19, heightPct: 19 };
  const sealTurn = -10;
  const sealLabel = {
    text: "48h only", sizePct: 1.15, font: "mono", uppercase: true,
    trackingPct: 0.12, color: cw.onAccent,
  } as const;
  const sealAnchor = rotateAbout(
    {
      xPct: centreOf(seal).xPct - estWidthPct(sealLabel) / 2,
      yPct: centreOf(seal).yPct - sealLabel.sizePct * 0.6,
    },
    centreOf(seal),
    sealTurn,
  );

  const chips: { icon: IconName; label: string; yPct: number; widthPct: number }[] = [
    { icon: "bolt", label: "Fast charging", yPct: 20, widthPct: 24 },
    { icon: "check", label: "Two-year cover", yPct: 29, widthPct: 25 },
    { icon: "droplet", label: "Splash proof", yPct: 38, widthPct: 22 },
  ];

  c.add(
    ...g.layers,
    halftone({ xPct: 46, yPct: 6, widthPct: 52, heightPct: 52 }, cw.ink, {
      opacity: 0.2, blend: "screen", rings: 7,
    }),
    // Clear of the cap-line: a glow is an image layer, so where it overlaps a
    // run it becomes what that run sits on, and the wash claim stops being true.
    glow({ xPct: 54, yPct: 45, widthPct: 44, heightPct: 14 }, cw.accent, { alpha: 0.5 }),
    // Ends at 62%, above the cap-line rather than across it: at 12% the headline
    // is 51% wide and the two boxes overlapped, which made its wash claim false.
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
    solidPill({ xPct: 6, yPct: 87, widthPct: 26, heightPct: 7 }, cw.accent),
  );

  c.type(
    ...chips.map((ch) => ({ ...chip, text: ch.label, xPct: 11.5, yPct: ch.yPct + 2.2, on: onChip })),
    { ...script, xPct: 6, yPct: 57, on },
    { ...caps, xPct: 5, yPct: 62.5, on },
    {
      text: "Every charger, cable and dock until Sunday midnight.",
      sizePct: 1.6, font: "support", opacity: 0.9, color: cw.ink, xPct: 6, yPct: 79, on,
    },
    { ...shop, xPct: centerOn(6, 26, shop), yPct: 89.3, on: { kind: "owned", colors: [cw.accent] } },
    { ...sealLabel, ...sealAnchor, rotation: sealTurn, on: { kind: "owned", colors: [cw.accent] } },
  );

  c.add(grain({ xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }, cw.ink, {
    opacity: 0.14, blend: "overlay", seed: 17, scale: 0.85,
  }));

  return {
    id: "pb_sale_halfprice",
    name: "Half Price",
    subject: "sale",
    register: "vibrant",
    intent: "loud",
    ground: "duotone",
    groundNote: g.note,
    colourway: cw,
    headline: "Half price",
    note: "A duotone photograph as the ground, the product cut out in front of it bleeding off the right, chips stacked in a column and a die-cut seal.",
    layers: c.layers,
    runs: c.runs,
  };
}

// ── 6. Late Set — portrait, vibrant, TEXTURED ground ─────────────────────────
//
// The ground is a halftone field over a flat colour — texture as the surface
// itself rather than as an accent behind the subject — plus grain. Arranged on
// a diagonal: subject bleeding off the left, type block right, a torn strip of
// paper across the bottom.
//
//   DEPTH       flare, halftone ground, glow, cutout, torn paper laid over the
//               subject's feet, sticker over the paper. Six planes.
//   LUMINOSITY  a screen-blend flare and a screen halftone, so the texture is
//               lit rather than printed on.
//   SOFT GEO    starburst, pills, discs, and a ripped edge instead of a rule.
//   DENSITY     two chips, a starburst, a dot cluster, an x-mark, a CTA, a
//               micro-line on the paper.
//   SUBJECT     cut out, bleeding off the left edge, lifted by its own glow,
//               and the largest thing in the frame.

function lateSet(cw: Colourway): ProbeTemplate {
  const c = compose();
  const g = ground("textured", cw, { seed: 33 });
  const on = g.on;
  const onPaper = { kind: "owned", colors: [cw.ink] } as const;
  const chipText = { sizePct: 1.15, font: "mono", uppercase: true, trackingPct: 0.12, color: cw.ink } as const;

  const script = { text: "Live and late", sizePct: 4.6, font: "script", color: cw.accentInk } as const;
  const caps = {
    text: "Late Set", sizePct: 10.5, font: "impact", uppercase: true,
    trackingPct: -0.35, color: cw.ink,
  } as const;
  const tickets = {
    text: "Tickets", sizePct: 1.35, font: "mono", uppercase: true,
    trackingPct: 0.25, color: cw.onAccent,
  } as const;

  const burst = { xPct: 34, yPct: 60, widthPct: 19, heightPct: 19 };
  const burstTurn = -14;
  const burstLabel = {
    text: "On sale", sizePct: 1.2, font: "mono", uppercase: true,
    trackingPct: 0.15, color: cw.onAccent,
  } as const;
  const burstAnchor = rotateAbout(
    {
      xPct: centreOf(burst).xPct - estWidthPct(burstLabel) / 2,
      yPct: centreOf(burst).yPct - burstLabel.sizePct * 0.6,
    },
    centreOf(burst),
    burstTurn,
  );

  const chips: { icon: IconName; label: string; yPct: number; widthPct: number }[] = [
    { icon: "mic", label: "Nine live sets", yPct: 38, widthPct: 27 },
    { icon: "bolt", label: "Room two till four", yPct: 47, widthPct: 30 },
  ];

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
    solidPill({ xPct: 62, yPct: 60, widthPct: 30, heightPct: 7 }, cw.accent),
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
    { ...script, xPct: 54, yPct: 12, on },
    { ...caps, xPct: 53, yPct: 17.5, on },
    {
      text: "Three rooms, one ticket, doors at ten.",
      sizePct: 1.6, font: "support", opacity: 0.9, color: cw.ink, xPct: 53.5, yPct: 30.5, on,
    },
    ...chips.map((ch) => ({ ...chipText, text: ch.label, xPct: 59.6, yPct: ch.yPct + 2.4, on })),
    { ...tickets, xPct: centerOn(62, 30, tickets), yPct: 62.3, on: { kind: "owned", colors: [cw.accent] } },
    { ...burstLabel, ...burstAnchor, rotation: burstTurn, on: { kind: "owned", colors: [cw.accent] } },
    {
      text: "Fri 26 Sep / The old print works / 22:00",
      sizePct: 1.35, font: "mono", uppercase: true, trackingPct: 0.1,
      color: cw.stops[0], xPct: 6, yPct: 93.4, on: onPaper,
    },
  );

  return {
    id: "pb_portrait_lateset",
    name: "Late Set",
    subject: "portrait",
    register: "vibrant",
    intent: "loud",
    ground: "textured",
    groundNote: g.note,
    colourway: cw,
    headline: "Late Set",
    note: "A halftone field as the ground: subject cut out and bleeding off the left over a flare, type block right, torn paper across the bottom.",
    layers: c.layers,
    runs: c.runs,
  };
}

/** The six layouts, with the colourway each ships as and the registers each can
 *  take. `accepts` is what the sweep's matrix is built from — a layout that only
 *  renders in one colourway would be carrying colour assumptions it should not,
 *  and the matrix is what makes that visible. */
export const LAYOUTS: Layout[] = [
  { id: "pb_product_soundpro", name: "Sound Pro", ground: "flat", accepts: ["soft"], defaultColourway: "sorbet", build: soundPro },
  { id: "pb_event_counter", name: "Counter", ground: "blocked", accepts: ["soft"], defaultColourway: "peachsky", build: counter },
  { id: "pb_editorial_culvert", name: "Culvert", ground: "photographic", accepts: ["vibrant", "dark"], defaultColourway: "slate", build: culvert },
  { id: "pb_product_bassline", name: "Bass Line", ground: "gradient", accepts: ["vibrant", "dark"], defaultColourway: "blurple", build: bassLine },
  { id: "pb_sale_halfprice", name: "Half Price", ground: "duotone", accepts: ["vibrant", "dark"], defaultColourway: "sunset", build: halfPrice },
  { id: "pb_portrait_lateset", name: "Late Set", ground: "textured", accepts: ["vibrant", "dark"], defaultColourway: "ember", build: lateSet },
];

/** One layout in one colourway. */
export function buildProbe(layout: Layout, cw: Colourway = colourway(layout.defaultColourway)): ProbeTemplate {
  return layout.build(cw);
}

/** Every colourway a layout renders correctly in. */
export function colourwaysForLayout(layout: Layout): Colourway[] {
  return colourwaysFor(layout.accepts);
}

/** The six as they ship. */
export const PROBE_TEMPLATES: ProbeTemplate[] = LAYOUTS.map((l) => buildProbe(l));

/** Reference points for reading the headline sizes above. */
export const HEADLINE_REFERENCE = {
  /** What the rejected set shipped, from `TYPE_STEPS.headline` at 80px. */
  rejectedHeadline: (80 / REFERENCE_WIDTH) * 100,
  /** And its display step, at 112px. */
  rejectedDisplay: (112 / REFERENCE_WIDTH) * 100,
  /** Where the owner's taste actually sits, once "the text is too big" turned
   *  out to mean "make it designed" rather than "make it smaller". */
  approved: [6, 12] as const,
};
