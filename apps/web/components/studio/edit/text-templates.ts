import type { Layer, TextLayer } from "./EditCanvas";
import type { BrandKit } from "@/lib/api";
import {
  type ShapeId, type TemplateBackground,
  shadeHex, shapeAspect, shapeDataUri, backgroundDataUri,
} from "./shapes";
import { bestTextOn, resolvePalette, type TemplateCategory } from "./palette";
import type { BlendMode, ClipSpec } from "./scene/types";
import {
  scrimStack, framedInset, splitBlock, editorialBand, priceCorner, posterStack, bento,
  findUnbackedText, analyzeText,
} from "./families";

/** A reusable design composition: optional background, shape objects, and text.
 *  Positions are canvas percentages; font sizes assume an ~800px-wide canvas
 *  and are scaled to the real canvas on apply. */
export { bestTextOn, type TemplateCategory };

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
  /** Explicit height as % of canvas height. Omit to derive it from the shape's
   *  own aspect ratio — which is right for badges but wrong for the panels and
   *  bands the composition families build out of `rect`. */
  heightPct?: number;
  opacity?: number;
  rotation?: number;
  lockColor?: boolean;
  /** Professional styling — see ShapeStyle. */
  color2?: string;
  gradient?: boolean;
  shadow?: boolean;
}

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

// ── The composition families ─────────────────────────────────────────────────

/** The shipped set: 34 templates built from the seven composition families.
 *
 *  Every entry places the edited photo through an image layer, so these are
 *  compositions rather than decoration laid over whatever the user happened to
 *  upload. Colours come from `resolvePalette` roles, never from literals.
 *
 *  Three axes of variation, and no fourth. An instance differs from its
 *  siblings by:
 *    1. its palette — one of the four category palettes, each of which
 *       guarantees ink/surface and onAccent/accent at 4.5:1;
 *    2. its copy;
 *    3. its family's single composition parameter (scrim anchor, crop, block
 *       side, band edge, badge corner, plate shape).
 *  Nothing here invents structure. A template that needed its own geometry
 *  would be the twenty-seventh unrelated one-off this set was written to
 *  replace.
 *
 *  `category` is the picker filter — what the template is *for*. The palette
 *  argument is a colour decision and is deliberately allowed to differ from it,
 *  which is how a category gets more than one colour scheme without a hex
 *  literal appearing in this file. All four palettes carry the same contrast
 *  guarantee, so any pairing is safe.
 *
 *  Copy is authored to the family's field width. `panel()` warns in development
 *  when a run overflows its field; the widths that matter are roughly 20
 *  characters for a scrimStack or framedInset headline, 15 for posterStack, 10
 *  for the priceCorner seal, 9 for splitBlock and 6 for a bento cell. Lengthen
 *  a headline past that and the guard will say so.
 */
