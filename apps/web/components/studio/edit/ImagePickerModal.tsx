"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Upload, ImageIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { listImages, uploadImage, type GeneratedImage } from "@/lib/api";

interface ImagePickerModalProps {
  projectId: string;
  onSelect: (imageUrl: string, name: string, aspectRatio: number) => void;
  onClose: () => void;
}

function loadImageAspectRatio(src: string): Promise<number> {
  return new Promise((resolve) => {
    const el = new window.Image();
    el.onload = () => resolve(el.naturalWidth / (el.naturalHeight || 1));
    el.onerror = () => resolve(1);
    el.src = src;
  });
}

export function ImagePickerModal({ projectId, onSelect, onClose }: ImagePickerModalProps) {
  const [tab, setTab] = useState<"gallery" | "upload">("gallery");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: images = [], isLoading } = useQuery<GeneratedImage[]>({
    queryKey: ["images", projectId],
    queryFn: () => listImages(projectId),
  });

  async function handleImageSelect(img: GeneratedImage) {
    if (!img.image_url) return;
    const ar = await loadImageAspectRatio(img.image_url);
    onSelect(img.image_url, img.prompt.slice(0, 40) || "Image", ar);
  }

  async function handleFileUpload(file: File) {
    setUploading(true);
    try {
      const uploaded = await uploadImage(projectId, file);
      if (uploaded.image_url) {
        const ar = await loadImageAspectRatio(uploaded.image_url);
        onSelect(uploaded.image_url, file.name || "Uploaded", ar);
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-[600px] max-h-[80vh] flex flex-col rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-foreground">Add Image Layer</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          {(["gallery", "upload"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 py-2.5 text-sm font-medium capitalize transition-colors border-b-2",
                tab === t
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 min-h-[240px]">
          {tab === "gallery" ? (
            isLoading ? (
              <div className="grid grid-cols-4 gap-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="aspect-square rounded-lg bg-muted animate-pulse" />
                ))}
              </div>
            ) : images.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
                <ImageIcon className="h-8 w-8 opacity-40" />
                <span className="text-sm">No images in this project yet.</span>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-3">
                {images
                  .filter((img) => img.image_url && img.status === "ready")
                  .map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => handleImageSelect(img)}
                      className="aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-primary transition-all focus:outline-none focus:border-primary hover:scale-[1.03]"
                      title={img.prompt}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.thumbnail_url || img.image_url || ""}
                        alt={img.prompt}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-40 gap-4">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className={cn(
                  "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-12 py-8 transition-colors",
                  uploading
                    ? "border-border text-muted-foreground opacity-50 cursor-not-allowed"
                    : "border-border text-muted-foreground hover:border-primary hover:text-primary cursor-pointer",
                )}
              >
                <Upload className="h-8 w-8" />
                <span className="text-sm font-medium">
                  {uploading ? "Uploading..." : "Click to upload an image"}
                </span>
                <span className="text-xs text-muted-foreground">PNG, JPG, WebP</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                  e.target.value = "";
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
