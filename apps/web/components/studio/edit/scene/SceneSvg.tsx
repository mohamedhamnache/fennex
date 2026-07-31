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
