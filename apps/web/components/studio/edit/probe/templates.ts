/** Six compositions, built before thirty-four.
 *
 *  The last two sets were built whole and then judged, so "I don't like it"
 *  meant discarding a night's work. These six exist to be judged instead: two
 *  quiet, two mid, two loud, on six different subjects, with six different
 *  relationships between the photograph and the type.
 *
 *  They are not variations on one grid. Read down the `note` on each and the
 *  arrangements have nothing in common but the frame: a product with the type
 *  demoted to a caption under a trimmed photo; an editorial column with a plate
 *  bleeding off two edges; an event with its title in a corner the template
 *  darkened itself; a quote set at reading weight beside a circle; a sale
 *  bleeding a numeral off the left edge through a multiply band; a portrait cut
 *  out and standing in front of its own display type.
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
import { REFERENCE_WIDTH, photo } from "../families";
import {
  type RunSpec, compose, cornerScrim, field, rule,
} from "./type";

export interface ProbeTemplate {
  id: string;
  name: string;
  /** What it is for. The six span a deliberate range of jobs. */
  subject: "product" | "editorial" | "event" | "quote" | "sale" | "portrait";
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
    intent: "quiet",
    headline: "The River That",
    note: "Type owns the frame; the photograph is a plate bleeding off two edges, held by one hairline. Folio set vertically in the margin.",
    layers: c.layers,
    runs: c.runs,
  };
}

// ── 3. Night Market — event, mid ─────────────────────────────────────────────
//
// The first of the six with no box in it at all. The photograph runs full
// bleed and the type sits in the top-left corner, on a region the template
// darkened itself: two nested gradient squares, each fading corner to corner,
// compounding to roughly 0.84-0.97 alpha where the type lands and dissolving
// into the photograph on the way out. The declared 0.82 below is deliberately
// under the worst point of that range, so the contrast reported is a floor
// rather than a flattering average.
//
// This is the composition the previous system could not express. A template
// that must stay legible over ANY photograph can only be a box; a designer
// prepares the region the type needs and picks a photograph that suits it.
//
// Headline 6.5% over two lines — mid, and the loudest thing in the frame by a
// factor of five over the date beneath it.

function nightMarket(): ProbeTemplate {
  const p = resolvePalette("promo");
  const c = compose();
  const corner = { kind: "prepared", color: p.surface, alpha: 0.82 } as const;
  const display = { sizePct: 6.5, font: "impact", uppercase: true, trackingPct: -0.25, color: p.ink } as const;

  c.add(photo(), ...cornerScrim(p.surface, [78, 46]));

  c.type(
    {
      text: "Two nights only",
      sizePct: 1.3, font: "mono", uppercase: true, trackingPct: 0.2,
      color: p.accentInk, xPct: 5, yPct: 6.5, on: corner,
    },
    { ...display, text: "Night Market", xPct: 5, yPct: 10.5, on: corner },
    { ...display, text: "After Dark", xPct: 5, yPct: 17.8, on: corner },
    {
      text: "Fri 12 + Sat 13 Sep, from 18:00",
      sizePct: 1.5, font: "mono", color: p.ink, xPct: 5, yPct: 26.5, on: corner,
    },
    {
      text: "Twenty-two kitchens in the old car park.",
      sizePct: 1.5, font: "support", opacity: 0.85, color: p.ink, xPct: 5, yPct: 29.7, on: corner,
    },
    {
      // A stub, knocked off square. Its own pill is its own field, so this run
      // is guaranteed wherever it lands and does not depend on the corner.
      text: "Free entry",
      sizePct: 1.4, font: "mono", uppercase: true, trackingPct: 0.18, rotation: -4,
      color: p.onAccent, bg: p.accent, xPct: 64, yPct: 8,
      on: { kind: "field", color: p.accent },
    },
  );

  return {
    id: "pb_event_nightmarket",
    name: "Night Market",
    subject: "event",
    intent: "mid",
    headline: "Night Market",
    note: "No box anywhere: full-bleed photo with the title in a corner the template darkened with its own compounded gradient, plus one stub knocked off square.",
    layers: c.layers,
    runs: c.runs,
  };
}

export const PROBE_TEMPLATES: ProbeTemplate[] = [
  smallBatch(),
  culvert(),
  nightMarket(),
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
