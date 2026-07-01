"use client";

import { cn } from "@/lib/cn";
import type { GeneratedImage } from "@/lib/api";

interface VersionStripProps {
  source: GeneratedImage;
  versions: GeneratedImage[];
  /** Index into [source, ...versions]; 0 = source */
  historyIdx: number;
  onSelect: (idx: number) => void;
}

export function VersionStrip({ source, versions, historyIdx, onSelect }: VersionStripProps) {
  const all = [source, ...versions];

  return (
    <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto">
      <span className="text-xs text-muted-foreground shrink-0">History:</span>
      {all.map((img, i) => (
        <button
          key={img.id}
          type="button"
          onClick={() => onSelect(i)}
          className="relative shrink-0 group focus:outline-none"
          title={i === 0 ? "Original" : (img.edit_operation?.replace(/_/g, " ") ?? `v${i}`)}
        >
          {img.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img.image_url}
              alt={i === 0 ? "Original" : `Edit ${i}`}
              className={cn(
                "h-12 w-12 rounded object-cover border-2 transition-all",
                i === historyIdx
                  ? "border-primary shadow-md ring-1 ring-primary/30"
                  : "border-border opacity-60 hover:opacity-100 hover:border-muted-foreground",
              )}
            />
          ) : (
            <div className={cn("h-12 w-12 rounded bg-muted border-2", i === historyIdx ? "border-primary" : "border-border")} />
          )}
          <div className="absolute -bottom-5 left-0 right-0 text-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {i === 0 ? "Original" : (img.edit_operation?.replace(/_/g, " ") ?? `v${i}`)}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
