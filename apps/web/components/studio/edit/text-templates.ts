import type { Layer, TextLayer } from "./EditCanvas";
import type { BrandKit } from "@/lib/api";
import {
  type ShapeId, type TemplateBackground,
  shadeHex, shapeAspect, shapeDataUri, backgroundDataUri,
} from "./shapes";
import { bestTextOn, resolvePalette, type TemplateCategory } from "./palette";
import type { BlendMode, ClipSpec } from "./scene/types";
import {
  typeWrap, duotoneWash, offsetStack, ruleGrid, hardEdge, priceSlab, negativeSpace,
  findUnbackedText, analyzeText, isWashMode, washFor, type FamilyId,
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
  /** Composite this field against what is already painted. Only a field with no
   *  type on it may blend — see `panel()` in families.ts. */
  blend?: BlendMode;
}

export interface TemplateImageDef {
  kind: "image";
  /** "subject" places the image being edited. "subject-cutout" places it with
   *  its background removed, which is a paid operation and so is gated behind a
   *  consent dialog before the template applies. An explicit url places a fixed
   *  asset. */
  source: "subject" | "subject-cutout" | { url: string };
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
  /** Which composition family produced `layers`. Bookkeeping, not rendered:
   *  it is how the capability-coverage sweep groups templates back to the
   *  family that built them, so it can tell "no instance of this family in
   *  the shipped set earns a capability" from "no template happens to
   *  today" — see `templateFingerprint` below for the sibling problem this
   *  solves on the distinctness axis. */
  family: FamilyId;
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

/** The shipped set, built from the seven composition families.
 *
 *  Every entry places the edited photo through an image layer, so these are
 *  compositions rather than decoration laid over whatever the user happened to
 *  upload. Colours come from `resolvePalette` roles, never from literals.
 *
 *  Three axes of variation, and no fourth. An instance differs from its
 *  siblings by:
 *    1. its palette — one of the four category palettes, each of which
 *       guarantees ink/surface, onAccent/accent and accentInk/surface at
 *       4.5:1;
 *    2. its copy;
 *    3. its family's single composition parameter (type side, wash blend,
 *       plate spread, grid side, edge anchor, slab place, space anchor).
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
 *  Copy is authored to each family's character budget, which is stated in that
 *  family's doc comment in `families.ts`. `panel()` warns in development when a
 *  run overruns its field.
 *
 *  DISTINCTNESS IS STRUCTURAL, NOT LUCKY. `templateFingerprint` blanks the copy
 *  and hashes everything else, so two instances of one family that share a
 *  palette AND a composition parameter are the same template with different
 *  words — that is exactly how the set this replaced shipped seven identical
 *  pairs while appearing to hold 34 entries. The rule the set below follows is
 *  therefore stronger than the check: no (family, palette, parameter) triple is
 *  used twice, anywhere, across any category. Each family has eight such
 *  triples available and spends at most five of them, so a new template always
 *  has an unused one to take. Do not add an instance that reuses a triple and
 *  relies on a centred run's copy-dependent x offset to squeak past the sweep.
 *
 *  Copy carries no brand of ours. A customer applying one of these is
 *  publishing under their own name, so nothing here names a product, a domain
 *  or a company — the sweep's brand-neutrality check fails the build on the
 *  string "fennex" in any casing, in any field, including `name`.
 */
export const TEXT_TEMPLATES: TextTemplate[] = [
  // ── Ecommerce ──────────────────────────────────────────────────────────────
  {
    id: "ec_slab_lamp",
    name: "Markdown Slab",
    category: "ecommerce",
    family: "priceSlab",
    layers: priceSlab(resolvePalette("ecommerce"), {
      headline: "Aurora Desk Lamp",
      subhead: "-40%",
      support: "Today only, and free returns for thirty days",
    }),
  },
  {
    id: "ec_slab_bundle",
    name: "Bundle Slab",
    category: "ecommerce",
    family: "priceSlab",
    layers: priceSlab(resolvePalette("ecommerce"), {
      headline: "Ceramic Mug Set",
      subhead: "2 for 1",
      support: "Add both to the basket and the second one is free",
    }, "centre"),
  },
  {
    id: "ec_slab_outlet",
    name: "Outlet Slab",
    category: "ecommerce",
    family: "priceSlab",
    layers: priceSlab(resolvePalette("blog"), {
      headline: "Trail Runner 3",
      subhead: "$89",
      support: "Last season's colourway, same outsole and the same fit",
    }),
  },
  {
    id: "ec_grid_lookbook",
    name: "Lookbook Grid",
    category: "ecommerce",
    family: "ruleGrid",
    layers: ruleGrid(resolvePalette("ecommerce"), {
      headline: "The Winter Edit",
      subhead: "Twelve pieces cut from one palette",
      support: "Atelier / No 12",
    }, "right"),
  },
  {
    id: "ec_grid_care",
    name: "Care Guide Grid",
    category: "ecommerce",
    family: "ruleGrid",
    layers: ruleGrid(resolvePalette("ecommerce"), {
      headline: "How to Wash Linen",
      subhead: "Cold water, flat dry, no softener",
      support: "Care guide / 4 steps",
    }),
  },
  {
    id: "ec_edge_restock",
    name: "Restock Block",
    category: "ecommerce",
    family: "hardEdge",
    layers: hardEdge(resolvePalette("blog"), {
      headline: "Back in Stock",
      subhead: "The linen throw, in sand",
      support: "It sold out twice. This run is four hundred pieces.",
    }, "bottom"),
  },
  {
    id: "ec_edge_landed",
    name: "Just Landed Block",
    category: "ecommerce",
    family: "hardEdge",
    layers: hardEdge(resolvePalette("ecommerce"), {
      headline: "Just Landed",
      subhead: "The all-weather parka",
      support: "Taped seams, recycled shell, cut wide enough to layer.",
    }),
  },
  {
    id: "ec_stack_studio",
    name: "Studio Stack",
    category: "ecommerce",
    family: "offsetStack",
    layers: offsetStack(resolvePalette("ecommerce"), {
      headline: "Made in the Studio",
      subhead: "Batch 07",
      support: "Thrown, glazed and fired here",
    }),
  },
  {
    id: "ec_wrap_arrival",
    name: "Arrivals Wrap",
    category: "ecommerce",
    family: "typeWrap",
    layers: typeWrap(resolvePalette("ecommerce"), {
      headline: "New Arrivals",
      subhead: "Autumn Drop 02",
      support: "In store and online from Friday",
    }),
  },

  // ── Social ─────────────────────────────────────────────────────────────────
  {
    id: "so_wrap_season",
    name: "Season Wrap",
    category: "social",
    family: "typeWrap",
    layers: typeWrap(resolvePalette("social"), {
      headline: "New Season",
      subhead: "Spring 26",
      support: "Doors open Friday at nine",
    }),
  },
  {
    id: "so_wrap_milestone",
    name: "Milestone Wrap",
    category: "social",
    family: "typeWrap",
    layers: typeWrap(resolvePalette("social"), {
      headline: "We Hit 10K",
      subhead: "Giveaway Time",
      support: "Follow, tag a friend, we draw Sunday",
    }, "right"),
  },
  {
    id: "so_wash_golden",
    name: "Golden Hour Wash",
    category: "social",
    family: "duotoneWash",
    layers: duotoneWash(resolvePalette("social"), {
      headline: "Golden Hour",
      subhead: "The autumn edit, shot on location",
      support: "Three looks, one roll of film",
    }),
  },
  {
    id: "so_wash_release",
    name: "Release Wash",
    category: "social",
    family: "duotoneWash",
    layers: duotoneWash(resolvePalette("promo"), {
      headline: "Night Shift",
      subhead: "Twelve tracks for the late commute",
      support: "Out now wherever you stream",
    }),
  },
  {
    id: "so_stack_build",
    name: "Build Log Stack",
    category: "social",
    family: "offsetStack",
    layers: offsetStack(resolvePalette("social"), {
      headline: "Behind the Build",
      subhead: "Day 41",
      support: "New clips every Friday",
    }, "wide"),
  },
  {
    id: "so_stack_market",
    name: "Market Recap Stack",
    category: "social",
    family: "offsetStack",
    layers: offsetStack(resolvePalette("promo"), {
      headline: "Market Day Recap",
      subhead: "Stall 12",
      support: "Same spot again next Saturday",
    }, "wide"),
  },
  {
    id: "so_grid_carousel",
    name: "Carousel Grid",
    category: "social",
    family: "ruleGrid",
    layers: ruleGrid(resolvePalette("social"), {
      headline: "Five Slow Reads",
      subhead: "What the team finished this month",
      support: "Swipe / 1 of 5",
    }),
  },
  {
    id: "so_edge_live",
    name: "Going Live Block",
    category: "social",
    family: "hardEdge",
    layers: hardEdge(resolvePalette("social"), {
      headline: "We Go Live",
      subhead: "Wednesday at 8pm CET",
      support: "Bring questions. We are answering all of them on air.",
    }),
  },
  {
    id: "so_space_quote",
    name: "Quote Card",
    category: "social",
    family: "negativeSpace",
    layers: negativeSpace(resolvePalette("social"), {
      headline: "Make It Obvious",
      subhead: "Habits beat motivation",
      support: "From this month's letter, now in your inbox",
    }, "low"),
  },

  // ── Blog ───────────────────────────────────────────────────────────────────
  {
    id: "bl_wrap_series",
    name: "Series Wrap",
    category: "blog",
    family: "typeWrap",
    layers: typeWrap(resolvePalette("blog"), {
      headline: "Ship It Weekly",
      subhead: "Season Two",
      support: "A new build log every Tuesday",
    }, "right"),
  },
  {
    id: "bl_wash_slowweb",
    name: "Essay Wash",
    category: "blog",
    family: "duotoneWash",
    layers: duotoneWash(resolvePalette("blog"), {
      headline: "The Slow Web",
      subhead: "In praise of smaller, quieter sites",
      support: "Essay / 9 min read",
    }, "stagger"),
  },
  {
    id: "bl_wash_interview",
    name: "Interview Wash",
    category: "blog",
    family: "duotoneWash",
    layers: duotoneWash(resolvePalette("social"), {
      headline: "After Burnout",
      subhead: "What changed when we cut the roadmap",
      support: "Interview / 14 min read",
    }, "stagger"),
  },
  {
    id: "bl_grid_pagespeed",
    name: "Guide Grid",
    category: "blog",
    family: "ruleGrid",
    layers: ruleGrid(resolvePalette("blog"), {
      headline: "Page Speed",
      subhead: "A practical guide for small teams",
      support: "Updated for 2026",
    }),
  },
  {
    id: "bl_grid_migration",
    name: "Deep Dive Grid",
    category: "blog",
    family: "ruleGrid",
    layers: ruleGrid(resolvePalette("blog"), {
      headline: "Leaving the Monolith",
      subhead: "Eighteen months, one service at a time",
      support: "Engineering / Part 1",
    }, "right"),
  },
  {
    id: "bl_stack_notes",
    name: "Field Notes Stack",
    category: "blog",
    family: "offsetStack",
    layers: offsetStack(resolvePalette("blog"), {
      headline: "Field Notes",
      subhead: "Issue 04",
      support: "Everything we shipped in July",
    }),
  },
  {
    id: "bl_stack_retro",
    name: "Retro Stack",
    category: "blog",
    family: "offsetStack",
    layers: offsetStack(resolvePalette("blog"), {
      headline: "The Q3 Retro",
      subhead: "Team of nine",
      support: "What we would not do again",
    }, "wide"),
  },
  {
    id: "bl_space_profile",
    name: "Profile Cover",
    category: "blog",
    family: "negativeSpace",
    layers: negativeSpace(resolvePalette("blog"), {
      headline: "In Conversation",
      subhead: "With ceramicist Nadia Berger",
      support: "Craft series, part three of six",
    }),
  },
  {
    id: "bl_space_column",
    name: "Column Cover",
    category: "blog",
    family: "negativeSpace",
    layers: negativeSpace(resolvePalette("blog"), {
      headline: "The Long Read",
      subhead: "On buying less, keeping it longer",
      support: "Column / Saturday edition",
    }, "low"),
  },

  // ── Promo ──────────────────────────────────────────────────────────────────
  {
    id: "pr_wrap_opening",
    name: "Opening Wrap",
    category: "promo",
    family: "typeWrap",
    layers: typeWrap(resolvePalette("promo"), {
      headline: "Doors Open",
      subhead: "Thursday, 7pm",
      support: "24 Rue de la Paix, second floor",
    }),
  },
  {
    id: "pr_wash_festival",
    name: "Festival Wash",
    category: "promo",
    family: "duotoneWash",
    layers: duotoneWash(resolvePalette("promo"), {
      headline: "Two Nights",
      subhead: "Live sets from eleven local acts",
      support: "Tickets from twenty euros, doors at seven",
    }, "stagger"),
  },
  {
    id: "pr_edge_flash",
    name: "Flash Block",
    category: "promo",
    family: "hardEdge",
    layers: hardEdge(resolvePalette("promo"), {
      headline: "48 Hours Only",
      subhead: "Everything reduced",
      support: "The discount is applied at checkout. No code needed.",
    }),
  },
  {
    id: "pr_edge_lastcall",
    name: "Last Call Block",
    category: "promo",
    family: "hardEdge",
    layers: hardEdge(resolvePalette("promo"), {
      headline: "Last Call",
      subhead: "The sale ends at midnight",
      support: "Anything still in your basket at midnight goes back.",
    }, "bottom"),
  },
  {
    id: "pr_slab_membership",
    name: "Membership Slab",
    category: "promo",
    family: "priceSlab",
    layers: priceSlab(resolvePalette("promo"), {
      headline: "Founding Membership",
      subhead: "$9/mo",
      support: "Locked for life. The price goes up in January.",
    }),
  },
  {
    id: "pr_slab_multibuy",
    name: "Multibuy Slab",
    category: "promo",
    family: "priceSlab",
    layers: priceSlab(resolvePalette("promo"), {
      headline: "Every Mug in Store",
      subhead: "3 for 2",
      support: "The cheapest one comes off at the checkout, no code.",
    }, "centre"),
  },
  {
    id: "pr_space_workshop",
    name: "Workshop Card",
    category: "promo",
    family: "negativeSpace",
    layers: negativeSpace(resolvePalette("promo"), {
      headline: "Knife Skills",
      subhead: "One evening, eight seats",
      support: "Thursday the 14th, apron and dinner included",
    }),
  },
];

/** A template's geometry with its words removed. Two templates that differ only
 *  in copy produce the same fingerprint -- which is how the previous set came
 *  to ship seven visually identical pairs while appearing to have 34 entries.
 *
 *  Everything but the text survives the blank: colour, position, size, blend,
 *  clip, rotation, opacity, fit and image source are all still keys on the
 *  spread layer, so two templates that share geometry but differ in, say,
 *  blend mode are NOT collapsed into the same fingerprint -- they differ in a
 *  field this function keeps. */
export function templateFingerprint(t: TextTemplate): string {
  const layers = t.layers.map((l) =>
    l.kind === "text" ? { ...l, text: "" } : l,
  );
  return JSON.stringify({ background: t.background ?? null, layers });
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
      // "subject-cutout" resolves to the subject here too: the background-free
      // copy is fetched by the apply path, which passes it in as `subjectUrl`
      // once the user has agreed to spend the credits.
      const url = typeof def.source === "string" ? subjectUrl : def.source.url;
      if (!url) return; // no subject to place; skip rather than render an empty box
      out.push({
        id: `tpl-${now}-${i}`,
        type: "image",
        imageUrl: url,
        name: def.source === "subject-cutout" ? "Cutout" : def.source === "subject" ? "Photo" : "Image",
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
        blend: def.blend,
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
  return defs.some((d) => {
    if (d.kind !== "image") return false;
    const source = (d as TemplateImageDef).source;
    return source === "subject" || source === "subject-cutout";
  });
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
      const color = colors[badge++ % colors.length];
      // A wash's direction is a function of its colour and its ink, not a
      // style the layer carries around. Recolouring one without re-deriving
      // the direction is how brand mode produced near-black type on a
      // multiply wash of a pale brand colour — 1.11:1 against a dark
      // photograph, because multiply can only take that field darker still.
      // The ink below is chosen by `bestTextOn` against this same colour, so
      // deriving the direction from that exact value here is what keeps the
      // two agreeing, and the monotone floor is re-established against the
      // brand palette instead of inherited from the palette the template was
      // authored in.
      if (isWashMode(def.blend)) {
        return { ...def, color, blend: washFor(color, bestTextOn(color)) };
      }
      return { ...def, color };
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
  //
  // Order matters, and it is the order it is for a reason. Every field this
  // function touches — colour AND wash direction — is already final in
  // `layers`, so `analyzeText` here reads the rebranded fields and only the ink
  // is still open. That is the one thing this loop writes, so nothing it
  // decides is invalidated by a later step.
  const rebranded = [...layers];
  if (colors.length > 0) {
    for (const backing of analyzeText(rebranded)) {
      const layer = rebranded[backing.index];
      if (layer.kind === "shape" || layer.kind === "image") continue;
      if (layer.lockColor || layer.bgColor) continue;
      // No field at all, so there is no colour to contrast against and no
      // recolouring that would help. `assertTemplatesReadable` is what catches
      // this; it is not silently acceptable, it is simply not fixable here.
      if (!backing.fieldColor) continue;
      // `backing.fieldColor` is a wash's own colour rather than what it
      // composites to, which is exactly what makes this correct on a wash:
      // monotonicity puts the true worst case at that colour, and the field's
      // direction was derived from `bestTextOn` of it above.
      rebranded[backing.index] = { ...layer, color: bestTextOn(backing.fieldColor) };
    }
  }

  return { background, layers: rebranded };
}

// ── The readability gate ──────────────────────────────────────────────────────

/** Helper so a kit is one line of colours rather than six fields of nulls. */
function readabilityKit(colors: string[]): BrandKit {
  return { logo_url: null, colors, primary_font: null, secondary_font: null, style_rules: null, tone: null };
}

/**
 * Brand kits the gate below re-checks every template through.
 *
 * Deliberately adversarial rather than pretty. Each one broke something real:
 * a pale primary and a near-white primary put light-seeking ink on a light
 * field, a near-black primary does the mirror, mid grey has no good ink at all,
 * and stock Tailwind sky/green is the most likely accidental kit there is. The
 * dev sweep has its own overlapping list for visual review; this one exists so
 * the check runs at module load with no page open, because a defect that only
 * a browser can see is a defect that ships.
 */
const READABILITY_KITS: { label: string; kit: BrandKit }[] = [
  { label: "pale", kit: readabilityKit(["#f3d9a4", "#123a6b", "#7f1d3f"]) },
  { label: "sky/green", kit: readabilityKit(["#0ea5e9", "#22c55e"]) },
  { label: "sage/steel", kit: readabilityKit(["#7a9a5a", "#6b8fa8"]) },
  { label: "mid grey", kit: readabilityKit(["#969696", "#8a8a8a"]) },
  { label: "near-black", kit: readabilityKit(["#101820", "#1e293b"]) },
  { label: "near-white", kit: readabilityKit(["#f8fafc", "#e2e8f0"]) },
  { label: "single colour", kit: readabilityKit(["#7f1d3f"]) },
];

/**
 * Dev-only gate on the readability rule.
 *
 * The families make it hard to author unbacked text; this makes it impossible
 * to ship. A template that spreads a family's output and appends its own text
 * def, or that hand-writes layers entirely, bypasses `panel()` — this catches
 * it at module load, before anything renders, and names the offending copy.
 *
 * It checks the BRANDED form as well as the authored one, and that half is not
 * optional. `brandTemplate` defaults to on in the editor, so branded is the
 * normal path, not an edge case — and it is the path that re-colours fields
 * out from under type that was contrast-checked against different colours.
 * Checking only `TEXT_TEMPLATES` is precisely how a wash whose direction no
 * longer matched its ink — 1.11:1 at the worst photograph — passed this gate
 * while being wrong in every brand kit.
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
    for (const { label, kit } of READABILITY_KITS) {
      for (const issue of findUnbackedText(brandTemplate(t, kit).layers)) {
        bad.push(`  ${t.id} [${label}]: "${issue.text}" — ${issue.reason}`);
      }
    }
  }
  if (bad.length === 0) return;
  const message =
    `${bad.length} template text run(s) are not on a scrim, band or solid field.\n` +
    `Text over a bare photo is unreadable on light images. Build the layers with\n` +
    `panel() from families.ts, which cannot emit text without its backing field.\n` +
    `A "[kit]" tag means the authored template is fine and the brand-kit mapping\n` +
    `broke it, so the fix belongs in brandTemplate rather than in the template.\n` +
    bad.join("\n");
  // eslint-disable-next-line no-console
  console.error(`[text-templates] ${message}`);
  throw new Error(`[text-templates] ${message}`);
}

// Runs last in the module on purpose: it calls `brandTemplate`, which reads
// module-level constants declared above it.
if (process.env.NODE_ENV === "development") {
  assertTemplatesReadable(TEXT_TEMPLATES);
}
