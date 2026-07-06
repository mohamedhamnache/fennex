"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Folder, FolderOpen, Plus, Trash2, X, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { listImageFolders, createImageFolder, deleteImageFolder, type ImageFolder } from "@/lib/api";

interface FolderSidebarProps {
  activeFolderId: string | null;
  onFolderSelect: (id: string | null) => void;
}

export function FolderSidebar({ activeFolderId, onFolderSelect }: FolderSidebarProps) {
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: folders = [] } = useQuery<ImageFolder[]>({
    queryKey: ["image-folders"],
    queryFn: listImageFolders,
  });

  const createMutation = useMutation({
    mutationFn: () => createImageFolder(newName.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["image-folders"] });
      qc.invalidateQueries({ queryKey: ["images"] });
      setNewName("");
      setAdding(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteImageFolder(id),
    onSuccess: (_, deletedId) => {
      qc.invalidateQueries({ queryKey: ["image-folders"] });
      qc.invalidateQueries({ queryKey: ["images"] });
      setConfirmingId(null);
      if (activeFolderId === deletedId) onFolderSelect(null);
    },
  });

  function handleDeleteClick(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setConfirmingId(id);
  }

  function handleConfirmDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    deleteMutation.mutate(id);
  }

  function handleCancelDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmingId(null);
  }

  return (
    <aside className="w-48 shrink-0 border-r border-border bg-card flex flex-col">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          Folders
        </span>
        <button
          type="button"
          onClick={() => { setAdding(true); setConfirmingId(null); }}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="New folder"
          title="New folder"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* All images row */}
        <button
          type="button"
          onClick={() => { onFolderSelect(null); setConfirmingId(null); }}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors text-left",
            activeFolderId === null
              ? "bg-primary/10 text-primary font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
          )}
        >
          <Folder className="h-3.5 w-3.5 shrink-0" />
          <span>All Images</span>
        </button>

        {folders.length > 0 && (
          <div className="mx-3 my-1 border-t border-border" />
        )}

        {folders.map((f) => (
          <div key={f.id}>
            {confirmingId === f.id ? (
              /* Inline confirmation */
              <div
                className="mx-2 my-1 rounded-lg border border-destructive/40 bg-destructive/5 px-2 py-2"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="text-[11px] text-foreground font-medium mb-0.5">
                  Delete &quot;{f.name}&quot;?
                </p>
                <p className="text-[10px] text-muted-foreground mb-2">
                  All images in this folder will also be deleted.
                </p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={(e) => handleConfirmDelete(e, f.id)}
                    disabled={deleteMutation.isPending}
                    className="flex-1 flex items-center justify-center gap-1 rounded bg-destructive text-white text-[11px] py-1 hover:bg-destructive/90 transition-colors disabled:opacity-60"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelDelete}
                    className="flex-1 flex items-center justify-center gap-1 rounded border border-border text-[11px] py-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <X className="h-2.5 w-2.5" />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                className={cn(
                  "group flex items-center gap-2 px-3 py-2 text-xs transition-colors",
                  activeFolderId === f.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                )}
              >
                <button
                  type="button"
                  onClick={() => onFolderSelect(f.id)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                >
                  {activeFolderId === f.id ? (
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <Folder className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="truncate">{f.name}</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => handleDeleteClick(e, f.id)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all shrink-0"
                  aria-label={`Delete folder ${f.name}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        ))}

        {/* New folder inline input */}
        {adding && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) createMutation.mutate();
            }}
            className="px-2 py-2"
          >
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
                placeholder="Folder name"
                className="flex-1 min-w-0 rounded border border-primary/40 bg-input px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <button
                type="submit"
                disabled={!newName.trim() || createMutation.isPending}
                className="p-1 rounded text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
                aria-label="Create folder"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => { setAdding(false); setNewName(""); }}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label="Cancel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </form>
        )}
      </div>
    </aside>
  );
}
