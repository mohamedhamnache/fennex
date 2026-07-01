"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { generateImageSeo, exportImage, type GeneratedImage } from "@/lib/api";

interface SeoPanelProps {
  imageId: string;
  image: GeneratedImage | undefined;
}

export function SeoPanel({ imageId, image }: SeoPanelProps) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<"png" | "jpg" | "webp">("webp");
  const [exportQuality, setExportQuality] = useState(85);

  const seoMutation = useMutation({
    mutationFn: () => generateImageSeo(imageId),
    onSuccess: (data) => {
      qc.setQueryData(["image", imageId], data);
    },
  });

  const exportMutation = useMutation({
    mutationFn: () => exportImage(imageId, exportFormat, exportQuality),
    onSuccess: (data) => {
      const a = document.createElement("a");
      a.href = data.download_url;
      a.download = `${image?.seo_filename || "image"}.${exportFormat}`;
      a.click();
    },
  });

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const hasSeo = !!(image?.alt_text || image?.caption || image?.seo_filename);

  return (
    <div className="border-t border-border bg-card px-4 py-3 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">SEO & Export</span>
        <button
          type="button"
          onClick={() => seoMutation.mutate()}
          disabled={seoMutation.isPending}
          className="flex items-center gap-1.5 rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          <Sparkles className="h-3 w-3" />
          {seoMutation.isPending ? "Generating…" : hasSeo ? "Regenerate SEO" : "Generate SEO"}
        </button>
      </div>

      {hasSeo && (
        <div className="grid grid-cols-1 gap-2">
          {image?.alt_text && (
            <SeoField label="Alt text" value={image.alt_text} fieldKey="alt" copied={copied} onCopy={copyToClipboard} />
          )}
          {image?.caption && (
            <SeoField label="Caption" value={image.caption} fieldKey="caption" copied={copied} onCopy={copyToClipboard} />
          )}
          {image?.seo_filename && (
            <SeoField
              label="Filename"
              value={`${image.seo_filename}.${exportFormat}`}
              fieldKey="filename"
              copied={copied}
              onCopy={copyToClipboard}
            />
          )}
        </div>
      )}

      {/* Export */}
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
              className="w-16 accent-primary"
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
            : null) ?? "Failed — please try again."}
        </p>
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
        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mb-0.5">{label}</p>
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
