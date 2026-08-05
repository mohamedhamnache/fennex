/** Colourways — the palette axis, and nothing else.
 *
 *  WHY THIS EXISTS. A template used to hard-code its colours through a category
 *  palette, so the only way to get variety was to invent another layout. That is
 *  how 34 hand-built templates still managed to look related. Making colour an
 *  ORTHOGONAL axis means six layouts times twelve colourways is seventy-two
 *  variants with no new layouts, which is how a real template library scales.
 *
 *  A colourway carries HUES ONLY. How the colour is applied — gradient, flat,
 *  photographic, duotone, blocked, textured — is the separate `ground` axis in
 *  `ground.ts`. Keeping them apart is the point: the first version of this had
 *  the gradient inside the colourway, which quietly made every template a
 *  gradient and would have produced a set that was monotonous on a new axis.
 *
 *  ROLE NAMES MATCH `Palette` DELIBERATELY. `surface`, `ink`, `accent`,
 *  `onAccent` and `accentInk` mean exactly what they mean in `palette.ts`, so a
 *  layout reads the same whichever it is handed and promoting this later is a
 *  type change rather than a rewrite. `stops`, `angle` and `blobs` are the extra
 *  information a ground needs and a five-role palette cannot carry.
 *
 *  NAMING AND TRADE DRESS, both firm.
 *
 *  Every name here is descriptive — "Sunset", not the app whose gradient made
 *  that combination famous. A customer publishes these commercially under their
 *  own name, so a template shipping as a brand's name in that brand's colours
 *  is their legal exposure, not ours.
 *
 *  None of these values is sampled from any company's brand assets. They are
 *  hand-set inside the hue family each name describes, which is both the
 *  safer position and the honest one: colour in isolation is generally not
 *  protectable, but a handful of registered trade dresses are — Tiffany Blue,
 *  T-Mobile magenta, UPS brown, Cadbury purple, Louboutin red — and nothing
 *  here is built around any of them, renamed or otherwise. No network was
 *  available in this session, so no value below was checked against a published
 *  source; they are chosen by hue relationship, and every one is measured for
 *  contrast by the sweep rather than trusted.
 *
 *  REGISTER is which of the two directions the owner approved a colourway can
 *  carry. `vibrant` and `dark` are both dark-ground and take light ink;
 *  `soft` is pale-ground and takes dark ink. A layout declares which registers
 *  it accepts, and the matrix in the sweep is the cross product.
 */

import type { MeshStop } from "./vector";

export type ColourRegister = "vibrant" | "soft" | "dark";

export interface Colourway {
  id: string;
  name: string;
  register: ColourRegister;
  /** Two to four stops, in the order a gradient ground should run them. Also
   *  the palette a flat or blocked ground picks its fields from, so the middle
   *  stop is deliberately the most saturated in the vibrant sets. */
  stops: string[];
  /** Degrees, for a gradient ground. Ignored by every other ground. */
  angle: number;
  /** Radial blobs that give a gradient ground a lit core rather than a flat
   *  ramp. Empty is legal and reads as a plain two-stop fade. */
  blobs: MeshStop[];
  /** The deepest ground colour. Paper text, scrims and duotone shadows take it. */
  surface: string;
  /** Primary type on the ground. */
  ink: string;
  accent: string;
  /** Type on the accent. */
  onAccent: string;
  /** Coloured type on the ground — the accent moved in lightness until it can
   *  carry a word. */
  accentInk: string;
  /** A second accent, where the colourway has one. Multi-hue grounds and
   *  two-colour duotones use it; everything else ignores it. */
  accent2?: string;
}

function blob(color: string, x: number, y: number, r: number, alpha: number): MeshStop {
  return { color, x, y, r, alpha };
}

/**
 * Twelve colourways: three vibrant, five soft, four dark.
 *
 * Each name describes the colours. The parenthetical in each comment is the
 * family the research pointed at, recorded so the reasoning is auditable — it
 * is not a claim that the values came from that source.
 */
