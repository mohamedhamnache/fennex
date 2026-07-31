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
