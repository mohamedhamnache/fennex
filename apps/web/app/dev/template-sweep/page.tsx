"use client";

/** Dev-only template sweep.
 *
 *  apps/web has no test framework, so this route is the verification mechanism
 *  for the template system. It builds every template through the same
 *  `templateToLayers` the editor uses, renders it live with `SceneSvg`, exports
 *  it with `rasterizeScene`, and reports mechanical PASS/FAIL per template. The
 *  pictures are for judging design; the checks are for judging correctness.
 *
 *  By default only "as authored" is swept — one render per template, which is
 *  what a human needs to judge the design. The brand kits below are an
 *  additional correctness guard: `brandTemplate` recolours the fields without
 *  touching the text colours and can invert a palette's contrast, which is what
 *  a customer with a brand kit actually sees. They are opt-in via the checkboxes
 *  in the header so the page stays fast to open, but every kit stays reachable
 *  and unchanged in what it checks.
 *
 *  Rendering is progressive: each row is appended to state as its checks and
 *  rasterisation finish, rather than computing the whole sweep before painting
 *  anything, so the page never sits blank while 34+ templates resolve.
 *
 *  Not linked from the app and not translated: it is a workbench, not a screen.
 */

import { useEffect, useState } from "react";
import {
  TEXT_TEMPLATES, templateToLayers, brandTemplate, templateFingerprint, BRAND_KIT_FIXTURES,
  type TextTemplate, type ResolvedTemplate, type TemplateLayerDef,
} from "@/components/studio/edit/text-templates";
import { analyzeText } from "@/components/studio/edit/families";
import { worstCaseContrast, contrastRatio, MIN_CONTRAST } from "@/components/studio/edit/palette";
import { SceneSvg } from "@/components/studio/edit/scene/SceneSvg";
import { rasterizeScene } from "@/components/studio/edit/scene/rasterize";
import { measureTextLayer } from "@/components/studio/edit/scene/measure";
import type { BlendMode, Scene } from "@/components/studio/edit/scene/types";
import type { TextLayer } from "@/components/studio/edit/EditCanvas";
import type { BrandKit } from "@/lib/api";
import { cn } from "@/lib/cn";

const TEST_PHOTO = "/dev/sweep-test-photo.jpg";
const W = 800;
const H = 800;
const PREVIEW = 320;

/** The brand kits every template may be swept through, beyond "as authored".
 *
 *  One fixture is not a guard. A pale kit only exercises the case where a light
 *  field takes dark ink, and any brand colour far from mid-luminance agrees with
 *  any reasonable text-colour rule, so a template set can pass it while being
 *  unreadable for most real brands. The mid-luminance rows are where the choice
 *  is actually contested, and where the old YIQ rule in `bestTextOn` picked the
 *  worse of the two candidates: white on #0ea5e9 is 2.77:1 where near-black is
 *  6.81:1. Sweeping all of them is what makes the contrast check a guard rather
 *  than a fixture.
 *
 *  These are `BRAND_KIT_FIXTURES` verbatim — the same rows the module-load
 *  readability gate uses — with a "brand:" prefix for the checkbox labels. This
 *  page used to keep its own near-copy, and the two drifted: three of the seven
 *  fixtures were checked mechanically and never rendered for anyone to look at.
 *  Add a kit in `text-templates.ts` and it appears here with no edit to this
 *  file. */
const SWEEP_BRANDS: { label: string; kit: BrandKit }[] = BRAND_KIT_FIXTURES.map(
  ({ label, kit }) => ({ label: `brand: ${label}`, kit }),
);

/** The always-on baseline variant: the template as its author wrote it. */
const AS_AUTHORED: { label: string; kit: BrandKit | null } = { label: "as authored", kit: null };

interface Check { name: string; pass: boolean; detail: string }

/**
 * Set-level checks -- these judge `TEXT_TEMPLATES` as a whole rather than one
 * render at a time, so they run once, synchronously, over the static import,
 * not per row and not per brand variant.
 *
 * They exist because the previous 34-template set shipped three defects
 * nothing mechanical caught: seven pairs that were the same composition with
 * different words, nine templates advertising fennex.studio to the customer's
 * own audience, and families that only looked varied because their unused
 * capability branches were never exercised by a shipped template. Each check
 * below is built to fail on exactly one of those, and each was proven to fail
 * against a deliberate violation before being left in this state (see the
 * task report).
 */

/** Every fingerprint collision, as a human-readable line naming both ids. A
 *  template set with no repeats produces zero lines. */
