import type { TextLayer } from "./EditCanvas";
import type { BrandKit } from "@/lib/api";
import { type ShapeId, type TemplateBackground, shadeHex } from "./shapes";

/** A reusable design composition: optional background, shape objects, and text.
 *  Positions are canvas percentages; font sizes assume an ~800px-wide canvas
 *  and are scaled to the real canvas on apply. */
export type TemplateCategory = "ecommerce" | "social" | "blog" | "promo";

export interface TemplateTextDef extends Omit<TextLayer, "id"> {
  kind?: "text";
  /** Which brand font substitutes this layer's font in brand-aware mode. */
  fontRole?: "heading" | "body";
  /** Keep the authored colours even in brand-aware mode (e.g. urgency red). */
  lockColor?: boolean;
}

export interface TemplateShapeDef {
  kind: "shape";
  shape: ShapeId;
  color: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  opacity?: number;
  rotation?: number;
  lockColor?: boolean;
  /** Professional styling — see ShapeStyle. */
  color2?: string;
  gradient?: boolean;
  shadow?: boolean;
}

export type TemplateLayerDef = TemplateTextDef | TemplateShapeDef;

export interface TextTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  /** Full-bleed background layer. Omit for overlays that sit on a photo. */
  background?: TemplateBackground | null;
  layers: TemplateLayerDef[];
}

export const TEMPLATE_CATEGORIES: { id: TemplateCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ecommerce", label: "Ecommerce" },
  { id: "social", label: "Social" },
  { id: "blog", label: "Blog" },
  { id: "promo", label: "Promo" },
];

const base = { type: "text" as const, visible: true, bold: false, italic: false };

const BEBAS = "'Bebas Neue', cursive";
const MONT = "Montserrat, sans-serif";
const JAKARTA = "'Plus Jakarta Sans', sans-serif";
const INTER = "Inter, sans-serif";
const PLAYFAIR = "'Playfair Display', serif";

