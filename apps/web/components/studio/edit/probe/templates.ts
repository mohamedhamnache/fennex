/** Six compositions, built before thirty-four.
 *
 *  The last two sets were built whole and then judged, so "I don't like it"
 *  meant discarding a night's work. These six exist to be judged instead, and
 *  they answer the two reference designs the owner supplied — which are ground
 *  truth about taste in a way no trend reading is:
 *
 *    reference 1, vibrant   Bass Line 11.00%   Half Price 12.00%   (loud)
 *    reference 2, soft      Sound Pro  6.50%   Counter     6.00%   (mid)
 *    extending              Culvert    4.25%   Small Batch 3.40%   (quiet)
 *
 *  The percentages are headline size as a fraction of canvas width, which is
 *  what "the text looks very big" was about: the rejected set could only set a
 *  headline at 10.0% and a display at 14.0%, and four of these six are quieter
 *  than anything it could express. The two that are louder are louder because a
 *  sale and a product promo should be, and because one loud element in six
 *  reads as a decision where six loud elements read as a setting.
 *
 *  Both references share two things worth stating plainly. NEITHER puts type on
 *  an opaque box: both set it directly on a gradient the design owns, which is
 *  exactly the freedom the spec unlocked. And reference 2 builds its whole
 *  headline hierarchy out of WEIGHT at a constant size, which the old system had
 *  no vocabulary for — four sizes, one weight, everywhere.
 *
 *  Rules that still hold, because they are correctness rather than taste:
 *  colours come from palette roles and never from literals; no string names a
 *  product of ours; every template places the edited photo; and across the six,
 *  the renderer's blend, rotation, non-rounded-rect clip and cutout are all
 *  exercised.
 *
 *  Rules that no longer hold, because they were making good design impossible:
 *  the four-rung type ladder, the 5:1 headline-to-support ratio, and `panel()`
 *  as the only way to produce a word.
 */

import type { TemplateLayerDef } from "../text-templates";
import { resolvePalette } from "../palette";
import { REFERENCE_WIDTH, cutout, photo } from "../families";
import {
  type RunSpec, centerOn, compose, field, hueShift, rule, tint,
} from "./type";
import {
  type IconName, dotCluster, cross, ghostPill, glassPill, glow, halftone, icon, mesh, solidPill,
} from "./vector";

export interface ProbeTemplate {
  id: string;
  name: string;
  /** What it is for. The six span a deliberate range of jobs. */
  subject: "product" | "editorial" | "event" | "quote" | "sale" | "portrait";
  /** Which of the owner's two reference designs this one answers to.
   *
   *  `vibrant` is reference 1: a mesh background, a script line over a heavy
   *  cap-line, a cutout hero with a glow, scattered glass feature chips with
   *  icons, dot clusters and a solid CTA. `soft` is reference 2: pastel mesh,
   *  a two-line headline separated by WEIGHT at a constant size, two CTAs
   *  (one solid, one ghost), a cutout bleeding past the edge, and a great deal
   *  of air. `own` extends the language rather than copying either. */
  register: "vibrant" | "soft" | "own";
  /** How loud it is meant to be, so the sizes below can be read against intent
   *  rather than against each other. */
  intent: "quiet" | "mid" | "loud";
  /** The run that answers "how big is the headline". Must match a run's text. */
  headline: string;
  /** The arrangement, in one line. */
  note: string;
  layers: TemplateLayerDef[];
  runs: RunSpec[];
}

/** Headline size as a percentage of canvas width.
 *
 *  The number the rejected set is being judged on. The four-rung ladder put
 *  every headline at 10.0% and every display at 14.0%; editorial work sets a
 *  headline at 4-6%. Returns null when `headline` names no run, which is a
 *  bookkeeping error rather than a design one and is reported as a failure. */
export function headlinePct(t: ProbeTemplate): number | null {
  return t.runs.find((r) => r.text === t.headline)?.sizePct ?? null;
}

/** Largest type size in the composition, ornaments included. */
export function loudestPct(t: ProbeTemplate): number {
  return Math.max(...t.runs.map((r) => r.sizePct));
}

