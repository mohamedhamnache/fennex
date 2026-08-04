import type { TextLayer } from "../EditCanvas";

let ctx: CanvasRenderingContext2D | null = null;

function context(): CanvasRenderingContext2D {
  if (!ctx) ctx = document.createElement("canvas").getContext("2d")!;
  return ctx;
}

/** The canvas width the editor's pixel-denominated UI and the template
 *  authoring space are both expressed against.
 *
 *  A text layer stores its type metrics as percentages of canvas width, which
 *  is what makes preview and export agree. Humans do not think in those units:
 *  a template author writes `fontSize: 80` and a size slider reads "32". Both
 *  numbers mean "px on an 800px-wide canvas", and this constant is the single
 *  place that meaning lives. `families.ts` re-exports it as REFERENCE_WIDTH for
 *  the authoring guard, so there is one 800 in the codebase, not two. */
export const REFERENCE_CANVAS_WIDTH = 800;

/** Reference px (see REFERENCE_CANVAS_WIDTH) to a canvas-width percentage. */
export function pctFromReferencePx(px: number): number {
  return (px / REFERENCE_CANVAS_WIDTH) * 100;
}

/** A canvas-width percentage back to reference px, for display in the UI. */
export function referencePxFromPct(pct: number): number {
  return Math.round((pct / 100) * REFERENCE_CANVAS_WIDTH);
}

export function layerText(layer: TextLayer): string {
  return layer.uppercase ? layer.text.toUpperCase() : layer.text;
}

export function fontString(layer: TextLayer, fontSize: number): string {
  const style = layer.italic ? "italic " : "";
  const weight = layer.bold ? "bold " : "";
  return `${style}${weight}${fontSize}px ${layer.fontFamily}`;
}

/** A text layer's type metrics resolved to pixels on a canvas `canvasWidth`
 *  wide. */
export interface TextMetrics {
  fontSize: number;
  letterSpacing: number;
  outlineWidth: number;
}

/** Resolve a layer's percentage type metrics against a real canvas width.
 *
 *  This is the ONLY conversion from the layer model's percentage units to
 *  pixels. Every consumer — the SVG renderer, the measurer, the editor's
 *  hit-boxes, the font loader — goes through it with the width of the canvas it
 *  is drawing on, which is what makes a 620px preview and a 2048px export paint
 *  the same composition instead of two different ones. */
export function textMetrics(layer: TextLayer, canvasWidth: number): TextMetrics {
  return {
    fontSize: (layer.fontSizePct / 100) * canvasWidth,
    letterSpacing: ((layer.letterSpacingPct ?? 0) / 100) * canvasWidth,
    outlineWidth: ((layer.outlineWidthPct ?? 0) / 100) * canvasWidth,
  };
}

/** Width in px of a text layer rendered on a canvas `canvasWidth` wide,
 *  including letter spacing. Letter spacing applies between glyphs, hence
 *  length - 1. */
export function measureTextLayer(layer: TextLayer, canvasWidth: number): number {
  const text = layerText(layer);
  const { fontSize, letterSpacing } = textMetrics(layer, canvasWidth);
  const c = context();
  c.font = fontString(layer, fontSize);
  return c.measureText(text).width + letterSpacing * Math.max(0, text.length - 1);
}

/** Padding around a text background pill, as a fraction of font size. */
export const PILL_PAD_X = 0.35;
export const PILL_PAD_Y = 0.18;

export interface TextBox { x: number; y: number; width: number; height: number }

/** The box a text layer actually paints at (x, y) on a canvas `canvasWidth`
 *  wide, including the background pill when one is set. SceneSvg paints this
 *  rect and EditCanvas uses it as the hit-box, so the two cannot drift apart. */
export function textBox(layer: TextLayer, canvasWidth: number, x: number, y: number): TextBox {
  const { fontSize } = textMetrics(layer, canvasWidth);
  const width = measureTextLayer(layer, canvasWidth);
  const height = fontSize * 1.2;
  if (!layer.bgColor) return { x, y, width, height };
  const padX = fontSize * PILL_PAD_X;
  const padY = fontSize * PILL_PAD_Y;
  return { x: x - padX, y: y - padY, width: width + padX * 2, height: height + padY * 2 };
}
