import type { ShapeId } from "../shapes";
import type { Layer } from "../EditCanvas";

/** Blend modes that render identically in SVG `mix-blend-mode` and canvas
 *  `globalCompositeOperation`. Modes where the two diverge are excluded on
 *  purpose: a mode that previews one way and exports another reintroduces
 *  exactly the drift this renderer removes. */
export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "soft-light"
  | "darken"
  | "lighten";

export const BLEND_MODES: BlendMode[] = [
  "normal", "multiply", "screen", "overlay", "soft-light", "darken", "lighten",
];

/** How an image layer is cropped. Reuses the existing ShapeId vocabulary so all
 *  ~20 shapes in shapes.ts become crop masks without a parallel list. */
export type ClipSpec =
  | { shape: ShapeId }
  | { roundedPct: number }
  | { insetPct: [number, number, number, number] };

export interface Scene {
  /** Pixel size the scene renders at. Live: displayed size. Export: natural size. */
  width: number;
  height: number;
  /** The image being edited, drawn first. Null when layers replace it entirely. */
  baseImageUrl: string | null;
  layers: Layer[];
}