// ── 1. Small Batch — product, quiet ──────────────────────────────────────────
//
// The photograph does the selling and the type stays out of its way. It is
// trimmed off-centre with a rectangular inset so the frame it sits in is not
// the frame of the canvas, and everything written sits in the sixth of the
// canvas below it: a label, a name at 3.4%, two lines of specifics, and a price
// ranged right where a shelf ticket would put it.
//
// Headline 3.4% — a third of what the rejected set could go down to. Hierarchy
// here is weight and colour, not scale: the name is the only 700 in the
// composition and the only run at full ink.

function smallBatch(): ProbeTemplate {
  const p = resolvePalette("ecommerce");
  const c = compose();
  const onField = { kind: "field", color: p.surface } as const;

  c.add(
    field({ color: p.surface, xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }),
    photo({ xPct: 0, yPct: 0, widthPct: 100, heightPct: 64, clip: { insetPct: [0, 18, 0, 0] } }),
    rule(p.accent, 6, 69.5, 13, 0.28),
  );

  c.type(
    {
      text: "No. 04 / Candle",
      sizePct: 1.25, font: "mono", uppercase: true, trackingPct: 0.15,
      color: p.accentInk, xPct: 6, yPct: 72.5, on: onField,
    },
    {
      text: "Sea Salt and Cedar",
      sizePct: 3.4, font: "modern", weight: 700, trackingPct: -0.06,
      color: p.ink, xPct: 6, yPct: 76, on: onField,
    },
    {
      text: "Poured in small batches in Ghent.",
      sizePct: 1.55, font: "support", opacity: 0.78,
      color: p.ink, xPct: 6, yPct: 83.4, on: onField,
    },
    {
      text: "Nine hours of burn, and a wick we trim by hand.",
      sizePct: 1.55, font: "support", opacity: 0.78,
      color: p.ink, xPct: 6, yPct: 85.7, on: onField,
    },
    {
      text: "EUR 38",
      sizePct: 1.9, font: "mono", trackingPct: 0.04,
      color: p.accentInk, xPct: 85.5, yPct: 76.8, on: onField,
    },
  );

  return {
    id: "pb_product_smallbatch",
    name: "Small Batch",
    subject: "product",
    register: "own",
    intent: "quiet",
    headline: "Sea Salt and Cedar",
    note: "Photo trimmed off-centre with an inset clip; type demoted to a shelf caption under it.",
    layers: c.layers,
    runs: c.runs,
  };
}

// ── 2. Culvert — editorial, quiet ────────────────────────────────────────────
//
// The opposite arrangement to Small Batch: the type owns the frame and the
// photograph is pushed to a plate that bleeds off two edges, so it reads as a
// window rather than as a picture that has been placed. A single accent
// hairline holds the column against it, and a folio runs vertically down the
// outer margin.
//
// Headline 4.25% — the bottom of the editorial range — set over three lines,
// which is what makes it read as a headline rather than a slogan. The
// standfirst is the same face at half the size and 78% ink, and the hierarchy
// between them is weight (700 against 400) and colour, not scale: 2:1, where
// the rejected set's ladder could only express 5:1.

