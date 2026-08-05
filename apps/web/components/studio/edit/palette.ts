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

/** Linear-interpolate between two opaque colours by `t` (0 = `a`, 1 = `b`).
 *  Same channel arithmetic as `compositeOver`, but between two foreground
 *  colours rather than a foreground and a backdrop. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = rgb(a);
  const cb = rgb(b);
  return toHex([0, 1, 2].map((i) => ca[i] * (1 - t) + cb[i] * t) as [number, number, number]);
}

/** Channel-wise `screen`: 255 - (255-a)(255-b)/255.
 *
 *  The composite a screen-blend layer produces over a known backdrop, which is
 *  what lets a template that lays a neon flare over its own ground report the
 *  colour a run actually meets instead of the colour underneath it. Monotone and
 *  non-decreasing per channel, so the result is never darker than either input —
 *  which is why the number it feeds is the worst case for light ink. */
export function screenHex(a: string, b: string): string {
  const ca = rgb(a);
  const cb = rgb(b);
  return toHex([0, 1, 2].map((i) => 255 - ((255 - ca[i]) * (255 - cb[i])) / 255) as [number, number, number]);
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

export type PaletteRole = "surface" | "ink" | "accent" | "onAccent" | "accentInk";

export type Palette = Record<PaletteRole, string>;

/** The accent, darkened or lightened until it clears 4.5:1 on `surface`.
 *  Accent-on-surface is NOT a pair resolvePalette can promise -- in the default
 *  ecommerce palette raw accent on surface measures 3.80:1 -- so a family that
 *  wants coloured type takes this instead of `accent`. It keeps the accent's
 *  hue, which is what carries brand recognition, and moves only its lightness.
 *
 *  Both directions are tried at every step rather than picking one from
 *  `relativeLuminance(surface) < 0.5`: "the surface is dark" is not the same
 *  claim as "the surface is darker than the accent", and for a surface whose
 *  luminance sits between roughly 0.18 and 0.5 with an accent at or below it
 *  (e.g. accent #0ea5e9 on surface #22c55e), lightening is the wrong -- and
 *  mathematically incapable -- direction, so a one-directional walk fails
 *  before it starts and falls through to a hue-less fallback for a case the
 *  hue-preserving path exists to serve. Trying both and taking the smallest
 *  step that clears keeps the shift as subtle as the contrast floor allows. */
function accentInkFor(accent: string, surface: string): string {
  if (contrastRatio(accent, surface) >= MIN_CONTRAST) return accent;
  for (let step = 1; step <= 20; step++) {
    const lighter = mixHex(accent, "#ffffff", step / 20);
    const darker = shadeHex(accent, 1 - step / 20);
    const lighterOk = contrastRatio(lighter, surface) >= MIN_CONTRAST;
    const darkerOk = contrastRatio(darker, surface) >= MIN_CONTRAST;
    if (lighterOk && darkerOk) {
      return contrastRatio(lighter, surface) >= contrastRatio(darker, surface) ? lighter : darker;
    }
    if (lighterOk) return lighter;
    if (darkerOk) return darker;
  }
  return bestTextOn(surface);
}

/** Per-category fallbacks, used when the org has no brand kit. Chosen for
 *  contrast: every ink/surface and onAccent/accent pair clears 4.5:1. */
const DEFAULTS: Record<TemplateCategory, Palette> = {
  ecommerce: { surface: "#0f172a", ink: "#f8fafc", accent: "#e11d48", onAccent: "#ffffff", accentInk: accentInkFor("#e11d48", "#0f172a") },
  social:    { surface: "#1e1b4b", ink: "#f5f3ff", accent: "#f59e0b", onAccent: "#1c1917", accentInk: accentInkFor("#f59e0b", "#1e1b4b") },
  blog:      { surface: "#f8fafc", ink: "#0f172a", accent: "#2563eb", onAccent: "#ffffff", accentInk: accentInkFor("#2563eb", "#f8fafc") },
  promo:     { surface: "#18181b", ink: "#fafafa", accent: "#facc15", onAccent: "#18181b", accentInk: accentInkFor("#facc15", "#18181b") },
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
    accentInk: accentInkFor(accent, surface),
  };
}

/** Four type roles. Templates name a role; the role picks the face.
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
  mono: "'JetBrains Mono', monospace",
  /** A handwritten accent, for the one line above a cap-line that a script face
   *  is actually for. Used sparingly by design: a script set at length is
   *  unreadable, and a script used twice in one composition is a costume.
   *  Loaded through the same globals.css @import as the others, so the
   *  registered family stays the literal "Caveat" that `document.fonts.check`
   *  and `ctx.font` look up. */
  script: "'Caveat', cursive",
} as const;

export type FontRole = keyof typeof FONT_ROLES;

/* There was a TYPE_SCALE here: headline 80px, subhead 34px, support 16px on
 * the reference canvas, with a 5:1 headline-to-support ratio enforced centrally
 * so no template could flatten its own hierarchy. Only the type ladder in the
 * deleted composition families read it.
 *
 * It is gone rather than kept because fixing the ratio also fixes the absolute
 * scale: with support at a readable 16px, 5:1 forces every headline to 80px,
 * which is 10% of canvas width. That is the number the product owner was
 * looking at when the set was rejected as having no creativity in it — the
 * hierarchy was identical in all 34 because it was not theirs to choose.
 * `design/type.ts` sets size per composition and takes hierarchy from contrast
 * between elements instead. */
