import { createElement } from "react";
// @ts-expect-error - react-dom/server.browser has no bundled types in React 18
import { renderToStaticMarkup } from "react-dom/server.browser";
import { SceneSvg } from "./SceneSvg";
import { inlineSceneImages } from "./inlineImages";
import { sceneFontCss } from "./inlineFonts";
import { fontString, textMetrics } from "./measure";
import type { Scene } from "./types";
import type { TextLayer } from "../EditCanvas";

/** Wait for every font the scene actually uses to be available IN THIS
 *  DOCUMENT.
 *
 *  This does NOT make the export use those faces — a Blob-backed `<img>` is an
 *  isolated document and never consults the parent's font set, which is what
 *  inlineFonts.ts is for. What it does buy is the measurement: `textBox()` sizes
 *  the background pill behind a run with a canvas 2D context in THIS document,
 *  and measuring "ANNOUNCING" against the fallback sans while the export paints
 *  it in Anton puts the pill at the wrong width.
 *
 *  Uses the same fontString() the measurer relies on so the load request always
 *  matches the face SceneSvg actually renders (including italic, which
 *  document.fonts.load treats as a distinct face). */
async function waitForFonts(scene: Scene): Promise<void> {
  const families = new Set<string>();
  for (const layer of scene.layers) {
    if (layer.type === "text") {
      const t = layer as TextLayer;
      families.add(fontString(t, textMetrics(t, scene.width).fontSize));
    }
  }
  await Promise.all([...families].map((f) => document.fonts.load(f)));
  await document.fonts.ready;
}

/** Render a scene to a PNG data URL at scene.width x scene.height. */
export async function rasterizeScene(scene: Scene): Promise<string> {
  await waitForFonts(scene);
  // Both of these exist for the same reason: the SVG below is loaded through a
  // Blob URL, so it renders as an isolated document that can fetch nothing and
  // inherits none of this document's font registrations. Anything it needs has
  // to be inside it, as bytes.
  const inlined = await inlineSceneImages(scene);
  const fontCss = await sceneFontCss(inlined);

  const markup = renderToStaticMarkup(createElement(SceneSvg, { scene: inlined, fontCss }));
  const svgBlob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not rasterise the composition"));
      el.src = svgUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = scene.width;
    canvas.height = scene.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, scene.width, scene.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
