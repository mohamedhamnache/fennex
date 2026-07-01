"use client";

import { useState, useEffect, useRef, RefObject } from "react";
import { useMutation } from "@tanstack/react-query";
import { Lock, Unlock, RotateCcw, RotateCw, FlipHorizontal2, FlipVertical2 } from "lucide-react";
import { editImage, getImage, type GeneratedImage } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { EditCanvasRef } from "./EditCanvas";

interface EditControlsPanelProps {
  tool: string;
  imageId: string;
  canvasRef: RefObject<EditCanvasRef>;
  onVersionAdded: (img: GeneratedImage) => void;
  /** Controlled angle for the rotate tool (shared with EditCanvas) */
  rotationAngle: number;
  onRotationChange: (angle: number) => void;
  /** Called with a CSS filter string for live preview; "" to clear */
  onPreviewChange?: (filter: string) => void;
}

// ── CSS approximations for live preview (visual-only, not exact Pillow output) ──

const CSS_PREVIEW: Record<string, string> = {
  grayscale: "grayscale(100%)",
  sepia: "sepia(90%) brightness(1.02)",
  warm: "sepia(30%) saturate(150%) hue-rotate(-15deg)",
  cool: "hue-rotate(210deg) saturate(80%) brightness(1.02)",
  vivid: "saturate(180%) contrast(115%)",
};

// ── Filter chips ────────────────────────────────────────────────────────────

const FILTERS = [
  { value: "grayscale", label: "B&W" },
  { value: "sepia",     label: "Sepia" },
  { value: "warm",      label: "Warm" },
  { value: "cool",      label: "Cool" },
  { value: "vivid",     label: "Vivid" },
];

// ── Range slider ────────────────────────────────────────────────────────────

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums w-9 text-right">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

// ── Main panel ──────────────────────────────────────────────────────────────

