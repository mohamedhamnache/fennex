"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus, Link2, Loader2, X } from "lucide-react";
import { uploadImage } from "@/lib/api";
import { cn } from "@/lib/cn";

/**
 * The product image input every Product tool starts from: drop a file, pick
 * one, or paste a URL.
 *
 * It originally took a URL only, which meant Product-to-3D asked people to
 * host an image somewhere before they could use it -- while ProductStudio a
 * few components away already had drag-and-drop. Uploading goes through the
 * existing `POST /api/v1/images/upload` via `uploadImage()`, the same endpoint
 * ProductStudio uses, so there is one upload path rather than two.
 *
 * The value is still just a URL string: an uploaded file is stored and its
 * resulting URL handed back, so every consumer keeps the same simple contract.
 */
interface ImageUrlFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Required for uploads. Without it the control is URL-only. */
  projectId?: string;
  label?: string;
  placeholder?: string;
}

export function ImageUrlField({ value, onChange, projectId, label, placeholder }: ImageUrlFieldProps) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!projectId) return;
    setError(null);
    setUploading(true);
    try {
      const img = await uploadImage(projectId, file);
      if (img.image_url) onChange(img.image_url);
      else setError(t("productTab.imageUrl.uploadFailed", { defaultValue: "Upload failed" }));
    } catch (e) {
      // Surface the real reason -- a silent no-op here looks like a frozen UI.
      setError(e instanceof Error ? e.message : t("productTab.imageUrl.uploadFailed", { defaultValue: "Upload failed" }));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">
        {label ?? t("productTab.imageUrl.label", { defaultValue: "Product Image" })}
      </label>

      {projectId && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) void handleFile(f);
            }}
            onClick={() => fileRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
            className={cn(
              "mb-2 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-4 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
            )}
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-primary" strokeWidth={1.9} />
                <span className="text-xs text-muted-foreground">
                  {t("productTab.imageUrl.uploading", { defaultValue: "Uploading..." })}
                </span>
              </>
            ) : (
              <>
                <ImagePlus className="h-4 w-4 text-muted-foreground" strokeWidth={1.9} />
                <span className="text-xs text-muted-foreground">
                  {t("productTab.imageUrl.dropHint", { defaultValue: "Drop an image or click to upload" })}
                </span>
              </>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
        </>
      )}

      <div className="relative">
        <Link2 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" strokeWidth={1.9} />
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? t("productTab.imageUrl.placeholder", { defaultValue: "...or paste an image URL" }) ?? undefined}
          className="w-full rounded-lg border border-border bg-input py-2 pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={t("productTab.imageUrl.clear", { defaultValue: "Clear image" })}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
      </div>

      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}

      {value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={value}
          alt=""
          className="mt-2 h-24 w-full rounded-lg border border-border object-contain bg-muted/30"
        />
      )}
    </div>
  );
}
