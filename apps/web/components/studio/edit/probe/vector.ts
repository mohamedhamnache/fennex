/** Vector artwork for the probe: meshes, glows, halftones, dots, icons, pills.
 *
 *  WHY THIS EXISTS. The reference designs the owner supplied need six things the
 *  template system has never had: a multi-stop mesh background, a soft
 *  elliptical glow under a cutout, a halftone dot field, dot-grid clusters,
 *  small feature icons, and an outline pill for a secondary CTA. Five of the six
 *  are the same problem — flat vector artwork placed in a box — and
 *  `shapeDataUri` already solves that problem for its twenty-one fixed shapes by
 *  emitting an SVG data URI that renders as an ordinary image layer.
 *
 *  So this module is `shapeDataUri` generalised, and deliberately NOT an
 *  extension of it: nothing here adds a `ShapeId`, changes `SHAPE_VB`, or edits
 *  anything under `scene/`. It emits `TemplateImageDef`s with an explicit URL,
 *  which `templateToLayers` has always supported.
 *
 *  THE ASPECT TRICK, which is the one subtle thing here. A template shape layer
 *  gets `fit: "fill"` so it stretches to its box; `TemplateImageDef` cannot ask
 *  for that, and its default `cover` would CROP artwork whose intrinsic aspect
 *  differs from the box. Rather than widen the fit vocabulary — the renderer
 *  comment is explicit that `fill` exists for template shape layers and that
 *  anything which might be a photograph must slice — every builder below sizes
 *  its viewBox FROM the box it was given (10 units per canvas percent). The
 *  intrinsic aspect always matches, so `cover` is exact and nothing is cropped.
 *
 *  Its limit, stated rather than discovered later: `widthPct` is a percentage of
 *  canvas width and `heightPct` of canvas height, so on a canvas that is not
 *  square the two disagree and `cover` trims a little off the long side. The
 *  artwork here is soft-edged or centred, so the trim is invisible; a template
 *  needing exact geometry on a 16:9 canvas should not use this.
 *
 *  Colours are always arguments. No builder names one, so a template can only
 *  pass palette roles, and the no-hex-literals rule survives.
 */

import type { TemplateImageDef } from "../text-templates";
import type { BlendMode } from "../scene/types";

export interface Box {
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
}

export interface VectorOpts {
  opacity?: number;
  rotation?: number;
  blend?: BlendMode;
}

/** Units per canvas percent inside a generated viewBox. */
const U = 10;

function svgLayer(box: Box, defs: string, body: string, opts?: VectorOpts): TemplateImageDef {
  const w = Math.max(1, Math.round(box.widthPct * U));
  const h = Math.max(1, Math.round(box.heightPct * U));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    (defs ? `<defs>${defs}</defs>` : "") + body + "</svg>";
  return {
    kind: "image",
    source: { url: `data:image/svg+xml,${encodeURIComponent(svg)}` },
    xPct: box.xPct,
    yPct: box.yPct,
    widthPct: box.widthPct,
    heightPct: box.heightPct,
    fit: "cover",
    opacity: opts?.opacity,
    rotation: opts?.rotation,
    blend: opts?.blend,
  };
}

// ── Backgrounds ───────────────────────────────────────────────────────────────

export interface MeshStop {
  color: string;
  /** Centre of the blob, as a fraction of the box. */
  x: number;
  y: number;
  /** Radius as a fraction of the box's longer side. */
  r: number;
  alpha?: number;
}

/**
 * A mesh background: a linear base gradient with soft radial blobs floated over
 * it, which is how a "purple to blue to magenta, not two stops" field is
 * actually built.
 *
 * `TemplateBackground` takes exactly two colours and one angle, so a multi-stop
 * mesh was not expressible through it. Widening that type would have reached
 * into the shipped template set, the picker's preview CSS and the brand-kit
 * mapping; generating the artwork here reaches nothing. The cost is that the
 * mesh is a layer rather than a `background`, which for these compositions is
 * what it wants to be anyway — it sits under the type and over nothing.
 */
