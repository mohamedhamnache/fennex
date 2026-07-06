"use client";

import Link from "next/link";
import { Download, Link as LinkIcon, RotateCcw, AlertCircle, Loader2, Image as ImageIcon, PencilLine } from "lucide-react";
import type { GeneratedImage } from "@/lib/api";

interface ResultCardProps {
  image: GeneratedImage | null;
  projectId: string;
  onUse: (image: GeneratedImage) => void;
  onRegenerate: () => void;
}

export function ResultCard({ image, projectId, onUse, onRegenerate }: ResultCardProps) {
  if (image === null) {
    return (
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="aspect-square skeleton" />
        <div className="p-3 flex flex-col gap-2">
          <div className="h-3 w-3/4 skeleton rounded" />
          <div className="h-3 w-1/2 skeleton rounded" />
        </div>
      </div>
    );
  }

  const img = image;

  function handleDownload() {
    if (!img.image_url) return;
    const a = document.createElement("a");
    a.href = img.image_url;
    a.download = `studio-${img.id}.png`;
    a.target = "_blank";
    a.click();
  }

  const isLoading = img.status === "pending" || img.status === "generating";
  const isFailed = img.status === "failed";
  const isReady = img.status === "ready" && !!img.image_url;

  return (
    <div className="group rounded-xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-md hover:border-primary/25 transition-all duration-200">
      {/* Image area */}
      <div className="relative aspect-square bg-muted overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 skeleton flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {isFailed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-destructive/10 border-2 border-destructive/30">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <span className="text-xs text-destructive px-2 text-center">
              {img.error ?? "Generation failed"}
            </span>
          </div>
        )}
        {isReady && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img.image_url!}
            alt={img.alt_text ?? img.prompt}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        )}

        {/* Badge overlays */}
        {isReady && img.alt_text && (
          <span className="absolute top-1.5 left-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold text-white leading-none pointer-events-none backdrop-blur-sm">
            ALT
          </span>
        )}
        {isReady && img.social_platform && (
          <span className="absolute top-1.5 right-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold text-white uppercase tracking-wide leading-none pointer-events-none backdrop-blur-sm">
            {img.social_platform.replace(/_/g, " ")}
          </span>
        )}
        {!isLoading && !isFailed && !isReady && (
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}

        {/* Hover action overlay */}
        {isReady && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-2.5 gap-1.5">
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 rounded-lg bg-white/15 backdrop-blur-sm border border-white/20 px-2 py-1.5 text-xs font-medium text-white hover:bg-white/25 transition-colors"
              >
                <Download className="h-3 w-3" /> Save
              </button>
              <button
                onClick={() => onUse(img)}
                className="flex items-center gap-1 rounded-lg bg-white/15 backdrop-blur-sm border border-white/20 px-2 py-1.5 text-xs font-medium text-white hover:bg-white/25 transition-colors"
              >
                <LinkIcon className="h-3 w-3" /> Use
              </button>
              <Link
                href={`/${projectId}/images/edit/${img.id}`}
                className="flex items-center gap-1 rounded-lg bg-primary/80 backdrop-blur-sm px-2 py-1.5 text-xs font-medium text-white hover:bg-primary/90 transition-colors"
              >
                <PencilLine className="h-3 w-3" /> Edit
              </Link>
              <button
                onClick={onRegenerate}
                className="ml-auto flex items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm border border-white/20 h-7 w-7 text-white hover:bg-white/25 transition-colors"
                title="Regenerate"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {/* Fallback actions for non-ready states */}
        {!isReady && !isLoading && (
          <button
            onClick={onRegenerate}
            className="absolute bottom-2 right-2 flex items-center justify-center rounded-lg bg-background/80 border border-border h-7 w-7 text-muted-foreground hover:text-foreground transition-colors"
            title="Regenerate"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Prompt preview */}
      <div className="px-3 py-2">
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {img.prompt || "—"}
        </p>
      </div>
    </div>
  );
}
