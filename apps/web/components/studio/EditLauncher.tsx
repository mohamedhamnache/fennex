"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Upload, Loader2, ImageIcon, Wand2, Layers } from "lucide-react";
import { cn } from "@/lib/cn";
import { listImages, uploadImage, type GeneratedImage } from "@/lib/api";

interface EditLauncherProps {
  projectId: string;
}

export function EditLauncher({ projectId }: EditLauncherProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: images = [], isLoading } = useQuery<GeneratedImage[]>({
    queryKey: ["images", projectId],
    queryFn: () => listImages(projectId),
  });

  const readyImages = images.filter((i) => i.status === "ready" && i.image_url);

  const openEditor = useCallback(
    (imageId: string) => router.push(`/${projectId}/images/edit/${imageId}`),
    [projectId, router],
  );

  const handleUpload = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      setUploading(true);
      setError(null);
      try {
        const img = await uploadImage(projectId, file);
        openEditor(img.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
        setUploading(false);
      }
    },
    [projectId, openEditor],
  );

  // Create a white canvas of the chosen size and jump straight into the editor
  // (apply a Template there to turn it into a full design).
  const createBlank = useCallback(
    async (w: number, h: number) => {
      if (uploading) return;
      setUploading(true);
      setError(null);
      try {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        const blob = await new Promise<Blob>((resolve, reject) =>
          c.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))), "image/png"),
        );
        const file = new File([blob], `blank-${w}x${h}.png`, { type: "image/png" });
        const img = await uploadImage(projectId, file);
        openEditor(img.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create canvas");
        setUploading(false);
      }
    },
    [projectId, openEditor, uploading],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-10 animate-fade-in">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-foreground">Edit an image</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Upload your own image or pick one from this project — then retouch, remove backgrounds, or convert it to editable layers.
          </p>
        </div>

        {/* Upload dropzone */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => !uploading && fileRef.current?.click()}
          onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !uploading) fileRef.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) handleUpload(file);
          }}
          className={cn(
            "w-full rounded-2xl border-2 border-dashed px-8 py-12 flex flex-col items-center gap-4 transition-colors cursor-pointer",
            isDragOver
              ? "border-primary bg-primary/5 text-primary"
              : "border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/30",
          )}
        >
          <div className={cn(
            "flex h-14 w-14 items-center justify-center rounded-2xl transition-colors",
            isDragOver ? "bg-primary/15" : "bg-muted",
          )}>
            {uploading
              ? <Loader2 className="h-7 w-7 text-primary animate-spin" />
              : <Upload className={cn("h-7 w-7", isDragOver ? "text-primary" : "text-muted-foreground/60")} />}
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-foreground">
              {uploading ? "Uploading…" : isDragOver ? "Drop to upload" : "Upload an image"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              PNG, JPG or WebP — drag &amp; drop or click to browse
            </p>
          </div>
          {/* Capability hints */}
          {!uploading && !isDragOver && (
            <div className="mt-1 flex items-center gap-4 text-[11px] text-muted-foreground/70">
              <span className="flex items-center gap-1"><Wand2 className="h-3 w-3" /> AI retouch</span>
              <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> Convert to layers</span>
            </div>
          )}
        </div>
        {error && <p className="mt-2 text-center text-xs text-destructive">{error}</p>}

        {/* Start from a blank canvas */}
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Or start from a blank canvas
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([
              { label: "Square", hint: "1080 × 1080", w: 1080, h: 1080, ar: 1 },
              { label: "Portrait", hint: "1080 × 1350", w: 1080, h: 1350, ar: 4 / 5 },
              { label: "Story", hint: "1080 × 1920", w: 1080, h: 1920, ar: 9 / 16 },
              { label: "Landscape", hint: "1920 × 1080", w: 1920, h: 1080, ar: 16 / 9 },
            ]).map((s) => (
              <button
                key={s.label}
                type="button"
                disabled={uploading}
                onClick={() => createBlank(s.w, s.h)}
                className="group flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-3 transition-all hover:border-primary/50 hover:shadow-md disabled:opacity-50"
              >
                <div className="flex h-12 items-center justify-center">
                  <div
                    className="rounded-sm border-2 border-muted-foreground/40 bg-muted transition-colors group-hover:border-primary/60"
                    style={{ width: s.ar >= 1 ? 40 : 40 * s.ar, height: s.ar >= 1 ? 40 / s.ar : 40 }}
                  />
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-foreground">{s.label}</p>
                  <p className="text-[10px] text-muted-foreground tabular-nums">{s.hint}</p>
                </div>
              </button>
            ))}
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            You&apos;ll land in the editor — open the Templates tool to drop in a full design.
          </p>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            if (e.target) e.target.value = "";
          }}
        />

        {/* Pick from project */}
        <div className="mt-10">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Or edit one from this project
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {isLoading ? (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : readyImages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-10 text-muted-foreground">
              <ImageIcon className="h-6 w-6 opacity-40" />
              <span className="text-xs">No images in this project yet.</span>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {readyImages.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => openEditor(img.id)}
                  title={img.prompt}
                  className="group relative aspect-square overflow-hidden rounded-xl border-2 border-transparent hover:border-primary transition-all focus:outline-none focus:border-primary"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.thumbnail_url || img.image_url || ""}
                    alt={img.prompt}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-colors">
                    <span className="flex items-center gap-1 rounded-lg bg-background/90 px-2 py-1 text-[10px] font-semibold text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                      <Wand2 className="h-3 w-3 text-primary" /> Edit
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