export const TEXT_TEMPLATES: TextTemplate[] = [
  // ── Ecommerce ──────────────────────────────────────────────────────────────
  {
    id: "ec_split_new_in",
    name: "New Arrival",
    category: "ecommerce",
    layers: splitBlock(resolvePalette("ecommerce"), {
      headline: "Just In",
      subhead: "Aurora Desk Lamp",
      support: "Free returns  ·  2-year warranty",
    }),
  },
  {
    id: "ec_split_restock",
    name: "Back in Stock",
    category: "ecommerce",
    layers: splitBlock(resolvePalette("blog"), {
      headline: "Restock",
      subhead: "Linen Throw, Sand",
      support: "Sold out twice  ·  limited run",
    }, "right"),
  },
  {
    id: "ec_split_bundle",
    name: "Bundle Block",
    category: "ecommerce",
    layers: splitBlock(resolvePalette("promo"), {
      headline: "Bundle",
      subhead: "Two for 60",
      support: "Mix any two  ·  ends Sunday",
    }),
  },
  {
    id: "ec_price_markdown",
    name: "Markdown Seal",
    category: "ecommerce",
    layers: priceCorner(resolvePalette("ecommerce"), {
      headline: "-40%",
      subhead: "Aurora Desk Lamp",
      support: "Today only  ·  while stocks last",
    }),
  },
  {
    id: "ec_price_from",
    name: "From Price",
    category: "ecommerce",
    layers: priceCorner(resolvePalette("blog"), {
      headline: "From $29",
      subhead: "Everyday ceramics, made to be used",
      support: "Dishwasher safe  ·  free delivery over $50",
    }, "left"),
  },
  {
    id: "ec_price_clearance",
    name: "Clearance Seal",
    category: "ecommerce",
    layers: priceCorner(resolvePalette("promo"), {
      headline: "-70%",
      subhead: "End of season clearance",
      support: "Final markdown  ·  sale items are not returnable",
    }),
  },
  {
    id: "ec_bento_sale",
    name: "Sale Bento",
    category: "ecommerce",
    layers: bento(resolvePalette("ecommerce"), {
      headline: "Sale",
      subhead: "Half price",
      support: "Ends Sunday at midnight",
    }),
  },
  {
    id: "ec_bento_gift",
    name: "Gift Bento",
    category: "ecommerce",
    layers: bento(resolvePalette("social"), {
      headline: "Gifts",
      subhead: "Under $50",
      support: "Wrapped free, shipped fast",
    }, "right"),
  },
  {
    id: "ec_scrim_lookbook",
    name: "Lookbook",
    category: "ecommerce",
    layers: scrimStack(resolvePalette("ecommerce"), {
      headline: "The Winter Edit",
      subhead: "Twelve pieces, one palette",
      support: "Shop the full collection at fennex.studio",
    }),
  },

  // ── Social ─────────────────────────────────────────────────────────────────
  {
    id: "so_scrim_golden_hour",
    name: "Golden Hour",
    category: "social",
    layers: scrimStack(resolvePalette("social"), {
      headline: "Golden Hour",
      subhead: "The autumn edit",
      support: "Shot on location  ·  Fennex Studio",
    }),
  },
  {
    id: "so_scrim_hook",
    name: "Reel Hook",
    category: "social",
    layers: scrimStack(resolvePalette("promo"), {
      headline: "Wait For It",
      subhead: "Three things nobody tells you",
      support: "Full breakdown in the caption",
    }, "top"),
  },
  {
    id: "so_scrim_behind",
    name: "Behind the Build",
    category: "social",
    layers: scrimStack(resolvePalette("blog"), {
      headline: "Behind the Build",
      subhead: "Day 41 of shipping in public",
      support: "New clips every Friday",
    }),
  },
  {
    id: "so_frame_quote",
    name: "Quote Card",
    category: "social",
    layers: framedInset(resolvePalette("social"), {
      headline: "Make It Obvious",
      subhead: "Habits beat motivation",
      support: "From the Fennex newsletter  ·  Issue 12",
    }),
  },
  {
    id: "so_frame_intro",
    name: "Meet the Team",
    category: "social",
    layers: framedInset(resolvePalette("blog"), {
      headline: "Meet Nadia",
      subhead: "Lead designer, joined 2024",
      support: "Say hello in the comments",
    }, "rounded"),
  },
  {
    id: "so_frame_giveaway",
    name: "Giveaway",
    category: "social",
    layers: framedInset(resolvePalette("promo"), {
      headline: "Giveaway",
      subhead: "Win the full studio kit",
      support: "Follow, like and tag a friend  ·  closes Friday",
    }),
  },
  {
    id: "so_poster_drop",
    name: "Drop Poster",
    category: "social",
    layers: posterStack(resolvePalette("social"), {
      headline: "Summer Drop",
      subhead: "Saturday, 10am",
      support: "fennex.studio",
    }),
  },
  {
    id: "so_poster_live",
    name: "Going Live",
    category: "social",
    layers: posterStack(resolvePalette("promo"), {
      headline: "We Go Live",
      subhead: "Thursday at 6pm CET",
      support: "Set a reminder",
    }, "circle"),
  },
  {
    id: "so_band_caption",
    name: "Caption Band",
    category: "social",
    layers: editorialBand(resolvePalette("social"), {
      headline: "Five things we learned this month",
      support: "Swipe for the full thread",
    }),
  },

  // ── Blog ───────────────────────────────────────────────────────────────────
  {
    id: "bl_band_field_notes",
    name: "Field Notes",
    category: "blog",
    layers: editorialBand(resolvePalette("blog"), {
      headline: "How we rebuilt the studio",
      support: "Field notes  ·  Issue 04",
    }),
  },
  {
    id: "bl_band_guide",
    name: "Guide Header",
    category: "blog",
    layers: editorialBand(resolvePalette("social"), {
      headline: "A practical guide to page speed",
      support: "12 min read  ·  updated for 2026",
    }, "head"),
  },
  {
    id: "bl_band_interview",
    name: "Interview",
    category: "blog",
    layers: editorialBand(resolvePalette("promo"), {
      headline: "An interview with Nadia Berger",
      support: "Craft series  ·  part three",
    }),
  },
  {
    id: "bl_scrim_deep_work",
    name: "Deep Work",
    category: "blog",
    layers: scrimStack(resolvePalette("blog"), {
      headline: "Deep Work",
      subhead: "Focus in a distracted world",
      support: "8 min read  ·  by Fennex",
    }),
  },
  {
    id: "bl_scrim_case_study",
    name: "Case Study",
    category: "blog",
    layers: scrimStack(resolvePalette("ecommerce"), {
      headline: "Case Study",
      subhead: "From 400 to 40,000 visits",
      support: "What we changed, in the order we changed it",
    }, "top"),
  },
  {
    id: "bl_bento_series",
    name: "Series Card",
    category: "blog",
    layers: bento(resolvePalette("blog"), {
      headline: "Part 3",
      subhead: "SEO basics",
      support: "A six-part beginner series",
    }),
  },
  {
    id: "bl_bento_recap",
    name: "Weekly Recap",
    category: "blog",
    layers: bento(resolvePalette("social"), {
      headline: "Recap",
      subhead: "Week 32",
      support: "Everything we shipped",
    }, "right"),
  },
  {
    id: "bl_frame_essay",
    name: "Essay Cover",
    category: "blog",
    layers: framedInset(resolvePalette("blog"), {
      headline: "The Slow Web",
      subhead: "In praise of smaller sites",
      support: "Essay  ·  9 min read",
    }, "rounded"),
  },

  // ── Promo ──────────────────────────────────────────────────────────────────
  {
    id: "pr_poster_big_drop",
    name: "Big Drop",
    category: "promo",
    layers: posterStack(resolvePalette("promo"), {
      headline: "Big Drop",
      subhead: "March 15",
      support: "fennex.studio",
    }),
  },
  {
    id: "pr_poster_opening",
    name: "Now Open",
    category: "promo",
    layers: posterStack(resolvePalette("ecommerce"), {
      headline: "Now Open",
      subhead: "Doors open at 9am",
      support: "24 Rue Didouche",
    }, "circle"),
  },
  {
    id: "pr_poster_webinar",
    name: "Webinar Poster",
    category: "promo",
    layers: posterStack(resolvePalette("social"), {
      headline: "Free Webinar",
      subhead: "Scale your store in 2026",
      support: "Thursday, 6pm CET",
    }),
  },
  {
    id: "pr_price_flash",
    name: "Flash Sale",
    category: "promo",
    layers: priceCorner(resolvePalette("promo"), {
      headline: "-50%",
      subhead: "Flash sale, 24 hours only",
      support: "Discount applied at checkout  ·  ends midnight",
    }),
  },
  {
    id: "pr_price_two_for_one",
    name: "Two for One",
    category: "promo",
    layers: priceCorner(resolvePalette("ecommerce"), {
      headline: "2 for 1",
      subhead: "Every mug, every colour",
      support: "Add both to the basket  ·  the cheaper one is free",
    }, "left"),
  },
  {
    id: "pr_split_launch",
    name: "Launch Block",
    category: "promo",
    layers: splitBlock(resolvePalette("promo"), {
      headline: "Launch",
      subhead: "The Fennex Studio",
      support: "Live Tuesday  ·  early access open",
    }),
  },
  {
    id: "pr_split_last_call",
    name: "Last Call",
    category: "promo",
    layers: splitBlock(resolvePalette("ecommerce"), {
      headline: "Last Call",
      subhead: "Sale ends tonight",
      support: "Midnight, everywhere  ·  no extensions",
    }, "right"),
  },
  {
    id: "pr_scrim_event",
    name: "Event Scrim",
    category: "promo",
    layers: scrimStack(resolvePalette("social"), {
      headline: "Doors at Eight",
      subhead: "Rooftop set, city view",
      support: "Tickets at fennex.studio  ·  limited capacity",
    }),
  },
];

