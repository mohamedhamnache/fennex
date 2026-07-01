"use client";

import { cn } from "@/lib/cn";
import type { GeneratedImage } from "@/lib/api";

interface VersionStripProps {
  source: GeneratedImage;
  versions: GeneratedImage[];
}

export function VersionStrip({ source, versions }: VersionStripProps) {
  const all = [source, ...versions];

  return (
    <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto">
      <span className="text-xs text-muted-foreground shrink-0">History:</span>
      {all.map((img, i) => (
        <div key={img.id} className="relative shrink-0 group">
          {img.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img.image_url}
              alt={i === 0 ? "Original" : `Edit ${i}`}
              className={cn(
                "h-12 w-12 rounded object-cover border-2 transition-all",
                i === all.length - 1
                  ? "border-primary shadow-sm"
                  : "border-border opacity-70 hover:opacity-100",
              )}
            />
          ) : (
            <div className="h-12 w-12 rounded bg-muted border-2 border-border" />
          )}
          <div className="absolute -bottom-5 left-0 right-0 text-center opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {i === 0 ? "Original" : (img.edit_operation?.replace(/_/g, " ") ?? `v${i}`)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
