"use client";

import { cn } from "@/lib/cn";
import type { ImageStyle } from "@/lib/api";

const STYLES: { value: ImageStyle; label: string }[] = [
  { value: "professional",    label: "Professional" },
  { value: "photorealistic",  label: "Photorealistic" },
  { value: "illustration",    label: "Illustration" },
  { value: "minimalist",      label: "Minimalist" },
  { value: "abstract",        label: "Abstract" },
  { value: "3d_render",       label: "3D Render" },
  { value: "anime",           label: "Anime" },
  { value: "cinematic",       label: "Cinematic" },
  { value: "luxury_product",  label: "Luxury Product" },
];

interface StyleGridProps {
  value: ImageStyle;
  onChange: (style: ImageStyle) => void;
}

export function StyleGrid({ value, onChange }: StyleGridProps) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {STYLES.map((s) => (
        <button
          key={s.value}
          type="button"
          onClick={() => onChange(s.value)}
          className={cn(
            "rounded-lg border px-2 py-2 text-xs font-medium transition-colors text-center",
            value === s.value
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-accent",
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
