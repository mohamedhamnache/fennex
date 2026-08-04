import type { ImageLayer, TextLayer } from "../EditCanvas";
import type { Scene } from "./types";
import { layerText, textBox, textMetrics } from "./measure";

function clipPathId(layerId: string): string {
  return `clip-${layerId}`;
}

/** Pixel rect an image layer occupies in the scene. Single source of truth for
 *  both the clip geometry (ClipDefs) and the drawn image (ImageNode) — they
 *  must never compute this independently, or a change to one silently
 *  misaligns the other. */
function layerRect(layer: ImageLayer, scene: Scene): { x: number; y: number; w: number; h: number } {
  const x = (layer.xPct / 100) * scene.width;
  const y = (layer.yPct / 100) * scene.height;
  const w = (layer.widthPct / 100) * scene.width;
  const h = layer.heightPct != null
    ? (layer.heightPct / 100) * scene.height
    : (layer.aspectRatio > 0 ? w / layer.aspectRatio : w);
  return { x, y, w, h };
}

function TextNode({ layer, scene }: { layer: TextLayer; scene: Scene }) {
  const text = layerText(layer);
  // Type metrics are percentages of canvas width, resolved here against the
  // width this scene is actually being painted at. That is the whole reason the
  // preview at display size and the export at natural size are the same
  // picture: nothing in the layer carries a resolution with it.
  const { fontSize, letterSpacing, outlineWidth } = textMetrics(layer, scene.width);
  const x = (layer.xPct / 100) * scene.width;
  const y = (layer.yPct / 100) * scene.height;
  const box = textBox(layer, scene.width, x, y);

  return (
    <g
      opacity={layer.opacity ?? 1}
      style={{ mixBlendMode: (layer.blend ?? "normal") as React.CSSProperties["mixBlendMode"] }}
      transform={layer.rotation ? `rotate(${layer.rotation} ${x} ${y})` : undefined}
    >
      {layer.bgColor ? (
        <rect
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
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
        letterSpacing={letterSpacing ? `${letterSpacing}px` : undefined}
        fill={layer.color}
        stroke={outlineWidth ? layer.outlineColor ?? "#000000" : undefined}
        strokeWidth={outlineWidth || undefined}
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

function ClipDefs({ scene }: { scene: Scene }) {
  const clipped = scene.layers.filter(
    (l): l is ImageLayer => l.type === "image" && !!(l as ImageLayer).clip,
  );
  if (clipped.length === 0) return null;

  return (
    <defs>
      {clipped.map((layer) => {
        const clip = layer.clip!;
        const { x, y, w, h } = layerRect(layer, scene);

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

/** How an image layer fills its box.
 *
 *  Stretching is opt-in and carried by `fit: "fill"`, which only
 *  `templateToLayers` sets, and only on template shape layers. Those are flat
 *  vector artwork authored against their box — the shape SVGs already declare
 *  preserveAspectRatio="none" internally — and slicing one to its box aspect
 *  crops the artwork: a 33x44 rounded panel is scaled to a square and trimmed on
 *  both sides, taking most of the corner radius with it, so the cell renders
 *  nearly square.
 *
 *  It deliberately does NOT key off `heightPct`. Every one of the eight resize
 *  handles writes `heightPct`, and no non-template producer of an image layer
 *  sets `fit` at all, so keying off the height would make the first drag of a
 *  resize handle on an added image or an AI-decomposed object silently switch it
 *  from cropping to stretching. Anything that is or might be a photograph falls
 *  through to slice. */
function preserveAspectRatio(layer: ImageLayer): string {
  if (layer.fit === "contain") return "xMidYMid meet";
  if (layer.fit === "fill") return "none";
  return "xMidYMid slice";
}

function ImageNode({ layer, scene }: { layer: ImageLayer; scene: Scene }) {
  const { x, y, w, h } = layerRect(layer, scene);
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
        preserveAspectRatio={preserveAspectRatio(layer)}
      />
    </g>
  );
}

/** `fontCss` is `@font-face` rules with base64 `src:`, supplied only by the
 *  rasteriser. The live preview needs nothing here: it renders inside the app's
 *  document and inherits its webfonts. The export does not — an SVG in a
 *  Blob-backed `<img>` is an isolated document with no access to them — so
 *  rasterize.ts resolves the faces and passes them in. See inlineFonts.ts.
 *
 *  Written raw rather than as a text child because React escapes text children
 *  as HTML entities; inlineFonts.ts sanitises the family names, and base64 and
 *  the rest of the CSS grammar contain no `<` or `&` to break the XML. */
export function SceneSvg({ scene, fontCss }: { scene: Scene; fontCss?: string }) {
  const visible = scene.layers.filter((l) => l.visible !== false);

  return (
    <svg
      width={scene.width}
      height={scene.height}
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {fontCss ? <style dangerouslySetInnerHTML={{ __html: fontCss }} /> : null}
      <ClipDefs scene={scene} />
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