export function EditControlsPanel({
  tool,
  imageId,
  canvasRef,
  onVersionAdded,
  rotationAngle,
  onRotationChange,
  onPreviewChange,
}: EditControlsPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const appliedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adjust
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);

  // Filter
  const [filterName, setFilterName] = useState("grayscale");

  // Denoise / Sharpen
  const [denoiseStrength, setDenoiseStrength] = useState(0.5);
  const [sharpenStrength, setSharpenStrength] = useState(0.5);

  // Rotate — angle is controlled by parent; fill is local
  const [fillColor, setFillColor] = useState("#000000");
  const [fillTransparent, setFillTransparent] = useState(false);

  // Resize
  const [resizeW, setResizeW] = useState(1024);
  const [resizeH, setResizeH] = useState(1024);
  const [aspectLocked, setAspectLocked] = useState(true);
  const [aspectRatio, setAspectRatio] = useState(1);

  // Generative / text tools
  const [prompt, setPrompt] = useState("");

  // Shadow direction / relight direction
  const [shadowDir, setShadowDir] = useState("bottom");
  const [relightDir, setRelightDir] = useState("top");
  const [relightIntensity, setRelightIntensity] = useState(1.0);

  // Face restore / upscale
  const [fidelity, setFidelity] = useState(0.7);
  const [scale, setScale] = useState("2");

  // Clean up the applied-success timer on unmount
  useEffect(() => () => {
    if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current);
  }, []);

  // ── Reset on tool change — runs FIRST so preview effects below can override ─
  useEffect(() => {
    setError(null);
    setApplied(false);
    onPreviewChange?.("");
    setBrightness(0); setContrast(0);
    setFilterName("grayscale");
    setDenoiseStrength(0.5); setSharpenStrength(0.5);
    setFillColor("#000000"); setFillTransparent(false);
    setPrompt("");
    setShadowDir("bottom"); setRelightDir("top"); setRelightIntensity(1.0);
    setFidelity(0.7); setScale("2");

    if (tool === "resize") {
      const size = canvasRef.current?.getImageSize();
      if (size) {
        setResizeW(size.width);
        setResizeH(size.height);
        setAspectRatio(size.width / size.height);
      }
    }
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Live previews — defined AFTER reset so they run after and win ──────────

  // adjust: brightness + contrast sliders
  useEffect(() => {
    if (tool !== "adjust") return;
    const b = (1 + brightness / 100).toFixed(2);
    const c = (1 + contrast / 100).toFixed(2);
    onPreviewChange?.(`brightness(${b}) contrast(${c})`);
  }, [brightness, contrast, tool]); // eslint-disable-line react-hooks/exhaustive-deps

  // filter: selected chip
  useEffect(() => {
    if (tool !== "filter") return;
    onPreviewChange?.(CSS_PREVIEW[filterName] ?? "");
  }, [filterName, tool]); // eslint-disable-line react-hooks/exhaustive-deps

  // denoise: blur approximation
  useEffect(() => {
    if (tool !== "denoise") return;
    onPreviewChange?.(`blur(${(denoiseStrength * 1.5).toFixed(1)}px)`);
  }, [denoiseStrength, tool]); // eslint-disable-line react-hooks/exhaustive-deps

  // sharpen: contrast boost approximation
  useEffect(() => {
    if (tool !== "sharpen") return;
    const c = (1 + sharpenStrength * 0.25).toFixed(2);
    const s = (1 + sharpenStrength * 0.1).toFixed(2);
    onPreviewChange?.(`contrast(${c}) saturate(${s})`);
  }, [sharpenStrength, tool]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleWidthChange(v: number) {
    setResizeW(v);
    if (aspectLocked) setResizeH(Math.round(v / aspectRatio));
  }
  function handleHeightChange(v: number) {
    setResizeH(v);
    if (aspectLocked) setResizeW(Math.round(v * aspectRatio));
  }
  function toggleAspectLock() {
    if (!aspectLocked) setAspectRatio(resizeW / resizeH);
    setAspectLocked((p) => !p);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      setError(null);
      let params: Record<string, unknown> = {};

      switch (tool) {
        case "crop": {
          const r = canvasRef.current?.getCropRect();
          if (!r) throw new Error("No crop area selected");
          params = { x: r.x, y: r.y, w: r.w, h: r.h };
          break;
        }
        case "resize":
          params = { width: resizeW, height: resizeH, keep_aspect: false };
          break;
        case "rotate":
          params = {
            angle: rotationAngle,
            ...(fillTransparent ? {} : { fill_color: fillColor }),
          };
          break;
        case "adjust":
          params = { brightness, contrast };
          break;
        case "filter":
          params = { filter_name: filterName };
          break;
        case "denoise":
          params = { strength: denoiseStrength };
          break;
        case "sharpen":
          params = { strength: sharpenStrength };
          break;
        case "replace_background":
        case "insert_object":
        case "generative_fill":
          params = { prompt };
          if (canvasRef.current) {
            const m = canvasRef.current.getMaskBase64();
            if (m) params["mask_base64"] = m;
          }
          break;
        case "remove_background":
        case "remove_object":
        case "smart_erase":
          if (canvasRef.current) {
            const m = canvasRef.current.getMaskBase64();
            if (m) params["mask_base64"] = m;
          }
          break;
        case "generate_shadow":
          params = { direction: shadowDir };
          break;
        case "relight":
          params = { direction: relightDir, intensity: relightIntensity };
          break;
        case "restore_face":
          params = { fidelity };
          break;
        case "upscale":
          params = { scale: Number(scale) };
          break;
      }

      const result = await editImage(imageId, tool, params);
      if (!result.ok || !result.image_id) throw new Error(result.error ?? "Edit failed");
      const edited = await getImage(result.image_id);
      return edited;
    },
    onSuccess: (img) => {
      onPreviewChange?.("");
      onVersionAdded(img);
      canvasRef.current?.clearMask();
      if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current);
      setApplied(true);
      appliedTimerRef.current = setTimeout(() => setApplied(false), 2000);
    },
    onError: (e: Error) => setError(e.message),
  });

  const toolLabel = tool.replace(/_/g, " ");

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground capitalize">
          {toolLabel}
        </p>
      </div>

      <div className="flex flex-col gap-4 p-4 flex-1 overflow-y-auto">

        {/* ── Crop ──────────────────────────────────────────────────────────── */}
        {tool === "crop" && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            Drag the handles on the image to select the area you want to keep.
          </p>
        )}

        {/* ── Resize ────────────────────────────────────────────────────────── */}
        {tool === "resize" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-xs font-medium text-foreground">Width</label>
                <input
                  type="number"
                  value={resizeW}
                  min={1}
                  onChange={(e) => handleWidthChange(Number(e.target.value))}
                  className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <button
                type="button"
                onClick={toggleAspectLock}
                className="mt-5 p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title={aspectLocked ? "Unlock aspect ratio" : "Lock aspect ratio"}
              >
                {aspectLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
              </button>
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-xs font-medium text-foreground">Height</label>
                <input
                  type="number"
                  value={resizeH}
                  min={1}
                  onChange={(e) => handleHeightChange(Number(e.target.value))}
                  className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {aspectLocked ? "Aspect ratio locked" : "Aspect ratio unlocked"}
            </p>
          </div>
        )}

        {/* ── Rotate ────────────────────────────────────────────────────────── */}
        {tool === "rotate" && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
              Drag the handle at the bottom of the image, or use the controls below.
              Hold <kbd className="px-1 py-0.5 rounded border border-border text-[10px]">Shift</kbd> while dragging to snap to 15°.
            </p>

            {/* Angle slider */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">Angle</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    value={rotationAngle}
                    min={-180}
                    max={180}
                    onChange={(e) => onRotationChange(Number(e.target.value))}
                    className="w-16 rounded-lg border border-border bg-background px-2 py-0.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <span className="text-xs text-muted-foreground">°</span>
                </div>
              </div>
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={rotationAngle}
                onChange={(e) => onRotationChange(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </div>

            {/* Quick-rotate buttons */}
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { icon: RotateCcw, label: "-90°", action: () => onRotationChange(rotationAngle - 90) },
                { icon: RotateCw,  label: "+90°", action: () => onRotationChange(rotationAngle + 90) },
                { icon: FlipHorizontal2, label: "Reset", action: () => onRotationChange(0) },
                { icon: FlipVertical2,   label: "180°",  action: () => onRotationChange(180) },
              ].map(({ icon: Icon, label, action }) => (
                <button
                  key={label}
                  type="button"
                  onClick={action}
                  className="flex flex-col items-center gap-1 rounded-lg border border-border px-1 py-2 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="text-[10px] leading-none">{label}</span>
                </button>
              ))}
            </div>

            {/* Background fill */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-foreground">Background</label>
                <button
                  type="button"
                  onClick={() => setFillTransparent((v) => !v)}
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full border transition-colors",
                    fillTransparent
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  Transparent
                </button>
              </div>
              {!fillTransparent && (
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={fillColor}
                    onChange={(e) => setFillColor(e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded-md border border-border p-0.5 bg-transparent"
                  />
                  <span className="text-xs text-muted-foreground font-mono">{fillColor}</span>
                </div>
              )}
              {fillTransparent && (
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-md border border-border"
                    style={{ background: "repeating-conic-gradient(#aaa 0% 25%, #fff 0% 50%) 0 0 / 8px 8px" }} />
                  <span className="text-xs text-muted-foreground">Transparent PNG</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Adjust ────────────────────────────────────────────────────────── */}
        {tool === "adjust" && (
          <div className="flex flex-col gap-4">
            <Slider label="Brightness" value={brightness} min={-100} max={100} step={1} onChange={setBrightness} />
            <Slider label="Contrast" value={contrast} min={-100} max={100} step={1} onChange={setContrast} />
          </div>
        )}

        {/* ── Filter ────────────────────────────────────────────────────────── */}
        {tool === "filter" && (
          <div className="flex flex-col gap-3">
            <span className="text-xs font-medium text-foreground">Choose a filter</span>
            <div className="flex flex-col gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilterName(f.value)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors text-left",
                    filterName === f.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-foreground hover:bg-accent",
                  )}
                >
                  <span
                    className="h-5 w-5 rounded-full border border-border shrink-0"
                    style={{
                      background:
                        f.value === "grayscale" ? "linear-gradient(135deg, #999 50%, #ccc 50%)" :
                        f.value === "sepia" ? "linear-gradient(135deg, #a08060 50%, #c0a080 50%)" :
                        f.value === "warm" ? "linear-gradient(135deg, #f0a060 50%, #f8c080 50%)" :
                        f.value === "cool" ? "linear-gradient(135deg, #60a0f0 50%, #80c0f8 50%)" :
                        "linear-gradient(135deg, hsl(var(--primary)) 50%, hsl(var(--primary)/0.6) 50%)",
                    }}
                  />
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Denoise ───────────────────────────────────────────────────────── */}
        {tool === "denoise" && (
          <Slider label="Strength" value={denoiseStrength} min={0} max={1} step={0.1} onChange={setDenoiseStrength} />
        )}

        {/* ── Sharpen ───────────────────────────────────────────────────────── */}
        {tool === "sharpen" && (
          <Slider label="Strength" value={sharpenStrength} min={0} max={1} step={0.1} onChange={setSharpenStrength} />
        )}

        {/* ── Remove BG / Remove Object / Smart Erase ───────────────────────── */}
        {(tool === "remove_background" || tool === "remove_object" || tool === "smart_erase") && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {tool === "remove_background"
              ? "Automatically removes the background. No mask needed."
              : "Paint over the area you want to remove, then click Apply."}
          </p>
        )}

        {/* ── Mask-based AI tools that need a prompt ─────────────────────────── */}
        {(tool === "replace_background" || tool === "insert_object" || tool === "generative_fill") && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Paint the area on the image, then describe what you want.
            </p>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-foreground">
                {tool === "replace_background" ? "New background" : "Description"}
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder={
                  tool === "replace_background"
                    ? "e.g. Sunny beach with clear blue water"
                    : "e.g. A red ball"
                }
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
            </div>
          </div>
        )}

        {/* ── Shadow ────────────────────────────────────────────────────────── */}
        {tool === "generate_shadow" && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-foreground">Direction</span>
            <div className="grid grid-cols-2 gap-1.5">
              {["bottom", "top", "left", "right"].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setShadowDir(d)}
                  className={cn(
                    "rounded-lg border px-2 py-1.5 text-xs font-medium capitalize transition-colors",
                    shadowDir === d
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-foreground hover:bg-accent",
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Relight ───────────────────────────────────────────────────────── */}
        {tool === "relight" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-foreground">Light direction</span>
              <div className="grid grid-cols-2 gap-1.5">
                {["top", "bottom", "left", "right"].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setRelightDir(d)}
                    className={cn(
                      "rounded-lg border px-2 py-1.5 text-xs font-medium capitalize transition-colors",
                      relightDir === d
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-foreground hover:bg-accent",
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <Slider label="Intensity" value={relightIntensity} min={0.1} max={3} step={0.1} onChange={setRelightIntensity} />
          </div>
        )}

        {/* ── Restore face ──────────────────────────────────────────────────── */}
        {tool === "restore_face" && (
          <Slider label="Fidelity" value={fidelity} min={0} max={1} step={0.05} onChange={setFidelity} />
        )}

        {/* ── Upscale ───────────────────────────────────────────────────────── */}
        {tool === "upscale" && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-foreground">Scale factor</span>
            <div className="flex gap-2">
              {["2", "4"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScale(s)}
                  className={cn(
                    "flex-1 rounded-lg border py-2 text-sm font-semibold transition-colors",
                    scale === s
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-foreground hover:bg-accent",
                  )}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border p-4 flex flex-col gap-2">
        {error && (
          <p className="text-xs text-destructive leading-relaxed">{error}</p>
        )}
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className={cn(
            "w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed",
            applied && !mutation.isPending
              ? "bg-green-600 text-white"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          {mutation.isPending ? "Saving…" : applied ? "✓ Saved!" : "Save"}
        </button>
      </div>
    </div>
  );
}
