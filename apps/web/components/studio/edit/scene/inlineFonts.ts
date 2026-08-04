import type { TextLayer } from "../EditCanvas";
import { layerText } from "./measure";

/**
 * Embed the faces a scene uses INTO the scene, as `@font-face` rules whose
 * `src:` is a base64 data URI.
 *
 * An SVG loaded through `<img src={blobURL}>` is an ISOLATED DOCUMENT. It gets
 * no scripts, no network, and — the part that cost us every exported headline —
 * none of the parent document's font registrations. Anton, Inter, Source Sans 3
 * and JetBrains Mono all arrive through the Google Fonts `@import` in
 * globals.css; not one of them is a system face; and `document.fonts.load()` in
 * the parent resolves against a font set the raster never consults. The export
 * silently fell back to the platform sans for every layer, which is why an Anton
 * export PNG came out byte-identical to a sans-serif one.
 *
 * This is `inlineImages.ts` applied to type. That module exists because remote
 * IMAGES do not cross the boundary either; the same argument was always true of
 * fonts and simply never got made.
 *
 * Faces are resolved in two steps, in this order:
 *
 *   1. The document's own readable stylesheets. Self-hosted faces (next/font
 *      writes `src: url(/_next/static/media/...)`) are same-origin, so their
 *      `@font-face` rules are readable and give us the exact file the preview
 *      is painting with. This is the only path that can be byte-exact.
 *   2. The Google Fonts CSS API. The `@import`ed stylesheet is cross-origin, so
 *      `sheet.cssRules` throws and we cannot read the URLs the browser already
 *      has. We ask the API again ourselves, passing `text=` so it returns a
 *      face subsetted to exactly the glyphs this scene paints — a headline
 *      costs a few hundred bytes rather than the ~40KB of a full latin face.
 *
 * Everything here is best-effort. A face that cannot be resolved is left out
 * and the export proceeds exactly as it does today: wrong font, but an export.
 * Failing the download over a missing typeface would be a worse trade.
 */

/** Primary family of a CSS stack, unquoted: "'Anton', sans-serif" -> Anton. */
function primaryFamily(stack: string): string {
  return (stack.split(",")[0] ?? "").trim().replace(/^['"]|['"]$/g, "");
}

/** Families that never resolve to a downloadable file. Asking the Google API
 *  for "sans-serif" is a guaranteed 400 and a wasted round trip. */
const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji",
  "inherit", "initial", "unset", "",
]);

/** Faces already known to be installed on essentially every platform. The
 *  isolated document resolves these itself, so embedding them is pure weight. */
const SYSTEM_FAMILIES = new Set([
  "arial", "helvetica", "helvetica neue", "georgia", "times", "times new roman",
  "courier", "courier new", "verdana", "tahoma", "trebuchet ms", "impact",
  "segoe ui", "-apple-system", "blinkmacsystemfont",
]);

interface Face {
  family: string;
  /** 400 or 700 — SceneSvg only ever paints those two. */
  weight: number;
  italic: boolean;
  /** Every distinct character painted in this face, for `text=` subsetting. */
  glyphs: Set<string>;
}

function faceKey(f: { family: string; weight: number; italic: boolean }): string {
  return `${f.family.toLowerCase()}|${f.weight}|${f.italic}`;
}

/** The faces a scene actually paints, with the glyph set each one needs.
 *  Only these are embedded — putting all four FONT_ROLES faces into every
 *  export would pay for three faces nobody looks at. */
function facesUsed(layers: { type: string }[]): Face[] {
  const byKey = new Map<string, Face>();
  for (const layer of layers) {
    if (layer.type !== "text") continue;
    const t = layer as TextLayer;
    const family = primaryFamily(t.fontFamily);
    if (GENERIC_FAMILIES.has(family.toLowerCase())) continue;
    if (SYSTEM_FAMILIES.has(family.toLowerCase())) continue;
    const face = { family, weight: t.bold ? 700 : 400, italic: !!t.italic };
    const key = faceKey(face);
    const existing = byKey.get(key) ?? { ...face, glyphs: new Set<string>() };
    for (const ch of layerText(t)) existing.glyphs.add(ch);
    byKey.set(key, existing);
  }
  return [...byKey.values()];
}

