/** SVG shape and background builders — used by the Shapes tool and design templates.
 *  Everything is emitted as a data URI so it works as a normal ImageLayer and
 *  draws onto the burn canvas without CORS issues.
 *
 *  Every shape gets a uniform transparent margin (PAD) inside its viewBox so
 *  drop shadows are never clipped; SHAPE_ASPECT accounts for it. */

export type ShapeId =
  // Basic
  | "rect" | "rounded" | "circle" | "pill" | "triangle" | "diamond" | "hexagon"
  // Badges & markers
  | "star" | "seal" | "burst" | "ribbon" | "tag" | "pin" | "bubble"
  // Lines & arrows
  | "line" | "arrow"
  // Decor
  | "ring" | "frame" | "blob" | "sparkle" | "heart";

export interface ShapeStyle {
  color: string;
  /** Second gradient stop; defaults to a darker shade of `color`. */
  color2?: string;
  gradient?: boolean;
  shadow?: boolean;
}

export const SHAPE_GROUPS: { label: string; shapes: { id: ShapeId; label: string }[] }[] = [
  {
    label: "Basic",
    shapes: [
      { id: "rect", label: "Square" },
      { id: "rounded", label: "Rounded" },
      { id: "circle", label: "Circle" },
      { id: "pill", label: "Pill" },
      { id: "triangle", label: "Triangle" },
      { id: "diamond", label: "Diamond" },
      { id: "hexagon", label: "Hexagon" },
    ],
  },
  {
    label: "Badges & markers",
    shapes: [
      { id: "star", label: "Star" },
      { id: "seal", label: "Seal" },
      { id: "burst", label: "Burst" },
      { id: "ribbon", label: "Ribbon" },
      { id: "tag", label: "Tag" },
      { id: "pin", label: "Pin" },
      { id: "bubble", label: "Speech bubble" },
    ],
  },
  {
    label: "Lines & arrows",
    shapes: [
      { id: "line", label: "Line" },
      { id: "arrow", label: "Arrow" },
    ],
  },
  {
    label: "Decor",
    shapes: [
      { id: "ring", label: "Ring" },
      { id: "frame", label: "Frame" },
      { id: "blob", label: "Blob" },
      { id: "sparkle", label: "Sparkle" },
      { id: "heart", label: "Heart" },
    ],
  },
];

export const SHAPES: { id: ShapeId; label: string }[] = SHAPE_GROUPS.flatMap((g) => g.shapes);

const PAD = 24; // transparent bleed added ONLY when a drop shadow needs room

/** TIGHT viewBox per shape [x, y, w, h] — hugs the geometry exactly (including
 *  stroke extents), so the layer box matches the visible shape with no spacing. */
const SHAPE_VB: Record<ShapeId, [number, number, number, number]> = {
  rect: [0, 0, 200, 200],
  rounded: [0, 0, 200, 200],
  circle: [0, 0, 200, 200],
  pill: [0, 0, 200, 80],
  triangle: [8, 8, 184, 184],
  diamond: [4, 4, 192, 192],
  hexagon: [16, 6, 168, 188],
  star: [4, 6, 192, 184],
  seal: [-7, -7, 214, 214],
  burst: [2, 2, 196, 196],
  ribbon: [0, 5, 200, 60],
  tag: [8, 12, 188, 96],
  pin: [25, 5, 150, 190],
  bubble: [8, 8, 184, 156],
  line: [0, 2, 240, 16],
  arrow: [3, 7, 154, 86],
  ring: [2, 2, 196, 196],
  frame: [3, 3, 194, 194],
  blob: [-3, -3, 202, 204],
  sparkle: [4, 4, 192, 192],
  heart: [10, 14, 180, 164],
};

/** Layer aspect ratio for a shape. Shadowed shapes carry bleed padding, so
 *  their box is slightly larger — keep the layer's aspect in sync with it. */
export function shapeAspect(shape: ShapeId, shadow = false): number {
  const [, , w, h] = SHAPE_VB[shape];
  const p = shadow ? PAD * 2 : 0;
  return (w + p) / (h + p);
}

