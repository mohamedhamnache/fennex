"use client";

import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { GeneratedImage } from "@/lib/api";
import { ResultCard } from "./ResultCard";
import { GenerationRun } from "./GenerationRun";

interface PastRun {
  prompt: string;
  images: GeneratedImage[];
  batchCount: number;
}

interface StudioRightPanelProps {
  currentImages: (GeneratedImage | null)[];
  batchCount: 1 | 2 | 4;
  pastRuns: PastRun[];
  onUse: (image: GeneratedImage) => void;
  onRegenerate: (index: number) => void;
  onPastRegenerate: (runIndex: number, imageIndex: number) => void;
  onOpenTemplates: () => void;
}

export function StudioRightPanel({
  currentImages,
  batchCount,
  pastRuns,
  onUse,
  onRegenerate,
  onPastRegenerate,
  onOpenTemplates,
}: StudioRightPanelProps) {
  const hasCurrentImages = currentImages.length > 0;

  const gridCols =
    batchCount === 1 ? "grid-cols-1 max-w-sm mx-auto" :
    batchCount === 2 ? "grid-cols-2" :
    "grid-cols-2";

  return (
    <div className="flex flex-col gap-6 p-6 overflow-y-auto h-full">
      {/* Empty state */}
      {!hasCurrentImages && pastRuns.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 h-full min-h-[400px] text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <ImageIcon className="h-7 w-7 text-muted-foreground/60" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Image Studio</p>
            <p className="mt-1 text-xs text-muted-foreground max-w-xs">
              Configure your prompt on the left and click Generate to create images.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenTemplates}
            className="text-xs text-primary hover:underline font-medium"
          >
            ✨ Try a template →
          </button>
        </div>
      )}

      {/* Current generation results */}
      {hasCurrentImages && (
        <div className={cn("grid gap-4 w-full", gridCols)}>
          {currentImages.map((img, i) => (
            <ResultCard
              key={img?.id ?? `skeleton-${i}`}
              image={img}
              onUse={onUse}
              onRegenerate={() => onRegenerate(i)}
            />
          ))}
        </div>
      )}

      {/* Past runs (session history) */}
      {pastRuns.length > 0 && (
        <div className="flex flex-col gap-3">
          {hasCurrentImages && (
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">Previous runs</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          )}
          {pastRuns.map((run, ri) => (
            <GenerationRun
              key={ri}
              prompt={run.prompt}
              images={run.images}
              batchCount={run.batchCount}
              onUse={onUse}
              onRegenerate={(ii) => onPastRegenerate(ri, ii)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
