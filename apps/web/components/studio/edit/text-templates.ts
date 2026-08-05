import type { Layer, TextLayer } from "./EditCanvas";
import type { BrandKit } from "@/lib/api";
import {
  type ShapeId, type TemplateBackground,
  shadeHex, shapeAspect, shapeDataUri, backgroundDataUri,
} from "./shapes";
import { bestTextOn, resolvePalette, type TemplateCategory } from "./palette";
import type { BlendMode, ClipSpec } from "./scene/types";
import { pctFromReferencePx } from "./scene/measure";
import { analyzeText } from "./families";
import { type Colourway, type ColourRegister, colourway } from "./design/colourways";
import type { GroundKind } from "./design/ground";
import {
  type ChipCopy, type LayoutCopy, buildTemplate, layoutById,
} from "./design/templates";
import { verifyFieldClaims, type RunSpec } from "./design/type";

/** A reusable design composition: optional background, shape objects, and text.
 *  Positions are canvas percentages; font sizes assume an ~800px-wide canvas
 *  and are scaled to the real canvas on apply. */
export { bestTextOn, type TemplateCategory };

/** A text run as an author writes it.
 *
 *  The type metrics are deliberately NOT the layer model's percentages. Authors
 *  and the families that generate them work in px on the `REFERENCE_WIDTH`
 *  canvas — `fontSize: 80` is legible as a headline in a way `fontSizePct: 10`
 *  is not, and the authoring fit guard in families.ts measures in the same
 *  units. `templateToLayers` is the boundary: it converts these px to
 *  percentages exactly once, and past that point nothing in the editor or the
 *  renderer carries an absolute pixel size. */