function checkDistinctness(templates: TextTemplate[]): Check {
  const firstSeenBy = new Map<string, string>();
  const collisions: string[] = [];
  for (const t of templates) {
    const fp = templateFingerprint(t);
    const earlier = firstSeenBy.get(fp);
    if (earlier) {
      collisions.push(`${earlier} and ${t.id} are geometrically identical`);
    } else {
      firstSeenBy.set(fp, t.id);
    }
  }
  return {
    name: "distinctness",
    pass: collisions.length === 0,
    detail: collisions.length
      ? collisions.join("; ")
      : `${templates.length} templates, ${firstSeenBy.size} distinct fingerprints`,
  };
}

/** Every string value reachable from a template object, recursively -- this
 *  scans copy, ids, names, colours, everything, rather than trusting a
 *  hand-picked list of "the fields that hold copy" to stay complete as the
 *  shape of a template evolves. */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectStrings(v, out);
  }
}

/** Case-insensitive scan for "fennex" in any string anywhere in a template.
 *  A customer applying a template is publishing under their own name; a
 *  template that name-drops Fennex burns their post advertising ours instead.
 */
function checkBrandNeutrality(templates: TextTemplate[]): Check {
  const hits: string[] = [];
  for (const t of templates) {
    const strings: string[] = [];
    collectStrings(t, strings);
    for (const s of strings) {
      if (s.toLowerCase().includes("fennex")) hits.push(`${t.id}: "${s}"`);
    }
  }
  return {
    name: "brand neutrality",
    pass: hits.length === 0,
    detail: hits.length ? hits.join("; ") : `${templates.length} templates scanned, no "fennex" found`,
  };
}

/** Whether a single emitted layer, on its own, uses one of the renderer
 *  capabilities the families exist to exercise. `clip` and `source` only
 *  apply to image layers; `blend` and `rotation` are fields on every layer
 *  kind (text layers can carry a blend or a rotation too). */
function earnsCapability(l: TemplateLayerDef): boolean {
  if (l.blend && l.blend !== "normal") return true;
  if (l.rotation) return true;
  if (l.kind === "image") {
    if (l.clip && !("roundedPct" in l.clip)) return true;
    if (l.source === "subject-cutout") return true;
  }
  return false;
}

/** Groups the shipped templates by the family that produced them and checks
 *  the UNION of each family's emitted layers -- across every instance of that
 *  family actually in `TEXT_TEMPLATES` -- for at least one earned capability.
 *  Grouping by the real, shipped output (not by calling a family function
 *  with parameters nothing currently ships) is the point: a capability sitting
 *  behind a parameter no template reaches has not been earned. */
function checkCapabilityCoverage(templates: TextTemplate[]): Check {
  const layersByFamily = new Map<string, TemplateLayerDef[]>();
  for (const t of templates) {
    layersByFamily.set(t.family, [...(layersByFamily.get(t.family) ?? []), ...t.layers]);
  }
  const barren = [...layersByFamily.entries()]
    .filter(([, layers]) => !layers.some(earnsCapability))
    .map(([family]) => family);
  return {
    name: "capability coverage",
    pass: barren.length === 0,
    detail: barren.length
      ? `${barren.join(", ")} earn(s) no blend, rotation, non-rounded clip or cutout across the shipped set`
      : `${layersByFamily.size} families, each earning a capability`,
  };
}