/**
 * Dev-only gate on the readability rule.
 *
 * The families make it hard to author unbacked text; this makes it impossible
 * to ship. A template that spreads a family's output and appends its own text
 * def, or that hand-writes layers entirely, bypasses `panel()` — this catches
 * it at module load, before anything renders, and names the offending copy.
 *
 * `process.env.NODE_ENV` is inlined by the bundler, so this whole block is
 * dead code in a production build and costs nothing there.
 */
export function assertTemplatesReadable(templates: TextTemplate[]): void {
  const bad: string[] = [];
  for (const t of templates) {
    for (const issue of findUnbackedText(t.layers)) {
      bad.push(`  ${t.id}: "${issue.text}" — ${issue.reason}`);
    }
  }
  if (bad.length === 0) return;
  const message =
    `${bad.length} template text run(s) are not on a scrim, band or solid field.\n` +
    `Text over a bare photo is unreadable on light images. Build the layers with\n` +
    `panel() from families.ts, which cannot emit text without its backing field.\n` +
    bad.join("\n");
  // eslint-disable-next-line no-console
  console.error(`[text-templates] ${message}`);
  throw new Error(`[text-templates] ${message}`);
}

if (process.env.NODE_ENV === "development") {
  assertTemplatesReadable(TEXT_TEMPLATES);
}

