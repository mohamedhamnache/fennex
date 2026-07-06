"use client";

import { useState } from "react";
import { X, Loader2, Crop, Check, Download, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { resizeToPlatforms, type GeneratedImage } from "@/lib/api";

const PLATFORMS: { id: string; label: string; size: string }[] = [
  { id: "instagram_post",   label: "Instagram Post",   size: "1080×1080" },
  { id: "instagram_story",  label: "Instagram Story",  size: "1080×1920" },
  { id: "instagram_reel",   label: "Instagram Reel",   size: "1080×1920" },
  { id: "youtube_thumbnail",label: "YouTube Thumbnail",size: "1280×720"  },
  { id: "linkedin_post",    label: "LinkedIn Post",    size: "1200×627"  },
  { id: "linkedin_banner",  label: "LinkedIn Banner",  size: "1584×396"  },
  { id: "facebook_ad",      label: "Facebook Ad",      size: "1200×628"  },
  { id: "tiktok_cover",     label: "TikTok Cover",     size: "1080×1920" },
  { id: "pinterest_pin",    label: "Pinterest Pin",    size: "1000×1500" },
];

const LABEL: Record<string, string> = Object.fromEntries(PLATFORMS.map((p) => [p.id, p.label]));

interface ResizeModalProps {
  imageId: string;
  imageUrl?: string | null;
  onClose: () => void;
  onCreated?: () => void;
}

export function ResizeModal({ imageId, imageUrl, onClose, onCreated }: ResizeModalProps) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(["instagram_post", "instagram_story", "linkedin_post", "facebook_ad"]),
  );
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GeneratedImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function handleResize() {
    if (selected.size === 0 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const imgs = await resizeToPlatforms(imageId, [...selected]);
      setResults(imgs);
      onCreated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resize failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Crop className="h-4 w-4" strokeWidth={1.8} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Resize for all platforms</h2>
              <p className="text-xs text-muted-foreground">Cover-fit crops saved to your library, ready to publish.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {results ? (
            /* Results */
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                {results.length} size{results.length === 1 ? "" : "s"} created and saved to your library.
              </div>
              <div className="grid grid-cols-3 gap-3">
                {results.map((img) => (
                  <div key={img.id} className="rounded-lg border border-border overflow-hidden bg-background">
                    <div className="aspect-square bg-muted">
                      {img.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img.image_url} alt={img.social_platform ?? ""} className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="p-2 flex flex-col gap-1">
                      <span className="text-[10px] font-medium text-foreground truncate">
                        {LABEL[img.social_platform ?? ""] ?? img.social_platform}
                      </span>
                      <span className="text-[9px] text-muted-foreground tabular-nums">{img.width}×{img.height}</span>
                      {img.image_url && (
                        <a href={img.image_url} download target="_blank" rel="noreferrer"
                          className="flex items-center gap-1 text-[10px] text-primary hover:underline">
                          <Download className="h-3 w-3" /> Download
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Platform picker */
            <div className="flex flex-col gap-3">
              {imageUrl && (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl} alt="Source" className="h-12 w-12 rounded object-cover border border-border" />
                  <span className="text-xs text-muted-foreground">Source image — pick the sizes to generate.</span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {PLATFORMS.map((p) => {
                  const on = selected.has(p.id);
                  return (
                    <button key={p.id} type="button" onClick={() => toggle(p.id)}
                      className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                        on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                      <span className={cn("flex h-4 w-4 items-center justify-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                        {on && <Check className="h-3 w-3" />}
                      </span>
                      <span className="flex-1 text-xs font-medium">{p.label}</span>
                      <span className="text-[10px] tabular-nums text-muted-foreground">{p.size}</span>
                    </button>
                  );
                })}
              </div>
              {error && (
                <p className="flex items-center gap-1.5 text-xs text-destructive"><AlertCircle className="h-3.5 w-3.5" /> {error}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border p-4 flex justify-end gap-2">
          {results ? (
            <button type="button" onClick={onClose} className="btn-primary px-4 py-2 text-sm">Done</button>
          ) : (
            <>
              <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors">
                Cancel
              </button>
              <button type="button" disabled={selected.size === 0 || loading} onClick={handleResize}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-50 flex items-center gap-2">
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Resizing…</> : `Create ${selected.size} size${selected.size === 1 ? "" : "s"}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
