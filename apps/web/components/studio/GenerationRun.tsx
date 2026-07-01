"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import type { GeneratedImage } from "@/lib/api";
import { ResultCard } from "./ResultCard";

interface GenerationRunProps {
  prompt: string;
  images: GeneratedImage[];
  batchCount: number;
  projectId: string;
  onUse: (image: GeneratedImage) => void;
  onRegenerate: (index: number) => void;
}

export function GenerationRun({ prompt, images, batchCount, projectId, onUse, onRegenerate }: GenerationRunProps) {
  const [expanded, setExpanded] = useState(false);

  const gridCols =
    batchCount === 1 ? "grid-cols-1" :
    batchCount === 2 ? "grid-cols-2" :
    "grid-cols-2";

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Collapsed header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors text-left"
      >
        {/* Thumbnails strip */}
        <div className="flex gap-1 shrink-0">
          {images.slice(0, 4).map((img, i) => (
            img.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={img.image_url}
                alt=""
                className="h-8 w-8 rounded object-cover border border-border"
              />
            ) : (
              <div key={i} className="h-8 w-8 rounded bg-muted border border-border" />
            )
          ))}
        </div>
        <span className="flex-1 text-xs text-muted-foreground truncate">{prompt || "—"}</span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
        />
      </button>

      {/* Expanded grid */}
      {expanded && (
        <div className={cn("grid gap-3 p-4 border-t border-border", gridCols)}>
          {images.map((img, i) => (
            <ResultCard
              key={img.id}
              image={img}
              projectId={projectId}
              onUse={onUse}
              onRegenerate={() => onRegenerate(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
