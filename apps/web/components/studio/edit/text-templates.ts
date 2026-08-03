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
 *  PROVISIONAL. This is a two-per-family placeholder that exercises every
 *  family and both of its variants, so the module compiles and the readability
 *  gate below has something real to check. The full 34-template set — its
 *  distribution across categories, its copy, and its geometric distinctness —
 *  is authored in the task that follows the families, and replaces this array
 *  wholesale.
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
 */
export const TEXT_TEMPLATES: TextTemplate[] = [
  // ── Ecommerce ──────────────────────────────────────────────────────────────
  {
    id: "ec_grid_lookbook",
    name: "Lookbook Grid",
    category: "ecommerce",
    family: "ruleGrid",
    layers: ruleGrid(resolvePalette("ecommerce"), {
      headline: "The Winter Edit",
      subhead: "Twelve pieces, one palette",
      support: "atelier / no 12",
    }, "right"),
  },
  {
    id: "ec_edge_restock",
    name: "Restock Block",
    category: "ecommerce",
    family: "hardEdge",
    layers: hardEdge(resolvePalette("blog"), {
      headline: "Back in Stock",
      subhead: "Linen throw, sand",
      support: "sold out twice / limited run",
    }, "bottom"),
  },
  {
    id: "ec_slab_markdown",
    name: "Markdown Slab",
    category: "ecommerce",
    family: "priceSlab",
    layers: priceSlab(resolvePalette("ecommerce"), {
      headline: "Aurora Desk Lamp",
      subhead: "-40%",
      support: "today only, while stocks last",
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
      support: "in store from friday",
    }),
  },
  {
    id: "so_wash_golden",
    name: "Golden Hour",
    category: "social",
    family: "duotoneWash",
    layers: duotoneWash(resolvePalette("social"), {
      headline: "Golden Hour",
      subhead: "The autumn edit, shot on location",
      support: "three looks, one roll of film",
    }),
  },
  {
    id: "so_stack_behind",
    name: "Behind the Build",
    category: "social",
    family: "offsetStack",
    layers: offsetStack(resolvePalette("promo"), {
      headline: "Behind the Build",
      subhead: "Day 41",
      support: "new clips every friday",
    }, "wide"),
  },
  {
    id: "so_space_quote",
    name: "Quote Card",
    category: "social",
    family: "negativeSpace",
    layers: negativeSpace(resolvePalette("social"), {
      headline: "Make It Obvious",
      subhead: "Habits beat motivation",
      support: "from this month's letter",
    }, "low"),
  },

  // ── Blog ───────────────────────────────────────────────────────────────────
  {
    id: "bl_grid_guide",
    name: "Guide Grid",
    category: "blog",
    family: "ruleGrid",
    layers: ruleGrid(resolvePalette("blog"), {
      headline: "Page Speed",
      subhead: "A practical guide for small teams",
      support: "updated for 2026",
    }),
  },
  {
    id: "bl_wash_essay",
    name: "Essay Wash",
    category: "blog",
    family: "duotoneWash",
    layers: duotoneWash(resolvePalette("blog"), {
      headline: "The Slow Web",
      subhead: "In praise of smaller, quieter sites",
      support: "essay / 9 min read",
    }, "stagger"),
  },
  {
    id: "bl_stack_notes",
    name: "Field Notes",
    category: "blog",
    family: "offsetStack",
    layers: offsetStack(resolvePalette("blog"), {
      headline: "Field Notes",
      subhead: "Issue 04",
      support: "everything we shipped in july",
    }),
  },
  {
    id: "bl_space_interview",
    name: "Interview Cover",
    category: "blog",
    family: "negativeSpace",
    layers: negativeSpace(resolvePalette("blog"), {
      headline: "In Conversation",
      subhead: "With Nadia Berger",
      support: "craft series, part three",
    }),
  },

  // ── Promo ──────────────────────────────────────────────────────────────────
  {
    id: "pr_wrap_opening",
    name: "Opening Wrap",
    category: "promo",
    family: "typeWrap",
    layers: typeWrap(resolvePalette("promo"), {
      headline: "Doors Open",
      subhead: "Thursday 7pm",
      support: "24 rue de la paix",
    }, "right"),
  },
  {
    id: "pr_edge_flash",
    name: "Flash Block",
    category: "promo",
    family: "hardEdge",
    layers: hardEdge(resolvePalette("promo"), {
      headline: "48 Hours",
      subhead: "Everything reduced",
      support: "discount applied at checkout",
    }),
  },
  {
    id: "pr_slab_two_for",
    name: "Two for One",
    category: "promo",
    family: "priceSlab",
    layers: priceSlab(resolvePalette("promo"), {
      headline: "Every Mug in Store",
      subhead: "2 for 1",
      support: "add both, the cheaper one is free",
    }, "centre"),
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
