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
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      {/* Image area */}
      <div className="relative aspect-square bg-muted">
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
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        {isReady && img.alt_text && (
          <span
            title={img.alt_text}
            className="absolute top-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium text-white leading-none pointer-events-none"
          >
            ALT
          </span>
        )}
        {isReady && img.social_platform && (
          <span className="absolute top-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-white uppercase tracking-wide leading-none pointer-events-none">
            {img.social_platform.replace(/_/g, " ")}
          </span>
        )}
        {!isLoading && !isFailed && !isReady && (
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}
      </div>

      {/* Prompt preview */}
      <div className="px-3 pt-2.5 pb-1">
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {img.prompt || "—"}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 px-3 pb-3 pt-1.5">
        <button
          onClick={handleDownload}
          disabled={!isReady}
          className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="h-3 w-3" /> Download
        </button>
        <button
          onClick={() => onUse(img)}
          disabled={!isReady}
          className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <LinkIcon className="h-3 w-3" /> Use
        </button>
        {isReady && (
          <Link
            href={`/${projectId}/images/edit/${img.id}`}
            className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <PencilLine className="h-3 w-3" /> Edit
          </Link>
        )}
        <button
          onClick={onRegenerate}
          className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Regenerate"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
