import type { TextLayer } from "../EditCanvas";

let ctx: CanvasRenderingContext2D | null = null;

function context(): CanvasRenderingContext2D {
  if (!ctx) ctx = document.createElement("canvas").getContext("2d")!;
  return ctx;
}

export function layerText(layer: TextLayer): string {
  return layer.uppercase ? layer.text.toUpperCase() : layer.text;
}

export function fontString(layer: TextLayer, fontSize: number): string {
  const style = layer.italic ? "italic " : "";
  const weight = layer.bold ? "bold " : "";
  return `${style}${weight}${fontSize}px ${layer.fontFamily}`;
}

/** Width in px of a text layer rendered at `fontSize`, including letter spacing.
 *  Letter spacing applies between glyphs, hence length - 1. */
export function measureTextLayer(layer: TextLayer, fontSize: number): number {
  const text = layerText(layer);
  const c = context();
  c.font = fontString(layer, fontSize);
  const scale = fontSize / (layer.fontSize || fontSize);
  const spacing = (layer.letterSpacing ?? 0) * scale * Math.max(0, text.length - 1);
  return c.measureText(text).width + spacing;
}

/** Padding around a text background pill, as a fraction of font size. */
export const PILL_PAD_X = 0.35;
export const PILL_PAD_Y = 0.18;

export interface TextBox { x: number; y: number; width: number; height: number }

/** The box a text layer actually paints at (x, y), including the background
 *  pill when one is set. SceneSvg paints this rect and EditCanvas uses it as
 *  the hit-box, so the two cannot drift apart. */
export function textBox(layer: TextLayer, fontSize: number, x: number, y: number): TextBox {
  const width = measureTextLayer(layer, fontSize);
  const height = fontSize * 1.2;
  if (!layer.bgColor) return { x, y, width, height };
  const padX = fontSize * PILL_PAD_X;
  const padY = fontSize * PILL_PAD_Y;
  return { x: x - padX, y: y - padY, width: width + padX * 2, height: height + padY * 2 };
}
