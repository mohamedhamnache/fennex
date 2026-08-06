"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { burnOptions, upscalesPhoto, type BurnSize } from "./burnResolution";

interface BurnSizePickerProps {
  /** The source photograph's real size. */
  source: BurnSize;
  value: BurnSize;
  onChange: (size: BurnSize) => void;
  disabled?: boolean;
}

/**
 * Choose the size the composition is flattened at.
 *
 * Applying a template to a 1024px generation used to yield a 1024px asset with
 * no way to ask for more, which for a marketing image is small.
 */
export function BurnSizePicker({ source, value, onChange, disabled }: BurnSizePickerProps) {
  const { t } = useTranslation();
  const options = burnOptions(source);
  const photoUpscaled = upscalesPhoto(value, source);

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        {t("imageEdit.burnSizeLabel")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = o.size.width === value.width && o.size.height === value.height;
          return (
            <button
              key={o.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(o.size)}
              title={`${o.size.width} x ${o.size.height}`}
              className={cn(
                "rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                "disabled:opacity-40 disabled:cursor-not-allowed",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40",
              )}
            >
              {t(`imageEdit.burnSize.${o.labelKey}`)}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground tabular-nums">
        {value.width} x {value.height}
      </p>
      {/* Said plainly rather than implied. Type, shapes and gradients are
          vector and genuinely re-render sharper at any size; the photograph is
          upscaled. A user expecting a small source to become a crisp 4K asset
          would think the feature was broken. */}
      {photoUpscaled && (
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          {t("imageEdit.burnSizePhotoNote")}
        </p>
      )}
    </div>
  );
}