// ── Brand-aware mapping ───────────────────────────────────────────────────────

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export interface ResolvedTemplate {
  background: TemplateBackground | null;
  layers: TemplateLayerDef[];
}

/**
 * Turn a resolved template into editable canvas layers.
 *
 * Lives here rather than in the panel so the editor and the sweep route build
 * layers through exactly the same code — a template that renders in one and not
 * the other is the failure mode this function exists to prevent.
 *
 * `width`/`height` are the pixel size the layers will be laid out at: font
 * sizes are authored against an ~800px reference canvas and are scaled to it,
 * and shapes without an explicit height take their height from the canvas
 * aspect. A subject image layer resolves to `subjectUrl`; when that is empty
 * the layer is skipped rather than rendered as an empty box, so the caller must
 * handle an empty result.
 */
export function templateToLayers(
  t: ResolvedTemplate,
  subjectUrl: string,
  width: number,
  height: number,
): Layer[] {
  const scale = width ? Math.max(0.5, Math.min(2.5, width / 800)) : 1;
  const canvasAspect = width && height ? width / height : 1;
  const now = Date.now();
  const out: Layer[] = [];

  // Full-bleed background layer (covers the whole canvas)
  if (t.background) {
    out.push({
      id: `tpl-${now}-bg`,
      type: "image",
      imageUrl: backgroundDataUri(t.background),
      name: "Background",
      xPct: 0, yPct: 0, widthPct: 100,
      aspectRatio: canvasAspect,
      opacity: 1,
      visible: true,
    });
  }

  t.layers.forEach((def, i) => {
    if (def.kind === "image") {
      const url = def.source === "subject" ? subjectUrl : def.source.url;
      if (!url) return; // no subject to place; skip rather than render an empty box
      out.push({
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
    if (def.kind === "shape") {
      out.push({
        id: `tpl-${now}-${i}`,
        type: "image",
        imageUrl: shapeDataUri(def.shape, def.color, { color2: def.color2, gradient: def.gradient, shadow: def.shadow }),
        name: `shape:${def.shape}`,
        xPct: def.xPct, yPct: def.yPct, widthPct: def.widthPct,
        heightPct: def.heightPct,
        aspectRatio: shapeAspect(def.shape, !!def.shadow),
        // Shape layers are flat vector artwork authored against their box, so
        // they stretch to it rather than crop. This marker is the only thing
        // that makes SceneSvg stretch a layer, and it is set here and nowhere
        // else: an added image or an AI-decomposed object keeps cover-cropping
        // however the user resizes it.
        fit: "fill",
        opacity: def.opacity ?? 1,
        rotation: def.rotation,
        visible: true,
      });
      return;
    }
    const { kind, fontRole, lockColor, ...l } = def as TemplateTextDef; // strip template-only fields
    void kind; void fontRole; void lockColor;
    out.push({
      ...l,
      fontSize: Math.round(l.fontSize * scale),
      letterSpacing: l.letterSpacing !== undefined ? Math.round(l.letterSpacing * scale) : undefined,
      id: `tpl-${now}-${i}`,
    });
  });

  return out;
}

/** True when a template places the edited photo as a layer — the caller must
 *  then hide the backdrop copy of it, or the subject renders twice. */
export function placesSubject(defs: TemplateLayerDef[]): boolean {
  return defs.some((d) => d.kind === "image" && (d as TemplateImageDef).source === "subject");
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
    // Photos aren't recoloured by the brand kit — pass through unchanged.
    if (def.kind === "image") return def;
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

  // Recolouring the fields without recolouring the type on them is how brand
  // mode used to produce light ink on a pale brand field. The families pick
  // text colours that are guaranteed against the *palette's* field roles, and
  // that guarantee does not survive a brand kit cycling arbitrary colours
  // through those fields — so re-derive each run's colour from whatever it
  // actually ends up sitting on. Runs with their own pill, or with lockColor,
  // are already handled above and left alone.
  const rebranded = [...layers];
  if (colors.length > 0) {
    for (const backing of analyzeText(rebranded)) {
      if (!backing.fieldColor) continue;
      const layer = rebranded[backing.index];
      if (layer.kind === "shape" || layer.kind === "image") continue;
      if (layer.lockColor || layer.bgColor) continue;
      rebranded[backing.index] = { ...layer, color: bestTextOn(backing.fieldColor) };
    }
  }

  return { background, layers: rebranded };
}