export function mesh(
  box: Box,
  base: string[],
  blobs: MeshStop[] = [],
  angleDeg = 135,
  opts?: VectorOpts,
): TemplateImageDef {
  const w = Math.max(1, Math.round(box.widthPct * U));
  const h = Math.max(1, Math.round(box.heightPct * U));
  const stops = base
    .map((c, i) => `<stop offset="${(i / Math.max(1, base.length - 1)).toFixed(3)}" stop-color="${c}"/>`)
    .join("");
  const defs =
    `<linearGradient id="b" gradientTransform="rotate(${angleDeg - 90} 0.5 0.5)">${stops}</linearGradient>` +
    blobs
      .map(
        (s, i) =>
          `<radialGradient id="m${i}">` +
          `<stop offset="0" stop-color="${s.color}" stop-opacity="${s.alpha ?? 0.85}"/>` +
          `<stop offset="1" stop-color="${s.color}" stop-opacity="0"/></radialGradient>`,
      )
      .join("");
  const body =
    `<rect width="${w}" height="${h}" fill="url(#b)"/>` +
    blobs
      .map(
        (s, i) =>
          `<ellipse cx="${(s.x * w).toFixed(0)}" cy="${(s.y * h).toFixed(0)}" ` +
          `rx="${(s.r * w).toFixed(0)}" ry="${(s.r * h).toFixed(0)}" fill="url(#m${i})"/>`,
      )
      .join("");
  return svgLayer(box, defs, body, opts);
}

/** A soft elliptical glow — what sits under a cutout product instead of a hard
 *  drop shadow. Radial, which `shapeDataUri` has no way to express: its only
 *  gradient is a two-stop linear one at a fixed 45 degrees. */