export const TEXT_TEMPLATES: TextTemplate[] = [
  // ── Ecommerce ──────────────────────────────────────────────────────────────
  {
    id: "flash_sale",
    name: "Flash Sale",
    category: "ecommerce",
    layers: [
      {
        ...base, text: "FLASH SALE", xPct: 8, yPct: 16, fontSize: 76, bold: true,
        color: "#ffffff", fontFamily: BEBAS, fontRole: "heading",
        uppercase: true, letterSpacing: 5, outlineWidth: 3, outlineColor: "#0f172a", shadow: true,
      },
      {
        ...base, text: "-40%", xPct: 10, yPct: 40, fontSize: 44, bold: true,
        color: "#ffffff", fontFamily: JAKARTA, bgColor: "#dc2626", shadow: false,
      },
      {
        ...base, text: "Today only · While stocks last", xPct: 10, yPct: 60, fontSize: 20,
        color: "#e2e8f0", fontFamily: INTER, fontRole: "body", shadow: true, opacity: 0.92,
      },
    ],
  },
  {
    id: "new_in",
    name: "New In",
    category: "ecommerce",
    layers: [
      {
        ...base, text: "NEW IN", xPct: 8, yPct: 8, fontSize: 18, bold: true,
        color: "#ffffff", fontFamily: MONT, fontRole: "body",
        uppercase: true, letterSpacing: 3, bgColor: "#0f172a", shadow: false,
      },
      {
        ...base, text: "The Autumn Collection", xPct: 8, yPct: 78, fontSize: 46,
        color: "#ffffff", fontFamily: PLAYFAIR, fontRole: "heading", shadow: true,
      },
    ],
  },
  {
    id: "price_drop",
    name: "Price Drop",
    category: "ecommerce",
    layers: [
      {
        ...base, text: "PRICE DROP", xPct: 8, yPct: 9, fontSize: 20, bold: true,
        color: "#ffffff", fontFamily: MONT, fontRole: "body",
        uppercase: true, letterSpacing: 2, bgColor: "#16a34a", shadow: false,
      },
      {
        ...base, text: "NOW $29.99", xPct: 46, yPct: 84, fontSize: 38, bold: true,
        color: "#ffffff", fontFamily: JAKARTA, fontRole: "heading",
        bgColor: "#111111", letterSpacing: 1, shadow: false,
      },
    ],
  },
  {
    id: "free_shipping",
    name: "Free Shipping",
    category: "ecommerce",
    layers: [
      {
        ...base, text: "FREE SHIPPING ON ORDERS $50+", xPct: 12, yPct: 89, fontSize: 22, bold: true,
        color: "#ffffff", fontFamily: MONT, fontRole: "body",
        uppercase: true, letterSpacing: 2, bgColor: "#0f172a", shadow: false,
      },
    ],
  },
  {
    id: "bestseller",
    name: "Bestseller",
    category: "ecommerce",
    layers: [
      {
        ...base, text: "#1 BESTSELLER", xPct: 8, yPct: 8, fontSize: 20, bold: true,
        color: "#111111", fontFamily: MONT, fontRole: "body",
        uppercase: true, letterSpacing: 2, bgColor: "#f59e0b", shadow: false,
      },
      {
        ...base, text: "Loved by 10,000+ customers", xPct: 8, yPct: 18, fontSize: 18,
        color: "#ffffff", fontFamily: INTER, fontRole: "body", shadow: true, opacity: 0.9,
      },
    ],
  },

  // ── Social ─────────────────────────────────────────────────────────────────
  {
    id: "giveaway",
    name: "Giveaway",
    category: "social",
    layers: [
      {
        ...base, text: "GIVEAWAY", xPct: 14, yPct: 26, fontSize: 80, bold: true,
        color: "#ffffff", fontFamily: BEBAS, fontRole: "heading",
        uppercase: true, letterSpacing: 8, outlineWidth: 3, outlineColor: "#0f172a", shadow: true,
      },
      {
        ...base, text: "Tag a friend to enter", xPct: 24, yPct: 52, fontSize: 22, bold: true,
        color: "#111111", fontFamily: MONT, fontRole: "body", bgColor: "#ffffff", shadow: false,
      },
    ],
  },
  {
    id: "quote_card",
    name: "Quote",
    category: "social",
    layers: [
      {
        ...base, text: "“Design is intelligence made visible.”", xPct: 10, yPct: 38,
        fontSize: 34, italic: true, color: "#ffffff",
        fontFamily: PLAYFAIR, fontRole: "heading", shadow: true,
      },
      {
        ...base, text: "— ALINA WHEELER", xPct: 12, yPct: 54, fontSize: 16,
        color: "#e2e8f0", fontFamily: MONT, fontRole: "body",
        uppercase: true, letterSpacing: 3, shadow: true, opacity: 0.85,
      },
    ],
  },
  {
    id: "reel_hook",
    name: "Reel Hook",
    category: "social",
    layers: [
      {
        ...base, text: "WAIT FOR IT…", xPct: 28, yPct: 8, fontSize: 24, bold: true,
        color: "#ffffff", fontFamily: MONT, fontRole: "heading",
        uppercase: true, letterSpacing: 2, bgColor: "#111111", shadow: false,
      },
    ],
  },
  {
    id: "tips_header",
    name: "Tips Header",
    category: "social",
    layers: [
      {
        ...base, text: "5", xPct: 8, yPct: 14, fontSize: 120, bold: true,
        color: "#facc15", fontFamily: BEBAS, fontRole: "heading",
        outlineWidth: 2, outlineColor: "#0f172a", shadow: true,
      },
      {
        ...base, text: "QUICK TIPS", xPct: 24, yPct: 24, fontSize: 44, bold: true,
        color: "#ffffff", fontFamily: BEBAS, fontRole: "heading",
        uppercase: true, letterSpacing: 6, shadow: true,
      },
      {
        ...base, text: "to level up your content", xPct: 24, yPct: 42, fontSize: 20,
        color: "#e2e8f0", fontFamily: INTER, fontRole: "body", shadow: true, opacity: 0.9,
      },
    ],
  },
  {
    id: "link_in_bio",
    name: "Link in Bio",
    category: "social",
    layers: [
      {
        ...base, text: "LINK IN BIO", xPct: 32, yPct: 86, fontSize: 24, bold: true,
        color: "#111111", fontFamily: MONT, fontRole: "body",
        uppercase: true, letterSpacing: 3, bgColor: "#ffffff", shadow: false,
      },
    ],
  },

  // ── Blog ───────────────────────────────────────────────────────────────────
  {
    id: "article_cover",
    name: "Article Cover",
    category: "blog",
    layers: [
      {
        ...base, text: "PRODUCTIVITY", xPct: 8, yPct: 10, fontSize: 16, bold: true,
        color: "#ffffff", fontFamily: MONT, fontRole: "body",
        uppercase: true, letterSpacing: 3, bgColor: "#0f172a", shadow: false,
      },
      {
        ...base, text: "Deep Work in a Distracted World", xPct: 8, yPct: 64, fontSize: 44, bold: true,
        color: "#ffffff", fontFamily: JAKARTA, fontRole: "heading", shadow: true,
      },
      {
        ...base, text: "8 min read · by Fennex", xPct: 8, yPct: 82, fontSize: 16,
        color: "#cbd5e1", fontFamily: INTER, fontRole: "body", shadow: true, opacity: 0.9,
      },
    ],
  },
  {
    id: "how_to",
    name: "How-To",
    category: "blog",
    layers: [
      {
        ...base, text: "HOW TO", xPct: 8, yPct: 50, fontSize: 20, bold: true,
        color: "#facc15", fontFamily: MONT, fontRole: "body",
        uppercase: true, letterSpacing: 6, shadow: true,
      },
      {
        ...base, text: "Grow an audience from zero", xPct: 8, yPct: 58, fontSize: 40, bold: true,
        color: "#ffffff", fontFamily: JAKARTA, fontRole: "heading", shadow: true,
      },
    ],
  },
  {
    id: "listicle",
    name: "Listicle",
    category: "blog",
    layers: [
      {
        ...base, text: "07", xPct: 8, yPct: 8, fontSize: 110, bold: true,
        color: "#ffffff", fontFamily: BEBAS, fontRole: "heading",
        outlineWidth: 2, outlineColor: "#0f172a", shadow: true,
      },
      {
        ...base, text: "ways to grow your brand", xPct: 27, yPct: 26, fontSize: 30, italic: true,
        color: "#ffffff", fontFamily: PLAYFAIR, fontRole: "body", shadow: true,
      },
    ],
  },
  {
    id: "versus",
    name: "Versus",
    category: "blog",
    layers: [
      {
        ...base, text: "SEO vs. PAID ADS", xPct: 10, yPct: 38, fontSize: 54, bold: true,
        color: "#ffffff", fontFamily: BEBAS, fontRole: "heading",
        uppercase: true, letterSpacing: 3, outlineWidth: 2, outlineColor: "#0f172a", shadow: true,
      },
      {
        ...base, text: "Which one is right for you?", xPct: 12, yPct: 56, fontSize: 20,
        color: "#e2e8f0", fontFamily: INTER, fontRole: "body", shadow: true, opacity: 0.9,
      },
    ],
  },

  // ── Promo / events ─────────────────────────────────────────────────────────
  {
    id: "webinar",
    name: "Webinar",
    category: "promo",
    layers: [
      {
        ...base, text: "FREE WEBINAR", xPct: 8, yPct: 10, fontSize: 20, bold: true,
        color: "#ffffff", fontFamily: MONT, fontRole: "body",
        uppercase: true, letterSpacing: 2, bgColor: "#0f172a", shadow: false,
      },
      {
        ...base, text: "Scale Your Store in 2026", xPct: 8, yPct: 24, fontSize: 42, bold: true,
        color: "#ffffff", fontFamily: JAKARTA, fontRole: "heading", shadow: true,
      },
      {
        ...base, text: "Thursday · 6 PM CET · Live Q&A", xPct: 8, yPct: 40, fontSize: 18,
        color: "#e2e8f0", fontFamily: INTER, fontRole: "body", shadow: true, opacity: 0.9,
      },
    ],
  },
  {
    id: "coming_soon",
    name: "Coming Soon",
    category: "promo",
    layers: [
      {
        ...base, text: "COMING SOON", xPct: 16, yPct: 42, fontSize: 64, bold: true,
        color: "#ffffff", fontFamily: BEBAS, fontRole: "heading",
        uppercase: true, letterSpacing: 10, outlineWidth: 2, outlineColor: "#0f172a", shadow: true,
      },
    ],
  },
  {
    id: "grand_opening",
    name: "Grand Opening",
    category: "promo",
    layers: [
      {
        ...base, text: "GRAND OPENING", xPct: 12, yPct: 28, fontSize: 60, bold: true,
        color: "#ffffff", fontFamily: BEBAS, fontRole: "heading",
        uppercase: true, letterSpacing: 5, outlineWidth: 2, outlineColor: "#0f172a", shadow: true,
      },
      {
        ...base, text: "MARCH 15", xPct: 34, yPct: 50, fontSize: 22, bold: true,
        color: "#111111", fontFamily: MONT, fontRole: "body",
        uppercase: true, letterSpacing: 2, bgColor: "#ffffff", shadow: false,
      },
    ],
  },
  {
    id: "last_chance",
    name: "Last Chance",
    category: "promo",
    layers: [
      {
        ...base, text: "LAST CHANCE", xPct: 8, yPct: 8, fontSize: 26, bold: true,
        color: "#ffffff", fontFamily: MONT, fontRole: "heading",
        uppercase: true, letterSpacing: 2, bgColor: "#dc2626", lockColor: true, shadow: false,
      },
      {
        ...base, text: "Sale ends tonight at midnight", xPct: 8, yPct: 19, fontSize: 20,
        color: "#ffffff", fontFamily: INTER, fontRole: "body", shadow: true,
      },
    ],
  },

  // ── Full designs: background + objects + text ─────────────────────────────
  {
    id: "sale_splash",
    name: "Sale Splash",
    category: "ecommerce",
    background: { type: "gradient", colors: ["#dc2626", "#f97316"], angle: 135 },
    layers: [
      { kind: "shape", shape: "circle", color: "#ffffff", xPct: 64, yPct: -18, widthPct: 52, opacity: 0.12 },
      { kind: "shape", shape: "circle", color: "#ffffff", xPct: -14, yPct: 64, widthPct: 42, opacity: 0.1 },
      { kind: "shape", shape: "star", color: "#facc15", xPct: 79, yPct: 10, widthPct: 14, rotation: 16, shadow: true },
      {
        ...base, text: "MEGA SALE", xPct: 8, yPct: 24, fontSize: 84, bold: true,
        color: "#ffffff", fontFamily: BEBAS, fontRole: "heading",
        uppercase: true, letterSpacing: 5, shadow: true,
      },
      {
        ...base, text: "-50% TODAY", xPct: 10, yPct: 54, fontSize: 30, bold: true,
        color: "#111111", fontFamily: MONT, fontRole: "body",
        uppercase: true, letterSpacing: 2, bgColor: "#ffffff", shadow: false,
      },
      {
        ...base, text: "Free returns · Ends midnight", xPct: 10, yPct: 74, fontSize: 18,
        color: "#ffffff", fontFamily: INTER, fontRole: "body", shadow: true, opacity: 0.92,
      },
    ],
  },
  {
    id: "product_card",
    name: "Product Card",
    category: "ecommerce",
    background: { type: "gradient", colors: ["#0f172a", "#1e293b"], angle: 160 },
    layers: [
      { kind: "shape", shape: "ring", color: "#38bdf8", xPct: 62, yPct: 6, widthPct: 30, opacity: 0.35 },
      { kind: "shape", shape: "rounded", color: "#ffffff", xPct: 0, yPct: 55, widthPct: 100, opacity: 0.97, shadow: true },
      {
        ...base, text: "Aurora Desk Lamp", xPct: 12, yPct: 64, fontSize: 34, bold: true,
        color: "#111111", fontFamily: JAKARTA, fontRole: "heading", lockColor: true, shadow: false,
      },
      {
        ...base, text: "$49", xPct: 76, yPct: 64, fontSize: 30, bold: true,
        color: "#ffffff", fontFamily: JAKARTA, bgColor: "#0f172a", shadow: false,
      },
      {
        ...base, text: "Warm light · 3 modes · USB-C", xPct: 12, yPct: 78, fontSize: 16,
        color: "#475569", fontFamily: INTER, fontRole: "body", lockColor: true, shadow: false,
      },
    ],
  },
  {
    id: "insta_quote",
    name: "Insta Quote",
    category: "social",
    background: { type: "gradient", colors: ["#7c3aed", "#ec4899"], angle: 135 },
    layers: [
      { kind: "shape", shape: "ring", color: "#ffffff", xPct: 62, yPct: 6, widthPct: 34, opacity: 0.3 },
      { kind: "shape", shape: "circle", color: "#ffffff", xPct: -10, yPct: 74, widthPct: 34, opacity: 0.12 },
      {
        ...base, text: "“Create more than you consume.”", xPct: 10, yPct: 36,
        fontSize: 36, italic: true, color: "#ffffff",
        fontFamily: PLAYFAIR, fontRole: "heading", shadow: true,
      },
      {
        ...base, text: "— @FENNEX", xPct: 12, yPct: 56, fontSize: 16,
        color: "#ffffff", fontFamily: MONT, fontRole: "body",
        uppercase: true, letterSpacing: 4, shadow: true, opacity: 0.85,
      },
    ],
  },
  {
    id: "story_promo",
    name: "Story Promo",
    category: "social",
    background: { type: "gradient", colors: ["#0ea5e9", "#6366f1"], angle: 180 },
    layers: [
      { kind: "shape", shape: "blob", color: "#ffffff", xPct: -12, yPct: 58, widthPct: 66, opacity: 0.14 },
      { kind: "shape", shape: "line", color: "#facc15", xPct: 10, yPct: 18, widthPct: 16 },
      {
        ...base, text: "SUMMER DROP", xPct: 10, yPct: 22, fontSize: 62, bold: true,
        color: "#ffffff", fontFamily: BEBAS, fontRole: "heading",
        uppercase: true, letterSpacing: 4, shadow: true,
      },
      {
        ...base, text: "SHOP NOW", xPct: 12, yPct: 44, fontSize: 24, bold: true,
        color: "#111111", fontFamily: MONT, fontRole: "body",
        uppercase: true, letterSpacing: 3, bgColor: "#ffffff", shadow: false,
      },
    ],
  },
  {
    id: "blog_cover_bold",
    name: "Bold Blog Cover",
    category: "blog",
    background: { type: "solid", colors: ["#0f172a"] },
    layers: [
      { kind: "shape", shape: "circle", color: "#facc15", xPct: 74, yPct: -20, widthPct: 44, opacity: 0.18 },
      {
        ...base, text: "GUIDE", xPct: 8, yPct: 12, fontSize: 16, bold: true,
        color: "#111111", fontFamily: MONT, fontRole: "body",
        uppercase: true, letterSpacing: 3, bgColor: "#facc15", shadow: false,
      },
      { kind: "shape", shape: "line", color: "#facc15", xPct: 8, yPct: 50, widthPct: 14 },
      {
        ...base, text: "The Complete SEO Playbook", xPct: 8, yPct: 55, fontSize: 46, bold: true,
        color: "#ffffff", fontFamily: JAKARTA, fontRole: "heading", shadow: false,
      },
      {
        ...base, text: "12 min read · Updated for 2026", xPct: 8, yPct: 78, fontSize: 16,
        color: "#94a3b8", fontFamily: INTER, fontRole: "body", shadow: false,
      },
    ],
  },
  {
    id: "webinar_card",
    name: "Webinar Card",
    category: "promo",
    background: { type: "gradient", colors: ["#0f172a", "#334155"], angle: 120 },
    layers: [
      { kind: "shape", shape: "ring", color: "#38bdf8", xPct: 70, yPct: -16, widthPct: 46, opacity: 0.25 },
      { kind: "shape", shape: "circle", color: "#38bdf8", xPct: 86, yPct: 72, widthPct: 12, opacity: 0.3 },
      {
        ...base, text: "FREE WEBINAR", xPct: 8, yPct: 12, fontSize: 18, bold: true,
        color: "#111111", fontFamily: MONT, fontRole: "body",
        uppercase: true, letterSpacing: 2, bgColor: "#38bdf8", shadow: false,
      },
      {
        ...base, text: "Scale Your Store in 2026", xPct: 8, yPct: 30, fontSize: 44, bold: true,
        color: "#ffffff", fontFamily: JAKARTA, fontRole: "heading", shadow: false,
      },
      {
        ...base, text: "Thursday · 6 PM CET · Live Q&A", xPct: 8, yPct: 50, fontSize: 18,
        color: "#cbd5e1", fontFamily: INTER, fontRole: "body", shadow: false,
      },
    ],
  },
  {
    id: "minimal_frame",
    name: "Minimal Frame",
    category: "social",
    background: { type: "solid", colors: ["#111827"] },
    layers: [
      { kind: "shape", shape: "frame", color: "#ffffff", xPct: 18, yPct: 8, widthPct: 64, opacity: 0.9 },
      {
        ...base, text: "LESS IS MORE", xPct: 30, yPct: 44, fontSize: 30, bold: true,
        color: "#ffffff", fontFamily: MONT, fontRole: "heading",
        uppercase: true, letterSpacing: 8, shadow: false,
      },
    ],
  },
  {
    id: "discount_badge",
    name: "Discount Badge",
    category: "ecommerce",
    // No background — an overlay that sits on your product photo
    layers: [
      { kind: "shape", shape: "star", color: "#facc15", xPct: 61, yPct: 1, widthPct: 37, rotation: 12, shadow: true },
      {
        ...base, text: "-30%", xPct: 72, yPct: 16, fontSize: 34, bold: true,
        color: "#111111", fontFamily: JAKARTA, fontRole: "heading", lockColor: true, shadow: false,
      },
      {
        ...base, text: "LIMITED", xPct: 71, yPct: 34, fontSize: 14, bold: true,
        color: "#111111", fontFamily: MONT, fontRole: "body",
        uppercase: true, letterSpacing: 2, lockColor: true, shadow: false,
      },
    ],
  },
];

