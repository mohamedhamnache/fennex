"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, PencilLine, Undo2, Redo2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
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
  /** 0 = source, 1..n = versions[0..n-1] */
  const [historyIdx, setHistoryIdx] = useState(0);
  const [rotationAngle, setRotationAngle] = useState(0);
  const [previewFilter, setPreviewFilter] = useState("");

  // Reset rotation when switching away from the rotate tool
  useEffect(() => {
    if (selectedTool !== "rotate") setRotationAngle(0);
  }, [selectedTool]);

  // Reset rotation whenever the displayed version changes (Save, Undo, Redo, strip click)
  // so the CSS transform doesn't stack on top of an already-rotated saved image
  useEffect(() => {
    setRotationAngle(0);
  }, [historyIdx]);

  const { data: sourceImage, isLoading } = useQuery<GeneratedImage>({
    queryKey: ["image", imageId],
    queryFn: () => getImage(imageId),
  });

  // The image currently shown in the canvas
  const displayImage =
    historyIdx === 0 ? sourceImage : (versions[historyIdx - 1] ?? sourceImage);

  // The image edits are applied on top of (currently viewed image)
  const editTargetId = displayImage?.id ?? imageId;

  const canUndo = historyIdx > 0;
  const canRedo = historyIdx < versions.length;

  function handleUndo() {
    setHistoryIdx((prev) => Math.max(0, prev - 1));
  }

  function handleRedo() {
    setHistoryIdx((prev) => Math.min(versions.length, prev + 1));
  }

  function handleVersionAdded(img: GeneratedImage) {
    // Append and jump to the new version
    const newIdx = versions.length + 1;
    setVersions((prev) => [...prev, img]);
    setHistoryIdx(newIdx);
  }

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        setHistoryIdx((prev) => Math.max(0, prev - 1));
      }
      if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        // versions.length captured at effect creation — ok because effect
        // re-registers whenever versions.length changes
        setHistoryIdx((prev) => Math.min(versions.length, prev + 1));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [versions.length]);

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

  return (
    <div className="flex flex-col h-full">
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

        {/* Undo / Redo */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className={cn(
              "flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs transition-colors",
              canUndo
                ? "text-foreground hover:bg-accent"
                : "text-muted-foreground/40 cursor-not-allowed",
            )}
          >
            <Undo2 className="h-3.5 w-3.5" />
            <span>Undo</span>
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z)"
            className={cn(
              "flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs transition-colors",
              canRedo
                ? "text-foreground hover:bg-accent"
                : "text-muted-foreground/40 cursor-not-allowed",
            )}
          >
            <Redo2 className="h-3.5 w-3.5" />
            <span>Redo</span>
          </button>
          {versions.length > 0 && (
            <span className="ml-1 text-xs text-muted-foreground">
              {historyIdx === 0 ? "Original" : `v${historyIdx}`}
            </span>
          )}
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
              imageUrl={displayImage?.image_url ?? ""}
              tool={selectedTool}
              rotationAngle={rotationAngle}
              onRotationChange={setRotationAngle}
              previewFilter={previewFilter}
            />
          </div>
          {/* Version strip at bottom of canvas */}
          <div className="shrink-0 border-t border-border">
            <VersionStrip
              source={sourceImage}
              versions={versions}
              historyIdx={historyIdx}
              onSelect={setHistoryIdx}
            />
          </div>
        </div>

        {/* Right — controls */}
        <div className="w-[300px] shrink-0 border-l border-border overflow-hidden">
          <EditControlsPanel
            tool={selectedTool}
            imageId={editTargetId}
            canvasRef={canvasRef}
            onVersionAdded={handleVersionAdded}
            rotationAngle={rotationAngle}
            onRotationChange={setRotationAngle}
            onPreviewChange={setPreviewFilter}
          />
        </div>
      </div>
    </div>
  );
}
