/**
 * Which layer did the user actually click?
 *
 * Every layer overlay is a rectangle, and a rectangle is the wrong shape for
 * most of what this editor puts on a canvas:
 *
 *   * Convert to canvas gives every object a FULL-CANVAS layer whose position
 *     lives entirely in its alpha ("All layers use xPct=0, yPct=0,
 *     widthPct=100 ... the object sits at the right spot via transparency").
 *     Every object's rectangle is therefore the whole canvas, so a click
 *     anywhere selected whichever object happened to be topmost, never the one
 *     under the cursor.
 *   * Templates add full-canvas decoration last -- `grain` covers 100%x100%,
 *     `tornEdge` the bottom 28% -- so the topmost rectangle covered everything
 *     and the photograph beneath could not be picked at all.
 *
 * So a click resolves to the topmost layer that is actually OPAQUE at that
 * point, rather than the topmost whose bounding box contains it.
 */

import type { Layer, ImageLayer } from "./EditCanvas";
import { textBox } from "./scene/measure";

/**
 * Effective alpha below this is treated as "not there".
 *
 * EFFECTIVE, not the image's own: a layer's `opacity` is applied on top of its
 * pixels, and reading only the pixels was the first version's mistake. Template
 * grain is opaque feTurbulence noise carried at layer opacity 0.08-0.15, so by
 * its own alpha it is solid and swallowed every click on the photograph beneath
 * -- the exact symptom this module exists to fix, reintroduced one level down.
 *
 * A fifth of full strength is the line. Below it a layer is a wash or a texture
 * and the thing under it is what the user is pointing at; above it the layer is
 * content in its own right. Anything this rule makes unclickable on the canvas
 * is still selectable from the Layers list, which is why the trade is safe in
 * this direction and not the other.
 */
const OPAQUE_ALPHA = 51;

/** Probes are sampled at low resolution -- this is a hit test, not a matte.
 *  256px keeps a full-canvas probe at 256KB and is far finer than a click. */
const PROBE_EDGE = 256;

type Probe = Uint8ClampedArray | null;

/** Alpha probes by image URL. Module-level so it survives re-renders; entries
 *  are small and bounded by the number of distinct images in a session. */
const probes = new Map<string, Probe>();
const pending = new Map<string, Promise<void>>();

/**
 * Ensure an alpha probe exists for every image layer.
 *
 * Call when the layer list changes. Hit testing is synchronous (it runs inside
 * a pointer handler), so anything not yet probed falls back to rectangle
 * behaviour rather than blocking -- the pre-existing behaviour, only until the
 * image resolves.
 */
export function primeHitProbes(layers: Layer[]): void {
  for (const layer of layers) {
    if (layer.type !== "image") continue;
    const url = (layer as ImageLayer).imageUrl;
    if (!url || probes.has(url) || pending.has(url)) continue;
    pending.set(url, loadProbe(url));
  }
}

async function loadProbe(url: string): Promise<void> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      // Data URIs need no CORS, and a tainted canvas would throw on read --
      // caught below and degraded to rectangle behaviour.
      el.crossOrigin = "anonymous";
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("probe load failed"));
      el.src = url;
    });
    const w = Math.max(1, Math.min(PROBE_EDGE, img.naturalWidth || PROBE_EDGE));
    const h = Math.max(1, Math.min(PROBE_EDGE, img.naturalHeight || PROBE_EDGE));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const alpha = new Uint8ClampedArray(w * h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data.data[i * 4 + 3];
    probes.set(url, alpha);
    probeSizes.set(url, { w, h });
  } catch {
    // Unreadable or cross-origin: remember the failure so it is not retried on
    // every pointer move, and fall back to the rectangle.
    probes.set(url, null);
  } finally {
    pending.delete(url);
  }
}

const probeSizes = new Map<string, { w: number; h: number }>();

/** Fractional position within a layer's own box, or null if outside it.
 *
 * Geometry deliberately mirrors the overlay in EditCanvas exactly -- image
 * height from `heightPct` when present and from the aspect ratio otherwise,
 * text from `textBox` so the pill padding is included. If the two ever
 * disagree, clicks land somewhere the selection outline is not.
 */
function localPoint(
  layer: Layer, xPx: number, yPx: number, canvasW: number, canvasH: number,
): { u: number; v: number } | null {
  const x = (layer.xPct / 100) * canvasW;
  const y = (layer.yPct / 100) * canvasH;

  if (layer.type === "text") {
    const box = textBox(layer, canvasW, x, y);
    if (box.width <= 0 || box.height <= 0) return null;
    const u = (xPx - box.x) / box.width;
    const v = (yPx - box.y) / box.height;
    return u < 0 || u > 1 || v < 0 || v > 1 ? null : { u, v };
  }

  const img = layer as ImageLayer;
  const w = (img.widthPct / 100) * canvasW;
  if (w <= 0) return null;
  const h = img.heightPct != null
    ? (img.heightPct / 100) * canvasH
    : (img.aspectRatio > 0 ? w / img.aspectRatio : w);
  if (h <= 0) return null;
  const u = (xPx - x) / w;
  const v = (yPx - y) / h;
  return u < 0 || u > 1 || v < 0 || v > 1 ? null : { u, v };
}

/** True when the layer paints something at this point. Layers with no probe
 *  yet (or an unreadable one) answer true, preserving rectangle behaviour. */
export function isOpaqueAt(
  layer: Layer, xPx: number, yPx: number, canvasW: number, canvasH: number,
): boolean {
  const local = localPoint(layer, xPx, yPx, canvasW, canvasH);
  if (!local) return false;

  // The layer's own opacity multiplies whatever its pixels say, so a
  // near-invisible layer cannot capture a click it does not visibly own.
  const opacity = layer.opacity ?? 1;
  if (opacity * 255 < OPAQUE_ALPHA) return false;

  // Text already has a tight box; there is nothing transparent to see through.
  if (layer.type !== "image") return true;
  const url = (layer as ImageLayer).imageUrl;
  const alpha = url ? probes.get(url) : undefined;
  const size = url ? probeSizes.get(url) : undefined;
  if (!alpha || !size) return true;
  const px = Math.min(size.w - 1, Math.max(0, Math.floor(local.u * size.w)));
  const py = Math.min(size.h - 1, Math.max(0, Math.floor(local.v * size.h)));
  return alpha[py * size.w + px] * opacity >= OPAQUE_ALPHA;
}

/**
 * The layer a click at (xPx, yPx) -- in canvas pixels -- should select, or null.
 *
 * Walks from the top down, since later layers paint over earlier ones, and
 * returns the first that is genuinely painted there.
 */
export function resolveLayerAt(
  layers: Layer[], xPx: number, yPx: number, canvasW: number, canvasH: number,
): Layer | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer.visible === false) continue;
    if (isOpaqueAt(layer, xPx, yPx, canvasW, canvasH)) return layer;
  }
  return null;
}
