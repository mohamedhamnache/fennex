/**
 * Choosing the size a composition is flattened at.
 *
 * Flattening used to produce exactly the source photograph's dimensions and
 * nothing else, so a template applied to a 1024px generation yielded a 1024px
 * finished asset with no way to ask for more.
 *
 * This is only possible because the composition is resolution-independent:
 * every field a layer carries -- position, size, font size, letter spacing,
 * outline width -- is a percentage of the canvas, resolved at paint time. That
 * was not true until the export was found shrinking type by
 * displayWidth / naturalWidth, and it is the property this whole feature rests
 * on. `rasterizeScene` already accepts any size; nothing was asking it for one.
 */

export interface BurnSize {
  width: number;
  height: number;
}

export interface BurnOption {
  id: string;
  /** i18n key under `imageEdit.burnSize`. */
  labelKey: string;
  size: BurnSize;
}

/**
 * A 4096x4096 RGBA canvas is ~67MB before PNG encoding, and the browser has to
 * hold the bitmap, the encoded PNG and the data URI at once. Past this a tab
 * does not degrade, it dies -- so the request is refused with a message
 * instead.
 */
export const MAX_BURN_PIXELS = 4096 * 4096;

/** Chrome and Safari both refuse to rasterise a canvas past this on one edge,
 *  whatever the total area, and fail by producing a blank image rather than
 *  throwing. */
export const MAX_BURN_EDGE = 8192;

/** Below this there is nothing to flatten; guards against a 0 from an image
 *  that failed to load. */
const MIN_BURN_EDGE = 16;

/** Platform frames worth one click. Their aspect ratios deliberately differ
 *  from most sources: layer geometry is in canvas percentages, so a
 *  composition re-renders correctly into any frame, and the photograph inside
 *  is fitted by its own `fit` mode. */
const PRESETS: ReadonlyArray<{ id: string; labelKey: string; size: BurnSize }> = [
  { id: "square", labelKey: "square", size: { width: 1080, height: 1080 } },
  { id: "story", labelKey: "story", size: { width: 1080, height: 1920 } },
  { id: "wide", labelKey: "wide", size: { width: 1200, height: 628 } },
];

function round2(n: number): number {
  // Even dimensions: an odd width leaves a half-pixel column that some encoders
  // round away, changing the size the upload path then measures and records.
  return Math.max(MIN_BURN_EDGE, Math.round(n / 2) * 2);
}

/**
 * The sizes offered for a given source, in the order they should be shown.
 *
 * "2x" is omitted when it would exceed what the browser can rasterise, rather
 * than offered and then refused -- an option that always fails is worse than no
 * option.
 */
export function burnOptions(source: BurnSize): BurnOption[] {
  const src: BurnSize = { width: round2(source.width), height: round2(source.height) };
  const options: BurnOption[] = [{ id: "source", labelKey: "matchSource", size: src }];

  const doubled: BurnSize = { width: round2(src.width * 2), height: round2(src.height * 2) };
  if (!burnSizeError(doubled)) {
    options.push({ id: "2x", labelKey: "double", size: doubled });
  }
  for (const p of PRESETS) {
    options.push({ id: p.id, labelKey: p.labelKey, size: p.size });
  }
  return options;
}

/**
 * A custom width, with the height derived from the COMPOSITION's aspect so the
 * layout is preserved rather than stretched.
 */
export function customBurnSize(width: number, source: BurnSize): BurnSize {
  const aspect = source.height > 0 ? source.width / source.height : 1;
  const w = round2(width);
  return { width: w, height: round2(w / (aspect || 1)) };
}

/**
 * The i18n key of why this size is refused, or null when it is fine. Returned
 * as a key rather than a message so the caller owns presentation.
 */
export function burnSizeError(size: BurnSize): string | null {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return "burnSizeInvalid";
  if (size.width < MIN_BURN_EDGE || size.height < MIN_BURN_EDGE) return "burnSizeTooSmall";
  if (size.width > MAX_BURN_EDGE || size.height > MAX_BURN_EDGE) return "burnSizeTooWide";
  if (size.width * size.height > MAX_BURN_PIXELS) return "burnSizeTooLarge";
  return null;
}

/**
 * Whether the photograph will be upscaled at this size.
 *
 * Drives the honest warning in the UI. Type, shapes, gradients, rules and
 * badges are vector and genuinely re-render sharper at any size; the
 * photograph does not. A user who expects a small source to become a crisp 4K
 * asset will think the feature is broken, so the control has to say which of
 * the two is happening.
 */
export function upscalesPhoto(target: BurnSize, source: BurnSize): boolean {
  return target.width > source.width || target.height > source.height;
}
