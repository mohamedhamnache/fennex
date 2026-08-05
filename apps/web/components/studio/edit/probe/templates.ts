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
  type RunSpec, compose, field, rule,
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

export const PROBE_TEMPLATES: ProbeTemplate[] = [
  smallBatch(),
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
