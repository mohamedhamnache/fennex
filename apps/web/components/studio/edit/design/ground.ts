/** Grounds — how a colourway is applied, which is a different question from
 *  what the colours are.
 *
 *  The first version of this system had the gradient inside the colourway, so
 *  every template was a gradient by construction. That is monotony on a new
 *  axis: the reference designs happened to be gradient-based, and generalising
 *  from a sample of two is exactly the mistake that produced 34 identical boxes.
 *
 *  Six treatments, and any colourway must work across several of them:
 *
 *    gradient      a mesh or multi-stop blend. ONE option, not the default.
 *    flat          a single confident colour. Modern when the colour is strong
 *                  and the composition carries depth some other way — a glow, a
 *                  cast shadow, a subject lifted off the ground. This is not the
 *                  dated flat-and-empty look; flat plus a luminous dimensional
 *                  subject is very current, and it is the case that proves
 *                  LUMINOSITY DOES NOT REQUIRE A GRADIENT.
 *    photographic  the photograph itself is the ground, full bleed, with type in
 *                  a region the template darkened and therefore owns.
 *    duotone       the photograph mapped into two of the colourway's hues.
 *    blocked       two or three flat areas meeting at an edge, the subject
 *                  crossing the boundary so the composition still has a z-axis.
 *    textured      a flat ground plus a halftone field used AS the ground rather
 *                  than as an accent behind the subject, plus grain.
 *
 *  Each builder returns its layers and the `Backdrop` that type sitting on it
 *  should declare, so a layout cannot describe a backdrop it does not paint.
 *
 *  TWO THINGS THE PROBE DID NOT HAVE TO SOLVE, because it shipped one layout per
 *  ground and each layout was written against the one it got.
 *
 *  1. `photographic` darkened the top-left corner, because the one layout using
 *     it wrote there. Six layouts write in six places, so the darkened region is
 *     now the `zone` the layout asks for, and the declared alpha comes back out
 *     of the scrim that was built rather than being a number typed beside it.
 *
 *  2. `duotone` ended on a MULTIPLY pass, which bounds a lighter ink. Every
 *     colourway it shipped with was dark-ground and light-ink, so that was
 *     correct and invisible. On a soft colourway — pale ground, dark ink — the
 *     same order has no bound at all, and `analyzeText` reports the wash as
 *     running the wrong way. The order is therefore derived from the register
 *     rather than fixed: screen last for a dark ink, multiply last for a light
 *     one, so the surviving pass is always the one whose monotone bound protects
 *     the ink the colourway actually sets.
 */

import type { TemplateLayerDef } from "../text-templates";
import { photo } from "./layers";
import type { Backdrop } from "./type";
import { field, zoneScrim } from "./type";
import type { Colourway } from "./colourways";
import { grain, halftone, mesh } from "./vector";

export type GroundKind =
  | "gradient" | "flat" | "photographic" | "duotone" | "blocked" | "textured";

export const GROUND_KINDS: GroundKind[] = [
  "gradient", "flat", "photographic", "duotone", "blocked", "textured",
];

/** A box in canvas percent. */
export interface Zone {
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
}

export interface Ground {
  layers: TemplateLayerDef[];
  /** What type on the ground sits on. */
  on: Backdrop;
  /** For `blocked`, the second area's backdrop. Undefined on every other
   *  ground, where a layout falls back to `on` for its lower half. */
  onSecond?: Backdrop;
  /** One line for the sweep, so the treatment is legible without reading code. */
  note: string;
}

export interface GroundOpts {
  seed?: number;
  /** Where the layout writes. `photographic` darkens exactly these and
   *  dissolves outward from each; every other ground ignores them.
   *
   *  A list rather than a box because several layouts write in two places that
   *  are not one rectangle — a sale with its chips stacked top-left and its
   *  cap-line bottom-left would otherwise have to darken the whole frame to
   *  cover both, which is a scrim over the photograph rather than a region the
   *  template owns. Each zone gets its own ramp and they compose. */
  zones?: Zone[];
}

const FULL = { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 };

/** Where `blocked` puts the boundary between its two areas. Exported because a
 *  layout has to know which of its runs land in the lower area — a run below
 *  this line takes `onSecond`, and one above takes `on`. */
export const BLOCK_SPLIT_PCT = 54;

/** The most saturated stop — the one a flat ground wants. In every vibrant set
 *  above that is the middle; taking it by index rather than by measuring
 *  saturation keeps the choice legible in the colourway definition. */
function confident(cw: Colourway): string {
  return cw.stops[Math.min(1, cw.stops.length - 1)];
}

/** What a layout gets if it asks for no particular zone. */
const WHOLE_FRAME: Zone[] = [{ xPct: 4, yPct: 6, widthPct: 60, heightPct: 60 }];