export function glow(box: Box, color: string, opts?: VectorOpts & { alpha?: number }): TemplateImageDef {
  const w = Math.max(1, Math.round(box.widthPct * U));
  const h = Math.max(1, Math.round(box.heightPct * U));
  const defs =
    `<radialGradient id="g">` +
    `<stop offset="0" stop-color="${color}" stop-opacity="${opts?.alpha ?? 0.55}"/>` +
    `<stop offset="0.55" stop-color="${color}" stop-opacity="${(opts?.alpha ?? 0.55) * 0.35}"/>` +
    `<stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
  return svgLayer(box, defs, `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="url(#g)"/>`, opts);
}

/** A halftone disc: concentric rings of dots that shrink outward, so the field
 *  reads as printed texture rather than as a pattern of circles. */
export function halftone(
  box: Box,
  color: string,
  opts?: VectorOpts & { rings?: number; dot?: number },
): TemplateImageDef {
  const w = Math.max(1, Math.round(box.widthPct * U));
  const h = Math.max(1, Math.round(box.heightPct * U));
  const rings = opts?.rings ?? 7;
  const maxDot = (opts?.dot ?? 0.055) * Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const dots: string[] = [];
  for (let ring = 0; ring < rings; ring++) {
    const t = ring / (rings - 1);
    const radius = (Math.min(w, h) / 2) * t * 0.94;
    const count = ring === 0 ? 1 : Math.max(6, Math.round(6 * ring));
    const size = maxDot * (1 - t * 0.72);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + ring * 0.35;
      dots.push(
        `<circle cx="${(cx + radius * Math.cos(a)).toFixed(1)}" cy="${(cy + radius * Math.sin(a)).toFixed(1)}" r="${size.toFixed(1)}" fill="${color}"/>`,
      );
    }
  }
  return svgLayer(box, "", dots.join(""), opts);
}

/** A rectangular cluster of small dots — the corner decoration in reference 1. */
export function dotCluster(
  box: Box,
  color: string,
  cols: number,
  rows: number,
  opts?: VectorOpts,
): TemplateImageDef {
  const w = Math.max(1, Math.round(box.widthPct * U));
  const h = Math.max(1, Math.round(box.heightPct * U));
  const r = Math.min(w / cols, h / rows) * 0.22;
  const dots: string[] = [];
  for (let cx = 0; cx < cols; cx++) {
    for (let cy = 0; cy < rows; cy++) {
      dots.push(
        `<circle cx="${(((cx + 0.5) / cols) * w).toFixed(1)}" cy="${(((cy + 0.5) / rows) * h).toFixed(1)}" r="${r.toFixed(1)}" fill="${color}"/>`,
      );
    }
  }
  return svgLayer(box, "", dots.join(""), opts);
}

/** A small x-mark accent. */
export function cross(box: Box, color: string, opts?: VectorOpts & { weight?: number }): TemplateImageDef {
  const w = Math.max(1, Math.round(box.widthPct * U));
  const h = Math.max(1, Math.round(box.heightPct * U));
  const sw = (opts?.weight ?? 0.13) * Math.min(w, h);
  const pad = sw;
  return svgLayer(
    box,
    "",
    `<path d="M${pad} ${pad} L${w - pad} ${h - pad} M${w - pad} ${pad} L${pad} ${h - pad}" ` +
    `stroke="${color}" stroke-width="${sw.toFixed(1)}" stroke-linecap="round" fill="none"/>`,
    opts,
  );
}

// ── Grain ─────────────────────────────────────────────────────────────────────

/**
 * Monochrome film grain over the whole composition.
 *
 * The cheapest thing on the list and probably the most valuable: texture is
 * what makes a digital piece read as made rather than generated, and every
 * surface in this system is currently a perfectly smooth gradient or a
 * perfectly flat field.
 *
 * `feTurbulence` rather than a few thousand emitted rects. A fractal-noise
 * turbulence desaturated to grey and pushed through a linear alpha ramp is the
 * standard SVG grain recipe, it is a dozen bytes instead of a hundred kilobytes
 * of markup, and it costs the rasteriser one filter pass instead of parsing
 * 20,000 nodes. `seed` is explicit so the same template produces the same grain
 * every render — the layer has to be byte-identical across runs or the sweep's
 * geometry fingerprint moves under it.
 *
 * `stitchTiles="stitch"` keeps the noise continuous if the layer is ever tiled.
 *
 * RESIDUAL RISK, stated because it cannot be checked from here: SVG filters
 * inside an `<img>`-loaded document are a different code path from the plain
 * shapes everything else here uses. Chromium supports it — filters need no
 * script and no network, which is what the isolated document actually
 * forbids — but this is the one primitive whose failure mode is "renders as a
 * flat grey rectangle over the design" rather than "renders slightly wrong".
 * It is the first thing to look at on screen, and `opacity` is the dial.
 */
export function grain(
  box: Box,
  color: string,
  opts?: VectorOpts & { seed?: number; scale?: number; alpha?: number },
): TemplateImageDef {
  const w = Math.max(1, Math.round(box.widthPct * U));
  const h = Math.max(1, Math.round(box.heightPct * U));
  const freq = opts?.scale ?? 0.9;
  const defs =
    `<filter id="n" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" ` +
    `seed="${opts?.seed ?? 7}" stitchTiles="stitch" result="t"/>` +
    `<feColorMatrix type="saturate" values="0"/>` +
    `<feComponentTransfer><feFuncA type="linear" slope="${opts?.alpha ?? 0.55}"/></feComponentTransfer>` +
    `</filter>`;
  // The flood colour underneath keeps the grain tinted to a palette role rather
  // than to whatever grey the turbulence happens to produce.
  const body =
    `<rect width="${w}" height="${h}" fill="${color}" opacity="0.03"/>` +
    `<rect width="${w}" height="${h}" filter="url(#n)"/>`;
  return svgLayer(box, defs, body, opts);
}

// ── Stickers ──────────────────────────────────────────────────────────────────
//
// Decorative, not informational — the distinction matters. A glass chip carries
// a fact about the product and is aligned to the frame; a sticker is a charm,
// it is knocked off square, and it says one short thing. Two different jobs, so
// two different vocabularies, and mixing them is how a composition stops having
// a hierarchy.
//
// Both builders take an optional keyline, which is what makes a badge read as
// die-cut: a printed sticker is trimmed a millimetre outside its artwork, and
// that white border is the entire visual signature of the thing.