// ── Brand-aware mapping ───────────────────────────────────────────────────────

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Black or white, whichever reads best on the given colour. */
export function bestTextOn(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111111" : "#ffffff";
}

export interface ResolvedTemplate {
  background: TemplateBackground | null;
  layers: TemplateLayerDef[];
}

/**
 * Re-colour and re-font a whole template for the org's brand kit:
 * - the background takes the brand palette (gradients use the first two colours,
 *   or a darkened shade of the first when only one exists)
 * - shapes and pills/badges cycle through the palette; pill text auto-contrasts
 * - text sitting on a branded background auto-contrasts against it
 * - heading/body layers switch to the brand's primary/secondary fonts
 * - `lockColor` layers keep their authored colours (e.g. urgency red, card text)
 * Overlay templates (no background) keep photo-text colours for legibility.
 */
export function brandTemplate(t: TextTemplate, brand?: BrandKit | null): ResolvedTemplate {
  const plain: ResolvedTemplate = { background: t.background ?? null, layers: t.layers };
  if (!brand) return plain;
  const colors = (brand.colors ?? []).filter((c) => HEX_RE.test(c));

  let background = t.background ?? null;
  if (background && colors.length > 0) {
    background = background.type === "gradient"
      ? { ...background, colors: [colors[0], colors[1] ?? shadeHex(colors[0])] }
      : { ...background, colors: [colors[0]] };
  }
  const onBg = background?.colors?.[0];

  let badge = 0;
  const layers = t.layers.map((def): TemplateLayerDef => {
    if (def.kind === "shape") {
      if (def.lockColor || colors.length === 0) return def;
      // Decorative white shapes (soft accents) keep their colour; solid shapes rebrand
      if (def.color === "#ffffff" && (def.opacity ?? 1) < 0.5) return def;
      return { ...def, color: colors[badge++ % colors.length] };
    }
    const out: TemplateTextDef = { ...def };
    if (def.fontRole === "heading" && brand.primary_font) out.fontFamily = brand.primary_font;
    if (def.fontRole === "body" && brand.secondary_font) out.fontFamily = brand.secondary_font;
    if (!def.lockColor && def.bgColor && colors.length > 0) {
      const c = colors[badge++ % colors.length];
      out.bgColor = c;
      out.color = bestTextOn(c);
    } else if (!def.lockColor && !def.bgColor && onBg) {
      out.color = bestTextOn(onBg);
    }
    return out;
  });

  return { background, layers };
}
