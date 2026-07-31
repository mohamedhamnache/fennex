import type { BrandKit } from "@/lib/api";
import { shadeHex } from "./shapes";

export type TemplateCategory = "ecommerce" | "social" | "blog" | "promo";

/** Moved verbatim from text-templates.ts to break the import cycle. */
export function bestTextOn(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111111" : "#ffffff";
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
