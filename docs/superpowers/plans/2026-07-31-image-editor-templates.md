# Image Editor Template Engine and Composition Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the image editor's two divergent renderers (DOM for editing, hand-written canvas-2D for export) with a single declarative SVG scene, then rebuild the template set around seven composition families that can place, clip and blend the edited photo.

**Architecture:** One React component, `SceneSvg`, renders the whole layer stack as SVG. The live editor mounts it directly; the export path serialises the *same component* with `renderToStaticMarkup` and rasterises it. Because both paths run one component, preview/export divergence stops being possible by construction rather than by discipline. Templates gain image layers with a `"subject"` source, so a composition can place the edited photo instead of only decorating over it.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript 5, Tailwind CSS v3, react-i18next. No test framework in `apps/web` — verification is `npm run typecheck` plus a dev-only sweep route that runs mechanical PASS/FAIL checks.

**Spec:** `docs/superpowers/specs/2026-07-31-image-editor-templates-design.md`

## Global Constraints

- All work is in `apps/web`. No backend changes; templates are frontend state that seeds layers and is not referenced after apply.
- Never hard-code colours in components. Use CSS variables (`hsl(var(--primary))`, `bg-card`). This applies to editor chrome, **not** to template definitions, which legitimately carry design hexes.
- All user-visible strings go through `t("key")` with translations in `apps/web/public/locales/`.
- Use `apiClient` from `lib/api.ts` for API calls; never `fetch` directly.
- Use `cn()` from `lib/cn.ts` for conditional class names.
- No emoji anywhere — code, UI text, comments, or commit messages.
- Verify every task with `npm run typecheck` from `apps/web/`. It must pass with zero errors before commit.
- Allowed blend modes, exactly: `normal | multiply | screen | overlay | soft-light | darken | lighten`. No others — the excluded modes diverge between SVG and canvas.
- Template font sizes assume an ~800px-wide canvas and are scaled on apply. Preserve this convention.
- Every new field on template and layer types is **optional**, so layers already saved against existing images keep rendering unchanged.
- Commit style: `feat(scope): description` / `fix(scope):` / `refactor(scope):` / `docs:`.

---

## File Structure

**Create:**

| Path | Responsibility |
| --- | --- |
| `components/studio/edit/scene/types.ts` | `BlendMode`, `ClipSpec`, `Scene`; no logic |
| `components/studio/edit/scene/measure.ts` | Canvas-based text measurement shared by live and export |
| `components/studio/edit/scene/SceneSvg.tsx` | The single renderer — layer stack to SVG |
| `components/studio/edit/scene/inlineImages.ts` | Remote image URL to data URI, for taint-free rasterising |
| `components/studio/edit/scene/rasterize.ts` | `SceneSvg` to PNG data URL at full resolution |
| `components/studio/edit/TemplatePicker.tsx` | Extracted template picker |
| `components/studio/edit/LayersPanel.tsx` | Extracted layers list |
| `components/studio/edit/palette.ts` | Palette and typography roles |
| `components/studio/edit/families.ts` | The seven composition family builders |
| `app/dev/template-sweep/page.tsx` | Dev-only sweep route with mechanical checks |

**Modify:**

| Path | Change |
| --- | --- |
| `components/studio/edit/EditCanvas.tsx` | Mount `SceneSvg`; layer overlays become transparent hit-boxes |
| `app/(dashboard)/[projectId]/images/edit/[imageId]/page.tsx` | Burn via `rasterize`; delete the canvas-2D block at 351-470 |
| `components/studio/edit/text-templates.ts` | Add `TemplateImageDef`; rebuild the template set |
| `components/studio/edit/EditControlsPanel.tsx` | Remove the extracted picker and layers list |

---

## Task 1: Scene types and the SVG renderer

**Files:**
- Create: `apps/web/components/studio/edit/scene/types.ts`
- Create: `apps/web/components/studio/edit/scene/measure.ts`
- Create: `apps/web/components/studio/edit/scene/SceneSvg.tsx`

**Interfaces:**
- Consumes: `TextLayer`, `ImageLayer`, `Layer` from `../EditCanvas`; `ShapeId` from `../shapes`.
- Produces: `BlendMode`, `ClipSpec`, `Scene`, `SceneSvg`, `measureTextLayer`.

**Why the renderer is a React component:** the export path serialises this exact component with `renderToStaticMarkup`. If the renderer were a string builder for export and JSX for live, the two could drift — which is the bug this whole plan exists to remove.

- [ ] **Step 1: Write the types**

Create `apps/web/components/studio/edit/scene/types.ts`:

```ts
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
```

- [ ] **Step 2: Write the shared text measurement**

Both paths must agree on how wide a text run is — the background pill rect and the sweep's overflow check both depend on it. One implementation, used by both.

Create `apps/web/components/studio/edit/scene/measure.ts`:

```ts
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
```

- [ ] **Step 3: Write the renderer**

Create `apps/web/components/studio/edit/scene/SceneSvg.tsx`:

