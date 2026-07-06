"use client";

import { useState } from "react";
import Link from "next/link";
import { FolderPlus, X, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { createCollection } from "@/lib/api";

interface SaveCollectionButtonProps {
  projectId: string;
  imageIds: string[];
  defaultName?: string;
  className?: string;
}

export function SaveCollectionButton({ projectId, imageIds, defaultName = "", className }: SaveCollectionButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const disabled = imageIds.length === 0;

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const col = await createCollection({ project_id: projectId, name: name.trim(), image_ids: imageIds });
      setSavedId(col.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setName(defaultName); setSavedId(null); setError(null); setOpen(true); }}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors",
          disabled ? "text-muted-foreground/50 cursor-not-allowed" : "text-foreground hover:bg-accent",
          className,
        )}
        title={disabled ? "Generate images first" : "Save these as a collection"}
      >
        <FolderPlus className="h-4 w-4" />
        Save as collection
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h2 className="text-sm font-semibold text-foreground">Save as collection</h2>
              <button type="button" onClick={() => setOpen(false)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4">
              {savedId ? (
                <div className="flex flex-col items-center gap-3 py-2 text-center">
                  <CheckCircle2 className="h-8 w-8 text-green-600" />
                  <p className="text-sm text-foreground">
                    Saved <span className="font-semibold">{name}</span> — {imageIds.length} image{imageIds.length === 1 ? "" : "s"}.
                  </p>
                  <Link
                    href={`/${projectId}/images/collections`}
                    className="text-xs text-primary hover:underline font-medium"
                  >
                    View collections →
                  </Link>
                </div>
              ) : (
                <>
                  <label className="text-xs font-medium text-foreground mb-1.5 block">Collection name</label>
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") save(); }}
                    placeholder="e.g. Summer launch"
                    className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <p className="mt-1.5 text-[11px] text-muted-foreground">{imageIds.length} image{imageIds.length === 1 ? "" : "s"} will be added.</p>
                  {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
                  <div className="mt-4 flex justify-end gap-2">
                    <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent transition-colors">
                      Cancel
                    </button>
                    <button type="button" disabled={!name.trim() || saving} onClick={save}
                      className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50 flex items-center gap-1.5">
                      {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : "Save"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
