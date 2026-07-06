"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Layers, Loader2, Trash2, Pencil, Globe, ImageIcon, ChevronLeft,
} from "lucide-react";
import { useProjectStore } from "@/lib/store";
import {
  listCollections, getCollection, deleteCollection,
  type ImageCollection,
} from "@/lib/api";
import { PublishModal } from "@/components/studio/PublishModal";

export default function CollectionsPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { setCurrentProject } = useProjectStore();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [publishId, setPublishId] = useState<string | null>(null);

  useEffect(() => { setCurrentProject(projectId); }, [projectId, setCurrentProject]);

  const { data: collections = [], isLoading } = useQuery<ImageCollection[]>({
    queryKey: ["collections", projectId],
    queryFn: () => listCollections(projectId),
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["collection", selectedId],
    queryFn: () => getCollection(selectedId!),
    enabled: !!selectedId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCollection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collections", projectId] });
      setSelectedId(null);
    },
  });

  return (
    <div className="flex flex-col h-full -m-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <Link href={`/${projectId}/images`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> Library
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" strokeWidth={1.8} />
            <span className="text-sm font-semibold text-foreground">Collections</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Detail view */}
        {selectedId ? (
          <div>
            <button type="button" onClick={() => setSelectedId(null)} className="mb-4 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="h-3.5 w-3.5" /> All collections
            </button>
            {detailLoading || !detail ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <>
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <h1 className="text-lg font-semibold text-foreground">{detail.name}</h1>
                    <p className="text-xs text-muted-foreground">{detail.images.length} image{detail.images.length === 1 ? "" : "s"}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { if (confirm(`Delete collection "${detail.name}"? The images stay in your library.`)) deleteMutation.mutate(detail.id); }}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
                {detail.images.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-muted-foreground">
                    <ImageIcon className="h-6 w-6 opacity-40" />
                    <span className="text-xs">This collection is empty.</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {detail.images.map((img) => (
                      <div key={img.id} className="rounded-xl border border-border overflow-hidden bg-card">
                        <div className="group relative aspect-square bg-muted">
                          {img.image_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={img.thumbnail_url || img.image_url} alt={img.prompt} className="absolute inset-0 h-full w-full object-cover" />
                          )}
                          <div className="absolute inset-0 flex items-end justify-end gap-1 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Link href={`/${projectId}/images/edit/${img.id}`} className="flex items-center gap-1 rounded-lg bg-background/95 px-2 py-1 text-[10px] font-semibold text-foreground">
                              <Pencil className="h-3 w-3 text-primary" /> Edit
                            </Link>
                            <button type="button" onClick={() => setPublishId(img.id)} className="flex items-center gap-1 rounded-lg bg-background/95 px-2 py-1 text-[10px] font-semibold text-foreground">
                              <Globe className="h-3 w-3 text-primary" /> Publish
                            </button>
                          </div>
                        </div>
                        {img.social_platform && (
                          <div className="px-2 py-1.5">
                            <span className="text-[10px] text-muted-foreground">{img.social_platform.replace(/_/g, " ")}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          /* List view */
          isLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : collections.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                <Layers className="h-7 w-7 text-muted-foreground/50" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">No collections yet</p>
                <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                  Generate a set in AI Studio, Product, or Social — then &ldquo;Save as collection&rdquo; to group it here.
                </p>
              </div>
              <Link href={`/${projectId}/images/studio`} className="btn-primary px-4 py-2 text-sm">Open Studio</Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {collections.map((col) => (
                <button
                  key={col.id}
                  type="button"
                  onClick={() => setSelectedId(col.id)}
                  className="group text-left rounded-xl border border-border overflow-hidden bg-card hover:border-primary/50 hover:shadow-md transition-all"
                >
                  <div className="aspect-[4/3] bg-muted relative">
                    {col.cover_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={col.cover_url} alt={col.name} className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Layers className="h-8 w-8 text-muted-foreground/30" />
                      </div>
                    )}
                    <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                      {col.image_count}
                    </span>
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">{col.name}</p>
                    {col.description && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{col.description}</p>}
                  </div>
                </button>
              ))}
            </div>
          )
        )}
      </div>

      {publishId && <PublishModal imageId={publishId} onClose={() => setPublishId(null)} />}
    </div>
  );
}
