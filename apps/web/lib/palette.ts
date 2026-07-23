// Per-project accent palette. A project's `theme` is either a named palette
// (desert/indigo/…, resolved by the `[data-palette]` blocks in globals.css) or a
// custom hex (#rrggbb), which we inject as CSS variables on <html> at runtime.

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** Parse `#rrggbb` (or `rrggbb`) into HSL. Returns null for anything else. */
export function hexToHsl(hex: string): Hsl | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function isCustomTheme(theme: string | null | undefined): boolean {
  return !!theme && theme.charAt(0) === "#";
}

const CUSTOM_VARS = ["--primary", "--primary-accent", "--ring", "--primary-foreground"];

/**
 * Apply a project theme to <html>. A named palette sets `data-palette` (the
 * stylesheet does the rest); a custom hex injects the accent CSS variables
 * inline (which override the stylesheet) and clears `data-palette` so the base
 * neutrals from `:root`/`.dark` are used.
 */
export function applyPalette(theme: string | null | undefined) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (isCustomTheme(theme)) {
    const hsl = hexToHsl(theme as string);
    if (hsl) {
      const primary = `${hsl.h} ${hsl.s}% ${hsl.l}%`;
      const accent = `${hsl.h} ${Math.min(hsl.s + 4, 100)}% ${Math.min(hsl.l + 7, 92)}%`;
      el.style.setProperty("--primary", primary);
      el.style.setProperty("--ring", primary);
      el.style.setProperty("--primary-accent", accent);
      // Readable text on the accent: dark ink for light colours, warm white otherwise.
      el.style.setProperty("--primary-foreground", hsl.l > 65 ? "26 30% 12%" : "40 44% 98%");
      el.removeAttribute("data-palette");
      return;
    }
  }
  CUSTOM_VARS.forEach((v) => el.style.removeProperty(v));
  el.setAttribute("data-palette", theme || "desert");
}
