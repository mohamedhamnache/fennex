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
 */

import type { TemplateLayerDef } from "../text-templates";
import { photo } from "../families";
import type { Backdrop } from "./type";
import { cornerScrim, field } from "./type";
import type { Colourway } from "./colourways";
import { grain, halftone, mesh } from "./vector";

export type GroundKind =
  | "gradient" | "flat" | "photographic" | "duotone" | "blocked" | "textured";

export interface Ground {
  layers: TemplateLayerDef[];
  /** What type on the ground sits on. */
  on: Backdrop;
  /** For `blocked`, the second area's backdrop. */
  onSecond?: Backdrop;
  /** One line for the sweep, so the treatment is legible without reading code. */
  note: string;
}

const FULL = { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 };

/** The most saturated stop — the one a flat ground wants. In every vibrant set
 *  above that is the middle; taking it by index rather than by measuring
 *  saturation keeps the choice legible in the colourway definition. */
function confident(cw: Colourway): string {
  return cw.stops[Math.min(1, cw.stops.length - 1)];
}

export function ground(kind: GroundKind, cw: Colourway, opts?: { seed?: number }): Ground {
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

    case "photographic":
      return {
        // Nested gradient squares anchored top-left: the corner the type lands
        // in is driven to roughly 0.85-0.97 alpha and dissolves into the picture
        // on the way out, so the darkening is part of the composition rather
        // than a safety box behind every run.
        layers: [photo(), ...cornerScrim(cw.surface, [82, 50])],
        on: { kind: "prepared", color: cw.surface, alpha: 0.82 },
        note: "the photograph full bleed, with a corner the template darkened itself",
      };

    case "duotone":
      return {
        // Screen first, multiply last, and the order is the guarantee rather
        // than a preference. `multiply` can only drive a field darker, so it
        // bounds a LIGHTER ink: contrast against the shadow hue is a floor for
        // every photograph a customer might drop in. Screen last would bound a
        // darker ink instead and every one of these colourways sets light type.
        layers: [
          photo(),
          field({ color: cw.accent, ...FULL, blend: "screen" }),
          field({ color: cw.surface, ...FULL, blend: "multiply" }),
        ],
        on: { kind: "wash", color: cw.surface, blend: "multiply" },
        note: `duotone: the photograph mapped between ${cw.accent} and ${cw.surface}`,
      };

    case "blocked":
      return {
        layers: [
          field({ color: cw.stops[0], ...FULL }),
          field({ color: confident(cw), xPct: 0, yPct: 54, widthPct: 100, heightPct: 46 }),
        ],
        on: { kind: "field", color: cw.stops[0] },
        onSecond: { kind: "field", color: confident(cw) },
        note: `two flat areas meeting at 54%, ${cw.stops[0]} over ${confident(cw)}`,
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
