"use client";

/** Dev-only template sweep.
 *
 *  apps/web has no test framework, so this route is the verification mechanism
 *  for the template system. It builds every template through the same
 *  `templateToLayers` the editor uses, renders it live with `SceneSvg`, exports
 *  it with `rasterizeScene`, and reports mechanical PASS/FAIL per template. The
 *  pictures are for judging design; the checks are for judging correctness.
 *
 *  Every template is swept twice: as authored, and through `brandTemplate` with
 *  a deliberately awkward brand kit, because brand-aware mode recolours the
 *  fields without touching the text colours and can invert a palette's
 *  contrast. That path is what a customer with a brand kit actually sees.
 *
 *  Not linked from the app and not translated: it is a workbench, not a screen.
 */

import { useEffect, useState } from "react";
import {
  TEXT_TEMPLATES, templateToLayers, brandTemplate,
  type TextTemplate, type ResolvedTemplate,
} from "@/components/studio/edit/text-templates";
import { analyzeText } from "@/components/studio/edit/families";
import { worstCaseContrast, MIN_CONTRAST } from "@/components/studio/edit/palette";
import { SceneSvg } from "@/components/studio/edit/scene/SceneSvg";
import { rasterizeScene } from "@/components/studio/edit/scene/rasterize";
import { measureTextLayer } from "@/components/studio/edit/scene/measure";
import type { Scene } from "@/components/studio/edit/scene/types";
import type { TextLayer } from "@/components/studio/edit/EditCanvas";
import type { BrandKit } from "@/lib/api";

const TEST_PHOTO = "/dev/sweep-test-photo.jpg";
const W = 800;
const H = 800;
const PREVIEW = 320;

function brandKit(colors: string[]): BrandKit {
  return {
    logo_url: null,
    colors,
    primary_font: null,
    secondary_font: null,
    style_rules: null,
    tone: null,
  };
}

/** The brand kits every template is swept through, beyond "as authored".
 *
 *  One fixture is not a guard. The pale kit only exercises the case where a
 *  light field takes dark ink, and any brand colour far from mid-luminance
 *  agrees with any reasonable text-colour rule, so a template set can pass it
 *  while being unreadable for most real brands. The three that follow sit in the
 *  mid-luminance band where the choice is actually contested and where the old
 *  YIQ rule in `bestTextOn` picked the worse of the two candidates: white on
 *  #0ea5e9 is 2.77:1 where near-black is 6.81:1. Sweeping all four is what makes
 *  the contrast check a guard rather than a fixture.
 *
 *  Add colours here, never remove them: each row is a case someone measured. */
const SWEEP_BRANDS: { label: string; kit: BrandKit }[] = [
  // Pale first colour: brandTemplate cycles it into a field shape.
  { label: "brand: pale", kit: brandKit(["#f3d9a4", "#123a6b", "#7f1d3f"]) },
  // Stock Tailwind sky/green — the most likely accidental brand kit there is.
  { label: "brand: sky/green", kit: brandKit(["#0ea5e9", "#22c55e"]) },
  // Muted mid-luminance naturals, the band where YIQ and WCAG disagree most.
  { label: "brand: sage/steel", kit: brandKit(["#7a9a5a", "#6b8fa8"]) },
  // Achromatic mid-grey: the hardest possible field, no readable ink exists.
  { label: "brand: mid grey", kit: brandKit(["#969696", "#8a8a8a"]) },
];

interface Check { name: string; pass: boolean; detail: string }
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
  //    run must clear WCAG AA against that field. The second is what catches
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

  const contrasts = backings
    .filter((b) => b.fieldColor)
    .map((b) => ({
      text: b.text,
      ratio: worstCaseContrast(b.color, b.fieldColor as string, b.fieldOpacity),
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

async function sweep(templates: TextTemplate[]): Promise<Row[]> {
  const out: Row[] = [];
  for (const tpl of templates) {
    out.push(await checkVariant(tpl, "as authored", {
      background: tpl.background ?? null,
      layers: tpl.layers,
    }));
    for (const b of SWEEP_BRANDS) {
      out.push(await checkVariant(tpl, b.label, brandTemplate(tpl, b.kit)));
    }
  }
  return out;
}

export default function TemplateSweepPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Never read document.fonts before it has settled.
      await document.fonts.ready;
      const out = await sweep(TEXT_TEMPLATES);
      if (cancelled) return;
      setRows(out);
      setBusy(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const failures = rows.reduce((n, r) => n + r.checks.filter((c) => !c.pass).length, 0);

  return (
    <div className="min-h-screen bg-background p-8 text-foreground">
      <header className="mb-8 space-y-2">
        <h1 className="text-2xl font-bold">Template sweep</h1>
        <p className="text-sm text-muted-foreground">
          {busy
            ? "Waiting for fonts, then rendering and exporting every template…"
            : `${TEXT_TEMPLATES.length} templates x ${SWEEP_BRANDS.length + 1} variants (as authored, plus ${SWEEP_BRANDS.length} brand kits) = ${rows.length} renders, ${failures} failing check(s). Left is the live SceneSvg preview, right is the rasterised PNG export — they must look identical.`}
        </p>
      </header>

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
