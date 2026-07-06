"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Layers, ArrowRight } from "lucide-react";
import { listCollections, type ImageCollection } from "@/lib/api";

export function CollectionsStrip({ projectId }: { projectId: string }) {
  const { data: collections = [] } = useQuery<ImageCollection[]>({
    queryKey: ["collections", projectId],
    queryFn: () => listCollections(projectId),
  });

  if (collections.length === 0) return null;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">Collections</span>
        </div>
        <Link href={`/${projectId}/images/collections`} className="flex items-center gap-1 text-xs text-primary hover:underline">
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {collections.slice(0, 8).map((col) => (
          <Link
            key={col.id}
            href={`/${projectId}/images/collections`}
            className="group shrink-0 w-40 rounded-xl border border-border overflow-hidden bg-card hover:border-primary/50 hover:shadow-md transition-all"
          >
            <div className="relative aspect-[4/3] bg-muted">
              {col.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={col.cover_url} alt={col.name} className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Layers className="h-6 w-6 text-muted-foreground/30" />
                </div>
              )}
              <span className="absolute top-1.5 right-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm">
                {col.image_count}
              </span>
            </div>
            <div className="p-2">
              <p className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors">{col.name}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
