"use client";

import { useTranslation } from "react-i18next";

/**
 * The product image input every Product tool starts from. There is no
 * drag-and-drop uploader in this part of the studio -- ProductTab has always
 * taken a URL, not a file -- so this is the "upload control" Product3DTab is
 * told to reuse rather than building a second one. Extracted out of
 * ProductTab.tsx (Task 8) so both tools import the same control instead of
 * duplicating its markup.
 */
interface ImageUrlFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
}

export function ImageUrlField({ value, onChange, label, placeholder }: ImageUrlFieldProps) {
  const { t } = useTranslation();
  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">
        {label ?? t("productTab.imageUrl.label", { defaultValue: "Product Image URL" })}
      </label>
      <input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t("productTab.imageUrl.placeholder", { defaultValue: "https://your-store.com/product.jpg" }) ?? undefined}
        className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}