function SweepSetChecks({ templates }: { templates: TextTemplate[] }) {
  const checks = [
    checkDistinctness(templates),
    checkBrandNeutrality(templates),
    checkCapabilityCoverage(templates),
  ];
  return (
    <section className="mb-8 space-y-2 rounded-lg border border-border bg-card p-4">
      <h2 className="font-semibold">Template-set checks</h2>
      <ul className="space-y-1 text-sm">
        {checks.map((c) => (
          <li key={c.name} className={c.pass ? "text-green-600" : "text-red-600"}>
            <span className="font-mono">{c.pass ? "PASS" : "FAIL"}</span> {c.name}
            <span className="text-muted-foreground"> — {c.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface Row {
  key: string;
  id: string;
  name: string;
  variant: string;
  scene: Scene;
  png: string;
  checks: Check[];
}

/** Primary family of a CSS font stack, unquoted: "'Anton', sans-serif" -> Anton. */
function primaryFamily(stack: string): string {
  return (stack.split(",")[0] ?? "").trim().replace(/^['"]|['"]$/g, "");
}

/** Families declared anywhere in the document's font set (webfonts loaded via
 *  @font-face or an imported stylesheet). A family missing from this set can
 *  never load, which `document.fonts.check` alone will not tell you: it returns
 *  true for an unknown family, because zero matching faces are unloaded.
 *
 *  Only read this after `document.fonts.ready`. On a cold load the set is still
 *  filling from the stylesheet, and reading it early reports families as
 *  undeclared that are merely late. A check that fails for the wrong reason is
 *  worse than no check, and this route is what the branch gets judged on. */
function declaredFamilies(): Set<string> {
  const out = new Set<string>();
  document.fonts.forEach((f) => out.add(primaryFamily(f.family)));
  return out;
}

function textLayers(scene: Scene): TextLayer[] {
  return scene.layers.filter((l): l is TextLayer => l.type === "text");
}

/** The composited extreme a blend can drive a field to, whatever photograph is
 *  underneath. `multiply(a, b) = a*b/255` is channel-wise non-increasing, so a
 *  black photograph takes the field to black and nothing takes it lighter;
 *  `screen` is the exact mirror. Any other mode is unbounded in both
 *  directions, so both extremes are reachable — `analyzeText` already reports a
 *  run on one as unbacked, and listing both here keeps the number honest for
 *  anyone who reads it anyway. */
const WASH_EXTREMES: Partial<Record<BlendMode, string[]>> = {
  multiply: ["#000000"],
  screen: ["#ffffff"],
};

/** Which field colours in a layer list belong to a blended field.
 *
 *  `analyzeText` reports the field's own colour rather than what it composites
 *  to — deliberately, because monotonicity makes that colour the FLOOR — but it
 *  does not report the blend, so the contrast metric below has to recover it.
 *  A colour painted both blended and unblended in the same template is
 *  ambiguous and is treated as unblended; no family does that today (only
 *  `duotoneWash` blends, and it emits exactly one shape), and the "text on a
 *  field" check is what actually gates a mispairing either way. */
function washBlendByColor(layers: TemplateLayerDef[]): Map<string, BlendMode> {
  const blended = new Map<string, BlendMode>();
  const plain = new Set<string>();
  for (const l of layers) {
    if (l.kind !== "shape") continue;
    if (l.blend && l.blend !== "normal") blended.set(l.color, l.blend);
    else plain.add(l.color);
  }
  for (const c of plain) blended.delete(c);
  return blended;
}

/**
 * Worst-case contrast of a run against its field, accounting for the field's
 * blend.
 *
 * `worstCaseContrast` alone measures against the field's authored colour, which
 * is right for an opaque field and right for a CORRECTLY paired wash — the
 * monotone bound puts the worst case exactly there. It is badly wrong for a
 * mispaired one: a multiply wash carrying dark ink was reported at 8.14:1 when
 * a black photograph takes the field to black and the true ratio is 1.01:1.
 * Taking the worse of the authored colour and the blend's reachable extreme
 * gives the correct number in both cases, and leaves the opaque-field number
 * untouched.
 *
 * This changes only the metric. The threshold is still `MIN_CONTRAST` and the
 * check still tests the same thing.
 */
function fieldContrast(text: string, fieldColor: string, opacity: number, blend?: BlendMode): number {
  const base = worstCaseContrast(text, fieldColor, opacity);
  if (!blend || blend === "normal") return base;
  const extremes = WASH_EXTREMES[blend] ?? ["#000000", "#ffffff"];
  return Math.min(base, ...extremes.map((e) => contrastRatio(text, e)));
}

async function checkVariant(
  tpl: TextTemplate,
  variant: string,
  resolved: ResolvedTemplate,
): Promise<Row> {
  const layers = templateToLayers(resolved, TEST_PHOTO, W, H);
  const scene: Scene = { width: W, height: H, baseImageUrl: null, layers };
  const checks: Check[] = [];
  const texts = textLayers(scene);

  // 1. The template actually places the photo. Before this branch a template
  //    could only decorate over the image; a family that does not use an image
  //    layer has wasted the renderer.
  const images = layers.filter((l) => l.type === "image" && l.imageUrl === TEST_PHOTO);
  checks.push({
    name: "places the photo",
    pass: images.length > 0,
    detail: images.length > 0 ? `${images.length} subject layer(s)` : "no subject image layer",
  });

  // 2. Fonts. Every face the scene uses must be declared AND loadable, or the
  //    export silently renders in a fallback with no error anywhere.
  const faces = [...new Set(texts.map((l) => `${l.fontSize}px ${l.fontFamily}`))];
  const declared = declaredFamilies();
  const undeclared = [...new Set(texts.map((l) => primaryFamily(l.fontFamily)))]
    .filter((f) => !declared.has(f));
  await Promise.all(faces.map((f) => document.fonts.load(f).catch(() => [])));
  const unloaded = faces.filter((f) => {
    try { return !document.fonts.check(f); } catch { return true; }
  });
  const fontDetail = [
    undeclared.length ? `undeclared: ${undeclared.join(", ")}` : "",
    unloaded.length ? `unloaded: ${unloaded.join(", ")}` : "",
  ].filter(Boolean).join(" | ");
  checks.push({
    name: "fonts",
    pass: undeclared.length === 0 && unloaded.length === 0,
    detail: fontDetail || `${faces.length} face(s) loaded`,
  });

  // 3. Overflow. No text run may extend past the canvas.
  const over = texts.filter((l) => (l.xPct / 100) * W + measureTextLayer(l, l.fontSize) > W);
  checks.push({
    name: "text in bounds",
    pass: over.length === 0,
    detail: over.map((l) => l.text).join(", ") || "ok",
  });

  // 4 and 5. Readability, in two parts. Geometry: every run sits on a scrim,
  //    band or solid field that nothing painted since has covered, measured
  //    with real font metrics rather than the authoring estimate, so this is
  //    stricter than the check families.ts applies at build time. Contrast: the
  //    run must clear WCAG AA against that field, measured through the field's
  //    blend where it has one (see `fieldContrast`). The second is what catches
  //    brand-aware mode, which recolours fields but not the text on them.
  const backings = analyzeText(resolved.layers, {
    widthPct: (def) => {
      const match = texts.find((l) => l.text === def.text);
      const px = match ? measureTextLayer(match, def.fontSize) : def.fontSize * def.text.length * 0.6;
      return (px / W) * 100;
    },
  });
  const unbacked = backings.filter((b) => b.reason !== null);
  checks.push({
    name: "text on a field",
    pass: unbacked.length === 0,
    detail: unbacked.map((b) => `${b.text} (${b.reason})`).join("; ") || "every run backed",
  });

  const washes = washBlendByColor(resolved.layers);
  const contrasts = backings
    .filter((b) => b.fieldColor)
    .map((b) => ({
      text: b.text,
      ratio: fieldContrast(
        b.color,
        b.fieldColor as string,
        b.fieldOpacity,
        washes.get(b.fieldColor as string),
      ),
    }));
  const poor = contrasts.filter((c) => c.ratio < MIN_CONTRAST);
  checks.push({
    name: "contrast",
    pass: poor.length === 0,
    detail: poor.length
      ? poor.map((c) => `${c.text} ${c.ratio.toFixed(2)}:1`).join("; ")
      : contrasts.length
        ? `worst ${Math.min(...contrasts.map((c) => c.ratio)).toFixed(2)}:1`
        : "no backed runs to measure",
  });

  // 6. Export. Rasterises, and at the requested size.
  let png = "";
  try {
    png = await rasterizeScene(scene);
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const el = new Image();
      el.onload = () => res(el);
      el.onerror = () => rej(new Error("PNG did not decode"));
      el.src = png;
    });
    checks.push({
      name: "export size",
      pass: img.naturalWidth === W && img.naturalHeight === H,
      detail: `${img.naturalWidth}x${img.naturalHeight}`,
    });
  } catch (e) {
    checks.push({ name: "export", pass: false, detail: String(e) });
  }

  return { key: `${tpl.id}:${variant}`, id: tpl.id, name: tpl.name, variant, scene, png, checks };
}

/** Sweeps every template through every requested variant, calling `onRow` as
 *  each one finishes rather than collecting into an array first — that is what
 *  makes the page paint progressively instead of staring at blank space until
 *  the last of 34+ templates resolves.
 *
 *  `isCancelled` is checked before *and* after each await, so a caller whose
 *  effect has been superseded (dependency change or unmount) stops emitting
 *  rows the instant it is told to, rather than mid-checkVariant. That is what
 *  keeps a stale run from appending rows onto a newer run's state: it never
 *  gets the chance to call `onRow` again once cancelled. */
async function sweep(
  templates: TextTemplate[],
  variants: { label: string; kit: BrandKit | null }[],
  onRow: (row: Row) => void,
  isCancelled: () => boolean,
): Promise<void> {
  for (const tpl of templates) {
    for (const variant of variants) {
      if (isCancelled()) return;
      const resolved: ResolvedTemplate = variant.kit
        ? brandTemplate(tpl, variant.kit)
        : { background: tpl.background ?? null, layers: tpl.layers };
      const row = await checkVariant(tpl, variant.label, resolved);
      if (isCancelled()) return;
      onRow(row);
    }
  }
}

export default function TemplateSweepPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);
  const [selectedBrands, setSelectedBrands] = useState<Set<string>>(new Set());

  const variants = [
    AS_AUTHORED,
    ...SWEEP_BRANDS.filter((b) => selectedBrands.has(b.label)),
  ];

  useEffect(() => {
    let cancelled = false;
    setRows([]);
    setBusy(true);
    setTotal(TEXT_TEMPLATES.length * variants.length);

    (async () => {
      // Never read document.fonts before it has settled.
      await document.fonts.ready;
      if (cancelled) return;
      await sweep(
        TEXT_TEMPLATES,
        variants,
        // Functional updates: each row appends onto whatever state currently
        // holds, never a snapshot captured when the effect started, so rows
        // arriving 100ms apart can't clobber one another.
        (row) => setRows((prev) => [...prev, row]),
        () => cancelled,
      );
      if (!cancelled) setBusy(false);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBrands]);

  const failures = rows.reduce((n, r) => n + r.checks.filter((c) => !c.pass).length, 0);
  const allBrandsSelected = selectedBrands.size === SWEEP_BRANDS.length;

  function toggleBrand(label: string) {
    setSelectedBrands((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  }

  function toggleAllBrands() {
    setSelectedBrands(allBrandsSelected ? new Set() : new Set(SWEEP_BRANDS.map((b) => b.label)));
  }

  return (
    <div className="min-h-screen bg-background p-8 text-foreground">
      <header className="mb-8 space-y-3">
        <h1 className="text-2xl font-bold">Template sweep</h1>
        <p className="text-sm text-muted-foreground">
          {busy
            ? `Rendering ${rows.length} / ${total}…`
            : `${rows.length} renders, ${failures} failing check(s). Left is the live SceneSvg preview, right is the rasterised PNG export — they must look identical.`}
        </p>

        <div
          className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={rows.length}
          aria-valuemin={0}
          aria-valuemax={total}
        >
          <div
            className={cn("h-full bg-primary", !busy && "opacity-50")}
            style={{ width: total ? `${(rows.length / total) * 100}%` : "0%" }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-sm">
          <span className="text-muted-foreground">Brand kit sweep (correctness guard, opt-in):</span>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={allBrandsSelected} onChange={toggleAllBrands} />
            all kits
          </label>
          {SWEEP_BRANDS.map((b) => (
            <label key={b.label} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={selectedBrands.has(b.label)}
                onChange={() => toggleBrand(b.label)}
              />
              {b.label}
            </label>
          ))}
        </div>
      </header>

      <SweepSetChecks templates={TEXT_TEMPLATES} />

      <SweepList rows={rows} />
    </div>
  );
}

function SweepList({ rows }: { rows: Row[] }) {
  return (
    <div className="space-y-12">
      {rows.map((r) => (
        <section key={r.key} className="space-y-3">
          <h2 className="font-semibold">
            {r.name}{" "}
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal">{r.variant}</span>{" "}
            <span className="font-mono text-xs text-muted-foreground">{r.id}</span>
          </h2>
          <div className="flex flex-wrap gap-6">
            <figure>
              <figcaption className="mb-1 text-xs text-muted-foreground">Live preview</figcaption>
              <div
                className="overflow-hidden rounded-lg border border-border"
                style={{ width: PREVIEW, height: PREVIEW }}
              >
                <div style={{ transform: `scale(${PREVIEW / W})`, transformOrigin: "top left" }}>
                  <SceneSvg scene={r.scene} />
                </div>
              </div>
            </figure>
            <figure>
              <figcaption className="mb-1 text-xs text-muted-foreground">PNG export</figcaption>
              <div
                className="overflow-hidden rounded-lg border border-border"
                style={{ width: PREVIEW, height: PREVIEW }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {r.png ? <img src={r.png} alt="" style={{ width: PREVIEW }} /> : null}
              </div>
            </figure>
            <ul className="space-y-1 text-sm">
              {r.checks.map((c) => (
                <li key={c.name} className={c.pass ? "text-green-600" : "text-red-600"}>
                  <span className="font-mono">{c.pass ? "PASS" : "FAIL"}</span> {c.name}
                  <span className="text-muted-foreground"> — {c.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}
