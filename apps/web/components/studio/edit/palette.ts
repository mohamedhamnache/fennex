import type { BrandKit } from "@/lib/api";
import { shadeHex } from "./shapes";

export type TemplateCategory = "ecommerce" | "social" | "blog" | "promo";

/** The two candidates `bestTextOn` picks between: near-black ink and white. */
const DARK_INK = "#111111";
const LIGHT_INK = "#ffffff";

/** The readable one of near-black and white on `hex`.
 *
 *  This is measured with the same WCAG contrast ratio the readability checks
 *  use, not with the YIQ brightness heuristic it used to use. The two disagree
 *  across a wide mid-luminance band, and there YIQ picks the *worse* of the two
 *  candidates: on #0ea5e9, white is 2.77:1 and #111111 is 6.82:1, yet YIQ scores
 *  that colour at 149.6 and so returns white. Since there are exactly two
 *  candidates, taking the higher-contrast one is unambiguously correct.
 *
 *  Note this is a best-effort choice, not a guarantee: a mid-grey backdrop has
 *  no readable pairing at all, and the better of two poor options is still poor.
 *  Callers that must guarantee 4.5:1 have to change the field, not the ink. */
export function bestTextOn(hex: string): string {
  return contrastRatio(DARK_INK, hex) >= contrastRatio(LIGHT_INK, hex) ? DARK_INK : LIGHT_INK;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

function toHex(c: [number, number, number]): string {
  return `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque colours, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Flatten a translucent colour onto a backdrop. A scrim at opacity < 1 does
 *  not have a fixed colour, so contrast has to be measured against what it
 *  actually composites to. */
export function compositeOver(fg: string, bg: string, alpha: number): string {
  const f = rgb(fg);
  const b = rgb(bg);
  return toHex([0, 1, 2].map((i) => f[i] * alpha + b[i] * (1 - alpha)) as [number, number, number]);
}

/** Contrast of `text` against a field of `fieldColor` at `opacity`, assuming
 *  the worst photograph underneath it. A translucent scrim is composited over
 *  both white and black and the poorer of the two ratios is returned, because a
 *  template has no idea what image a user will drop behind it. */
export function worstCaseContrast(text: string, fieldColor: string, opacity = 1): number {
  if (opacity >= 1) return contrastRatio(text, fieldColor);
  return Math.min(
    contrastRatio(text, compositeOver(fieldColor, "#ffffff", opacity)),
    contrastRatio(text, compositeOver(fieldColor, "#000000", opacity)),
  );
}

/** WCAG AA for body text. */
export const MIN_CONTRAST = 4.5;

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
  if (!useBrand || !brand?.colors?.length) return base;

  const accent = brand.colors[0];
  const surface = brand.colors[1] ?? shadeHex(accent, 0.25);
  return {
    surface,
    ink: bestTextOn(surface),
    accent,
    onAccent: bestTextOn(accent),
  };
}

/** Three type roles. Templates name a role; the role picks the face.
 *
 *  These are complete CSS font stacks, not bare family names, and the quoting
 *  is load-bearing. "Source Sans 3" is not a valid unquoted CSS identifier —
 *  an identifier cannot begin with a digit, so the trailing "3" invalidates the
 *  whole declaration — and every consumer fails silently and differently:
 *    - `ctx.font = "16px Source Sans 3"` is rejected as an invalid shorthand
 *      and the assignment is IGNORED, so measureTextLayer keeps whatever the
 *      context had (10px sans-serif) and returns badly wrong widths.
 *    - `document.fonts.load("16px Source Sans 3")` rejects, and rasterize.ts
 *      does not catch it, so the PNG export fails outright.
 *    - SceneSvg puts the string straight into a font-family attribute, which
 *      also fails to parse and falls back to the default face.
 *  Quoting here means every consumer can use FONT_ROLES raw and be correct. */
export const FONT_ROLES = {
  impact: "'Anton', sans-serif",
  modern: "'Inter', sans-serif",
  support: "'Source Sans 3', sans-serif",
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
