"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, Copy, Download, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { generateImageSeo, exportImage, type GeneratedImage, type SeoResult } from "@/lib/api";

interface SeoPanelProps {
  imageId: string;
  image: GeneratedImage | undefined;
}

export function SeoPanel({ imageId, image }: SeoPanelProps) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<"png" | "jpg" | "webp">("webp");
  const [exportQuality, setExportQuality] = useState(85);

  // Local seo state — null means "read from image prop".
  // Reset when the displayed image changes (version switches) so stale seo from
  // a previous version doesn't bleed through.
  const [localSeo, setLocalSeo] = useState<SeoResult | null>(null);
  useEffect(() => {
    setLocalSeo(null);
  }, [imageId]);

  const altText = localSeo !== null ? localSeo.alt_text : (image?.alt_text ?? null);
  const caption = localSeo !== null ? localSeo.caption : (image?.caption ?? null);
  const seoFilename = localSeo !== null ? localSeo.seo_filename : (image?.seo_filename ?? null);
  const hasSeo = !!(altText || caption || seoFilename);

  // Collapsed by default; auto-open if source image already has seo data on mount,
  // and auto-open after a successful generate call.
  const [isOpen, setIsOpen] = useState(() => !!(image?.alt_text || image?.caption || image?.seo_filename));

  const seoMutation = useMutation({
    mutationFn: () => generateImageSeo(imageId),
    onSuccess: (data) => {
      setLocalSeo(data);
      setIsOpen(true);
      // Merge seo fields into the source image cache — never replace the full object
      // so image_url and other fields are preserved (critical: prevents canvas blank-out).
      qc.setQueryData(
        ["image", imageId],
        (old: GeneratedImage | undefined) =>
          old
            ? { ...old, alt_text: data.alt_text, caption: data.caption, seo_filename: data.seo_filename }
            : old,
      );
    },
  });

  const exportMutation = useMutation({
    mutationFn: () => exportImage(imageId, exportFormat, exportQuality),
    onSuccess: (data) => {
      const a = document.createElement("a");
      a.href = data.download_url;
      a.download = `${seoFilename || "image"}.${exportFormat}`;
      a.click();
    },
  });

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <div className="border-t border-border bg-card">
      {/* Header — always visible */}
      <div className="flex items-center gap-2 px-4 py-2">
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-semibold text-foreground hover:text-primary transition-colors"
        >
          {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          SEO &amp; Export
          {hasSeo && (
            <span className="rounded-full bg-green-500/15 text-green-600 dark:text-green-400 px-1.5 py-px text-[10px] font-semibold leading-none">
              ✓
            </span>
          )}
        </button>
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => seoMutation.mutate()}
            disabled={seoMutation.isPending}
            className="flex items-center gap-1.5 rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            <Sparkles className="h-3 w-3" />
            {seoMutation.isPending ? "Generating…" : hasSeo ? "Regenerate" : "Generate SEO"}
          </button>
        </div>
      </div>

      {/* Expandable body */}
      {isOpen && (
        <div className="border-t border-border/60 px-4 py-3 flex flex-col gap-3">
          {/* Loading skeleton */}
          {seoMutation.isPending && (
            <div className="flex flex-col gap-2">
              <div className="h-12 rounded-lg skeleton" />
              <div className="h-12 rounded-lg skeleton" />
              <div className="h-8 w-3/4 rounded-lg skeleton" />
            </div>
          )}

          {/* SEO fields */}
          {!seoMutation.isPending && hasSeo && (
            <div className="flex flex-col gap-1.5">
              {altText && (
                <SeoField label="Alt text" value={altText} fieldKey="alt" copied={copied} onCopy={copyToClipboard} />
              )}
              {caption && (
                <SeoField label="Caption" value={caption} fieldKey="caption" copied={copied} onCopy={copyToClipboard} />
              )}
              {seoFilename && (
                <SeoField
                  label="Filename"
                  value={`${seoFilename}.${exportFormat}`}
                  fieldKey="filename"
                  copied={copied}
                  onCopy={copyToClipboard}
                />
              )}
            </div>
          )}

          {/* Empty state */}
          {!seoMutation.isPending && !hasSeo && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              Generate AI-powered alt text, a caption, and an SEO-friendly filename for this image.
            </p>
          )}

          {/* Export row */}
          <div className="flex items-center gap-2 pt-1 border-t border-border/50">
            <div className="flex gap-1">
              {(["webp", "jpg", "png"] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setExportFormat(fmt)}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                    exportFormat === fmt
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground border border-border",
                  )}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
            {exportFormat !== "png" && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>Q</span>
                <input
                  type="range"
                  min={60}
                  max={100}
                  value={exportQuality}
                  onChange={(e) => setExportQuality(Number(e.target.value))}
                  className="w-14 accent-primary"
                />
                <span className="w-6 tabular-nums">{exportQuality}</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending || !image?.image_url}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {exportMutation.isPending ? "Exporting…" : "Export"}
            </button>
          </div>

          {(seoMutation.isError || exportMutation.isError) && (
            <p className="text-xs text-destructive">
              {((seoMutation.error || exportMutation.error) instanceof Error
                ? (seoMutation.error || exportMutation.error)!.message
                : null) ?? "Something went wrong — please try again."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface SeoFieldProps {
  label: string;
  value: string;
  fieldKey: string;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
}

function SeoField({ label, value, fieldKey, copied, onCopy }: SeoFieldProps) {
  return (
    <div className="group flex items-start gap-2 rounded-lg bg-muted/40 px-2.5 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-0.5">{label}</p>
        <p className="text-xs text-foreground leading-relaxed break-words">{value}</p>
      </div>
      <button
        type="button"
        onClick={() => onCopy(value, fieldKey)}
        className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Copy"
      >
        {copied === fieldKey ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
        )}
      </button>
    </div>
  );
}