async function toDataUri(url: string): Promise<string> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`font ${res.status}`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("could not read font"));
    reader.readAsDataURL(blob);
  });
}

// ── 1. The document's own stylesheets ────────────────────────────────────────

const URL_RE = /url\((['"]?)([^'")]+)\1\)/g;

/** Every `url()` in a `src:` descriptor, woff2 first. woff2 is both the
 *  smallest and the only format every browser that can run this code
 *  understands, so preferring it is never a downgrade. */
function srcUrls(src: string): string[] {
  const all = [...src.matchAll(URL_RE)].map((m) => m[2]);
  const woff2 = all.filter((u) => /woff2/i.test(u) || /woff2/i.test(src));
  return [...new Set([...woff2, ...all])];
}

function styleMatches(declared: string, italic: boolean): boolean {
  const wantsItalic = /italic|oblique/i.test(declared);
  return wantsItalic === italic;
}

/** `font-weight` may be a single value or a variable font's range ("100 900").
 *  A range that contains the weight we want is a match: the raster picks the
 *  instance, exactly as the preview does. */
function weightMatches(declared: string, weight: number): boolean {
  const nums = declared.trim().split(/\s+/).map(Number).filter((n) => !Number.isNaN(n));
  if (nums.length === 0) return weight === 400;
  if (nums.length === 1) return nums[0] === weight;
  return weight >= Math.min(...nums) && weight <= Math.max(...nums);
}

function eachFontFaceRule(sheet: CSSStyleSheet, out: CSSFontFaceRule[], depth = 0): void {
  if (depth > 4) return;
  let rules: CSSRuleList;
  try {
    // Cross-origin sheets (the Google Fonts @import) throw here. That is the
    // whole reason step 2 exists.
    rules = sheet.cssRules;
  } catch {
    return;
  }
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSFontFaceRule) out.push(rule);
    else if (rule instanceof CSSImportRule && rule.styleSheet) {
      eachFontFaceRule(rule.styleSheet, out, depth + 1);
    }
  }
}

/** The file URL the parent document would paint this face with, if it is
 *  declared in a stylesheet we are allowed to read. */
function documentFaceUrls(face: Face): string[] {
  const rules: CSSFontFaceRule[] = [];
  for (const sheet of Array.from(document.styleSheets)) eachFontFaceRule(sheet, rules);
  for (const rule of rules) {
    const style = rule.style;
    if (primaryFamily(style.getPropertyValue("font-family")).toLowerCase() !== face.family.toLowerCase()) continue;
    if (!styleMatches(style.getPropertyValue("font-style"), face.italic)) continue;
    if (!weightMatches(style.getPropertyValue("font-weight"), face.weight)) continue;
    const urls = srcUrls(style.getPropertyValue("src"));
    if (urls.length) return urls;
  }
  return [];
}

// ── 2. The Google Fonts CSS API ──────────────────────────────────────────────

/** Family names go into the CSS API with "+" for spaces, and into our own
 *  `@font-face` output stripped to characters that cannot break out of a CSS
 *  string — the output is injected raw into the SVG, so this is the sanitiser. */
function familyParam(family: string): string {
  return encodeURIComponent(family).replace(/%20/g, "+");
}

function safeFamily(family: string): string {
  return family.replace(/[^A-Za-z0-9 _-]/g, "");
}

/** `text=` makes the API return a face containing only these glyphs. Sorted so
 *  the same scene produces the same URL twice and the HTTP cache can work.
 *  Dropped entirely past a sane length: the URL has a limit, and past a few
 *  hundred distinct glyphs the full face is smaller than the query anyway. */
function textParam(glyphs: Set<string>): string {
  const chars = [...glyphs].sort().join("");
  if (chars.length === 0 || chars.length > 220) return "";
  return `&text=${encodeURIComponent(chars)}`;
}

/** The API rejects axis specs a family does not have — Anton has one weight, so
 *  `wght@700` is a 400 rather than a graceful downgrade. Ask most-specific
 *  first and let each failure fall through to a looser spec; the last is the
 *  bare family, which every hosted family answers. */
function apiUrls(face: Face): string[] {
  const family = familyParam(face.family);
  const text = textParam(face.glyphs);
  const specs = face.italic
    ? [`:ital,wght@1,${face.weight}`, `:ital,wght@0,${face.weight}`, `:wght@${face.weight}`, ""]
    : [`:ital,wght@0,${face.weight}`, `:wght@${face.weight}`, ""];
  const urls = specs.map((s) => `https://fonts.googleapis.com/css2?family=${family}${s}${text}`);
  // Last resort: no glyph subsetting, in case a character in the scene is one
  // the family does not cover and the subsetting request fails because of it.
  if (text) urls.push(`https://fonts.googleapis.com/css2?family=${family}`);
  return urls;
}

async function googleFaceCss(face: Face): Promise<string | null> {
  for (const url of apiUrls(face)) {
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) continue;
      const css = await res.text();
      if (css.includes("@font-face")) return css;
    } catch {
      // Offline, blocked, or a transient failure. Try the next spec, and if
      // they all fail the caller ships the export without this face.
    }
  }
  return null;
}

