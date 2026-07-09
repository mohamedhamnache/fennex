"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { ImageStyle } from "@/lib/api";

const STYLES: ImageStyle[] = [
  "professional", "photorealistic", "illustration", "minimalist",
  "abstract", "3d_render", "anime", "cinematic", "luxury_product",
];

interface StyleGridProps {
  value: ImageStyle;
  onChange: (style: ImageStyle) => void;
}

export function StyleGrid({ value, onChange }: StyleGridProps) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {STYLES.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={cn(
            "rounded-lg border px-2 py-2 text-xs font-medium transition-colors text-center",
            value === s
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-accent",
          )}
        >
          {t(`studio.styles.${s}`)}
        </button>
      ))}
    </div>
  );
}