```ts
import type { ImageLayer, TextLayer } from "../EditCanvas";
import type { Scene } from "./types";
import { layerText, measureTextLayer } from "./measure";

/** Padding around a text background pill, as a fraction of font size. Matches
 *  the value the DOM overlay used so existing templates look unchanged. */
const PILL_PAD_X = 0.35;
const PILL_PAD_Y = 0.18;

function clipPathId(layerId: string): string {
  return `clip-${layerId}`;
}

function TextNode({ layer, scene }: { layer: TextLayer; scene: Scene }) {
  const text = layerText(layer);
  const fontSize = layer.fontSize;
  const x = (layer.xPct / 100) * scene.width;
  const y = (layer.yPct / 100) * scene.height;
  const width = measureTextLayer(layer, fontSize);
  const padX = fontSize * PILL_PAD_X;
  const padY = fontSize * PILL_PAD_Y;

  return (
    <g
      opacity={layer.opacity ?? 1}
      style={{ mixBlendMode: (layer.blend ?? "normal") as React.CSSProperties["mixBlendMode"] }}
      transform={layer.rotation ? `rotate(${layer.rotation} ${x} ${y})` : undefined}
    >
      {layer.bgColor ? (
        <rect
          x={x - padX}
          y={y - padY}
          width={width + padX * 2}
          height={fontSize * 1.2 + padY * 2}
          fill={layer.bgColor}
          rx={fontSize * 0.15}
        />
      ) : null}
      <text
        x={x}
        y={y}
        fontFamily={layer.fontFamily}
        fontSize={fontSize}
        fontWeight={layer.bold ? 700 : 400}
        fontStyle={layer.italic ? "italic" : undefined}
        letterSpacing={layer.letterSpacing ? `${layer.letterSpacing}px` : undefined}
        fill={layer.color}
        stroke={layer.outlineWidth ? layer.outlineColor ?? "#000000" : undefined}
        strokeWidth={layer.outlineWidth || undefined}
        // paint-order is essential: without it the stroke is painted over the
        // fill and a 4px outline eats half the glyph.
        paintOrder="stroke fill"
        dominantBaseline="text-before-edge"
        style={layer.shadow !== false
          ? { filter: `drop-shadow(0 ${fontSize * 0.04}px ${fontSize * 0.08}px rgba(0,0,0,0.45))` }
          : undefined}
      >
        {text}
      </text>
    </g>
  );
}

function ImageNode({ layer, scene }: { layer: ImageLayer; scene: Scene }) {
  const x = (layer.xPct / 100) * scene.width;
  const y = (layer.yPct / 100) * scene.height;
  const w = (layer.widthPct / 100) * scene.width;
  const h = layer.heightPct != null
    ? (layer.heightPct / 100) * scene.height
    : (layer.aspectRatio > 0 ? w / layer.aspectRatio : w);
  const cx = x + w / 2;
  const cy = y + h / 2;

  return (
    <g
      opacity={layer.opacity ?? 1}
      style={{ mixBlendMode: (layer.blend ?? "normal") as React.CSSProperties["mixBlendMode"] }}
      transform={layer.rotation ? `rotate(${layer.rotation} ${cx} ${cy})` : undefined}
      clipPath={layer.clip ? `url(#${clipPathId(layer.id)})` : undefined}
    >
      <image
        href={layer.imageUrl}
        x={x}
        y={y}
        width={w}
        height={h}
        preserveAspectRatio={layer.fit === "contain" ? "xMidYMid meet" : "xMidYMid slice"}
      />
    </g>
  );
}

export function SceneSvg({ scene }: { scene: Scene }) {
  const visible = scene.layers.filter((l) => l.visible !== false);

  return (
    <svg
      width={scene.width}
      height={scene.height}
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {scene.baseImageUrl ? (
        <image
          href={scene.baseImageUrl}
          x={0}
          y={0}
          width={scene.width}
          height={scene.height}
          preserveAspectRatio="xMidYMid slice"
        />
      ) : null}
      {visible.map((layer) =>
        layer.type === "text"
          ? <TextNode key={layer.id} layer={layer} scene={scene} />
          : <ImageNode key={layer.id} layer={layer} scene={scene} />,
      )}
    </svg>
  );
}
```

Note: `layer.blend`, `layer.clip` and `layer.fit` do not exist on the layer types yet — Task 5 adds them. Until then TypeScript will error on those three property reads. **Add the optional fields to `TextLayer` and `ImageLayer` now**, as part of this step, so the renderer compiles:

In `apps/web/components/studio/edit/EditCanvas.tsx`, add to `TextLayer` (after `uppercase?: boolean;`):

```ts
  blend?: import("./scene/types").BlendMode;
```

and to `ImageLayer` (after `locked?: boolean;`):

```ts
  blend?: import("./scene/types").BlendMode;
  clip?: import("./scene/types").ClipSpec;
  fit?: "cover" | "contain";
```

The `<clipPath>` definitions themselves land in Task 5; until then `clip` is never set, so `clipPath` resolves to `undefined` and nothing references a missing id.

- [ ] **Step 4: Verify it compiles**

Run from `apps/web/`:

```bash
npm run typecheck
```

Expected: PASS, zero errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/studio/edit/scene apps/web/components/studio/edit/EditCanvas.tsx
git commit -m "feat(editor): add the SVG scene renderer

One React component renders the whole layer stack. The export path will
serialise this same component, so preview and export cannot diverge."
```

---

## Task 2: Mount the renderer in the live editor

**Files:**
- Modify: `apps/web/components/studio/edit/EditCanvas.tsx:717` (layer overlays block)

**Interfaces:**
- Consumes: `SceneSvg` and `Scene` from Task 1.
- Produces: layer overlays that are transparent hit-boxes, not painted elements.

The overlay elements at `EditCanvas.tsx:717` are currently *both* the visuals and the interaction surface. This step splits them: `SceneSvg` paints, the overlays keep their pointer handlers and become transparent.

- [ ] **Step 1: Mount SceneSvg beneath the overlays**

In `EditCanvas.tsx`, immediately before the `{/* Layer overlays ... */}` block, insert:

```tsx
        {/* Visual truth for all layers. The overlays below are transparent
            hit-boxes; this is the only thing that paints them. */}
        {canvasRect.width > 0 && (
          <div
            className="absolute pointer-events-none"
            style={{
              top: canvasRect.top,
              left: canvasRect.left,
              width: canvasRect.width,
              height: canvasRect.height,
            }}
          >
            <SceneSvg
              scene={{
                width: canvasRect.width,
                height: canvasRect.height,
                baseImageUrl: null,
                layers: visibleLayers,
              }}
            />
          </div>
        )}
```

`baseImageUrl` is null here because the base image is already painted by the existing `<img>` element behind the overlays; the scene only adds layers on top. The export path in Task 4 passes the real URL, because there it must paint everything.

Add the import at the top of the file:

```ts
import { SceneSvg } from "./scene/SceneSvg";
```

- [ ] **Step 2: Strip the paint from the text overlay**

In the `visibleLayers.map` block, the non-editing text branch currently renders the styled text. Replace its visual styling with a transparent box of the same geometry. Find the returned element for a text layer that is **not** being edited and replace its `style` payload so it paints nothing but keeps its box:

