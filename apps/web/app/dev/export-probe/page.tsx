"use client";

// TEMPORARY evidence harness -- deleted before commit.
import { useEffect, useState } from "react";
import { rasterizeScene } from "@/components/studio/edit/scene/rasterize";
import type { Scene } from "@/components/studio/edit/scene/types";
import type { TextLayer } from "@/components/studio/edit/EditCanvas";

const TEXT = "HEADLINE";

function layer(fontFamily: string, fontSizePct: number): TextLayer {
  return {
    id: "probe",
    type: "text",
    text: TEXT,
    xPct: 5,
    yPct: 30,
    fontSizePct,
    color: "#000000",
    bold: false,
    italic: false,
    fontFamily,
    visible: true,
    shadow: false,
  };
}

async function digest(dataUrl: string): Promise<{ bytes: number; sha: string }> {
  const b64 = dataUrl.split(",")[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return {
    bytes: bytes.length,
    sha: [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16),
  };
}

async function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const el = new Image();
    el.onload = () => res(el);
    el.onerror = () => rej(new Error("decode failed"));
    el.src = src;
  });
}

/** Horizontal extent of painted pixels, as a fraction of canvas width. */
async function inkFraction(scene: Scene): Promise<number> {
  const png = await rasterizeScene(scene);
  const img = await decode(png);
  const c = document.createElement("canvas");
  c.width = scene.width;
  c.height = scene.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let min = c.width;
  let max = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (data[(y * c.width + x) * 4 + 3] > 8) {
        if (x < min) min = x;
        if (x > max) max = x;
      }
    }
  }
  return max < 0 ? 0 : (max - min + 1) / c.width;
}

export default function ExportProbePage() {
  const [out, setOut] = useState<string>("");

  useEffect(() => {
    (async () => {
      await document.fonts.ready;
      const result: Record<string, unknown> = {};

      {
        // Old vs new "text in bounds" at W=800, to attribute the sweep's three
        // overflow failures. OLD reproduces the pre-change arithmetic exactly:
        // templateToLayers multiplied by scale = 800/800 = 1 and rounded, and
        // measureTextLayer(l, l.fontSize) used the layer's own absolute px.
        const { TEXT_TEMPLATES, templateToLayers } = await import(
          "@/components/studio/edit/text-templates"
        );
        const { measureTextLayer } = await import("@/components/studio/edit/scene/measure");
        const W = 800;
        const c = document.createElement("canvas").getContext("2d")!;
        const oldOver: string[] = [];
        const newOver: string[] = [];
        for (const tpl of TEXT_TEMPLATES) {
          for (const def of tpl.layers) {
            if (def.kind === "image" || def.kind === "shape") continue;
            const d = def as unknown as {
              text: string; xPct: number; fontSize: number; letterSpacing?: number;
              fontFamily: string; bold?: boolean; italic?: boolean; uppercase?: boolean;
            };
            const txt = d.uppercase ? d.text.toUpperCase() : d.text;
            const fs = Math.round(d.fontSize * 1);
            const ls = Math.round((d.letterSpacing ?? 0) * 1);
            c.font = `${d.italic ? "italic " : ""}${d.bold ? "bold " : ""}${fs}px ${d.fontFamily}`;
            const w = c.measureText(txt).width + ls * Math.max(0, txt.length - 1);
            if ((d.xPct / 100) * W + w > W) oldOver.push(`${tpl.id}: ${d.text}`);
          }
          const built = templateToLayers(
            { background: tpl.background ?? null, layers: tpl.layers },
            "/dev/sweep-test-photo.jpg",
            W,
            W,
          );
          for (const l of built) {
            if (l.type !== "text") continue;
            if ((l.xPct / 100) * W + measureTextLayer(l, W) > W) newOver.push(`${tpl.id}: ${l.text}`);
          }
        }
        result.bounds = { oldOver, newOver };
      }

      // --- Critical 1: does the export use the parent document's webfonts? ---
      const fontScene = (fontFamily: string): Scene => ({
        width: 800,
        height: 300,
        baseImageUrl: null,
        layers: [layer(fontFamily, 10)],
      });
      const fonts: Record<string, unknown> = {};
      for (const [name, stack] of [
        ["sans", "sans-serif"],
        ["anton", "'Anton', sans-serif"],
        ["mono", "monospace"],
        ["sourcesans", "'Source Sans 3', sans-serif"],
      ] as const) {
        fonts[name] = await digest(await rasterizeScene(fontScene(stack)));
      }
      result.fonts = fonts;

      // --- Critical 2: ink width vs canvas width at build/export ratios ---
      // Layers built for a display canvas of `buildW`, then rendered at `renderW`.
      const ink: Record<string, number> = {};
      const cases: [string, number, number][] = [
        ["build800_render800", 800, 800],
        ["build620_render620", 620, 620],
        ["build620_render1024", 620, 1024],
        ["build620_render2048", 620, 2048],
      ];
      for (const [name, buildW, renderW] of cases) {
        // A headline authored at 80px on the 800 reference canvas, as
        // templateToLayers now emits it: 10% of canvas width, at every buildW.
        void buildW;
        const built = layer("'Anton', sans-serif", 10);
        built.xPct = 5;
        ink[name] = Number(
          (
            await inkFraction({
              width: renderW,
              height: Math.round(renderW * 0.375),
              baseImageUrl: null,
              layers: [built],
            })
          ).toFixed(4),
        );
      }
      result.ink = ink;

      (window as unknown as { __probe: unknown }).__probe = result;
      setOut(JSON.stringify(result, null, 2));
    })().catch((e) => {
      (window as unknown as { __probe: unknown }).__probe = { error: String(e) };
      setOut(String(e));
    });
  }, []);

  return <pre id="probe-out">{out}</pre>;
}