export interface TemplateTextDef
  extends Omit<TextLayer, "id" | "fontSizePct" | "letterSpacingPct" | "outlineWidthPct"> {
  kind?: "text";
  /** px on the REFERENCE_WIDTH canvas. */
  fontSize: number;
  /** px on the REFERENCE_WIDTH canvas; may be negative. */
  letterSpacing?: number;
  /** px on the REFERENCE_WIDTH canvas. */
  outlineWidth?: number;
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
  /** Which of the six layouts produced `layers`. Bookkeeping, not rendered: it
   *  is how the capability sweep groups templates back to the layout that built
   *  them, so it can tell "no instance of this layout in the shipped set earns
   *  a capability" from "no template happens to today". */
  layout: string;
  /** How the colour is applied. One of the two axes crossed to build the set. */
  ground: GroundKind;
  /** The palette, in full rather than by id, so a report can name its register
   *  and read its roles without a second lookup. */
  colourwayRef: Colourway;
  /** The run that answers "how big is the headline", for the size report the
   *  first rejection was about. */
  headline: string;
  /** How this template was built: layout, ground, colourway and copy. Carried
   *  rather than discarded because it is what makes a brand kit able to REBUILD
   *  the composition in the brand's colours — see `brandTemplate`. */
  spec: TemplateSpec;
  /** The runs as authored, each carrying the backdrop it was measured against.
   *  `layers` already contains the same type — this is the declared side of it,
   *  and the only thing that makes an honest contrast number possible now that
   *  type is allowed off an opaque field. */
  runs: RunSpec[];
  /** Full-bleed background layer. Every template in this set paints its ground
   *  as LAYERS instead — a mesh, a duotone pair and a halftone field are none of
   *  them expressible as a `TemplateBackground` — so this is null throughout and
   *  kept only because `templateFingerprint`, `ResolvedTemplate` and the brand
   *  mapping are all written against it. */
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

// ── The set ───────────────────────────────────────────────────────────────────

/** Copy for one template, in the vocabulary of the layout that renders it.
 *
 *  SIX HELPERS RATHER THAN ONE OBJECT LITERAL, and the reason is a defect this
 *  set is one refactor away from at all times. `LayoutCopy` requires every field
 *  because a layout that reads an absent one puts the string "undefined" on the
 *  canvas, where it looks — in a thumbnail — like a design choice. But no layout
 *  renders all of them, so writing 34 full literals means writing hundreds of
 *  lines of copy that nothing paints, and the first thing that happens to copy
 *  nothing paints is that it stops being read, and the second is that a template
 *  quietly ships someone else's words.
 *
 *  Each helper below takes EXACTLY the fields its layout renders, in a tuple
 *  where the count matters, and blanks the rest. TypeScript then rejects a
 *  Culvert with two headline lines instead of three at compile time, and a field
 *  that reaches the canvas can never be one the author never saw.
 *
 *  CHARACTER BUDGETS are stated per helper. They are not folklore: the harness
 *  measures every run's extent with the same estimator the centring uses and
 *  fails on anything past the frame, which is how Late Set's cap-line was caught
 *  7% over the right edge.
 */
const NONE = "";

/** Sound Pro: kicker, two headline lines at 6.5%, two support lines, two CTAs.
 *  Headline lines run from x6 and the cutout starts at x52, so ~14 characters
 *  each. The two CTAs sit side by side in a 46% run, so ~12 characters each. */
function soundProCopy(c: {
  kicker: string; head: [string, string]; body: [string, string]; cta: string; cta2: string;
}): LayoutCopy {
  return { ...c, script: NONE, chips: [], badge: NONE, footer: NONE };
}

/** Counter: kicker, two centred headline lines at 6%, two centred support lines,
 *  three chips flowed across 78%, a CTA and a seal label. The three chip labels
 *  together must come to about 57 characters; the seal takes eight. */
function counterCopy(c: {
  kicker: string; head: [string, string]; body: [string, string];
  chips: [ChipCopy, ChipCopy, ChipCopy]; cta: string; badge: string;
}): LayoutCopy {
  return { ...c, script: NONE, cta2: NONE, footer: NONE };
}

/** Culvert: kicker, THREE headline lines at 7%, two standfirst lines, two chips
 *  and a seal label. Headline lines run from x6 and the lifted disc sits at x62,
 *  so ~15 characters each. No CTA: this is the editorial layout, and a call to
 *  action is the thing that makes an essay cover look like an advert. */
function culvertCopy(c: {
  kicker: string; head: [string, string, string]; body: [string, string];
  chips: [ChipCopy, ChipCopy]; badge: string;
}): LayoutCopy {
  return { ...c, script: NONE, cta: NONE, cta2: NONE, footer: NONE };
}

/** Bass Line: a script line, one centred cap-line at 11% (~21 characters), four
 *  chips down the margins, a CTA, a starburst label of about six characters, and
 *  a short contact line beside the CTA. */
function bassLineCopy(c: {
  script: string; head: [string]; chips: [ChipCopy, ChipCopy, ChipCopy, ChipCopy];
  cta: string; badge: string; footer: string;
}): LayoutCopy {
  return { ...c, kicker: NONE, body: [], cta2: NONE };
}

/** Half Price: a script line, one cap-line at 12% from x5 (~18 characters), one
 *  support line, three chips stacked top-left, a CTA and a seal label. */
function halfPriceCopy(c: {
  script: string; head: [string]; body: [string];
  chips: [ChipCopy, ChipCopy, ChipCopy]; cta: string; badge: string;
}): LayoutCopy {
  return { ...c, kicker: NONE, cta2: NONE, footer: NONE };
}

/** Late Set: a script line, one cap-line at 10.5% from x53, one support line,
 *  two chips, a CTA, a starburst label and a line on the torn paper.
 *
 *  NINE CHARACTERS for the cap-line, and this is the tightest budget in the set.
 *  The type block starts at x53 and the frame ends at 100, so ten characters
 *  reach x98 and eleven leave the frame — which the harness catches, but a
 *  headline flush to the trim is not a design either. It is a poster cap-line;
 *  it wants one word. */
function lateSetCopy(c: {
  script: string; head: [string]; body: [string]; chips: [ChipCopy, ChipCopy];
  cta: string; badge: string; footer: string;
}): LayoutCopy {
  return { ...c, kicker: NONE, cta2: NONE };
}

/** One shipped template, before it is built. */
export interface TemplateSpec {
  id: string;
  name: string;
  category: TemplateCategory;
  layout: string;
  ground: GroundKind;
  colourway: string;
  copy: LayoutCopy;
}

/**
 * The shipped set: 34 templates, built by crossing six layouts with six grounds
 * and thirteen colourways.
 *
 * WHY THIS IS A TABLE AND NOT THIRTY-FOUR COMPOSITIONS. The set this replaces
 * was 34 hand-built one-offs and the owner's verdict on it was that there is no
 * creativity in the design and that it looks very old — which is not what you
 * would expect from 34 independent designs, and is exactly what you get from 34
 * variations on one instinct. Thirty-four one-offs by one author at one sitting
 * converge; thirty-four points on three orthogonal axes cannot. A template here
 * differs from every other by its LAYOUT (the arrangement and the type), its
 * GROUND (how the colour is applied to the frame) and its COLOURWAY (which
 * colours), and none of the three is derivable from the others.
 *
 * THE AXES ARE SPENT DELIBERATELY, not sprinkled:
 *
 *  - Every layout takes every ground it is composed for, exactly once. Five of
 *    the six use all six treatments; Bass Line uses five, because it writes
 *    across the whole frame and a photographic ground would have to darken the
 *    entire picture to hold its type, which is a scrim rather than a region the
 *    template owns. That rule is also what makes the set distinct by
 *    construction rather than by luck: no two templates share a (layout, ground)
 *    pair, so no two can share a geometry fingerprint.
 *
 *  - All thirteen colourways appear, none more than four times, and no
 *    colourway repeats within one layout.
 *
 *  - Sunset and Ember never take a gradient ground. Both meshes run through
 *    their own accent hue, so light ink over the ramp measured 2.02:1 and
 *    3.35:1. `groundsFor` refuses the pairing, so this is enforced rather than
 *    remembered.
 *
 * THE FOUR CATEGORIES ARE FOUR REGISTERS, not one register with four filters.
 * Ecommerce names a product and asks for the sale. Social is short, plural and
 * addressed to a room. Promo is a date, a door and a deadline. Blog is the one
 * that had no reference from the owner and the one the previous set got most
 * wrong: it read as a product promo with different words. Here it takes the
 * layouts with no call to action in them — Culvert four times, plus the quiet
 * lockups — and its copy is a clause that continues into the standfirst rather
 * than a headline that announces. Its chips carry a read time and a section
 * instead of a feature. Where a blog template does use a loud layout, the loud
 * element is an issue number rather than a discount.
 *
 * COPY CARRIES NO BRAND OF OURS. A customer applying one of these publishes
 * under their own name, so nothing here names a product, a domain or a company,
 * and the harness fails on the string "fennex" in any casing in any field
 * including `name`. Nothing invents a person, a street or a company either: an
 * address a customer has to replace should be obviously theirs to fill in.
 */
const SPECS: TemplateSpec[] = [
  // ── Ecommerce ──────────────────────────────────────────────────────────────
  {
    id: "ec_soundpro_flat", name: "Sound Pro", category: "ecommerce",
    layout: "soundpro", ground: "flat", colourway: "sorbet",
    copy: soundProCopy({
      kicker: "Audio",
      head: ["Sound Pro", "A56 Headset"],
      body: ["Forty hours between charges, and a case", "that charges from the same cable."],
      cta: "Buy now", cta2: "Compare",
    }),
  },
  {
    id: "ec_soundpro_blocked", name: "Kettle Block", category: "ecommerce",
    layout: "soundpro", ground: "blocked", colourway: "seaglass",
    copy: soundProCopy({
      kicker: "Kitchen",
      head: ["Pour Over", "Kettle 900"],
      body: ["Holds a set temperature for an hour,", "and pours in a line you can steer."],
      cta: "Add to bag", cta2: "See specs",
    }),
  },
  {
    id: "ec_soundpro_textured", name: "Trail Runner", category: "ecommerce",
    layout: "soundpro", ground: "textured", colourway: "spectrum",
    copy: soundProCopy({
      kicker: "Footwear",
      head: ["Trail Runner", "Three"],
      body: ["A rock plate under the forefoot, and a", "lug deep enough for wet ground."],
      cta: "Choose size", cta2: "Size guide",
    }),
  },
  {
    id: "ec_halfprice_duotone", name: "Half Price", category: "ecommerce",
    layout: "halfprice", ground: "duotone", colourway: "sunset",
    copy: halfPriceCopy({
      script: "Weekend only",
      head: ["Half price"],
      body: ["Every charger, cable and dock until Sunday midnight."],
      chips: [
        { icon: "bolt", label: "Fast charging" },
        { icon: "check", label: "Two-year cover" },
        { icon: "droplet", label: "Splash proof" },
      ],
      cta: "Shop the sale", badge: "48h only",
    }),
  },
  {
    id: "ec_halfprice_flat", name: "Last Pairs", category: "ecommerce",
    layout: "halfprice", ground: "flat", colourway: "peachsky",
    copy: halfPriceCopy({
      script: "While they last",
      head: ["Last pairs"],
      body: ["Ends of runs and single sizes, reduced to clear."],
      chips: [
        { icon: "check", label: "Final sizes" },
        { icon: "droplet", label: "No returns" },
        { icon: "bolt", label: "Ships today" },
      ],
      cta: "Shop clearance", badge: "Ends Sun",
    }),
  },
  {
    id: "ec_bassline_gradient", name: "Bass Line", category: "ecommerce",
    layout: "bassline", ground: "gradient", colourway: "blurple",
    copy: bassLineCopy({
      script: "Special sale",
      head: ["Headphones"],
      chips: [
        { icon: "droplet", label: "Water resistance" },
        { icon: "waveform", label: "Enhanced bass" },
        { icon: "mic", label: "Voice assistant" },
        { icon: "bolt", label: "Fast charging" },
      ],
      cta: "Order now", badge: "New", footer: "Ships from stock",
    }),
  },
  {
    id: "ec_bassline_duotone", name: "Spec Sheet", category: "ecommerce",
    layout: "bassline", ground: "duotone", colourway: "sunset",
    copy: bassLineCopy({
      script: "Now shipping",
      head: ["The Mixer"],
      chips: [
        { icon: "waveform", label: "Twelve channels" },
        { icon: "bolt", label: "Bus powered" },
        { icon: "mic", label: "Two mic inputs" },
        { icon: "check", label: "Three-year cover" },
      ],
      cta: "Pre-order", badge: "Live", footer: "In stock now",
    }),
  },
  {
    id: "ec_counter_photographic", name: "Restock Counter", category: "ecommerce",
    layout: "counter", ground: "photographic", colourway: "deepsea",
    copy: counterCopy({
      kicker: "Back in stock",
      head: ["It is back", "on the shelf"],
      body: ["The linen throw, in sand.", "Four hundred pieces this run."],
      chips: [
        { icon: "check", label: "Four hundred made" },
        { icon: "bolt", label: "Ships in a day" },
        { icon: "droplet", label: "Washed linen" },
      ],
      cta: "Add to basket", badge: "Restock",
    }),
  },
  {
    id: "ec_culvert_gradient", name: "Maker Story", category: "ecommerce",
    layout: "culvert", ground: "gradient", colourway: "pinkperi",
    copy: culvertCopy({
      kicker: "How it is made",
      head: ["Thrown on", "a wheel in", "the old mill"],
      body: ["Every piece is turned, dried and glazed", "in one building, by four people."],
      chips: [
        { icon: "droplet", label: "Glazed by hand" },
        { icon: "check", label: "Made to order" },
      ],
      badge: "Batch 07",
    }),
  },

  // ── Social ─────────────────────────────────────────────────────────────────
  {
    id: "so_soundpro_gradient", name: "Capsule Drop", category: "social",
    layout: "soundpro", ground: "gradient", colourway: "pinkperi",
    copy: soundProCopy({
      kicker: "Out Friday",
      head: ["The Spring", "Capsule"],
      body: ["Nine pieces, one colour, and the", "first fifty come signed."],
      cta: "See the drop", cta2: "Remind me",
    }),
  },
  {
    id: "so_counter_flat", name: "Going Live", category: "social",
    layout: "counter", ground: "flat", colourway: "signal",
    copy: counterCopy({
      kicker: "Going live",
      head: ["We go live", "on Wednesday"],
      body: ["Bring questions. We are answering", "all of them on air."],
      chips: [
        { icon: "mic", label: "Ask anything" },
        { icon: "bolt", label: "Eight at night" },
        { icon: "check", label: "Replay after" },
      ],
      cta: "Set a reminder", badge: "Live",
    }),
  },
  {
    id: "so_counter_gradient", name: "Milestone", category: "social",
    layout: "counter", ground: "gradient", colourway: "seaglass",
    copy: counterCopy({
      kicker: "Thank you",
      head: ["Ten thousand", "of you now"],
      body: ["Follow, tag a friend, and we draw", "the giveaway on Sunday."],
      chips: [
        { icon: "check", label: "One winner" },
        { icon: "bolt", label: "Draw on Sunday" },
        { icon: "mic", label: "Tag a friend" },
      ],
      cta: "Enter the draw", badge: "10K",
    }),
  },
  {
    id: "so_culvert_blocked", name: "Slow Reads", category: "social",
    layout: "culvert", ground: "blocked", colourway: "spectrum",
    copy: culvertCopy({
      kicker: "This week",
      head: ["Five slow", "reads for", "a long week"],
      body: ["What the team finished this month,", "and the one we all argued about."],
      chips: [
        { icon: "check", label: "Five picks" },
        { icon: "droplet", label: "Twenty minutes" },
      ],
      badge: "No 12",
    }),
  },
  {
    id: "so_bassline_flat", name: "Night Shift", category: "social",
    layout: "bassline", ground: "flat", colourway: "signal",
    copy: bassLineCopy({
      script: "Out now",
      head: ["Night Shift"],
      chips: [
        { icon: "waveform", label: "Twelve tracks" },
        { icon: "mic", label: "Two features" },
        { icon: "bolt", label: "Mixed on tape" },
        { icon: "check", label: "Vinyl in May" },
      ],
      cta: "Listen now", badge: "New", footer: "Out everywhere",
    }),
  },
  {
    id: "so_bassline_textured", name: "Build Log", category: "social",
    layout: "bassline", ground: "textured", colourway: "deepsea",
    copy: bassLineCopy({
      script: "Day forty one",
      head: ["The Build"],
      chips: [
        { icon: "bolt", label: "New clips Friday" },
        { icon: "check", label: "Forty one days" },
        { icon: "mic", label: "Ask in the replies" },
        { icon: "waveform", label: "Sound coming" },
      ],
      cta: "Watch part four", badge: "Part 4", footer: "Clips on Fridays",
    }),
  },
  {
    id: "so_halfprice_blocked", name: "Flash Block", category: "social",
    layout: "halfprice", ground: "blocked", colourway: "signal",
    copy: halfPriceCopy({
      script: "Two days only",
      head: ["Half off"],
      body: ["Everything in the shop, until Sunday at midnight."],
      chips: [
        { icon: "bolt", label: "Applied at checkout" },
        { icon: "check", label: "No code needed" },
        { icon: "droplet", label: "Stock only" },
      ],
      cta: "Shop the sale", badge: "48h",
    }),
  },
  {
    id: "so_lateset_textured", name: "Late Set", category: "social",
    layout: "lateset", ground: "textured", colourway: "ember",
    copy: lateSetCopy({
      script: "Live and late",
      head: ["Late Set"],
      body: ["Three rooms, one ticket, doors at ten."],
      chips: [
        { icon: "mic", label: "Nine live sets" },
        { icon: "bolt", label: "Room two till four" },
      ],
      cta: "Tickets", badge: "On sale",
      footer: "Fri 26 Sep / The old print works / 22:00",
    }),
  },
  {
    id: "so_lateset_blocked", name: "Encore", category: "social",
    layout: "lateset", ground: "blocked", colourway: "seaglass",
    copy: lateSetCopy({
      script: "One more night",
      head: ["Encore"],
      body: ["Added by demand. Same room, same time."],
      chips: [
        { icon: "check", label: "Added night" },
        { icon: "mic", label: "Same set list" },
      ],
      cta: "Get a ticket", badge: "Added",
      footer: "Sat 27 Sep / Room two / 21:00",
    }),
  },

  // ── Blog ───────────────────────────────────────────────────────────────────
  //
  // The register the owner gave no reference for, and the one the rejected set
  // read as a product promo in. Four of the eight are Culvert, which has no call
  // to action in it at all; the rest are the quiet lockups. A headline here is a
  // clause that finishes in the standfirst rather than an announcement, and the
  // chips carry a read time and a desk instead of a feature.
  {
    id: "bl_culvert_photographic", name: "Culvert", category: "blog",
    layout: "culvert", ground: "photographic", colourway: "slate",
    copy: culvertCopy({
      kicker: "Reporting",
      head: ["The river", "under the", "ring road"],
      body: ["Forty years after it was culverted,", "a city is digging it back up."],
      chips: [
        { icon: "droplet", label: "Water desk" },
        { icon: "check", label: "12 min read" },
      ],
      badge: "No 214",
    }),
  },
  {
    id: "bl_culvert_duotone", name: "After the Cut", category: "blog",
    layout: "culvert", ground: "duotone", colourway: "cornflower",
    copy: culvertCopy({
      kicker: "Interview",
      head: ["What changed", "when we cut", "the roadmap"],
      body: ["Two years of shipping less on purpose,", "and what it cost to get there."],
      chips: [
        { icon: "mic", label: "In conversation" },
        { icon: "check", label: "14 min read" },
      ],
      badge: "No 216",
    }),
  },
  {
    id: "bl_culvert_textured", name: "Smaller Sites", category: "blog",
    layout: "culvert", ground: "textured", colourway: "parchment",
    copy: culvertCopy({
      kicker: "Essay",
      head: ["In praise of", "smaller and", "quieter sites"],
      body: ["The web got heavy while nobody was", "watching. Some of it can be given back."],
      chips: [
        { icon: "check", label: "9 min read" },
        { icon: "droplet", label: "Slow web" },
      ],
      badge: "No 219",
    }),
  },
  {
    id: "bl_culvert_flat", name: "One Service", category: "blog",
    layout: "culvert", ground: "flat", colourway: "seaglass",
    copy: culvertCopy({
      kicker: "Field notes",
      head: ["Eighteen", "months, one", "service"],
      body: ["Leaving a monolith without stopping,", "told in the order it happened."],
      chips: [
        { icon: "bolt", label: "Engineering" },
        { icon: "check", label: "21 min read" },
      ],
      badge: "Part one",
    }),
  },
  {
    id: "bl_soundpro_photographic", name: "Field Notes", category: "blog",
    layout: "soundpro", ground: "photographic", colourway: "parchment",
    copy: soundProCopy({
      kicker: "Issue 04",
      head: ["Field Notes", "July"],
      body: ["Everything we shipped last month, and", "the two things we quietly removed."],
      cta: "Read issue", cta2: "Archive",
    }),
  },
  {
    id: "bl_counter_textured", name: "Saturday Column", category: "blog",
    layout: "counter", ground: "textured", colourway: "parchment",
    copy: counterCopy({
      kicker: "Saturday column",
      head: ["On buying less", "and keeping it"],
      body: ["A column about the things that outlast", "the reason they were bought."],
      chips: [
        { icon: "check", label: "7 min read" },
        { icon: "droplet", label: "Column" },
        { icon: "bolt", label: "Saturdays" },
      ],
      cta: "Read the column", badge: "No 41",
    }),
  },
  {
    id: "bl_lateset_gradient", name: "One Thing", category: "blog",
    layout: "lateset", ground: "gradient", colourway: "sorbet",
    copy: lateSetCopy({
      script: "From the letter",
      head: ["One Thing"],
      body: ["On the tyranny of the open tab. Three minutes."],
      chips: [
        { icon: "check", label: "3 min read" },
        { icon: "droplet", label: "Letter 41" },
      ],
      cta: "Read the letter", badge: "Letter",
      footer: "The weekly letter / No 41",
    }),
  },
  {
    id: "bl_lateset_photographic", name: "Season Two", category: "blog",
    layout: "lateset", ground: "photographic", colourway: "spectrum",
    copy: lateSetCopy({
      script: "Season two",
      head: ["Ship It"],
      body: ["A build log every Tuesday, for as long as it takes."],
      chips: [
        { icon: "bolt", label: "Every Tuesday" },
        { icon: "check", label: "Season two" },
      ],
      cta: "Start at one", badge: "S2",
      footer: "A build log / Season two / Tuesdays",
    }),
  },

  // ── Promo ──────────────────────────────────────────────────────────────────
  {
    id: "pr_counter_blocked", name: "Counter", category: "promo",
    layout: "counter", ground: "blocked", colourway: "peachsky",
    copy: counterCopy({
      kicker: "Opening night",
      head: ["Doors open", "at seven"],
      body: ["Twelve seats at the counter.", "Booking by phone only."],
      chips: [
        { icon: "phone", label: "Booking by phone" },
        { icon: "check", label: "Twelve seats" },
        { icon: "bolt", label: "Kitchen till late" },
      ],
      cta: "Reserve a table", badge: "Walk-ins",
    }),
  },
  {
    id: "pr_counter_duotone", name: "Last Call", category: "promo",
    layout: "counter", ground: "duotone", colourway: "ember",
    copy: counterCopy({
      kicker: "Last call",
      head: ["The sale ends", "at midnight"],
      body: ["Anything left in a basket goes", "back on the shelf at twelve."],
      chips: [
        { icon: "bolt", label: "Ends at midnight" },
        { icon: "check", label: "No code needed" },
        { icon: "droplet", label: "Stock only" },
      ],
      cta: "Finish checkout", badge: "Tonight",
    }),
  },
  {
    id: "pr_soundpro_duotone", name: "Founding Member", category: "promo",
    layout: "soundpro", ground: "duotone", colourway: "cornflower",
    copy: soundProCopy({
      kicker: "Membership",
      head: ["Founding", "Membership"],
      body: ["Locked for life. The price goes up", "for everyone in January."],
      cta: "Join now", cta2: "What you get",
    }),
  },
  {
    id: "pr_halfprice_photographic", name: "Live in June", category: "promo",
    layout: "halfprice", ground: "photographic", colourway: "ember",
    copy: halfPriceCopy({
      script: "Two nights",
      head: ["Live in June"],
      body: ["Eleven local acts across two stages, from seven."],
      chips: [
        { icon: "mic", label: "Eleven acts" },
        { icon: "bolt", label: "Two stages" },
        { icon: "check", label: "From twenty euros" },
      ],
      cta: "Get tickets", badge: "June 12",
    }),
  },
  {
    id: "pr_halfprice_textured", name: "Knife Skills", category: "promo",
    layout: "halfprice", ground: "textured", colourway: "spectrum",
    copy: halfPriceCopy({
      script: "One evening",
      head: ["Knife Skills"],
      body: ["Eight seats, an apron, and dinner at the end of it."],
      chips: [
        { icon: "check", label: "Eight seats" },
        { icon: "bolt", label: "One evening" },
        { icon: "droplet", label: "Apron provided" },
      ],
      cta: "Book a seat", badge: "8 seats",
    }),
  },
  {
    id: "pr_bassline_blocked", name: "Doors Open", category: "promo",
    layout: "bassline", ground: "blocked", colourway: "pinkperi",
    copy: bassLineCopy({
      script: "We are open",
      head: ["Doors Open"],
      chips: [
        { icon: "check", label: "Second floor" },
        { icon: "bolt", label: "Late on Fridays" },
        { icon: "phone", label: "Book a table" },
        { icon: "mic", label: "Live on Sundays" },
      ],
      // No street and no number. An address a customer has to replace should be
      // obviously theirs to fill in, not somebody else's shopfront.
      cta: "Find us", badge: "Open", footer: "Above the bakery",
    }),
  },
  {
    id: "pr_lateset_flat", name: "Tonight", category: "promo",
    layout: "lateset", ground: "flat", colourway: "peachsky",
    copy: lateSetCopy({
      script: "Doors at eight",
      head: ["Tonight"],
      body: ["One night, one room, and the bar stays open late."],
      chips: [
        { icon: "mic", label: "One set only" },
        { icon: "bolt", label: "Bar till two" },
      ],
      cta: "Last tickets", badge: "Tonight",
      footer: "Thu 18 Sep / Room one / 20:00",
    }),
  },
  {
    id: "pr_lateset_duotone", name: "On Sale", category: "promo",
    layout: "lateset", ground: "duotone", colourway: "cornflower",
    copy: lateSetCopy({
      script: "The new season",
      head: ["On Sale"],
      body: ["Every date in the season, on sale from Friday."],
      chips: [
        { icon: "check", label: "Twelve dates" },
        { icon: "bolt", label: "On sale Friday" },
      ],
      cta: "See the dates", badge: "Season",
      footer: "Season tickets / From Fri 12 Sep",
    }),
  },
];

/** The shipped set, built. Every entry places the edited photo, every colour
 *  comes from a colourway role, and no hex literal appears in a spec above. */
export const TEXT_TEMPLATES: TextTemplate[] = SPECS.map((spec) => {
  const built = buildTemplate(layoutById(spec.layout), {
    cw: colourway(spec.colourway),
    ground: spec.ground,
    copy: spec.copy,
  });
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    layout: spec.layout,
    ground: spec.ground,
    colourwayRef: built.colourway,
    headline: built.headline,
    spec,
    background: null,
    layers: built.layers,
    runs: built.runs,
  };
});

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
 * `width`/`height` are the pixel size the layers will be laid out at, and they
 * are used ONLY for the canvas aspect ratio, which shapes without an explicit
 * height need. Nothing else here depends on them: positions are already
 * percentages and the type metrics become percentages below. That is what makes
 * the result resolution independent — the layers this returns render the same
 * composition whether the scene is 620px or 2048px wide.
 *
 * This function used to multiply the authored font sizes by `width / 800`,
 * baking the DISPLAY resolution into the layer. The burn then rasterised those
 * same layers at the image's NATURAL size, where SceneSvg read them as absolute
 * user units, and every exported headline came out at displayWidth /
 * naturalWidth of the size the user approved.
 *
 * A subject image layer resolves to `subjectUrl`; when that is empty the layer
 * is skipped rather than rendered as an empty box, so the caller must handle an
 * empty result.
 */