function keylined(shape: (scale: number) => string, keyline?: { color: string; width: number }): string {
  return keyline ? shape(1 + keyline.width) + shape(1) : shape(1);
}

/** A scalloped seal — the enamel-pin, guarantee-stamp, wax-seal shape. */
export function scallopedSeal(
  box: Box,
  fill: string,
  opts?: VectorOpts & { bumps?: number; keyline?: { color: string; width: number } },
): TemplateImageDef {
  const w = Math.max(1, Math.round(box.widthPct * U));
  const h = Math.max(1, Math.round(box.heightPct * U));
  const cx = w / 2;
  const cy = h / 2;
  const bumps = opts?.bumps ?? 12;
  const body = keylined((scale) => {
    const outer = (Math.min(w, h) / 2) * 0.82 * scale;
    const bump = outer * 0.2;
    const color = scale === 1 ? fill : opts!.keyline!.color;
    const scallops = Array.from({ length: bumps }, (_, i) => {
      const a = (i / bumps) * Math.PI * 2;
      return `<circle cx="${(cx + outer * Math.cos(a)).toFixed(1)}" cy="${(cy + outer * Math.sin(a)).toFixed(1)}" r="${bump.toFixed(1)}" fill="${color}"/>`;
    }).join("");
    return `<circle cx="${cx}" cy="${cy}" r="${outer.toFixed(1)}" fill="${color}"/>${scallops}`;
  }, opts?.keyline);
  return svgLayer(box, "", body, opts);
}

/** A starburst — the price-flash, the "new", the thing stuck on at an angle. */
export function starburst(
  box: Box,
  fill: string,
  opts?: VectorOpts & { points?: number; innerRatio?: number; keyline?: { color: string; width: number } },
): TemplateImageDef {
  const w = Math.max(1, Math.round(box.widthPct * U));
  const h = Math.max(1, Math.round(box.heightPct * U));
  const cx = w / 2;
  const cy = h / 2;
  const points = opts?.points ?? 12;
  const inner = opts?.innerRatio ?? 0.74;
  const body = keylined((scale) => {
    const r = (Math.min(w, h) / 2) * 0.94 * scale;
    const color = scale === 1 ? fill : opts!.keyline!.color;
    const verts: string[] = [];
    for (let i = 0; i < points * 2; i++) {
      const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const rad = i % 2 === 0 ? r : r * inner;
      verts.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
    }
    return `<polygon points="${verts.join(" ")}" fill="${color}"/>`;
  }, opts?.keyline);
  return svgLayer(box, "", body, opts);
}

// ── Collage ───────────────────────────────────────────────────────────────────
//
// A note on the mask question, because the obvious answer is wrong. `SceneSvg`
// renders `circle`, `roundedPct` and `insetPct` as authored and silently
// degrades every other ShapeId to a rounded rect, and that file is off-limits,
// so the tempting move is to paint the surrounding colour back over the photo
// with an interesting boundary — an arch cut out of a cover rect. That only
// works where the surround is a FLAT known colour, and every composition in
// this set now sits on a mesh, where the cover would leave a visible seam. It
// was written and then deleted rather than shipped with a caveat.
//
// The arch in Culvert is done properly instead: `roundedPct: 50` is a real
// clip that renders as authored and gives a stadium, and the plate is placed so
// the bottom half of the stadium runs off the frame. What is left in view is an
// arch, with no cover, no seam and no renderer change.
//
// What genuinely needs artwork is the torn edge, and it needs it as a POSITIVE
// element rather than as a cover: a strip of paper with a ripped top edge,
// opaque, laid over whatever is beneath it. That works over a mesh, over a
// photo, over anything.

/** A deterministic pseudo-random sequence. A torn edge has to be irregular and
 *  it has to be the SAME irregularity every render, or the sweep's geometry
 *  fingerprint changes on every reload and distinctness stops meaning anything.
 *  A seeded LCG is the whole requirement. */
