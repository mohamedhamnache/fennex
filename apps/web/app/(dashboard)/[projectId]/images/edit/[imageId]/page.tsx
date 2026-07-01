"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, PencilLine } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getImage, type GeneratedImage } from "@/lib/api";
import { EditToolsSidebar } from "@/components/studio/edit/EditToolsSidebar";
import { EditCanvas, type EditCanvasRef } from "@/components/studio/edit/EditCanvas";
import { EditControlsPanel } from "@/components/studio/edit/EditControlsPanel";
import { VersionStrip } from "@/components/studio/edit/VersionStrip";

export default function EditPage({
  params,
}: {
  params: { projectId: string; imageId: string };
}) {
  const { projectId, imageId } = params;
  const router = useRouter();
  const canvasRef = useRef<EditCanvasRef>(null);

  const [selectedTool, setSelectedTool] = useState<string>("crop");
  const [versions, setVersions] = useState<GeneratedImage[]>([]);

  const { data: sourceImage, isLoading } = useQuery<GeneratedImage>({
    queryKey: ["image", imageId],
    queryFn: () => getImage(imageId),
  });

  function handleVersionAdded(img: GeneratedImage) {
    setVersions((prev) => [...prev, img]);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (!sourceImage) {
    return (
      <div className="flex items-center justify-center h-full text-destructive text-sm">
        Image not found.
      </div>
    );
  }

  const displayImage =
    versions.length > 0 ? versions[versions.length - 1] : sourceImage;

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 60px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push(`/${projectId}/images/studio`)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Studio
          </button>
          <span className="text-muted-foreground/40">/</span>
          <div className="flex items-center gap-2">
            <PencilLine className="h-4 w-4 text-primary" strokeWidth={1.8} />
            <span className="text-sm font-semibold text-foreground">Edit Image</span>
          </div>
        </div>
      </div>

      {/* Three-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left — tool picker */}
        <div className="w-[220px] shrink-0 border-r border-border overflow-y-auto">
          <EditToolsSidebar selected={selectedTool} onSelect={setSelectedTool} />
        </div>

        {/* Center — canvas */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <EditCanvas
              ref={canvasRef}
              imageUrl={displayImage.image_url ?? ""}
              tool={selectedTool}
            />
          </div>
          {/* Version strip at bottom of canvas */}
          <div className="shrink-0 border-t border-border">
            <VersionStrip
              source={sourceImage}
              versions={versions}
            />
          </div>
        </div>

        {/* Right — controls */}
        <div className="w-[300px] shrink-0 border-l border-border overflow-y-auto">
          <EditControlsPanel
            tool={selectedTool}
            imageId={imageId}
            canvasRef={canvasRef}
            onVersionAdded={handleVersionAdded}
          />
        </div>
      </div>
    </div>
  );
}