export const COLOURWAYS: Colourway[] = [
  // ── Vibrant ────────────────────────────────────────────────────────────────
  {
    // Violet to crimson to amber. (The warm social-gradient family, and the DNA
    // of the owner's first reference.)
    id: "sunset",
    name: "Sunset",
    register: "vibrant",
    stops: ["#4c1d95", "#c2185b", "#f59e0b"],
    angle: 30,
    blobs: [blob("#f59e0b", 0.8, 0.18, 0.45, 0.4), blob("#7c3aed", 0.15, 0.85, 0.5, 0.45)],
    surface: "#2e1065",
    ink: "#fff7ed",
    accent: "#f59e0b",
    onAccent: "#3b1d02",
    accentInk: "#fcd34d",
    accent2: "#f43f5e",
  },
  {
    // Indigo through violet. "Blurple" is a generic colour term, which is why it
    // is usable as a name where a company's would not be.
    id: "blurple",
    name: "Blurple",
    register: "vibrant",
    stops: ["#1e1b4b", "#4338ca", "#7c3aed"],
    angle: 150,
    blobs: [blob("#8b5cf6", 0.78, 0.24, 0.5, 0.45), blob("#312e81", 0.2, 0.8, 0.55, 0.5)],
    surface: "#1e1b4b",
    ink: "#eef2ff",
    accent: "#a78bfa",
    onAccent: "#1e1b4b",
    accentInk: "#c4b5fd",
  },
  {
    // Deep red into orange, over near-black. Night heat.
    id: "ember",
    name: "Ember",
    register: "vibrant",
    stops: ["#1c0a05", "#7f1d1d", "#ea580c"],
    angle: 25,
    blobs: [blob("#fb923c", 0.24, 0.2, 0.42, 0.35), blob("#7f1d1d", 0.85, 0.8, 0.5, 0.5)],
    surface: "#1c0a05",
    ink: "#fff7ed",
    accent: "#fb923c",
    onAccent: "#1c0a05",
    accentInk: "#fdba74",
  },

  // ── Soft ───────────────────────────────────────────────────────────────────
  {
    // Mint, cream, blush. (The owner's second reference.)
    id: "sorbet",
    name: "Sorbet",
    register: "soft",
    stops: ["#d8fbec", "#fbfaea", "#fcdee8"],
    angle: 100,
    blobs: [blob("#d8fbec", 0.15, 0.2, 0.5, 0.75), blob("#fcdee8", 0.85, 0.75, 0.55, 0.7)],
    surface: "#fbfaea",
    ink: "#14232b",
    accent: "#c2185b",
    onAccent: "#fff5f8",
    accentInk: "#a3245a",
  },
  {
    // Peach into sky. Warm and optimistic; good for lifestyle and food.
    id: "peachsky",
    name: "Peach to sky",
    register: "soft",
    stops: ["#ffd9c0", "#ffeadb", "#cfe8ff"],
    angle: 30,
    blobs: [blob("#ffd9c0", 0.2, 0.15, 0.5, 0.7), blob("#cfe8ff", 0.8, 0.85, 0.55, 0.7)],
    surface: "#ffeadb",
    ink: "#1f2937",
    accent: "#be123c",
    onAccent: "#fff1f2",
    accentInk: "#9f1239",
  },
  {
    // Pink into periwinkle. Dreamy; flatters skin and rounded product shapes.
    id: "pinkperi",
    name: "Pink to periwinkle",
    register: "soft",
    stops: ["#ffd6e8", "#efe7ff", "#c7d2fe"],
    angle: 140,
    blobs: [blob("#ffd6e8", 0.18, 0.8, 0.5, 0.7), blob("#c7d2fe", 0.82, 0.2, 0.5, 0.7)],
    surface: "#efe7ff",
    ink: "#241b4b",
    accent: "#6d28d9",
    onAccent: "#f5f3ff",
    accentInk: "#5b21b6",
  },
  {
    // Multi-hue accents on a neutral ground: the ground stays out of the way and
    // the colour arrives in the elements.
    id: "spectrum",
    name: "Spectrum",
    register: "soft",
    stops: ["#fafafa", "#f4f4f5", "#e7e5e4"],
    angle: 120,
    blobs: [blob("#e0f2fe", 0.2, 0.2, 0.45, 0.55), blob("#fee2e2", 0.8, 0.8, 0.45, 0.55)],
    surface: "#f4f4f5",
    ink: "#18181b",
    accent: "#b91c1c",
    onAccent: "#fff1f2",
    accentInk: "#b91c1c",
    accent2: "#2563eb",
  },
  {
    // Warm neutral, for editorial and blog use. Paper rather than screen.
    id: "parchment",
    name: "Parchment",
    register: "soft",
    stops: ["#f5f0e6", "#efe7d8", "#e6d9c2"],
    angle: 160,
    blobs: [blob("#f5f0e6", 0.25, 0.18, 0.5, 0.7)],
    surface: "#efe7d8",
    ink: "#241c12",
    accent: "#a2570f",
    onAccent: "#fffbeb",
    accentInk: "#7c3d08",
  },
  {
    // Pale aqua into lilac. Cool, clinical, calm.
    id: "seaglass",
    name: "Seaglass",
    register: "soft",
    stops: ["#d7f2f0", "#eaf3fb", "#e6dcf7"],
    angle: 200,
    blobs: [blob("#d7f2f0", 0.2, 0.75, 0.5, 0.7), blob("#e6dcf7", 0.8, 0.2, 0.5, 0.65)],
    surface: "#eaf3fb",
    ink: "#122430",
    accent: "#0e7490",
    onAccent: "#ecfeff",
    accentInk: "#155e75",
  },

  // ── Dark ───────────────────────────────────────────────────────────────────
  {
    // A saturated green on near-black: the contrast trick where the ground goes
    // almost to zero so one hue can be turned all the way up.
    id: "signal",
    name: "Signal",
    register: "dark",
    stops: ["#0a0a0a", "#111b14", "#052e16"],
    angle: 210,
    blobs: [blob("#22c55e", 0.75, 0.2, 0.4, 0.28)],
    surface: "#0a0a0a",
    ink: "#f0fdf4",
    accent: "#22c55e",
    onAccent: "#052e16",
    accentInk: "#4ade80",
  },
  {
    // Cornflower on charcoal. Cornflower blue is a named colour older than any
    // company that has used it.
    id: "cornflower",
    name: "Cornflower",
    register: "dark",
    stops: ["#18181b", "#1f2937", "#1e3a8a"],
    angle: 40,
    blobs: [blob("#6495ed", 0.8, 0.25, 0.45, 0.3)],
    surface: "#111318",
    ink: "#eff6ff",
    accent: "#6495ed",
    onAccent: "#0b1220",
    accentInk: "#93b4f5",
  },
  {
    // Teal into navy. Depth, water, night.
    id: "deepsea",
    name: "Deep sea",
    register: "dark",
    stops: ["#042f2e", "#0b2439", "#0f172a"],
    angle: 300,
    blobs: [blob("#2dd4bf", 0.22, 0.25, 0.42, 0.3)],
    surface: "#04201f",
    ink: "#ecfeff",
    accent: "#2dd4bf",
    onAccent: "#042f2e",
    accentInk: "#5eead4",
  },
  {
    // Cool grey, for editorial that wants to be dark without being a colour.
    id: "slate",
    name: "Slate",
    register: "dark",
    stops: ["#0b1120", "#111827", "#243244"],
    angle: 170,
    blobs: [blob("#38bdf8", 0.78, 0.18, 0.4, 0.22)],
    surface: "#0b1120",
    ink: "#e2e8f0",
    accent: "#38bdf8",
    onAccent: "#0b1120",
    accentInk: "#7dd3fc",
  },
];

export function colourway(id: string): Colourway {
  const found = COLOURWAYS.find((c) => c.id === id);
  if (!found) throw new Error(`[probe] unknown colourway "${id}"`);
  return found;
}

/** The colourways a layout can take. `vibrant` and `dark` are interchangeable
 *  from a layout's point of view — both are dark-ground and light-ink — so a
 *  layout that accepts one accepts the other. `soft` inverts the ink and is a
 *  separate compatibility class. */
export function colourwaysFor(registers: ColourRegister[]): Colourway[] {
  return COLOURWAYS.filter((c) => registers.includes(c.register));
}