/** Replace every remote `url()` in a CSS blob with a data URI. The isolated
 *  document cannot fetch, so a rule still pointing at fonts.gstatic.com is a
 *  rule that does nothing. */
async function inlineCssUrls(css: string): Promise<string> {
  const urls = [...new Set([...css.matchAll(URL_RE)].map((m) => m[2]))]
    .filter((u) => !u.startsWith("data:"));
  const resolved = new Map<string, string>();
  await Promise.all(urls.map(async (u) => {
    try {
      resolved.set(u, await toDataUri(u));
    } catch {
      // Leave the rule pointing at a URL that will not load rather than
      // emitting a broken data URI.
    }
  }));
  if (resolved.size === 0) return "";
  return css.replace(URL_RE, (whole, _q, u) => (resolved.has(u) ? `url(${resolved.get(u)})` : whole));
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Keyed by family|weight|italic|glyphs, so two layers in the same face — or
 *  two exports of the same composition — pay for the download once. */
const cache = new Map<string, Promise<string>>();

async function faceCss(face: Face): Promise<string> {
  // 1. A face we can read out of our own stylesheets, embedded verbatim.
  for (const url of documentFaceUrls(face)) {
    try {
      const dataUri = await toDataUri(url);
      return `@font-face{font-family:'${safeFamily(face.family)}';`
        + `font-style:${face.italic ? "italic" : "normal"};`
        + `font-weight:${face.weight};src:url(${dataUri});}`;
    } catch {
      // Try the next url() in the same rule before giving up on the face.
    }
  }
  // 2. The hosted face, subsetted to this scene's glyphs.
  const css = await googleFaceCss(face);
  return css ? await inlineCssUrls(css) : "";
}

/**
 * The `<style>` body to embed in a scene's serialised SVG, or "" when nothing
 * could be resolved.
 *
 * Never rejects. Losing a typeface must not lose the export.
 */
export async function sceneFontCss(scene: { layers: { type: string }[] }): Promise<string> {
  try {
    const faces = facesUsed(scene.layers);
    const parts = await Promise.all(faces.map((face) => {
      const key = `${faceKey(face)}|${[...face.glyphs].sort().join("")}`;
      if (!cache.has(key)) cache.set(key, faceCss(face).catch(() => ""));
      return cache.get(key)!;
    }));
    return parts.filter(Boolean).join("\n");
  } catch {
    return "";
  }
}