```tsx
              <div
                key={layer.id}
                className={cn(
                  "absolute select-none",
                  interactive ? "cursor-move" : "pointer-events-none",
                  isSelected && "ring-2 ring-primary",
                )}
                style={{
                  left: x,
                  top: y,
                  width: measureTextLayer(layer, layer.fontSize),
                  height: layer.fontSize * 1.2,
                  // Transparent: SceneSvg paints this layer.
                  color: "transparent",
                  transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
                  transformOrigin: "top left",
                }}
                onPointerDown={(e) => onLayerPointerDown(e, layer.id)}
                onDoubleClick={() => interactive && setEditingLayerId(layer.id)}
              >
                {layerText(layer)}
              </div>
```

Keep whatever handler names the existing code uses — do not rename them. The text content stays in the DOM so double-click-to-edit and accessibility tooling still find it; it is simply invisible.

Add to the imports:

```ts
import { measureTextLayer, layerText } from "./scene/measure";
```

- [ ] **Step 3: Strip the paint from the image overlay**

For the image-layer branch, remove the `<img>` that paints it and keep the positioned box:

```tsx
              <div
                key={layer.id}
                className={cn(
                  "absolute",
                  interactive ? "cursor-move" : "pointer-events-none",
                  isSelected && "ring-2 ring-primary",
                )}
                style={{
                  left: x,
                  top: y,
                  width: (layer.widthPct / 100) * canvasRect.width,
                  height: layer.heightPct != null
                    ? (layer.heightPct / 100) * canvasRect.height
                    : ((layer.widthPct / 100) * canvasRect.width) / (layer.aspectRatio || 1),
                  transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
                  transformOrigin: "center",
                }}
                onPointerDown={(e) => onLayerPointerDown(e, layer.id)}
              />
```

The inline-edit `<input>` branch is unchanged — it must stay visible, because it is what the user types into.

- [ ] **Step 4: Verify in the browser**

Run `npm run typecheck` (expect PASS), then `npm run dev` and open an image in the editor.

Check each of these explicitly:
1. Apply any template. It looks the same as before this change — same colours, positions, fonts.
2. Drag a text layer. It moves, and the visual follows the drag.
3. Double-click a text layer. The input appears and typing updates the text.
4. Select a layer. The selection ring appears around it.
5. Toggle a layer's visibility. It disappears and reappears.

If the visual lags the drag by a frame, that is expected and acceptable — both read the same state.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/studio/edit/EditCanvas.tsx
git commit -m "refactor(editor): paint layers with SceneSvg, keep overlays as hit-boxes

Layer overlays were both the visuals and the interaction surface. They now
carry only geometry, pointer handlers and selection chrome."
```

---

## Task 3: The rasteriser

**Files:**
- Create: `apps/web/components/studio/edit/scene/inlineImages.ts`
- Create: `apps/web/components/studio/edit/scene/rasterize.ts`

**Interfaces:**
- Consumes: `Scene`, `SceneSvg` from Task 1.
- Produces: `rasterizeScene(scene: Scene): Promise<string>` returning a PNG data URL.

Three failure modes here, each silent rather than loud. Handle all three.

- [ ] **Step 1: Write the image inliner**

An SVG that references a remote image taints the canvas, and `toDataURL` throws a `SecurityError`. Shapes and backgrounds are already data URIs (see the header of `shapes.ts`), so only the subject photo and user uploads need this.

Create `apps/web/components/studio/edit/scene/inlineImages.ts`:

```ts
/** Fetch a remote image and return it as a data URI.
 *  Rasterising an SVG that references a remote image taints the canvas and
 *  makes toDataURL throw, so every remote reference must be inlined first. */
async function toDataUri(url: string): Promise<string> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`Could not load image for export: ${res.status}`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read image for export"));
    reader.readAsDataURL(blob);
  });
}

function needsInlining(url: string): boolean {
  return !url.startsWith("data:");
}

/** Replace every remote image URL in a scene with a data URI.
 *  Returns a new scene; the input is not mutated. */
export async function inlineSceneImages<T extends {
  baseImageUrl: string | null;
  layers: { type: string; imageUrl?: string }[];
}>(scene: T): Promise<T> {
  const cache = new Map<string, Promise<string>>();
  const resolve = (url: string) => {
    if (!cache.has(url)) cache.set(url, toDataUri(url));
    return cache.get(url)!;
  };

  const base = scene.baseImageUrl && needsInlining(scene.baseImageUrl)
    ? await resolve(scene.baseImageUrl)
    : scene.baseImageUrl;

  const layers = await Promise.all(
    scene.layers.map(async (l) => {
      if (l.type !== "image" || !l.imageUrl || !needsInlining(l.imageUrl)) return l;
      return { ...l, imageUrl: await resolve(l.imageUrl) };
    }),
  );

  return { ...scene, baseImageUrl: base, layers };
}
```

- [ ] **Step 2: Write the rasteriser**

Create `apps/web/components/studio/edit/scene/rasterize.ts`:

```ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.browser";
import { SceneSvg } from "./SceneSvg";
import { inlineSceneImages } from "./inlineImages";
import { fontString } from "./measure";
import type { Scene } from "./types";
import type { TextLayer } from "../EditCanvas";

/** Wait for every font the scene actually uses. Rasterising before a display
 *  face has loaded silently renders the export in a fallback font: the preview
 *  is right and the download is wrong, with no error anywhere.
 *
 *  Build the shorthand with fontString from measure.ts — never by hand.
 *  document.fonts.load matches on the FULL shorthand including font-style, so
 *  a string that omits "italic" requests the normal face and leaves an italic
 *  layer unwaited. Playfair Display ships its italic as a separate file and is
 *  already used by shipped templates, so this is reachable, not theoretical. */