function culvert(): ProbeTemplate {
  const p = resolvePalette("blog");
  const c = compose();
  const onField = { kind: "field", color: p.surface } as const;
  const head = { sizePct: 4.25, font: "modern", weight: 700, trackingPct: -0.075, color: p.ink } as const;
  const stand = { sizePct: 2.15, font: "support", opacity: 0.78, color: p.ink } as const;

  c.add(
    field({ color: p.surface, xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 }),
    photo({ xPct: 58, yPct: 12, widthPct: 46, heightPct: 92 }),
    field({ color: p.accent, xPct: 53, yPct: 12, widthPct: 0.28, heightPct: 74 }),
  );

  c.type(
    {
      text: "Reporting / Water",
      sizePct: 1.15, font: "mono", uppercase: true, trackingPct: 0.2,
      color: p.accentInk, xPct: 8, yPct: 14, on: onField,
    },
    { ...head, text: "The River That", xPct: 8, yPct: 18.5, on: onField },
    { ...head, text: "Runs Under the", xPct: 8, yPct: 23.3, on: onField },
    { ...head, text: "Ring Road", xPct: 8, yPct: 28.1, on: onField },
    { ...stand, text: "Forty years after it was culverted, a", xPct: 8, yPct: 35, on: onField },
    { ...stand, text: "city is digging its river back up. What", xPct: 8, yPct: 38, on: onField },
    { ...stand, text: "that costs, and who pays for it.", xPct: 8, yPct: 41, on: onField },
    {
      text: "By the water desk / 12 min read",
      sizePct: 1.15, font: "mono", trackingPct: 0.1,
      color: p.accentInk, xPct: 8, yPct: 47.5, on: onField,
    },
    {
      // Down the outer margin, reading bottom to top. The fit guard measures
      // the rotated footprint, so this still has to sit inside the frame.
      text: "No 214",
      sizePct: 1.15, font: "mono", uppercase: true, trackingPct: 0.2, rotation: -90,
      color: p.ink, opacity: 0.72, xPct: 3.4, yPct: 86, on: onField,
    },
  );

  return {
    id: "pb_editorial_culvert",
    name: "Culvert",
    subject: "editorial",
    register: "own",
    intent: "quiet",
    headline: "The River That",
    note: "Type owns the frame; the photograph is a plate bleeding off two edges, held by one hairline. Folio set vertically in the margin.",
    layers: c.layers,
    runs: c.runs,
  };
}

// ── 3. Sound Pro — product, soft register, mid ───────────────────────────────
//
// Reference 2, answered directly. Its headline is two lines AT THE SAME SIZE
// separated by weight alone, which is the one hierarchy the old system could
// not express at all: `TYPE_STEPS` had four sizes and every template used a
// single weight, so "same size, different weight" had no vocabulary. Here it is
// 6.5% at 400 over 6.5% at 700 — and the 700 is a real Inter 700, which the
// document only started loading in the commit before this one.
//
// Everything else follows the reference: a pastel mesh the template owns rather
// than an opaque field, a mark-plus-label lockup top left, a primary and a
// secondary CTA side by side, the product cut out and bleeding past the right
// edge over its own soft glow, and more air than type.

function soundPro(): ProbeTemplate {
  const p = resolvePalette("blog");
  const c = compose();
  // Mint, cream and blush, all derived from the one accent the palette carries:
  // a brand kit moves the whole field rather than breaking it.
  const mint = tint(hueShift(p.accent, -67), 0.82);
  const cream = tint(hueShift(p.accent, -150), 0.9);
  const blush = tint(hueShift(p.accent, 120), 0.85);
  const on = { kind: "owned", colors: [mint, cream, blush] } as const;
  const onAccentPill = { kind: "owned", colors: [p.accent] } as const;
  const line = { sizePct: 6.5, font: "modern", trackingPct: -0.1, color: p.ink } as const;
  const quiet = { sizePct: 1.65, font: "support", opacity: 0.8, color: p.ink } as const;
  const cta = { sizePct: 1.3, font: "mono", uppercase: true, trackingPct: 0.2 } as const;

  const buy = { ...cta, text: "Buy now", color: p.onAccent };
  const compare = { ...cta, text: "Compare", color: p.ink };

  c.add(
    mesh(
      { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 },
      [mint, cream, blush],
      [
        { color: mint, x: 0.15, y: 0.2, r: 0.5, alpha: 0.75 },
        { color: blush, x: 0.85, y: 0.75, r: 0.55, alpha: 0.7 },
      ],
      100,
    ),
    solidPill({ xPct: 6, yPct: 7, widthPct: 3, heightPct: 3 }, p.accent),
    glow({ xPct: 52, yPct: 72, widthPct: 46, heightPct: 13 }, p.accent, { alpha: 0.4 }),
    cutout({ xPct: 52, yPct: 16, widthPct: 56, heightPct: 72, fit: "contain" }),
    solidPill({ xPct: 6, yPct: 57, widthPct: 20, heightPct: 7 }, p.accent),
    ghostPill({ xPct: 29, yPct: 57, widthPct: 22, heightPct: 7 }, p.ink, { weight: 0.05 }),
  );

  c.type(
    {
      text: "Audio",
      sizePct: 1.2, font: "mono", uppercase: true, trackingPct: 0.25,
      color: p.ink, xPct: 10.5, yPct: 7.9, on,
    },
    { ...line, weight: 400, text: "Sound Pro", xPct: 6, yPct: 26, on },
    { ...line, weight: 700, text: "A56 Headset", xPct: 6, yPct: 34.2, on },
    { ...quiet, text: "Forty hours between charges, and a case", xPct: 6, yPct: 45, on },
    { ...quiet, text: "that charges from the same cable.", xPct: 6, yPct: 47.6, on },
    { ...buy, xPct: centerOn(6, 20, buy), yPct: 59.4, on: onAccentPill },
    { ...compare, xPct: centerOn(29, 22, compare), yPct: 59.4, on },
  );

  return {
    id: "pb_product_soundpro",
    name: "Sound Pro",
    subject: "product",
    register: "soft",
    intent: "mid",
    headline: "Sound Pro",
    note: "Reference 2: two headline lines at one size separated by weight alone, on a pastel mesh, with a primary and a ghost CTA and the cutout bleeding past the right edge.",
    layers: c.layers,
    runs: c.runs,
  };
}

