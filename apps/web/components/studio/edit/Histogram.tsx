"use client";

import { useEffect, useRef } from "react";

/** Client-side RGB histogram of an image, drawn on a small canvas. */
export function Histogram({ imageUrl, filter }: { imageUrl: string; filter?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!imageUrl) return;
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = 128, h = 128;
      const off = document.createElement("canvas");
      off.width = w; off.height = h;
      const octx = off.getContext("2d", { willReadFrequently: true });
      if (!octx) return;
      if (filter) octx.filter = filter; // reflect the live preview adjustments
      octx.drawImage(img, 0, 0, w, h);

      let data: Uint8ClampedArray;
      try {
        data = octx.getImageData(0, 0, w, h).data;
      } catch {
        return; // cross-origin tainted — skip
      }

      const r = new Array(256).fill(0), g = new Array(256).fill(0), b = new Array(256).fill(0);
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 8) continue; // ignore fully transparent pixels
        r[data[i]]++; g[data[i + 1]]++; b[data[i + 2]]++;
      }
      const max = Math.max(1, ...r, ...g, ...b);

      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const cw = c.width, ch = c.height;
      ctx.clearRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = "lighter";
      const draw = (hist: number[], color: string) => {
        ctx.fillStyle = color;
        for (let x = 0; x < 256; x++) {
          const bar = (hist[x] / max) * ch;
          if (bar <= 0) continue;
          ctx.fillRect((x / 256) * cw, ch - bar, cw / 256 + 0.6, bar);
        }
      };
      draw(r, "rgba(239,68,68,0.55)");
      draw(g, "rgba(34,197,94,0.55)");
      draw(b, "rgba(59,130,246,0.55)");
      ctx.globalCompositeOperation = "source-over";
    };
    img.src = imageUrl;
  }, [imageUrl, filter]);

  return (
    <canvas
      ref={canvasRef}
      width={256}
      height={72}
      className="w-full h-16 rounded-md border border-border bg-muted/30"
    />
  );
}