export function ground(kind: GroundKind, cw: Colourway, opts?: GroundOpts): Ground {
  const seed = opts?.seed ?? 7;
  switch (kind) {
    case "gradient":
      return {
        layers: [mesh(FULL, cw.stops, cw.blobs, cw.angle)],
        on: { kind: "owned", colors: cw.stops },
        note: `mesh, ${cw.stops.length} stops at ${cw.angle} degrees with ${cw.blobs.length} lit blob(s)`,
      };

    case "flat":
      return {
        // A real shape layer, so `analyzeText` can verify a `field` claim against
        // it and the contrast number is exact rather than a floor.
        layers: [field({ color: confident(cw), ...FULL })],
        on: { kind: "field", color: confident(cw) },
        note: `flat ${confident(cw)}; depth comes from the glow and the lifted subject, not from the ground`,
      };

    case "photographic": {
      // The photograph full bleed, with the region the layout writes in darkened
      // by the template. The alpha is read back out of the scrim rather than
      // asserted, so the contrast report and the picture cannot disagree.
      const zones = opts?.zones?.length ? opts.zones : WHOLE_FRAME;
      const scrims = zones.map((z) => zoneScrim(cw.surface, z));
      return {
        layers: [photo(), ...scrims.flatMap((s) => s.layers)],
        // Every zone is built with the same steps and step alpha, so they share
        // an accumulated alpha; taking the minimum keeps the declared figure a
        // floor if that ever stops being true.
        on: { kind: "prepared", color: cw.surface, alpha: Math.min(...scrims.map((s) => s.alpha)) },
        note: `the photograph full bleed, with ${zones.length} region(s) the template darkened to ` +
          `${(Math.min(...scrims.map((s) => s.alpha)) * 100).toFixed(0)}%`,
      };
    }

    case "duotone": {
      // Order is the guarantee rather than a preference, and which order depends
      // on the ink the colourway sets. `multiply` can only drive a field darker,
      // so it bounds a LIGHTER ink; `screen` can only drive it lighter, so it
      // bounds a DARKER one. The LAST pass is the one a run actually meets, so
      // it has to be the one whose bound protects this colourway's ink —
      // otherwise contrast against any photograph a customer drops in is
      // unbounded, which is exactly what `analyzeText` reports as a mispaired
      // wash.
      const lightInk = cw.register !== "soft";
      const first = lightInk
        ? { color: cw.accent, blend: "screen" as const }
        : { color: cw.accent, blend: "multiply" as const };
      const last = lightInk
        ? { color: cw.surface, blend: "multiply" as const }
        : { color: cw.stops[0], blend: "screen" as const };
      return {
        layers: [
          photo(),
          field({ color: first.color, ...FULL, blend: first.blend }),
          field({ color: last.color, ...FULL, blend: last.blend }),
        ],
        on: { kind: "wash", color: last.color, blend: last.blend },
        note: `duotone: the photograph mapped between ${first.color} and ${last.color}, ${last.blend} last`,
      };
    }

    case "blocked":
      return {
        layers: [
          field({ color: cw.stops[0], ...FULL }),
          field({
            color: confident(cw),
            xPct: 0, yPct: BLOCK_SPLIT_PCT, widthPct: 100, heightPct: 100 - BLOCK_SPLIT_PCT,
          }),
        ],
        on: { kind: "field", color: cw.stops[0] },
        onSecond: { kind: "field", color: confident(cw) },
        note: `two flat areas meeting at ${BLOCK_SPLIT_PCT}%, ${cw.stops[0]} over ${confident(cw)}`,
      };

    case "textured":
      return {
        layers: [
          field({ color: cw.stops[0], ...FULL }),
          // The halftone IS the ground here: full bleed, coarse, and lit from
          // one side by the accent rather than sitting in a disc behind the
          // subject.
          halftone({ xPct: -18, yPct: -18, widthPct: 136, heightPct: 136 }, cw.accent, {
            opacity: 0.3, blend: "screen", rings: 13, dot: 0.05,
          }),
          grain(FULL, cw.ink, { opacity: 0.16, blend: "overlay", seed, scale: 0.85 }),
        ],
        // The halftone is painted over the flat field, so the run is not on a
        // bare field any more; 0.9 accounts for the dots lifting it.
        on: { kind: "prepared", color: cw.stops[0], alpha: 0.9 },
        note: `halftone field over flat ${cw.stops[0]}, plus grain`,
      };
  }
}

/**
 * Which grounds a colourway may be applied through.
 *
 * Compatibility is not decided here by eye — the matrix in
 * `scripts/verify-templates.ts` measures every layout against every ground in
 * every colourway and prints the ratios. What this encodes is the one pairing
 * that came back structurally wrong rather than merely tight, so it cannot be
 * selected into the shipped set at all:
 *
 *  - GRADIENT excludes Sunset and Ember. Both ramps run through their own accent
 *    hue, so light ink over the mesh meets a colour close to itself: measured
 *    2.02:1 and 3.35:1 against the mesh's own stops. Every other ground either
 *    has one known colour under the type or darkens the region first, so both
 *    are fine on flat, duotone, photographic and textured. This is a
 *    gradient-only exclusion, not a colourway that cannot be used.
 *
 * There is deliberately no register exclusion on DUOTONE any more. The probe
 * would have needed one, because its wash order was fixed and bounded only a
 * light ink; `ground()` now derives the order from the register, so a soft
 * colourway gets a pale duotone that bounds its dark ink instead of a dark one
 * that bounds nothing.
 */
const GRADIENT_EXCLUDES = ["sunset", "ember"];

export function groundsFor(cw: Colourway): GroundKind[] {
  return GROUND_KINDS.filter(
    (g) => !(g === "gradient" && GRADIENT_EXCLUDES.includes(cw.id)),
  );
}

/** The mirror of `groundsFor`, for walking the matrix ground-first. */
export function allowsGround(cw: Colourway, kind: GroundKind): boolean {
  return groundsFor(cw).includes(kind);
}