function lcg(seed: number): () => number {
  let s = (seed * 1103515245 + 12345) % 2147483648;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/** A strip of `color` whose top edge is torn, painted over the straight bottom
 *  edge of a photo so the photo appears to have been ripped rather than cut. */
export function tornEdge(
  box: Box,
  color: string,
  opts?: VectorOpts & { teeth?: number; roughness?: number; seed?: number },
): TemplateImageDef {
  const w = Math.max(1, Math.round(box.widthPct * U));
  const h = Math.max(1, Math.round(box.heightPct * U));
  const teeth = opts?.teeth ?? 26;
  const rough = opts?.roughness ?? 0.55;
  const rand = lcg(opts?.seed ?? 3);
  const pts: string[] = [];
  for (let i = 0; i <= teeth; i++) {
    const x = (i / teeth) * w;
    // Two scales of noise: a slow wander so the tear has a shape, and a fast
    // jitter so it has a grain. One alone reads as a wave or as a sawtooth.
    const slow = Math.sin((i / teeth) * Math.PI * 2.3 + (opts?.seed ?? 3)) * 0.3;
    const y = h * (0.5 + (slow + (rand() - 0.5) * rough) * 0.5);
    pts.push(`${x.toFixed(1)},${Math.max(0, Math.min(h, y)).toFixed(1)}`);
  }
  return svgLayer(box, "", `<polygon points="${pts.join(" ")} ${w},${h} 0,${h}" fill="${color}"/>`, opts);
}

// ── Atmosphere ────────────────────────────────────────────────────────────────

/** A neon flare: a wide soft bloom with a bright streak through it. Meant for
 *  `screen` blend over a dark mesh, where it reads as light in the scene rather
 *  than as a shape on top of it. `glow()` is the round, contained version of
 *  the same idea; this one is directional and deliberately overruns its box. */
export function flare(
  box: Box,
  color: string,
  opts?: VectorOpts & { alpha?: number; coreAlpha?: number },
): TemplateImageDef {
  const w = Math.max(1, Math.round(box.widthPct * U));
  const h = Math.max(1, Math.round(box.heightPct * U));
  const a = opts?.alpha ?? 0.5;
  const defs =
    `<radialGradient id="b"><stop offset="0" stop-color="${color}" stop-opacity="${a}"/>` +
    `<stop offset="0.6" stop-color="${color}" stop-opacity="${(a * 0.28).toFixed(3)}"/>` +
    `<stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="s"><stop offset="0" stop-color="${color}" stop-opacity="0"/>` +
    `<stop offset="0.5" stop-color="${color}" stop-opacity="${opts?.coreAlpha ?? 0.75}"/>` +
    `<stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>`;
  const body =
    `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="url(#b)"/>` +
    `<rect x="0" y="${(h * 0.47).toFixed(1)}" width="${w}" height="${(h * 0.06).toFixed(1)}" ` +
    `rx="${(h * 0.03).toFixed(1)}" fill="url(#s)"/>`;
  return svgLayer(box, defs, body, opts);
}

// ── Pills ─────────────────────────────────────────────────────────────────────

/** A translucent "glass" pill: a soft fill with a hairline border, the chip
 *  reference 1 hangs its feature labels on. The fill alpha is inside the SVG
 *  rather than on the layer, so the border stays crisp while the fill stays
 *  see-through. */
export function glassPill(
  box: Box,
  fill: string,
  border: string,
  opts?: VectorOpts & { fillAlpha?: number; borderAlpha?: number },
): TemplateImageDef {
  const w = Math.max(1, Math.round(box.widthPct * U));
  const h = Math.max(1, Math.round(box.heightPct * U));
  const sw = Math.max(1, h * 0.045);
  return svgLayer(
    box,
    "",
    `<rect x="${sw / 2}" y="${sw / 2}" width="${w - sw}" height="${h - sw}" rx="${(h - sw) / 2}" ` +
    `fill="${fill}" fill-opacity="${opts?.fillAlpha ?? 0.18}" ` +
    `stroke="${border}" stroke-opacity="${opts?.borderAlpha ?? 0.45}" stroke-width="${sw.toFixed(1)}"/>`,
    opts,
  );
}

/** An outline pill with no fill — the secondary CTA beside a solid one. */
export function ghostPill(
  box: Box,
  border: string,
  opts?: VectorOpts & { weight?: number },
): TemplateImageDef {
  const w = Math.max(1, Math.round(box.widthPct * U));
  const h = Math.max(1, Math.round(box.heightPct * U));
  const sw = Math.max(1, h * (opts?.weight ?? 0.055));
  return svgLayer(
    box,
    "",
    `<rect x="${sw / 2}" y="${sw / 2}" width="${w - sw}" height="${h - sw}" rx="${(h - sw) / 2}" ` +
    `fill="none" stroke="${border}" stroke-width="${sw.toFixed(1)}"/>`,
    opts,
  );
}

/** A solid pill, for the primary CTA. `shapeDataUri`'s own pill has a fixed
 *  200x80 viewBox and is stretched to its box; this one is drawn to the box, so
 *  the corner radius stays a true semicircle at any width. */
export function solidPill(box: Box, fill: string, opts?: VectorOpts): TemplateImageDef {
  const w = Math.max(1, Math.round(box.widthPct * U));
  const h = Math.max(1, Math.round(box.heightPct * U));
  return svgLayer(box, "", `<rect width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/>`, opts);
}

// ── Icons ─────────────────────────────────────────────────────────────────────

/** Stroke paths on a 24-unit grid, so they line up with the way icon sets are
 *  normally drawn. Six glyphs, hand-written rather than pulled from a library:
 *  a dependency for six paths would be the wrong trade, and a library's licence
 *  and tree-shaking are a bigger conversation than this probe deserves. */
const ICON_PATHS = {
  droplet: "M12 3.5 C12 3.5 5.5 10.8 5.5 15 a6.5 6.5 0 0 0 13 0 C18.5 10.8 12 3.5 12 3.5 Z",
  waveform: "M3 12 h2 M7 8 v8 M11 4.5 v15 M15 8 v8 M19 10.5 v3 M21 12 h0.5",
  mic: "M12 3.5 a2.8 2.8 0 0 1 2.8 2.8 v5.4 a2.8 2.8 0 0 1 -5.6 0 V6.3 A2.8 2.8 0 0 1 12 3.5 Z M6 11.5 a6 6 0 0 0 12 0 M12 17.5 V21 M9 21 h6",
  bolt: "M13.5 2.5 L5.5 13.5 h5 L10 21.5 L18.5 10.5 h-5 Z",
  phone: "M6.5 3.5 h3.2 l1.6 4 -2.2 1.6 a11 11 0 0 0 5.8 5.8 l1.6 -2.2 4 1.6 v3.2 a2 2 0 0 1 -2 2 A16.5 16.5 0 0 1 4.5 5.5 a2 2 0 0 1 2 -2 Z",
  check: "M4.5 12.5 L9.5 17.5 L19.5 6.5",
} as const;

export type IconName = keyof typeof ICON_PATHS;

export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];

/** One icon, stroked in a palette colour. Square by construction: the caller
 *  passes one size and both box dimensions take it, so the 24-unit grid is
 *  never distorted. */
export function icon(
  spec: { name: IconName; xPct: number; yPct: number; sizePct: number },
  color: string,
  opts?: VectorOpts & { weight?: number },
): TemplateImageDef {
  const box: Box = {
    xPct: spec.xPct, yPct: spec.yPct, widthPct: spec.sizePct, heightPct: spec.sizePct,
  };
  const n = Math.max(1, Math.round(spec.sizePct * U));
  const body =
    `<g transform="scale(${(n / 24).toFixed(4)})" fill="none" stroke="${color}" ` +
    `stroke-width="${opts?.weight ?? 1.8}" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${ICON_PATHS[spec.name]}"/></g>`;
  return svgLayer(box, "", body, opts);
}
