"use client";

/** Dev-only template sweep.
 *
 *  apps/web has no test framework, so this route is the verification mechanism
 *  for the template system. It builds every template through the same
 *  `templateToLayers` the editor uses, renders it live with `SceneSvg`, exports
 *  it with `rasterizeScene`, and reports mechanical PASS/FAIL per template. The
 *  pictures are for judging design; the checks are for judging correctness.
 *
 *  Not linked from the app and not translated: it is a workbench, not a screen.
 */

import { useEffect, useState } from "react";
import {
  TEXT_TEMPLATES, LEGACY_TEXT_TEMPLATES, templateToLayers,
  type TextTemplate,
} from "@/components/studio/edit/text-templates";
import { findUnbackedText } from "@/components/studio/edit/families";
import { SceneSvg } from "@/components/studio/edit/scene/SceneSvg";
import { rasterizeScene } from "@/components/studio/edit/scene/rasterize";
import { measureTextLayer } from "@/components/studio/edit/scene/measure";
import type { Scene } from "@/components/studio/edit/scene/types";
import type { TextLayer } from "@/components/studio/edit/EditCanvas";

const TEST_PHOTO = "/dev/sweep-test-photo.jpg";
const W = 800;
const H = 800;
const PREVIEW = 320;

interface Check { name: string; pass: boolean; detail: string }
interface Row { id: string; name: string; scene: Scene; png: string; checks: Check[] }

/** Primary family of a CSS font stack, unquoted: "'Anton', sans-serif" -> Anton. */
function primaryFamily(stack: string): string {
  return (stack.split(",")[0] ?? "").trim().replace(/^['"]|['"]$/g, "");
}

/** Families declared anywhere in the document's font set (webfonts loaded via
 *  @font-face or an imported stylesheet). A family missing from this set can
 *  never load, which `document.fonts.check` alone will not tell you: it returns
 *  true for an unknown family because zero matching faces are unloaded. */
function declaredFamilies(): Set<string> {
  const out = new Set<string>();
  document.fonts.forEach((f) => out.add(primaryFamily(f.family)));
  return out;
}

function textLayers(scene: Scene): TextLayer[] {
  return scene.layers.filter((l): l is TextLayer => l.type === "text");
}

async function checkTemplate(tpl: TextTemplate): Promise<Row> {
  const layers = templateToLayers(
    { background: tpl.background ?? null, layers: tpl.layers }, TEST_PHOTO, W, H,
  );
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

  // 4. Readability. Every text run must sit on a scrim, band or solid field —
  //    measured with the real font metrics rather than the authoring estimate,
  //    so this is a stricter test than the one families.ts applies at build.
  const issues = findUnbackedText(tpl.layers, {
    widthPct: (def) => {
      const match = texts.find((l) => l.text === def.text);
      const px = match ? measureTextLayer(match, def.fontSize) : def.fontSize * def.text.length * 0.6;
      return (px / W) * 100;
    },
  });
  checks.push({
    name: "text on a field",
    pass: issues.length === 0,
    detail: issues.map((i) => `${i.text} (${i.reason})`).join("; ") || "every run backed",
  });

  // 5. Export. Rasterises, and at the requested size.
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

  return { id: tpl.id, name: tpl.name, scene, png, checks };
}

export default function TemplateSweepPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [legacyRows, setLegacyRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);
  const [showLegacy, setShowLegacy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Row[] = [];
      for (const tpl of TEXT_TEMPLATES) out.push(await checkTemplate(tpl));
      if (cancelled) return;
      setRows(out);
      setBusy(false);
    })();
    return () => { cancelled = true; };
  }, []);

  async function runLegacy() {
    setShowLegacy(true);
    if (legacyRows.length > 0) return;
    const out: Row[] = [];
    for (const tpl of LEGACY_TEXT_TEMPLATES) out.push(await checkTemplate(tpl));
    setLegacyRows(out);
  }

  const failures = rows.reduce((n, r) => n + r.checks.filter((c) => !c.pass).length, 0);

  return (
    <div className="min-h-screen bg-background p-8 text-foreground">
      <header className="mb-8 space-y-2">
        <h1 className="text-2xl font-bold">Template sweep</h1>
        <p className="text-sm text-muted-foreground">
          {busy
            ? "Rendering and exporting every template…"
            : `${rows.length} templates, ${failures} failing check(s). Left is the live SceneSvg preview, right is the rasterised PNG export — they must look identical.`}
        </p>
        <button
          type="button"
          onClick={runLegacy}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
        >
          Also sweep the {LEGACY_TEXT_TEMPLATES.length} legacy templates
        </button>
      </header>

      <SweepList rows={rows} />

      {showLegacy && (
        <section className="mt-16">
          <h2 className="mb-4 text-xl font-bold">Legacy templates (pre-family)</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            These decorate over the photo instead of placing it, which is what the
            families replace. Expect them to fail the photo and field checks.
          </p>
          <SweepList rows={legacyRows} />
        </section>
      )}
    </div>
  );
}

function SweepList({ rows }: { rows: Row[] }) {
  return (
    <div className="space-y-12">
      {rows.map((r) => (
        <section key={r.id} className="space-y-3">
          <h2 className="font-semibold">
            {r.name} <span className="font-mono text-xs text-muted-foreground">{r.id}</span>
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