// ── 4. Counter — event, soft register, mid ───────────────────────────────────
//
// The soft register again, arranged the other way: symmetrical rather than
// ranged left, the cutout dropped off the BOTTOM edge instead of the right, and
// the feature chips promoted from decoration to the middle of the composition.
// Same two-line weight hierarchy, one size smaller, so the two soft templates
// are the same language and not the same layout.
//
// The chips are the reference-1 vocabulary item — an icon paired with a short
// label on a translucent pill — used in the soft register, which is the test of
// whether the vocabulary travels.

function counter(): ProbeTemplate {
  const p = resolvePalette("promo");
  const cmp = compose();
  const cream = tint(p.accent, 0.86);
  const sage = tint(hueShift(p.accent, 75), 0.84);
  const peach = tint(hueShift(p.accent, -40), 0.82);
  const on = { kind: "owned", colors: [cream, sage, peach] } as const;
  const onPill = { kind: "owned", colors: [p.accent] } as const;
  const line = { sizePct: 6, font: "modern", trackingPct: -0.08, color: p.surface } as const;
  const quiet = { sizePct: 1.55, font: "support", opacity: 0.82, color: p.surface } as const;
  const chip = { sizePct: 1.15, font: "mono", uppercase: true, trackingPct: 0.12, color: p.surface } as const;

  const kicker = {
    text: "Opening night", sizePct: 1.25, font: "mono", uppercase: true,
    trackingPct: 0.3, color: p.surface,
  } as const;
  const one = { ...line, weight: 400 as const, text: "Doors open" };
  const two = { ...line, weight: 700 as const, text: "at seven" };
  const s1 = { ...quiet, text: "Twelve seats at the counter." };
  const s2 = { ...quiet, text: "Booking by phone only." };
  const book = {
    text: "Reserve a table", sizePct: 1.2, font: "mono", uppercase: true,
    trackingPct: 0.2, color: p.onAccent,
  } as const;

  const chips: { icon: IconName; label: string; xPct: number; widthPct: number }[] = [
    { icon: "phone", label: "Booking by phone", xPct: 9, widthPct: 25 },
    { icon: "check", label: "Twelve seats", xPct: 37.5, widthPct: 21 },
    { icon: "bolt", label: "Kitchen till late", xPct: 62, widthPct: 25 },
  ];

  cmp.add(
    mesh(
      { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 },
      [sage, cream, peach],
      [
        { color: peach, x: 0.5, y: 0.9, r: 0.6, alpha: 0.7 },
        { color: sage, x: 0.1, y: 0.1, r: 0.45, alpha: 0.6 },
      ],
      30,
    ),
    solidPill({ xPct: 37, yPct: 46, widthPct: 26, heightPct: 6.4 }, p.accent),
    ...chips.flatMap((ch) => [
      glassPill({ xPct: ch.xPct, yPct: 57, widthPct: ch.widthPct, heightPct: 6 }, p.surface, p.surface, {
        fillAlpha: 0.1, borderAlpha: 0.3,
      }),
      icon({ name: ch.icon, xPct: ch.xPct + 1.8, yPct: 58.3, sizePct: 3.4 }, p.surface, { weight: 1.9 }),
    ]),
    glow({ xPct: 24, yPct: 68, widthPct: 52, heightPct: 14 }, p.accent, { alpha: 0.45 }),
    cutout({ xPct: 22, yPct: 64, widthPct: 56, heightPct: 44, fit: "contain" }),
  );

  cmp.type(
    { ...kicker, xPct: centerOn(0, 100, kicker), yPct: 13, on },
    { ...one, xPct: centerOn(0, 100, one), yPct: 19, on },
    { ...two, xPct: centerOn(0, 100, two), yPct: 27.2, on },
    { ...s1, xPct: centerOn(0, 100, s1), yPct: 37, on },
    { ...s2, xPct: centerOn(0, 100, s2), yPct: 39.6, on },
    { ...book, xPct: centerOn(37, 26, book), yPct: 48.2, on: onPill },
    ...chips.map((ch) => ({
      ...chip, text: ch.label, xPct: ch.xPct + 6.4, yPct: 59.3, on,
    })),
  );

  return {
    id: "pb_event_counter",
    name: "Counter",
    subject: "event",
    register: "soft",
    intent: "mid",
    headline: "Doors open",
    note: "Soft register, symmetrical: the weight-split headline centred, a row of icon chips through the middle, and the cutout dropped off the bottom edge over a glow.",
    layers: cmp.layers,
    runs: cmp.runs,
  };
}

