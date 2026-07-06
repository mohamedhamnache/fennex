"use client";

import { useCallback, useRef, useState } from "react";
import { ImageIcon, Upload } from "lucide-react";
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
  projectId: string;
  onUse: (image: GeneratedImage) => void;
  onRegenerate: (index: number) => void;
  onPastRegenerate: (runIndex: number, imageIndex: number) => void;
  onOpenTemplates: () => void;
  onUpload?: (file: File) => void;
}

export function StudioRightPanel({
  currentImages,
  batchCount,
  pastRuns,
  projectId,
  onUse,
  onRegenerate,
  onPastRegenerate,
  onOpenTemplates,
  onUpload,
}: StudioRightPanelProps) {
  const hasCurrentImages = currentImages.length > 0;
  const [isDragOver, setIsDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && (file.type.startsWith("image/") ) && onUpload) onUpload(file);
    },
    [onUpload],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && onUpload) onUpload(file);
      if (e.target) e.target.value = "";
    },
    [onUpload],
  );

  const gridCols =
    batchCount === 1 ? "grid-cols-1 max-w-sm mx-auto" :
    batchCount === 2 ? "grid-cols-2" :
    "grid-cols-4";

  return (
    <div
      className={cn(
        "flex flex-col gap-6 p-6 overflow-y-auto h-full transition-colors",
        isDragOver && "bg-primary/5 ring-2 ring-inset ring-primary/30",
      )}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Upload bar — shown when there are images */}
      {(hasCurrentImages || pastRuns.length > 0) && onUpload && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload image
          </button>
        </div>
      )}

      {/* Empty state */}
      {!hasCurrentImages && pastRuns.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-6 h-full min-h-[400px] text-center">
          {/* Drop zone */}
          <div
            className={cn(
              "w-full max-w-sm rounded-2xl border-2 border-dashed px-8 py-12 flex flex-col items-center gap-4 transition-colors cursor-pointer",
              isDragOver
                ? "border-primary bg-primary/5 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/30",
            )}
            onClick={() => fileRef.current?.click()}
          >
            <div className={cn(
              "flex h-14 w-14 items-center justify-center rounded-2xl transition-colors",
              isDragOver ? "bg-primary/15" : "bg-muted",
            )}>
              {isDragOver
                ? <Upload className="h-7 w-7 text-primary" />
                : <ImageIcon className="h-7 w-7 text-muted-foreground/60" />
              }
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {isDragOver ? "Drop to upload" : "Image Studio"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground max-w-[220px]">
                {isDragOver
                  ? "Release to upload your image"
                  : "Generate images on the left, or drop an image here to edit it"}
              </p>
            </div>
            {!isDragOver && (
              <div className="flex flex-col items-center gap-2 w-full">
                <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">or</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpenTemplates(); }}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  Browse templates
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Current generation results */}
      {hasCurrentImages && (
        <div className={cn("grid gap-4 w-full", gridCols)}>
          {currentImages.map((img, i) => (
            <ResultCard
              key={img?.id ?? `skeleton-${i}`}
              image={img}
              projectId={projectId}
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
              projectId={projectId}
              onUse={onUse}
              onRegenerate={(ii) => onPastRegenerate(ri, ii)}
            />
          ))}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