/** Tight (no-shadow) aspect ratios, kept for convenience. */
export const SHAPE_ASPECT: Record<ShapeId, number> = Object.fromEntries(
  (Object.entries(SHAPE_VB) as [ShapeId, [number, number, number, number]][]).map(
    ([id, [, , w, h]]) => [id, w / h],
  ),
) as Record<ShapeId, number>;

/** Shape geometry: F is the paint (solid colour or gradient url). */
function body(shape: ShapeId, F: string): string {
  switch (shape) {
    case "rect":     return `<rect width="200" height="200" fill="${F}"/>`;
    case "rounded":  return `<rect width="200" height="200" rx="28" fill="${F}"/>`;
    case "circle":   return `<circle cx="100" cy="100" r="100" fill="${F}"/>`;
    case "pill":     return `<rect width="200" height="80" rx="40" fill="${F}"/>`;
    case "triangle": return `<polygon points="100,8 192,192 8,192" fill="${F}"/>`;
    case "diamond":  return `<polygon points="100,4 196,100 100,196 4,100" fill="${F}"/>`;
    case "hexagon":  return `<polygon points="100,6 184,53 184,147 100,194 16,147 16,53" fill="${F}"/>`;
    case "star":     return `<polygon points="100,6 124,74 196,76 138,120 158,190 100,148 42,190 62,120 4,76 76,74" fill="${F}"/>`;
    case "seal": {
      const scallops = Array.from({ length: 12 }, (_, i) => {
        const a = (i * 30 * Math.PI) / 180;
        const x = (100 + 90 * Math.cos(a)).toFixed(1);
        const y = (100 + 90 * Math.sin(a)).toFixed(1);
        return `<circle cx="${x}" cy="${y}" r="17" fill="${F}"/>`;
      }).join("");
      return `<circle cx="100" cy="100" r="90" fill="${F}"/>${scallops}`;
    }
    case "burst":    return `<polygon points="198,100 153.6,122.2 169.3,169.3 122.2,153.6 100,198 77.8,153.6 30.7,169.3 46.4,122.2 2,100 46.4,77.8 30.7,30.7 77.8,46.4 100,2 122.2,46.4 169.3,30.7 153.6,77.8" fill="${F}"/>`;
    case "ribbon":   return `<polygon points="0,5 200,5 184,35 200,65 0,65 16,35" fill="${F}"/>`;
    case "tag":      return `<path fill-rule="evenodd" d="M8,60 L60,12 H186 a10 10 0 0 1 10 10 V98 a10 10 0 0 1 -10 10 H60 Z M48,60 m-10,0 a10,10 0 1 0 20,0 a10,10 0 1 0 -20,0" fill="${F}"/>`;
    case "pin":      return `<path fill-rule="evenodd" d="M100 195C60 140 25 105 25 70 25 29 59 5 100 5s75 24 75 65c0 35-35 70-75 125Z M100 72 m-24,0 a24,24 0 1 0 48,0 a24,24 0 1 0 -48,0" fill="${F}"/>`;
    case "bubble":   return `<path d="M20 8h160a12 12 0 0 1 12 12v92a12 12 0 0 1-12 12H86l-34 40 8-40H20a12 12 0 0 1-12-12V20a12 12 0 0 1 12-12Z" fill="${F}"/>`;
    case "line":     return `<rect y="2" width="240" height="16" rx="8" fill="${F}"/>`;
    case "arrow":    return `<path d="M12 50 H144 M104 16 L148 50 L104 84" fill="none" stroke="${F}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "ring":     return `<circle cx="100" cy="100" r="86" fill="none" stroke="${F}" stroke-width="24"/>`;
    case "frame":    return `<rect x="8" y="8" width="184" height="184" fill="none" stroke="${F}" stroke-width="10"/>`;
    case "blob":     return `<path d="M55 21C78 4 132 -3 163 18 194 39 199 84 187 121 175 158 145 187 106 194 67 201 27 185 12 150 -3 115 9 74 26 51 35 39 43 30 55 21Z" fill="${F}"/>`;
    case "sparkle":  return `<path d="M100 4 C108 66 134 92 196 100 134 108 108 134 100 196 92 134 66 108 4 100 66 92 92 66 100 4Z" fill="${F}"/>`;
    case "heart":    return `<path d="M100 178 C40 128 10 96 10 62 10 34 32 14 58 14c18 0 33 9 42 24 9-15 24-24 42-24 26 0 48 20 48 48 0 34-30 66-90 116Z" fill="${F}"/>`;
  }
}

export function shapeDataUri(shape: ShapeId, color: string | ShapeStyle, opts?: Omit<ShapeStyle, "color">): string {
  const style: ShapeStyle = typeof color === "string" ? { color, ...opts } : color;
  const [vx, vy, vw, vh] = SHAPE_VB[shape];
  const c2 = style.color2 ?? shadeHex(style.color, 0.55);

  const defs: string[] = [];
  let paint = style.color;
  if (style.gradient) {
    defs.push(
      `<linearGradient id="g" gradientTransform="rotate(45 0.5 0.5)">` +
      `<stop offset="0" stop-color="${style.color}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`,
    );
    paint = "url(#g)";
  }
  if (style.shadow) {
    defs.push(
      `<filter id="s" x="-30%" y="-30%" width="160%" height="160%">` +
      `<feDropShadow dx="0" dy="5" stdDeviation="7" flood-opacity="0.35"/></filter>`,
    );
  }

  const inner = style.shadow ? `<g filter="url(#s)">${body(shape, paint)}</g>` : body(shape, paint);
  const defsStr = defs.length ? `<defs>${defs.join("")}</defs>` : "";
  // Bleed padding only when a shadow needs room — otherwise the tight viewBox
  // makes the shape fill its layer box edge-to-edge (no phantom spacing).
  const p = style.shadow ? PAD : 0;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${vw + p * 2}" height="${vh + p * 2}" ` +
    `viewBox="${vx - p} ${vy - p} ${vw + p * 2} ${vh + p * 2}" preserveAspectRatio="none">${defsStr}${inner}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Extract the style back out of a shape data URI (for the properties panel). */
export function parseShapeStyle(dataUri: string): ShapeStyle {
  try {
    const svg = decodeURIComponent(dataUri.split(",", 2)[1] ?? "");
    const gradient = svg.includes("linearGradient");
    const shadow = svg.includes("feDropShadow");
    let color = "#3b82f6";
    let color2: string | undefined;
    if (gradient) {
      const stops = [...svg.matchAll(/stop-color="(#[0-9a-fA-F]{3,8})"/g)].map((m) => m[1]);
      color = stops[0] ?? color;
      color2 = stops[1];
    } else {
      const m = svg.match(/(?:fill|stroke)="(#[0-9a-fA-F]{3,8})"/);
      if (m) color = m[1];
    }
    return { color, color2, gradient, shadow };
  } catch {
    return { color: "#3b82f6" };
  }
}

// ── Backgrounds ───────────────────────────────────────────────────────────────

export interface TemplateBackground {
  type: "solid" | "gradient";
  colors: string[];
  angle?: number;
}

function bgSvgUri(bodyStr: string, defsStr = ""): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">${defsStr}${bodyStr}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function backgroundDataUri(bg: TemplateBackground): string {
  if (bg.type === "solid" || bg.colors.length < 2) {
    return bgSvgUri(`<rect width="200" height="200" fill="${bg.colors[0] ?? "#1e293b"}"/>`);
  }
  const angle = (bg.angle ?? 135) - 90; // svg gradients default horizontal
  return bgSvgUri(
    `<rect width="200" height="200" fill="url(#g)"/>`,
    `<defs><linearGradient id="g" gradientTransform="rotate(${angle} 0.5 0.5)">` +
    `<stop offset="0" stop-color="${bg.colors[0]}"/><stop offset="1" stop-color="${bg.colors[1]}"/>` +
    `</linearGradient></defs>`,
  );
}

/** CSS background used for template preview cards. */
export function backgroundCss(bg: TemplateBackground): string {
  if (bg.type === "solid" || bg.colors.length < 2) return bg.colors[0] ?? "#1e293b";
  return `linear-gradient(${bg.angle ?? 135}deg, ${bg.colors[0]}, ${bg.colors[1]})`;
}

/** Darken a hex colour (used to synthesise a gradient from one brand colour). */
export function shadeHex(hex: string, factor = 0.65): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const f = (i: number) => Math.round((parseInt(full.slice(i, i + 2), 16) || 0) * factor);
  return `#${[f(0), f(2), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