export function templateToLayers(
  t: ResolvedTemplate,
  subjectUrl: string,
  width: number,
  height: number,
): Layer[] {
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
    // Strip template-only fields, and convert the three authoring-space px
    // metrics into the layer model's canvas-width percentages.
    const {
      kind, fontRole, lockColor, fontSize, letterSpacing, outlineWidth, ...l
    } = def as TemplateTextDef;
    void kind; void fontRole; void lockColor;
    out.push({
      ...l,
      fontSizePct: pctFromReferencePx(fontSize),
      letterSpacingPct: letterSpacing !== undefined ? pctFromReferencePx(letterSpacing) : undefined,
      outlineWidthPct: outlineWidth !== undefined ? pctFromReferencePx(outlineWidth) : undefined,
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
 * Rebuild a template in the org's brand colours.
 *
 * WHY THIS REBUILDS RATHER THAN RE-COLOURS. The previous implementation walked
 * the finished layer list and cycled the brand palette through whichever layers
 * happened to be SHAPES, then re-derived each run's ink from whatever it ended
 * up sitting on. That was the only thing available when a template was a flat
 * field with type on it, and it had two costs that only became visible once the
 * ground became an axis of its own:
 *
 *  1. It could not touch a ground that is not a shape. A mesh, a glow, a
 *     halftone field and a glass chip are all SVG data URIs — image layers —
 *     because that is the only way this renderer can express them. So on the
 *     five gradient-ground templates a brand kit changed literally nothing: the
 *     customer turned brand mode on and got our colours. The verification
 *     harness fails on that, and it is how the case was found.
 *
 *  2. Cycling a palette through shapes in paint order assigns colours by
 *     accident of layer index. The ground, a scrim and a CTA pill are three
 *     different jobs, and `colors[badge++ % colors.length]` gives them whatever
 *     comes next.
 *
 * A template now carries the spec it was built from, so branding is: derive a
 * `Colourway` from the brand kit, rebuild through the same `buildTemplate` the
 * shipped set uses, then substitute the brand's faces. Every colour in the
 * result comes from a role, exactly as in the authored form — which is the same
 * guarantee, applied to the brand's palette instead of ours.
 *
 * THE WASH DIRECTION IS RE-DERIVED BY CONSTRUCTION, which is the property that
 * had to survive this change. A duotone ground picks multiply-last or
 * screen-last from the colourway's REGISTER, and the derived colourway's
 * register is computed from the ink `bestTextOn` chooses for the brand's own
 * surface. So the surviving wash pass is always the one whose monotone bound
 * protects the ink actually set — there is no way to express the mispairing that
 * used to produce 1.11:1 against a dark photograph, rather than a rule
 * remembering to fix it afterwards.
 */
function brandColourway(colors: string[]): Colourway {
  const p = resolvePalette("ecommerce", { ...EMPTY_KIT, colors }, true);
  // `bestTextOn` returns one of exactly two inks, so this is a fact about the
  // brand's surface rather than a threshold guess: a light ink means a
  // dark-ground register and a dark ink means a soft one. Everything that keys
  // off the register — the duotone order above all — is then correct for the
  // ink this palette actually sets.
  const register: ColourRegister = p.ink === bestTextOn("#000000") ? "dark" : "soft";
  return {
    id: "brand",
    name: "Brand kit",
    register,
    // Three stops that belong to each other: the surface stepped down, the
    // surface, and the accent. `confident()` takes the middle one for a flat or
    // blocked ground, so the ground a run lands on is the surface its ink was
    // chosen against.
    stops: [shadeHex(p.surface, 0.75), p.surface, p.accent],
    angle: 135,
    blobs: [],
    surface: p.surface,
    ink: p.ink,
    accent: p.accent,
    onAccent: p.onAccent,
    accentInk: p.accentInk,
  };
}

/** A kit with nothing but colours, so `resolvePalette` can be reused for its
 *  role derivation without a caller inventing the other five fields. */
const EMPTY_KIT: BrandKit = {
  logo_url: null, colors: [], primary_font: null, secondary_font: null,
  style_rules: null, tone: null,
};

export function brandTemplate(t: TextTemplate, brand?: BrandKit | null): ResolvedTemplate {
  const plain: ResolvedTemplate = { background: t.background ?? null, layers: t.layers };
  if (!brand) return plain;
  const colors = (brand.colors ?? []).filter((c) => HEX_RE.test(c));

  const layers = colors.length
    ? buildTemplate(layoutById(t.spec.layout), {
      cw: brandColourway(colors),
      ground: t.spec.ground,
      copy: t.spec.copy,
    }).layers
    : t.layers;

  // Faces are independent of colour, so they apply whether or not the kit
  // carried any. `fontRole` is set by the type system from the run's size:
  // display and headline runs take the heading face, everything else the body.
  if (!brand.primary_font && !brand.secondary_font) return { background: null, layers };
  return {
    background: null,
    layers: layers.map((def): TemplateLayerDef => {
      if (def.kind !== "text") return def;
      if (def.fontRole === "heading" && brand.primary_font) return { ...def, fontFamily: brand.primary_font };
      if (def.fontRole === "body" && brand.secondary_font) return { ...def, fontFamily: brand.secondary_font };
      return def;
    }),
  };
}

// ── The soundness gate ────────────────────────────────────────────────────────

/** Helper so a kit is one line of colours rather than six fields of nulls. */
function readabilityKit(colors: string[]): BrandKit {
  return { logo_url: null, colors, primary_font: null, secondary_font: null, style_rules: null, tone: null };
}

/**
 * Brand kits the gate below re-checks every template through, and the same
 * kits `/dev/template-sweep` offers for visual review.
 *
 * Deliberately adversarial rather than pretty. Each one broke something real:
 * a pale primary and a near-white primary put light-seeking ink on a light
 * field, a near-black primary does the mirror, mid grey has no good ink at all,
 * and stock Tailwind sky/green is the most likely accidental kit there is.
 *
 * ONE LIST, deliberately. The sweep page used to carry its own near-copy of
 * this array, so the mechanical gate and the thing a human actually looks at
 * could — and did — disagree about which brands were covered: three of the
 * seven rows here were checked at module load and invisible in the browser.
 * Exported rather than duplicated so a kit added for one is a kit added for
 * both.
 *
 * Add colours here, never remove them: each row is a case someone measured.
 */
export const BRAND_KIT_FIXTURES: { label: string; kit: BrandKit }[] = [
  { label: "pale", kit: readabilityKit(["#f3d9a4", "#123a6b", "#7f1d3f"]) },
  { label: "sky/green", kit: readabilityKit(["#0ea5e9", "#22c55e"]) },
  { label: "sage/steel", kit: readabilityKit(["#7a9a5a", "#6b8fa8"]) },
  { label: "mid grey", kit: readabilityKit(["#969696", "#8a8a8a"]) },
  { label: "near-black", kit: readabilityKit(["#101820", "#1e293b"]) },
  { label: "near-white", kit: readabilityKit(["#f8fafc", "#e2e8f0"]) },
  { label: "single colour", kit: readabilityKit(["#7f1d3f"]) },
];

/**
 * Dev-only gate on the part of the readability rule that stays hard.
 *
 * WHAT CHANGED, AND WHY IT IS NOT A WEAKENING. The rule this replaces was
 * "every run sits on an opaque field at 4.5:1", enforced by `findUnbackedText`
 * over the whole set. It was correct for the composition families, because
 * `panel()` could not emit type without its backing field — and it is exactly
 * the rule the owner rejected the output of twice. A contrast floor that admits
 * no way to satisfy it except a box behind every word is a rule that designs
 * the page, and what it designed was called old and uncreative.
 *
 * So contrast is now REPORTED rather than enforced, and the harness prints
 * every measurement. Two things stay hard, and they are the two that are about
 * a template being wrong about itself rather than about taste:
 *
 *  1. A run that CLAIMS an opaque field or a monotone wash must actually have
 *     one, unoccluded, in the finished layer list. `verifyFieldClaims` checks
 *     the claim against the geometry. Everything downstream — the sweep, the
 *     harness, this gate — reads the declared backdrop, so a false claim
 *     poisons every number taken from it.
 *
 *  2. No run may sit on the bare photograph. `Backdrop`'s `photograph` kind
 *     exists to be declarable, and nothing in the shipped set may declare it:
 *     an unbacked run over whatever the customer uploaded has no measurable
 *     contrast at all, and that is a defect however the rest of the rule moved.
 *
 * The BRANDED form is checked too, and that half is not optional: `brandTemplate`
 * defaults to on in the editor, so branded is the normal path. It re-colours
 * fields out from under type that was measured against different colours, and
 * the failure it produces is a wash whose direction no longer matches its ink —
 * which `analyzeText` reports and which is what `washFor` exists to prevent.
 * Checking only the authored form is precisely how a wash at 1.11:1 against the
 * worst photograph passed the old gate while being wrong in every brand kit.
 *
 * `process.env.NODE_ENV` is inlined by the bundler, so this whole block is dead
 * code in a production build and costs nothing there.
 */
export function assertTemplatesSound(templates: TextTemplate[]): void {
  const bad: string[] = [];
  for (const t of templates) {
    for (const problem of verifyFieldClaims(t.layers, t.runs)) {
      bad.push(`  ${t.id}: ${problem}`);
    }
    for (const run of t.runs) {
      if (run.on.kind === "photograph") {
        bad.push(`  ${t.id}: "${run.text}" declares the bare photograph as its backdrop`);
      }
    }
    for (const { label, kit } of BRAND_KIT_FIXTURES) {
      for (const backing of analyzeText(brandTemplate(t, kit).layers)) {
        // Only the mispaired-wash case. A run resolving off its field under a
        // brand kit is the ordinary consequence of type living outside a box
        // and is reported as a contrast warning by the harness; a wash running
        // the wrong way for its ink has no contrast bound at all.
        if (backing.reason?.includes("wash")) {
          bad.push(`  ${t.id} [${label}]: "${backing.text}" — ${backing.reason}`);
        }
      }
    }
  }
  if (bad.length === 0) return;
  const message =
    `${bad.length} template(s) are wrong about what their type sits on.\n` +
    `A run may sit in a region the template prepared and take a contrast\n` +
    `warning for it. A run that claims a field or a wash it does not have is a\n` +
    `different thing: every number downstream is taken from that claim.\n` +
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
  assertTemplatesSound(TEXT_TEMPLATES);
}