// ── 5. Bass Line — product, vibrant register, loud ───────────────────────────
//
// Reference 1, answered directly and deliberately loudly. The cap-line is 11%
// of canvas width — above the rejected set's 10% headline — and that is the
// argument, not an accident: ONE element in six is allowed to be this size, so
// it reads as a decision. The other five sit between 3.4% and 6.5%.
//
// The two-part headline is the reference's: a script line at roughly a third
// the size, set to overlap the cap-line optically. Caveat is loaded for exactly
// this and used exactly once in the six.
//
// Behind the cutout, a halftone disc in screen blend — printed texture over a
// mesh, which is the one blend mode that can only lighten and therefore cannot
// swallow the type sitting near it. Four glass chips are scattered around the
// product, aligned to the frame rather than tilted: in the reference they are
// square to the edge, and rotating them would have been our idea, not theirs.

function bassLine(): ProbeTemplate {
  const p = resolvePalette("social");
  const c = compose();
  const violet = hueShift(p.surface, -25);
  const magenta = hueShift(p.surface, 55);
  const on = { kind: "owned", colors: [violet, p.surface, magenta] } as const;
  const onPill = { kind: "owned", colors: [p.accent] } as const;
  const chip = { sizePct: 1.15, font: "mono", uppercase: true, trackingPct: 0.12, color: p.ink } as const;

  const script = {
    text: "Special sale", sizePct: 5, font: "script", color: p.accentInk,
  } as const;
  const caps = {
    text: "Headphones", sizePct: 11, font: "impact", uppercase: true,
    trackingPct: -0.4, color: p.ink,
  } as const;
  const order = {
    text: "Order now", sizePct: 1.35, font: "mono", uppercase: true,
    trackingPct: 0.25, color: p.onAccent,
  } as const;

  const chips: { icon: IconName; label: string; xPct: number; yPct: number; widthPct: number }[] = [
    { icon: "droplet", label: "Water resistance", xPct: 2, yPct: 31, widthPct: 27 },
    { icon: "waveform", label: "Enhanced bass", xPct: 5, yPct: 47, widthPct: 24 },
    { icon: "mic", label: "Voice assistant", xPct: 68, yPct: 35, widthPct: 26 },
    { icon: "bolt", label: "Fast charging", xPct: 70, yPct: 51, widthPct: 24 },
  ];

  c.add(
    mesh(
      { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 },
      [violet, p.surface, magenta],
      [
        { color: magenta, x: 0.78, y: 0.24, r: 0.55, alpha: 0.55 },
        { color: violet, x: 0.2, y: 0.78, r: 0.6, alpha: 0.5 },
      ],
      150,
    ),
    halftone({ xPct: 22, yPct: 26, widthPct: 56, heightPct: 56 }, p.ink, {
      opacity: 0.22, blend: "screen", rings: 8,
    }),
    dotCluster({ xPct: 4, yPct: 7, widthPct: 8, heightPct: 11 }, p.ink, 3, 4, { opacity: 0.5 }),
    dotCluster({ xPct: 88, yPct: 80, widthPct: 8, heightPct: 11 }, p.ink, 3, 4, { opacity: 0.5 }),
    cross({ xPct: 84, yPct: 15, widthPct: 3.6, heightPct: 3.6 }, p.accentInk, { opacity: 0.9 }),
    cross({ xPct: 9, yPct: 74, widthPct: 3, heightPct: 3 }, p.accentInk, { opacity: 0.75 }),
    glow({ xPct: 26, yPct: 64, widthPct: 48, heightPct: 15 }, p.accent, { alpha: 0.5 }),
    cutout({ xPct: 24, yPct: 22, widthPct: 52, heightPct: 54, fit: "contain" }),
    ...chips.flatMap((ch) => [
      glassPill({ xPct: ch.xPct, yPct: ch.yPct, widthPct: ch.widthPct, heightPct: 6.6 }, p.ink, p.ink, {
        fillAlpha: 0.16, borderAlpha: 0.4,
      }),
      icon({ name: ch.icon, xPct: ch.xPct + 2, yPct: ch.yPct + 1.4, sizePct: 3.8 }, p.ink, { weight: 1.9 }),
    ]),
    solidPill({ xPct: 66, yPct: 88.5, widthPct: 28, heightPct: 7 }, p.accent),
    icon({ name: "phone", xPct: 5, yPct: 89.8, sizePct: 3.4 }, p.ink, { weight: 1.9 }),
  );

  c.type(
    { ...script, xPct: centerOn(0, 100, script), yPct: 8.5, on },
    { ...caps, xPct: centerOn(0, 100, caps), yPct: 13.5, on },
    ...chips.map((ch) => ({
      ...chip, text: ch.label, xPct: ch.xPct + 6.6, yPct: ch.yPct + 2.3, on,
    })),
    {
      text: "+32 9 000 00 00", sizePct: 1.3, font: "mono", color: p.ink,
      xPct: 9.6, yPct: 90.6, on,
    },
    { ...order, xPct: centerOn(66, 28, order), yPct: 90.8, on: onPill },
  );

  return {
    id: "pb_product_bassline",
    name: "Bass Line",
    subject: "product",
    register: "vibrant",
    intent: "loud",
    headline: "Headphones",
    note: "Reference 1: script over a heavy cap-line at 11%, a cutout hero on a halftone disc and its own glow, four glass chips scattered around it, dot clusters and a solid CTA.",
    layers: c.layers,
    runs: c.runs,
  };
}