async function waitForFonts(scene: Scene): Promise<void> {
  const families = new Set<string>();
  for (const layer of scene.layers) {
    if (layer.type === "text") {
      const t = layer as TextLayer;
      families.add(fontString(t, t.fontSize));
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
```

- [ ] **Step 3: Verify it compiles**

```bash
npm run typecheck
```

Expected: PASS. If `react-dom/server.browser` has no types in this setup, add at the top of `rasterize.ts`:

```ts
// @ts-expect-error - react-dom/server.browser has no bundled types in React 18
import { renderToStaticMarkup } from "react-dom/server.browser";
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/studio/edit/scene
git commit -m "feat(editor): rasterise a scene to PNG via the shared renderer

Waits on the fonts the scene uses and inlines remote images first: both
fail silently otherwise, producing a wrong export with no error."
```

---

## Task 4: Switch the export path and delete the canvas-2D renderer

**Files:**
- Modify: `apps/web/app/(dashboard)/[projectId]/images/edit/[imageId]/page.tsx:351-470`

**Interfaces:**
- Consumes: `rasterizeScene` from Task 3.
- Produces: `handleBurnLayers` with no hand-written drawing code.

This is the load-bearing task. After it there is one renderer; everything later is additive.

- [ ] **Step 1: Replace the burn body**

Replace the whole body of `handleBurnLayers` (lines 351-470) with:

```ts
  async function handleBurnLayers() {
    if (layers.length === 0) return;
    setIsBurning(true);
    setBurnError(null);

    try {
      const baseUrl = displayImage?.image_url ?? "";
      const baseImg = baseUrl ? await loadImg(baseUrl) : null;
      const width = baseImg?.naturalWidth ?? 1024;
      const height = baseImg?.naturalHeight ?? 1024;

      // Layer geometry is in canvas percentages, so it is resolution
      // independent: the same scene renders at display size for preview and at
      // natural size here. No scale factors.
      const dataUrl = await rasterizeScene({
        width,
        height,
        baseImageUrl: hideBaseImage ? null : baseUrl,
        layers: layers.filter((l) => l.visible !== false),
      });

      await uploadBurnedImage(dataUrl);
    } catch (e) {
      setBurnError(e instanceof Error ? e.message : "Could not flatten the layers.");
    } finally {
      setIsBurning(false);
    }
  }
```

`uploadBurnedImage` is whatever the existing code does with its `canvas.toDataURL(...)` result at the end of the current function — read lines 460-470 and keep that tail exactly as it is, renaming it into a helper if it is inline. Do not change the upload behaviour in this task.

- [ ] **Step 2: Add the import and remove dead ones**

Add:

```ts
import { rasterizeScene } from "@/components/studio/edit/scene/rasterize";
```

Then remove any import now unused by the file (the typecheck in step 3 will name them).

- [ ] **Step 3: Verify**

```bash
npm run typecheck
```

Expected: PASS. If it reports unused variables from the deleted drawing code, delete those too.

- [ ] **Step 4: Verify in the browser — this is the critical check**

Run `npm run dev`. Open an image, apply a template with text and shapes, then press **Burn into image**.

Check all of:
1. The burned result matches the preview — same positions, same colours, same fonts.
2. Text is in the correct typeface, not a serif fallback. This is the font-loading failure mode; look closely.
3. The burned image has the same pixel dimensions as the source image.
4. A template with a gradient background burns with the gradient intact.
5. No `SecurityError` in the browser console. That would mean an image was not inlined.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/[projectId]/images/edit/[imageId]/page.tsx"
git commit -m "refactor(editor): burn layers through the shared scene renderer

Deletes the 120-line canvas-2D reimplementation of the layer stack. Preview
and export now run one component, so they cannot drift."
```

---

## Task 5: Image layers, clipping and blend modes in templates

**Files:**
- Modify: `apps/web/components/studio/edit/text-templates.ts`
- Modify: `apps/web/components/studio/edit/scene/SceneSvg.tsx`
- Modify: `apps/web/components/studio/edit/EditControlsPanel.tsx:457` (`applyTemplate`)

**Interfaces:**
- Consumes: `ClipSpec`, `BlendMode` from Task 1; `shapeDataUri`, `shapeAspect` from `../shapes`.
- Produces: `TemplateImageDef`; `TemplateLayerDef` widened to include it.

- [ ] **Step 1: Add the template image def**

In `text-templates.ts`, after `TemplateShapeDef`:

```ts
export interface TemplateImageDef {
  kind: "image";
  /** "subject" places the image being edited. An explicit url places a fixed asset. */
  source: "subject" | { url: string };
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct?: number;
  fit?: "cover" | "contain";
  clip?: ClipSpec;
  blend?: BlendMode;
  opacity?: number;
  rotation?: number;
}

export type TemplateLayerDef = TemplateTextDef | TemplateShapeDef | TemplateImageDef;
```

Add the import:

```ts
import type { BlendMode, ClipSpec } from "./scene/types";
```

- [ ] **Step 2: Render clip paths**

In `SceneSvg.tsx`, add a `<defs>` block emitting one `<clipPath>` per clipped layer. Insert this component above `SceneSvg`:

```tsx
function ClipDefs({ scene }: { scene: Scene }) {
  const clipped = scene.layers.filter(
    (l): l is ImageLayer => l.type === "image" && !!(l as ImageLayer).clip,
  );
  if (clipped.length === 0) return null;

  return (
    <defs>
      {clipped.map((layer) => {
        const clip = layer.clip!;
        const x = (layer.xPct / 100) * scene.width;
        const y = (layer.yPct / 100) * scene.height;
        const w = (layer.widthPct / 100) * scene.width;
        const h = layer.heightPct != null
          ? (layer.heightPct / 100) * scene.height
          : (layer.aspectRatio > 0 ? w / layer.aspectRatio : w);

        let node: JSX.Element;
        if ("roundedPct" in clip) {
          const r = (clip.roundedPct / 100) * Math.min(w, h);
          node = <rect x={x} y={y} width={w} height={h} rx={r} ry={r} />;
        } else if ("insetPct" in clip) {
          const [t, rr, b, ll] = clip.insetPct;
          node = (
            <rect
              x={x + (ll / 100) * w}
              y={y + (t / 100) * h}
              width={w - ((ll + rr) / 100) * w}
              height={h - ((t + b) / 100) * h}
            />
          );
        } else {
          // Shape clip: the shape's own SVG is used as the mask via an <image>
          // reference inside a clipPath, which requires clipPathUnits on a path.
          // Circles and ellipses cover the common cases directly; everything
          // else falls back to a rounded rect so a template never renders
          // unclipped and silently wrong.
          node = clip.shape === "circle"
            ? <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 2} />
            : <rect x={x} y={y} width={w} height={h} rx={Math.min(w, h) * 0.08} />;
        }

        return <clipPath key={layer.id} id={clipPathId(layer.id)}>{node}</clipPath>;
      })}
    </defs>
  );
}
```

Render it as the first child inside `<svg>` in `SceneSvg`:

```tsx
      <ClipDefs scene={scene} />
```

The shape-clip fallback is deliberate and must stay: a mask that fails should degrade to a rounded rectangle, never to no clipping at all, because unclipped is the version that looks broken.

- [ ] **Step 3: Convert image defs on apply**

In `EditControlsPanel.tsx`, inside `applyTemplate`'s `defs.forEach`, add a branch **before** the existing `def.kind === "shape"` branch:

```ts
      if (def.kind === "image") {
        const url = def.source === "subject"
          ? (subjectImageUrl ?? "")
          : def.source.url;
        if (!url) return; // no subject to place; skip rather than render an empty box
        newLayers.push({
          id: `tpl-${now}-${i}`,
          type: "image",
          imageUrl: url,
          name: def.source === "subject" ? "Photo" : "Image",
          xPct: def.xPct,
          yPct: def.yPct,
          widthPct: def.widthPct,
          heightPct: def.heightPct,
          aspectRatio: canvasAspect,
          fit: def.fit ?? "cover",
          clip: def.clip,
          blend: def.blend,
          opacity: def.opacity ?? 1,
          rotation: def.rotation,
          visible: true,
        });
        return;
      }
```

`subjectImageUrl` is a new prop on `EditControlsPanel` carrying the URL of the image being edited. Add it to the component's props type as `subjectImageUrl?: string;` and pass it from the edit page as `subjectImageUrl={displayImage?.image_url}`.

- [ ] **Step 4: Hide the base image when a template places the subject**

A template that places the photo must not also have it as the backdrop. At the end of `applyTemplate`, after `onSetLayers`:

```ts
    const placesSubject = defs.some(
      (d) => d.kind === "image" && (d as TemplateImageDef).source === "subject",
    );
    if (placesSubject) onHideBaseImage?.(true);
```

`onHideBaseImage` already exists as a prop (`EditControlsPanel.tsx:2727` region, passed from the edit page).

- [ ] **Step 5: Verify**

```bash
npm run typecheck
```

Expected: PASS.

Then in the browser, temporarily add this template to `TEXT_TEMPLATES` to exercise the new path end to end:

```ts
  {
    id: "test-framed",
    name: "Test framed inset",
    category: "social",
    background: { type: "gradient", colors: ["#0f172a", "#334155"], angle: 135 },
    layers: [
      { kind: "image", source: "subject", xPct: 20, yPct: 12, widthPct: 60,
        heightPct: 45, fit: "cover", clip: { shape: "circle" } },
      { kind: "text", type: "text", text: "FRAMED", xPct: 20, yPct: 62,
        fontSize: 64, color: "#ffffff", bold: true, italic: false,
        fontFamily: "Inter", visible: true, uppercase: true },
    ],
  },
```

Check: the photo appears clipped to a circle on the gradient, the base image is not also showing behind it, and burning produces the same result.

Remove the test template before committing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/studio/edit
git commit -m "feat(editor): templates can place, clip and blend the edited photo

Adds TemplateImageDef with a subject source, ClipSpec-driven clip paths and
blend modes, so a template can compose with the photo rather than only
decorate over it."
```

---

## Task 6: Extract the template picker and layers panel

**Files:**
- Create: `apps/web/components/studio/edit/TemplatePicker.tsx`
- Create: `apps/web/components/studio/edit/LayersPanel.tsx`
- Modify: `apps/web/components/studio/edit/EditControlsPanel.tsx`

**Interfaces:**
- Produces: `<TemplatePicker onApply={(t: TextTemplate) => void} brandKit={...} subjectImageUrl={...} />` and `<LayersPanel layers={...} ... />`.

`EditControlsPanel.tsx` is 2,495 lines and holds the picker, every tool's controls, and the mask-confirm UI. Both halves of this work land in it. Extract only these two; leave the rest.

- [ ] **Step 1: Move the picker**

Cut the picker JSX (the block around `EditControlsPanel.tsx:1611-1800`, containing the category tabs at 1742 and the template grid at 1769) into `TemplatePicker.tsx` as a component with this signature:

```tsx
"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { BrandKit } from "@/lib/api";
import {
  TEXT_TEMPLATES, TEMPLATE_CATEGORIES, type TextTemplate, type TemplateCategory,
} from "./text-templates";

export interface TemplatePickerProps {
  onApply: (t: TextTemplate) => void;
  brandKit?: BrandKit | null;
  brandTemplates: boolean;
  subjectImageUrl?: string;
}

export function TemplatePicker({ onApply, brandKit, brandTemplates, subjectImageUrl }: TemplatePickerProps) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<"all" | TemplateCategory>("all");
  const [query, setQuery] = useState("");

  const shown = TEXT_TEMPLATES.filter((tpl) => {
    if (category !== "all" && tpl.category !== category) return false;
    if (!query.trim()) return true;
    return tpl.name.toLowerCase().includes(query.trim().toLowerCase());
  });

  // ... category tabs, search input, and the template grid go here
  return null; // replaced by the moved JSX
}
```

Move `templateCategory` state (`EditControlsPanel.tsx:341`) into this component. `applyTemplate` stays in `EditControlsPanel` and is passed as `onApply`, because it needs canvas geometry the picker does not have.

- [ ] **Step 2: Add the search field**

At ~38 templates a flat grid is hard to scan. Above the grid, inside `TemplatePicker`:

```tsx
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("imageEdit.templates.search", "Search templates")}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />
```

Add the key to `apps/web/public/locales/en/common.json` under `imageEdit.templates.search` with the value `"Search templates"`, and to the other locale files present in that directory with the same English value as a placeholder for translation.

- [ ] **Step 3: Move the layers list**

Cut the layers list JSX (around `EditControlsPanel.tsx:2170-2200`, the block with the move-up, move-down and remove buttons) into `LayersPanel.tsx`:

```tsx
export interface LayersPanelProps {
  layers: Layer[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string) => void;
  onMoveLayerUp: (id: string) => void;
  onMoveLayerDown: (id: string) => void;
  onRemoveLayer: (id: string) => void;
  onToggleLayerVisible: (id: string) => void;
}
```

Pass the existing handlers straight through from `EditControlsPanel`.

- [ ] **Step 4: Verify**

```bash
npm run typecheck
```

Expected: PASS.

In the browser: the template picker renders, category tabs filter, the search box filters by name, applying a template still works, and the layers list still reorders, hides and deletes layers.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/studio/edit apps/web/public/locales
git commit -m "refactor(editor): extract TemplatePicker and LayersPanel

EditControlsPanel held the picker, every tool's controls and the mask-confirm
UI in 2,495 lines. Both halves of the template work land in it, so the two
pieces it touches move out. Adds a name filter for the larger set."
```

---

## Task 7: Palette and typography roles

**Files:**
- Create: `apps/web/components/studio/edit/palette.ts`

**Interfaces:**
- Consumes: `BrandKit` from `@/lib/api`; `shadeHex` from `./shapes`.
- Produces: `PaletteRole`, `Palette`, `resolvePalette`, `FONT_ROLES`, `TYPE_SCALE`, and the relocated `TemplateCategory` and `bestTextOn`.

Templates declare roles, not hexes, so 38 templates cannot drift apart and brand resolution has one place to happen.

**Import direction matters here.** `text-templates.ts` will import `resolvePalette` from this module in Task 9. So this module must not import from `text-templates.ts`, or the two form a cycle. `TemplateCategory` and `bestTextOn` (currently at `text-templates.ts:535`) therefore **move into `palette.ts`**, and `text-templates.ts` re-exports them so existing importers keep working:

```ts
// in text-templates.ts, replacing the bestTextOn definition and the
// TemplateCategory type alias
export { bestTextOn, type TemplateCategory } from "./palette";
```

- [ ] **Step 1: Write the module**

Create `apps/web/components/studio/edit/palette.ts`. Move the body of `bestTextOn` from `text-templates.ts:535` into it verbatim — do not reimplement it:

```ts
import type { BrandKit } from "@/lib/api";
import { shadeHex } from "./shapes";

export type TemplateCategory = "ecommerce" | "social" | "blog" | "promo";

/** Moved verbatim from text-templates.ts to break the import cycle. */
export function bestTextOn(hex: string): string {
  // ... existing body, unchanged
}

export type PaletteRole = "surface" | "ink" | "accent" | "onAccent";

export type Palette = Record<PaletteRole, string>;

/** Per-category fallbacks, used when the org has no brand kit. Chosen for
 *  contrast: every ink/surface and onAccent/accent pair clears 4.5:1. */
const DEFAULTS: Record<TemplateCategory, Palette> = {
  ecommerce: { surface: "#0f172a", ink: "#f8fafc", accent: "#e11d48", onAccent: "#ffffff" },
  social:    { surface: "#1e1b4b", ink: "#f5f3ff", accent: "#f59e0b", onAccent: "#1c1917" },
  blog:      { surface: "#f8fafc", ink: "#0f172a", accent: "#2563eb", onAccent: "#ffffff" },
  promo:     { surface: "#18181b", ink: "#fafafa", accent: "#facc15", onAccent: "#18181b" },
};

export function resolvePalette(
  category: TemplateCategory,
  brand?: BrandKit | null,
  useBrand = false,
): Palette {
  const base = DEFAULTS[category];
  if (!useBrand || !brand?.primary_color) return base;

  const accent = brand.primary_color;
  const surface = brand.secondary_color ?? shadeHex(accent, 0.25);
  return {
    surface,
    ink: bestTextOn(surface),
    accent,
    onAccent: bestTextOn(accent),
  };
}

/** Three type roles. Templates name a role; the role picks the face. */
export const FONT_ROLES = {
  impact: "Anton",
  modern: "Inter",
  support: "Source Sans 3",
} as const;

export type FontRole = keyof typeof FONT_ROLES;

/** Sizes at the ~800px reference canvas. The 5:1 headline-to-support ratio is
 *  enforced here rather than per-template: flat hierarchy is the single most
 *  common reason a composition reads as amateur. */
export const TYPE_SCALE = {
  headline: 80,
  subhead: 34,
  support: 16,
} as const;
```

- [ ] **Step 2: Load the display fonts**

The impact face must actually be available or every headline silently falls back. In `apps/web/app/layout.tsx`, add Anton and Source Sans 3 alongside the existing font setup, following whatever pattern that file already uses (`next/font/google` or a stylesheet link). If it uses `next/font/google`:

```ts
import { Anton, Source_Sans_3 } from "next/font/google";

const anton = Anton({ subsets: ["latin"], weight: "400", variable: "--font-anton" });
const sourceSans = Source_Sans_3({ subsets: ["latin"], variable: "--font-source-sans" });
```

and add `anton.variable` and `sourceSans.variable` to the `<body>` className list.

- [ ] **Step 3: Verify**

```bash
npm run typecheck
```

Expected: PASS.

In the browser, open devtools and run `document.fonts.check("40px Anton")`. Expected: `true`. If false, the font is not loaded and every impact headline will export in a fallback face.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/studio/edit/palette.ts apps/web/app/layout.tsx
git commit -m "feat(editor): palette and typography roles for templates

Templates name roles instead of hexes, so brand resolution happens once and
38 compositions cannot drift apart. Enforces the 5:1 headline ratio in the
scale rather than per-template."
```

---

## Task 8: The seven families, one template each, and the sweep route

**Files:**
- Create: `apps/web/components/studio/edit/families.ts`
- Create: `apps/web/app/dev/template-sweep/page.tsx`
- Modify: `apps/web/components/studio/edit/text-templates.ts`

**Interfaces:**
- Consumes: `Palette`, `FONT_ROLES`, `TYPE_SCALE` from Task 7; `TemplateImageDef` from Task 5.
- Produces: seven builder functions, each `(opts) => TemplateLayerDef[]`.

**This task is the checkpoint.** It produces seven families with one template each so the design direction can be judged before committing to the full set in Task 9.

- [ ] **Step 1: Write two families**

Create `apps/web/components/studio/edit/families.ts`. Start with the two that exercise the most machinery:

```ts
import type { TemplateLayerDef } from "./text-templates";
import type { Palette } from "./palette";
import { FONT_ROLES, TYPE_SCALE } from "./palette";

export interface FamilyCopy {
  headline: string;
  subhead?: string;
  support?: string;
}

/** Scrim stack: full-bleed photo, gradient scrim, headline stacked low.
 *  The scrim is mandatory — text over a bare photo is unreadable on light
 *  images, and this is a property of the family so it cannot be forgotten. */
export function scrimStack(p: Palette, copy: FamilyCopy): TemplateLayerDef[] {
  return [
    { kind: "image", source: "subject", xPct: 0, yPct: 0, widthPct: 100, heightPct: 100, fit: "cover" },
    { kind: "shape", shape: "rect", color: p.surface, xPct: 0, yPct: 45, widthPct: 100, opacity: 0.82 },
    { kind: "text", type: "text", text: copy.headline, xPct: 8, yPct: 62,
      fontSize: TYPE_SCALE.headline, color: p.ink, bold: true, italic: false,
      fontFamily: FONT_ROLES.impact, visible: true, uppercase: true,
      letterSpacing: -1, shadow: false, fontRole: "heading" },
    ...(copy.support ? [{
      kind: "text" as const, type: "text" as const, text: copy.support, xPct: 8, yPct: 84,
      fontSize: TYPE_SCALE.support, color: p.ink, bold: false, italic: false,
      fontFamily: FONT_ROLES.support, visible: true, opacity: 0.85, shadow: false,
      fontRole: "body" as const,
    }] : []),
  ];
}

/** Framed inset: photo clipped to a shape, offset on a colour field. */
export function framedInset(p: Palette, copy: FamilyCopy): TemplateLayerDef[] {
  return [
    { kind: "image", source: "subject", xPct: 14, yPct: 8, widthPct: 72, heightPct: 52,
      fit: "cover", clip: { shape: "circle" } },
    { kind: "text", type: "text", text: copy.headline, xPct: 10, yPct: 66,
      fontSize: TYPE_SCALE.headline, color: p.ink, bold: true, italic: false,
      fontFamily: FONT_ROLES.impact, visible: true, uppercase: true,
      letterSpacing: -1, shadow: false, fontRole: "heading" },
    ...(copy.subhead ? [{
      kind: "text" as const, type: "text" as const, text: copy.subhead, xPct: 10, yPct: 86,
      fontSize: TYPE_SCALE.subhead, color: p.accent, bold: false, italic: false,
      fontFamily: FONT_ROLES.modern, visible: true, shadow: false,
      fontRole: "body" as const,
    }] : []),
  ];
}
```

- [ ] **Step 2: Write the remaining five families**

Add to the same file, following the shape of the two above. Each must obey the readability constraint — any text over the photo sits on a scrim, band or solid field.

- `splitBlock(p, copy)` — photo at `xPct: 0, widthPct: 52, heightPct: 100, fit: "cover"`; a `rect` in `p.surface` at `xPct: 52, widthPct: 48`; headline and support inside that block starting at `xPct: 58`.
- `editorialBand(p, copy)` — photo full-bleed; a `rect` in `p.surface` at `yPct: 72, widthPct: 100, opacity: 1`; headline at `yPct: 76` in `FONT_ROLES.modern` at `TYPE_SCALE.subhead`, support beneath it.
- `priceCorner(p, copy)` — photo full-bleed; a `seal` shape in `p.accent` at `xPct: 66, yPct: 8, widthPct: 28`; `copy.headline` centred over the seal in `p.onAccent` at `TYPE_SCALE.subhead`.
- `posterStack(p, copy)` — a `rect` in `p.surface` full-bleed; headline at `fontSize: TYPE_SCALE.headline * 1.4` with `letterSpacing: -3` at `yPct: 18`; photo at `xPct: 10, yPct: 34, widthPct: 80, heightPct: 56` with `clip: { roundedPct: 4 }`.
- `bento(p, copy)` — photo at `xPct: 4, yPct: 4, widthPct: 56, heightPct: 92, clip: { roundedPct: 5 }`; a `rect` in `p.accent` at `xPct: 63, yPct: 4, widthPct: 33, heightPct: 44, `; headline inside it in `p.onAccent`.

- [ ] **Step 3: Add one template per family**

In `text-templates.ts`, replace `TEXT_TEMPLATES` with seven entries — one per family — built through `resolvePalette`. Keep the existing 31 in the file for now, exported as `LEGACY_TEXT_TEMPLATES`, so the sweep can compare old against new.

- [ ] **Step 4: Write the sweep route**

Create `apps/web/app/dev/template-sweep/page.tsx`. This is the substitute for a test suite: it renders every template and reports mechanical PASS/FAIL, not just pictures.

```tsx
"use client";

import { useEffect, useState } from "react";
import { TEXT_TEMPLATES } from "@/components/studio/edit/text-templates";
import { SceneSvg } from "@/components/studio/edit/scene/SceneSvg";
import { rasterizeScene } from "@/components/studio/edit/scene/rasterize";
import { measureTextLayer } from "@/components/studio/edit/scene/measure";

const TEST_PHOTO = "/dev/sweep-test-photo.jpg";
const W = 800;
const H = 800;

interface Check { name: string; pass: boolean; detail: string }

export default function TemplateSweepPage() {
  const [rows, setRows] = useState<{ id: string; png: string; checks: Check[] }[]>([]);

  useEffect(() => {
    (async () => {
      const out = [];
      for (const tpl of TEXT_TEMPLATES) {
        const layers = templateToLayers(
          { background: tpl.background ?? null, layers: tpl.layers }, TEST_PHOTO, W, H);
        const scene = { width: W, height: H, baseImageUrl: null, layers };
        const checks: Check[] = [];

        // 1. Fonts: every face the scene uses must be loaded, or the export
        //    silently renders in a fallback.
        const faces = [...new Set(layers.filter((l) => l.type === "text")
          .map((l: any) => `${l.fontSize}px ${l.fontFamily}`))];
        const missing = faces.filter((f) => !document.fonts.check(f));
        checks.push({ name: "fonts", pass: missing.length === 0, detail: missing.join(", ") || "all loaded" });

        // 2. Overflow: no text run may extend past the canvas.
        const over = layers.filter((l: any) =>
          l.type === "text" && (l.xPct / 100) * W + measureTextLayer(l, l.fontSize) > W);
        checks.push({ name: "text in bounds", pass: over.length === 0,
          detail: over.map((l: any) => l.text).join(", ") || "ok" });

        // 3. Export: rasterises, and at the requested size.
        let png = "";
        try {
          png = await rasterizeScene(scene);
          const img = await new Promise<HTMLImageElement>((res, rej) => {
            const el = new Image(); el.onload = () => res(el); el.onerror = rej; el.src = png;
          });
          checks.push({ name: "export size", pass: img.naturalWidth === W && img.naturalHeight === H,
            detail: `${img.naturalWidth}x${img.naturalHeight}` });
        } catch (e) {
          checks.push({ name: "export", pass: false, detail: String(e) });
        }

        out.push({ id: tpl.id, png, checks });
      }
      setRows(out);
    })();
  }, []);

  return (
    <div className="p-8 space-y-10">
      <h1 className="text-2xl font-bold">Template sweep</h1>
      {rows.map((r) => (
        <section key={r.id} className="space-y-2">
          <h2 className="font-semibold">{r.id}</h2>
          <div className="flex gap-6">
            <div style={{ width: 320 }}>
              <p className="text-xs mb-1">Preview</p>
              {/* live render, same component as export */}
            </div>
            <div style={{ width: 320 }}>
              <p className="text-xs mb-1">Export</p>
              {r.png ? <img src={r.png} alt="" style={{ width: 320 }} /> : null}
            </div>
            <ul className="text-sm">
              {r.checks.map((c) => (
                <li key={c.name} className={c.pass ? "text-green-600" : "text-red-600"}>
                  {c.pass ? "PASS" : "FAIL"} {c.name}: {c.detail}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}
```

`templateToLayers` converts a resolved template into `Layer[]` — extract that logic out of `applyTemplate` in `EditControlsPanel.tsx` into an exported function in `text-templates.ts` so the sweep and the editor share it rather than diverging. Import it in the sweep with `import { TEXT_TEMPLATES, templateToLayers } from "@/components/studio/edit/text-templates";`:

```ts
export function templateToLayers(
  t: ResolvedTemplate, subjectUrl: string, width: number, height: number,
): Layer[]
```

Then `applyTemplate` calls it too. Place a test photo at `apps/web/public/dev/sweep-test-photo.jpg` — any photo with both light and dark regions, so scrim contrast is actually exercised.

- [ ] **Step 5: Run the sweep**

```bash
npm run dev
```

Open `http://localhost:3000/dev/template-sweep`.

Expected: seven sections, every check PASS. Any FAIL is a real defect — fix it before commit. Then look at the seven previews and judge whether the design direction holds.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/studio/edit apps/web/app/dev apps/web/public/dev
git commit -m "feat(editor): seven composition families and the template sweep

One template per family, plus a dev route that renders and exports every
template with mechanical checks for font loading, text overflow and export
size. This is the checkpoint before building the full set."
```

**STOP HERE and show the sweep output before starting Task 9.** Task 9 is the expensive stretch; the point of this checkpoint is to judge direction before paying for it.

---

## Task 9: The full template set

**Files:**
- Modify: `apps/web/components/studio/edit/text-templates.ts`

**Interfaces:**
- Consumes: the seven family builders from Task 8; `resolvePalette` from Task 7.

- [ ] **Step 1: Build the set**

Expand `TEXT_TEMPLATES` to 34-38 entries by instantiating families per category, with copy appropriate to each:

| Category | Families to instantiate | Count |
| --- | --- | --- |
| ecommerce | splitBlock x3, priceCorner x3, bento x2, scrimStack x1 | 9 |
| social | scrimStack x3, framedInset x3, posterStack x2, editorialBand x1 | 9 |
| blog | editorialBand x3, scrimStack x2, bento x2, framedInset x1 | 8 |
| promo | posterStack x3, priceCorner x2, splitBlock x2, scrimStack x1 | 8 |

Total: 34. Vary each instance by palette, copy, and one composition parameter (crop shape, block side, headline position) — not by inventing new structure, which is what produced 31 unrelated one-offs.

- [ ] **Step 2: Delete the legacy set**

Remove `LEGACY_TEXT_TEMPLATES` and its export. Nothing references it outside the sweep.

- [ ] **Step 3: Run the sweep**

Open `http://localhost:3000/dev/template-sweep`.

Expected: 34 sections, every check PASS. Fix any FAIL before commit.

- [ ] **Step 4: Visual pass**

Scroll the whole sweep and check:
1. No headline overflows its slot or collides with another layer.
2. Every text run over a photo sits on a scrim, band or solid field.
3. Each family is recognisable across its instances but the instances are distinct.
4. Preview and export match for every row.

- [ ] **Step 5: Verify in the real editor**

```bash
npm run typecheck
```

Expected: PASS.

Then in the editor: apply four templates from different categories, confirm each looks like its sweep preview, edit a headline in one, and burn it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/studio/edit/text-templates.ts
git commit -m "feat(editor): rebuild the template set on the seven families

34 templates across four categories, each a real layout that places the
edited photo rather than decorating over it. Replaces the 31 flat
compositions the old renderer could express."
```

---

## Self-Review Notes

**Spec coverage.** Section 1 (one renderer) is Tasks 1-4. Section 2 (scene model: photo slot, clipping, blend, gradients, brand awareness) is Task 5, with palette roles in Task 7. Section 3 (seven families, typography, colour roles, readability constraint) is Tasks 7-9. Section 4 (picker previews, search, panel extraction) is Task 6; the "lands in an editable state" item needs no task, per the spec's own note that `applyTemplate` already does it. Section 5 (fonts, taint, blend divergence, sweep, backwards compatibility) is Tasks 3, 8 and 9. Section 6's order of work maps one-to-one onto the task order.

**One gap accepted deliberately.** Spec section 4 asks that picker thumbnails render through `SceneSvg` with the user's own photo. Task 6 extracts the picker but keeps its existing CSS miniatures; converting them is folded into Task 8, where the families exist to render. If Task 6's reviewer flags the thumbnails as unconverted, that is expected and not a defect.

**Known constraint on shape clipping.** Task 5 renders circle clips natively and falls back to a rounded rect for other `ShapeId` values. Full shape-mask support needs the shape SVG as a `<clipPath>` path rather than an `<image>`, which `shapes.ts` does not currently expose. Templates in Tasks 8 and 9 use only `circle`, `roundedPct` and `insetPct`, so nothing ships on the fallback path.
