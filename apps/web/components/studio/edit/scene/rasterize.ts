import { createElement } from "react";
// @ts-expect-error - react-dom/server.browser has no bundled types in React 18
import { renderToStaticMarkup } from "react-dom/server.browser";
import { SceneSvg } from "./SceneSvg";
import { inlineSceneImages } from "./inlineImages";
import { fontString, textMetrics } from "./measure";
import type { Scene } from "./types";
import type { TextLayer } from "../EditCanvas";

/** Wait for every font the scene actually uses. Rasterising before a display
 *  face has loaded silently renders the export in a fallback font: the preview
 *  is right and the download is wrong, with no error anywhere. Uses the same
 *  fontString() the measurer relies on so the load request always matches the
 *  face SceneSvg actually renders (including italic, which document.fonts.load
 *  treats as a distinct face). */
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
  const inlined = await inlineSceneImages(scene);

  const markup = renderToStaticMarkup(createElement(SceneSvg, { scene: inlined }));
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