// ── 6. Half Price — sale, vibrant register, loud ─────────────────────────────
//
// The vibrant register arranged against itself: the lockup falls to the bottom
// left instead of centring at the top, the cutout takes the right half and
// bleeds off the edge, and the chips stack in a column rather than scattering.
// Same vocabulary, no shared geometry — which is the thing the previous set
// failed at when it shipped seven pairs that were one composition with
// different words.
//
// The cap-line is 12%, the loudest thing in the six, on a sale, where being the
// loudest thing is the job.

function halfPrice(): ProbeTemplate {
  const p = resolvePalette("ecommerce");
  const c = compose();
  const indigo = hueShift(p.surface, -20);
  const rose = hueShift(p.accent, -12);
  // The base gradient runs bottom-left to top-right (see the angle below), so
  // the rose end sits under the cutout and the type never meets it. A run only
  // names the stops it can actually reach: measuring every run against every
  // stop in the mesh would report a warning for a colour that is nowhere near
  // it, and a warning nobody can act on is how a warning column stops being
  // read at all.
  const on = { kind: "owned", colors: [indigo, p.surface] } as const;
  const onPill = { kind: "owned", colors: [p.accent] } as const;
  const chip = { sizePct: 1.15, font: "mono", uppercase: true, trackingPct: 0.12, color: p.ink } as const;

  const script = { text: "Weekend only", sizePct: 4.5, font: "script", color: p.accentInk } as const;
  const caps = {
    text: "Half price", sizePct: 12, font: "impact", uppercase: true,
    trackingPct: -0.45, color: p.ink,
  } as const;
  const shop = {
    text: "Shop the sale", sizePct: 1.3, font: "mono", uppercase: true,
    trackingPct: 0.22, color: p.onAccent,
  } as const;

  const chips: { icon: IconName; label: string; yPct: number; widthPct: number }[] = [
    { icon: "bolt", label: "Fast charging", yPct: 20, widthPct: 24 },
    { icon: "check", label: "Two-year cover", yPct: 29, widthPct: 25 },
    { icon: "droplet", label: "Splash proof", yPct: 38, widthPct: 22 },
  ];

  c.add(
    mesh(
      { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 },
      [indigo, p.surface, rose],
      [
        { color: rose, x: 0.82, y: 0.7, r: 0.6, alpha: 0.5 },
        { color: indigo, x: 0.1, y: 0.15, r: 0.5, alpha: 0.55 },
      ],
      45,
    ),
    halftone({ xPct: 46, yPct: 6, widthPct: 52, heightPct: 52 }, p.ink, {
      opacity: 0.2, blend: "screen", rings: 7,
    }),
    glow({ xPct: 50, yPct: 60, widthPct: 46, heightPct: 14 }, p.accent, { alpha: 0.45 }),
    cutout({ xPct: 44, yPct: 10, widthPct: 62, heightPct: 62, fit: "contain" }),
    ...chips.flatMap((ch) => [
      glassPill({ xPct: 5, yPct: ch.yPct, widthPct: ch.widthPct, heightPct: 6.4 }, p.ink, p.ink, {
        fillAlpha: 0.16, borderAlpha: 0.4,
      }),
      icon({ name: ch.icon, xPct: 6.9, yPct: ch.yPct + 1.3, sizePct: 3.7 }, p.ink, { weight: 1.9 }),
    ]),
    dotCluster({ xPct: 5, yPct: 6, widthPct: 8, heightPct: 11 }, p.ink, 3, 4, { opacity: 0.5 }),
    cross({ xPct: 37, yPct: 51, widthPct: 3.2, heightPct: 3.2 }, p.accentInk, { opacity: 0.85 }),
    solidPill({ xPct: 6, yPct: 87, widthPct: 26, heightPct: 7 }, p.accent),
  );

  c.type(
    ...chips.map((ch) => ({
      ...chip, text: ch.label, xPct: 11.5, yPct: ch.yPct + 2.2, on,
    })),
    { ...script, xPct: 6, yPct: 57, on },
    { ...caps, xPct: 5, yPct: 62.5, on },
    {
      text: "Every charger, cable and dock until Sunday midnight.",
      sizePct: 1.6, font: "support", opacity: 0.85, color: p.ink,
      xPct: 6, yPct: 79, on,
    },
    { ...shop, xPct: centerOn(6, 26, shop), yPct: 89.3, on: onPill },
  );

  return {
    id: "pb_sale_halfprice",
    name: "Half Price",
    subject: "sale",
    register: "vibrant",
    intent: "loud",
    headline: "Half price",
    note: "Vibrant register turned on its side: lockup bottom left at 12%, cutout bleeding off the right over a halftone disc, chips stacked in a column.",
    layers: c.layers,
    runs: c.runs,
  };
}

export const PROBE_TEMPLATES: ProbeTemplate[] = [
  smallBatch(),
  culvert(),
  soundPro(),
  counter(),
  bassLine(),
  halfPrice(),
];

/** Reference points for reading the headline sizes above. */
export const HEADLINE_REFERENCE = {
  /** What the rejected set shipped, from `TYPE_STEPS.headline` at 80px. */
  rejectedHeadline: (80 / REFERENCE_WIDTH) * 100,
  /** And its display step, at 112px. */
  rejectedDisplay: (112 / REFERENCE_WIDTH) * 100,
  /** Where editorial work usually sets a headline. */
  editorial: [4, 6] as const,
};
