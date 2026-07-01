"use client";

import { useState, RefObject } from "react";
import { useMutation } from "@tanstack/react-query";
import { editImage, getImage, type GeneratedImage } from "@/lib/api";
import type { EditCanvasRef } from "./EditCanvas";

interface EditControlsPanelProps {
  tool: string;
  imageId: string;
  canvasRef: RefObject<EditCanvasRef>;
  onVersionAdded: (img: GeneratedImage) => void;
}

interface FieldDef {
  key: string;
  label: string;
  type: "number" | "text" | "range" | "select";
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: string | number;
  options?: { value: string; label: string }[];
}

const CONTROLS: Record<string, FieldDef[]> = {
  crop: [
    { key: "x", label: "X", type: "number", defaultValue: 0 },
    { key: "y", label: "Y", type: "number", defaultValue: 0 },
    { key: "w", label: "Width", type: "number", defaultValue: 512 },
    { key: "h", label: "Height", type: "number", defaultValue: 512 },
  ],
  resize: [
    { key: "width", label: "Width", type: "number", defaultValue: 1024 },
    { key: "height", label: "Height", type: "number", defaultValue: 1024 },
  ],
  rotate: [
    { key: "angle", label: "Angle (°)", type: "range", min: -180, max: 180, step: 1, defaultValue: 90 },
    { key: "fill_color", label: "Fill color", type: "text", defaultValue: "#000000" },
  ],
  adjust: [
    { key: "brightness", label: "Brightness", type: "range", min: -100, max: 100, step: 1, defaultValue: 0 },
    { key: "contrast", label: "Contrast", type: "range", min: -100, max: 100, step: 1, defaultValue: 0 },
  ],
  filter: [
    {
      key: "filter_name",
      label: "Filter",
      type: "select",
      defaultValue: "grayscale",
      options: [
        { value: "grayscale", label: "Grayscale" },
        { value: "sepia", label: "Sepia" },
        { value: "warm", label: "Warm" },
        { value: "cool", label: "Cool" },
        { value: "vivid", label: "Vivid" },
      ],
    },
  ],
  denoise: [
    { key: "strength", label: "Strength", type: "range", min: 0, max: 1, step: 0.1, defaultValue: 0.5 },
  ],
  sharpen: [
    { key: "strength", label: "Strength", type: "range", min: 0, max: 1, step: 0.1, defaultValue: 0.5 },
  ],
  replace_background: [
    { key: "prompt", label: "Background description", type: "text", defaultValue: "" },
  ],
  insert_object: [
    { key: "prompt", label: "Object description", type: "text", defaultValue: "" },
  ],
  generative_fill: [
    { key: "prompt", label: "Fill description", type: "text", defaultValue: "" },
  ],
  generate_shadow: [
    {
      key: "direction",
      label: "Direction",
      type: "select",
      defaultValue: "bottom",
      options: [
        { value: "bottom", label: "Bottom" },
        { value: "left", label: "Left" },
        { value: "right", label: "Right" },
        { value: "top", label: "Top" },
      ],
    },
  ],
  relight: [
    {
      key: "direction",
      label: "Direction",
      type: "select",
      defaultValue: "top",
      options: [
        { value: "top", label: "Top" },
        { value: "left", label: "Left" },
        { value: "right", label: "Right" },
        { value: "bottom", label: "Bottom" },
      ],
    },
    { key: "intensity", label: "Intensity", type: "range", min: 0.1, max: 3, step: 0.1, defaultValue: 1.0 },
  ],
  restore_face: [
    { key: "fidelity", label: "Fidelity", type: "range", min: 0, max: 1, step: 0.05, defaultValue: 0.7 },
  ],
  upscale: [
    {
      key: "scale",
      label: "Scale",
      type: "select",
      defaultValue: "2",
      options: [
        { value: "2", label: "2×" },
        { value: "4", label: "4×" },
      ],
    },
  ],
};

const MASK_TOOLS = new Set([
  "remove_background",
  "replace_background",
  "remove_object",
  "insert_object",
  "generative_fill",
  "smart_erase",
]);

export function EditControlsPanel({
  tool,
  imageId,
  canvasRef,
  onVersionAdded,
}: EditControlsPanelProps) {
  const fields = CONTROLS[tool] ?? [];

  const initValues = () =>
    Object.fromEntries(fields.map((f) => [f.key, String(f.defaultValue ?? "")]));

  const [values, setValues] = useState<Record<string, string>>(initValues);
  const [error, setError] = useState<string | null>(null);

  // Reset form when tool changes
  const prevTool = useState(tool)[0];
  if (tool !== prevTool) {
    setValues(initValues());
    setError(null);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      setError(null);
      const params: Record<string, unknown> = {};
      for (const f of fields) {
        const raw = values[f.key];
        if (f.type === "number" || f.type === "range") {
          params[f.key] = Number(raw);
        } else {
          params[f.key] = raw;
        }
      }

      // Attach mask for mask-based tools
      if (MASK_TOOLS.has(tool) && canvasRef.current) {
        const maskB64 = canvasRef.current.getMaskBase64();
        if (maskB64) params["mask_base64"] = maskB64;
      }

      const result = await editImage(imageId, tool, params);
      if (!result.ok || !result.image_id) {
        throw new Error(result.error ?? "Edit failed");
      }
      const edited = await getImage(result.image_id);
      return edited;
    },
    onSuccess: (img) => {
      onVersionAdded(img);
      canvasRef.current?.clearMask();
    },
    onError: (e: Error) => setError(e.message),
  });

  function set(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {tool.replace(/_/g, " ")}
      </p>

      {fields.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No parameters needed. Click Apply to run.
        </p>
      )}

      {fields.map((f) => (
        <div key={f.key} className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-foreground">{f.label}</label>
          {f.type === "select" && f.options ? (
            <select
              value={values[f.key] ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === "range" ? (
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={f.min}
                max={f.max}
                step={f.step}
                value={values[f.key] ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-10 text-right">
                {values[f.key]}
              </span>
            </div>
          ) : (
            <input
              type={f.type === "number" ? "number" : "text"}
              value={values[f.key] ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          )}
        </div>
      ))}

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="mt-auto rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {mutation.isPending ? "Applying…" : "Apply"}
      </button>
    </div>
  );
}
