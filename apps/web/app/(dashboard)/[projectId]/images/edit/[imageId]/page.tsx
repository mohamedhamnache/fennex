"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { ArrowLeft, PencilLine, Undo2, Redo2, Sparkles, Eye, Download, BarChart3, Check, SlidersHorizontal, Keyboard, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { getImage, uploadImage, type GeneratedImage } from "@/lib/api";
import { EditToolsSidebar } from "@/components/studio/edit/EditToolsSidebar";
import { EditCanvas, type EditCanvasRef, type Layer, type TextLayer, type ImageLayer } from "@/components/studio/edit/EditCanvas";
import { EditControlsPanel } from "@/components/studio/edit/EditControlsPanel";
import { AiChatPanel } from "@/components/studio/edit/AiChatPanel";
import { VersionStrip } from "@/components/studio/edit/VersionStrip";
import { SeoPanel } from "@/components/studio/edit/SeoPanel";
import { ScorePanel } from "@/components/studio/edit/ScorePanel";
import { ExportModal } from "@/components/studio/edit/ExportModal";

export default function EditPage({
  params,
}: {
  params: { projectId: string; imageId: string };
}) {
  const { projectId, imageId } = params;
  const { t } = useTranslation();
  const router = useRouter();
  const canvasRef = useRef<EditCanvasRef>(null);

  const [selectedTool, setSelectedTool] = useState<string>("crop");
  const [versions, setVersions] = useState<GeneratedImage[]>([]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const [rotationAngle, setRotationAngle] = useState(0);
  const [previewFilter, setPreviewFilter] = useState("");
  const [rightTab, setRightTab] = useState<"edit" | "assistant">("edit");
  const [showInsights, setShowInsights] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [cropAspect, setCropAspect] = useState<number | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showExport, setShowExport] = useState(false);

  // Layer state
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [isBurning, setIsBurning] = useState(false);
  const [burnError, setBurnError] = useState<string | null>(null);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [hideBaseImage, setHideBaseImage] = useState(false);

  useEffect(() => {
    if (selectedTool !== "rotate") setRotationAngle(0);
    if (selectedTool !== "crop") setCropAspect(null);
  }, [selectedTool]);

  useEffect(() => {
    setRotationAngle(0);
    setHideBaseImage(false);
  }, [historyIdx]);

  const { data: sourceImage, isLoading } = useQuery<GeneratedImage>({
    queryKey: ["image", imageId],
    queryFn: () => getImage(imageId),
  });

  const displayImage =
    historyIdx === 0 ? sourceImage : (versions[historyIdx - 1] ?? sourceImage);

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
    const newIdx = versions.length + 1;
    setVersions((prev) => [...prev, img]);
    setHistoryIdx(newIdx);
  }

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
        setHistoryIdx((prev) => Math.min(versions.length, prev + 1));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [versions.length]);

  function handleDuplicateLayer(id: string) {
    const src = layers.find((l) => l.id === id);
    if (!src) return;
    const newId = `dup-${Date.now()}`;
    const copy = { ...src, id: newId, xPct: src.xPct + 2, yPct: src.yPct + 2 } as Layer;
    setLayers((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
    setSelectedLayerId(newId);
  }

  type AlignMode = "left" | "centerX" | "right" | "top" | "middleY" | "bottom";

  function handleAlignLayer(id: string, align: AlignMode) {
    const layer = layers.find((l) => l.id === id);
    const disp = canvasRef.current?.getDisplayedSize();
    if (!layer || !disp) return;

    // Layer extents as canvas percentages
    let wPct = 0, hPct = 0;
    if (layer.type === "image") {
      wPct = layer.widthPct;
      const wpx = (layer.widthPct / 100) * disp.width;
      const hpx = layer.aspectRatio > 0 ? wpx / layer.aspectRatio : wpx;
      hPct = (hpx / disp.height) * 100;
    } else {
      // Measure the rendered text so centring is accurate
      const c = document.createElement("canvas");
      const ctx = c.getContext("2d");
      if (ctx) {
        const text = layer.uppercase ? layer.text.toUpperCase() : layer.text;
        ctx.font = `${layer.italic ? "italic " : ""}${layer.bold ? "bold " : ""}${layer.fontSize}px ${layer.fontFamily}`;
        const spacing = (layer.letterSpacing ?? 0) * Math.max(0, text.length - 1);
        const padX = layer.bgColor ? layer.fontSize * 0.6 : 12;
        wPct = ((ctx.measureText(text).width + spacing + padX) / disp.width) * 100;
        hPct = ((layer.fontSize * 1.2 + (layer.bgColor ? layer.fontSize * 0.36 : 4)) / disp.height) * 100;
      }
    }

    const patch: { xPct?: number; yPct?: number } = {};
    if (align === "left") patch.xPct = 0;
    else if (align === "centerX") patch.xPct = 50 - wPct / 2;
    else if (align === "right") patch.xPct = 100 - wPct;
    else if (align === "top") patch.yPct = 0;
    else if (align === "middleY") patch.yPct = 50 - hPct / 2;
    else if (align === "bottom") patch.yPct = 100 - hPct;
    handleUpdateLayer(id, patch);
  }

  // Layer keyboard controls: Delete, Ctrl+D duplicate, arrow-key nudge
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (!selectedLayerId) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        handleRemoveLayer(selectedLayerId);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        handleDuplicateLayer(selectedLayerId);
        return;
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 2 : 0.4;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        setLayers((prev) => prev.map((l) => l.id === selectedLayerId ? { ...l, xPct: l.xPct + dx, yPct: l.yPct + dy } : l));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }); // re-bind every render so handlers see fresh layers

  // "?" toggles the shortcuts overlay, Escape closes it
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.key === "?") setShowShortcuts((v) => !v);
      if (e.key === "Escape") setShowShortcuts(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Layer handlers ─────────────────────────────────────────────────────────

  function handleAddTextLayer(layer: Omit<TextLayer, "id">) {
    const newLayer: TextLayer = { ...layer, id: `t-${Date.now()}` };
    setLayers((prev) => [...prev, newLayer]);
    setSelectedLayerId(newLayer.id);
  }

  function handleAddImageLayer(imageUrl: string, name: string, aspectRatio: number, widthPct = 50) {
    // Center the new layer on the canvas given its aspect-derived height
    const disp = canvasRef.current?.getDisplayedSize();
    const canvasAr = disp?.width && disp?.height ? disp.width / disp.height : 1;
    const heightFrac = aspectRatio > 0 ? (widthPct / 100) * (canvasAr / aspectRatio) : widthPct / 100;
    const newLayer: ImageLayer = {
      id: `img-${Date.now()}`,
      type: "image",
      imageUrl,
      name,
      xPct: Math.max(0, 50 - widthPct / 2),
      yPct: Math.max(0, 50 - (heightFrac * 100) / 2),
      widthPct,
      aspectRatio,
      opacity: 1,
      visible: true,
    };
    setLayers((prev) => [...prev, newLayer]);
    setSelectedLayerId(newLayer.id);
  }

  function handleRemoveLayer(id: string) {
    setLayers((prev) => prev.filter((l) => l.id !== id));
    if (selectedLayerId === id) setSelectedLayerId(null);
    if (editingLayerId === id) setEditingLayerId(null);
  }

  function handleLayerMove(id: string, xPct: number, yPct: number) {
    setLayers((prev) => prev.map((l) => l.id === id ? { ...l, xPct, yPct } : l));
  }

  function handleLayerResize(id: string, patch: { widthPct: number; heightPct?: number; xPct?: number; yPct?: number }) {
    setLayers((prev) => prev.map((l) => l.id === id ? { ...l, ...patch } : l));
  }

  function handleUpdateLayer(id: string, patch: Partial<TextLayer> | Partial<ImageLayer>) {
    setLayers((prev) => prev.map((l) => l.id === id ? { ...l, ...patch } as Layer : l));
  }

  function handleMoveLayerUp(id: string) {
    setLayers((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }

  function handleMoveLayerDown(id: string) {
    setLayers((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx], next[idx - 1]] = [next[idx - 1], next[idx]];
      return next;
    });
  }

  function handleMoveLayerToFront(id: string) {
    setLayers((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      if (idx === prev.length - 1) return prev;
      const next = [...prev];
      const [layer] = next.splice(idx, 1);
      next.push(layer);
      return next;
    });
  }

  function handleMoveLayerToBack(id: string) {
    setLayers((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      if (idx === 0) return prev;
      const next = [...prev];
      const [layer] = next.splice(idx, 1);
      next.unshift(layer);
      return next;
    });
  }

  function handleToggleLayerVisible(id: string) {
    setLayers((prev) => prev.map((l) => l.id === id ? { ...l, visible: l.visible === false ? true : false } : l));
  }

  function handleStartEdit(id: string) {
    setSelectedLayerId(id);
    setEditingLayerId(id);
  }

  function handleEditText(id: string, text: string) {
    setLayers((prev) => prev.map((l) => l.id === id ? { ...l, text } as Layer : l));
  }

  function handleFinishEdit() {
    setEditingLayerId(null);
  }

  // ── Burn layers onto base image ────────────────────────────────────────────

  function loadImg(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load: ${src}`));
      img.src = src;
    });
  }

  async function handleBurnLayers() {
    if (layers.length === 0) return;
    setIsBurning(true);
    setBurnError(null);

    try {
      const baseUrl = displayImage?.image_url ?? "";
      const baseImg = baseUrl ? await loadImg(baseUrl) : null;
      const canvas = document.createElement("canvas");
      canvas.width = baseImg?.naturalWidth ?? 1024;
      canvas.height = baseImg?.naturalHeight ?? 1024;
      const ctx = canvas.getContext("2d")!;
      // Only draw the base image if it's visible (not replaced by layers)
      if (baseImg && !hideBaseImage) ctx.drawImage(baseImg, 0, 0);

      const displayedSize = canvasRef.current?.getDisplayedSize();
      const scaleX = canvas.width / (displayedSize?.width || canvas.width);
      const scaleY = canvas.height / (displayedSize?.height || canvas.height);

      const visibleLayers = layers.filter((l) => l.visible !== false);

      // Pre-load all image layers in parallel
      const imgLayersData = await Promise.all(
        visibleLayers.map(async (layer) => {
          if (layer.type !== "image") return null;
          try {
            return await loadImg((layer as ImageLayer).imageUrl);
          } catch {
            return null;
          }
        }),
      );

      for (let i = 0; i < visibleLayers.length; i++) {
        const layer = visibleLayers[i];

        if (layer.type === "image") {
          const imgEl = imgLayersData[i];
          if (!imgEl) continue;
          const il = layer as ImageLayer;
          const drawX = (il.xPct / 100) * canvas.width;
          const drawY = (il.yPct / 100) * canvas.height;
          const drawW = (il.widthPct / 100) * canvas.width;
          const drawH = il.heightPct != null
            ? (il.heightPct / 100) * canvas.height
            : (il.aspectRatio > 0 ? drawW / il.aspectRatio : drawW);
          const rotation = il.rotation ?? 0;
          ctx.save();
          ctx.globalAlpha = il.opacity ?? 1;
          if (rotation !== 0) {
            ctx.translate(drawX + drawW / 2, drawY + drawH / 2);
            ctx.rotate((rotation * Math.PI) / 180);
            ctx.drawImage(imgEl, -drawW / 2, -drawH / 2, drawW, drawH);
          } else {
            ctx.drawImage(imgEl, drawX, drawY, drawW, drawH);
          }
          ctx.restore();
        } else if (layer.type === "text") {
          const tl = layer as TextLayer;
          const text = tl.uppercase ? tl.text.toUpperCase() : tl.text;
          const drawX = (tl.xPct / 100) * canvas.width;
          const drawY = (tl.yPct / 100) * canvas.height;
          const scale = Math.min(scaleX, scaleY);
          const scaledSize = Math.round(tl.fontSize * scale);
          const weight = tl.bold ? "bold " : "";
          const style = tl.italic ? "italic " : "";
          ctx.save();
          ctx.globalAlpha = tl.opacity ?? 1;
          ctx.font = `${style}${weight}${scaledSize}px ${tl.fontFamily}`;
          // Letter spacing (supported by modern canvas implementations)
          try {
            (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
              `${(tl.letterSpacing ?? 0) * scale}px`;
          } catch { /* older browsers: spacing skipped on export */ }
          ctx.textBaseline = "top";

          // Background pill — geometry mirrors the DOM's em-based padding
          if (tl.bgColor) {
            const m = ctx.measureText(text);
            const padX = scaledSize * 0.3;
            const padY = scaledSize * 0.18;
            const w = m.width + padX * 2;
            const h = scaledSize * 1.2 + padY * 2;
            const r = Math.min(scaledSize * 0.25, h / 2);
            ctx.fillStyle = tl.bgColor;
            if (typeof ctx.roundRect === "function") {
              ctx.beginPath();
              ctx.roundRect(drawX - padX, drawY - padY, w, h, r);
              ctx.fill();
            } else {
              ctx.fillRect(drawX - padX, drawY - padY, w, h);
            }
          }

          if (tl.shadow ?? true) {
            ctx.shadowColor = "rgba(0,0,0,0.5)";
            ctx.shadowBlur = Math.round(4 * scale);
          }
          if ((tl.outlineWidth ?? 0) > 0) {
            ctx.lineWidth = (tl.outlineWidth ?? 0) * scale;
            ctx.strokeStyle = tl.outlineColor ?? "#000000";
            ctx.lineJoin = "round";
            ctx.strokeText(text, drawX, drawY);
          }
          ctx.fillStyle = tl.color;
          ctx.fillText(text, drawX, drawY);
          ctx.restore();
        }
      }

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))),
          "image/png",
        );
      });

      const uploaded = await uploadImage(projectId, blob);
      handleVersionAdded(uploaded);
      setLayers([]);
      setSelectedLayerId(null);
      setHideBaseImage(false);
    } catch (e) {
      setBurnError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setIsBurning(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading...
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

  const iconBtn = "flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent";

  return (
    <div className="flex flex-col h-full">
      {/* ── Command bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => router.push(`/${projectId}/images/studio`)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft className="h-4 w-4" /> Studio
          </button>
          <span className="text-muted-foreground/40">/</span>
          <div className="flex items-center gap-2 min-w-0">
            <PencilLine className="h-4 w-4 text-primary shrink-0" strokeWidth={1.8} />
            <span className="text-sm font-semibold text-foreground truncate">Edit Image</span>
            {versions.length > 0 && (
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {historyIdx === 0 ? "Original" : `v${historyIdx}`}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Undo / redo group */}
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            <button type="button" onClick={handleUndo} disabled={!canUndo} title={t("imageEdit.toolbar.undo")}
              className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent">
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <div className="h-5 w-px bg-border" />
            <button type="button" onClick={handleRedo} disabled={!canRedo} title={t("imageEdit.toolbar.redo")}
              className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent">
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Hold-to-compare with original */}
          <button
            type="button"
            disabled={historyIdx === 0 || !sourceImage?.image_url}
            onPointerDown={() => setComparing(true)}
            onPointerUp={() => setComparing(false)}
            onPointerLeave={() => setComparing(false)}
            title={t("imageEdit.toolbar.compare")}
            className={cn(iconBtn, comparing && "border-primary bg-primary/10 text-primary")}
          >
            <Eye className="h-3.5 w-3.5" />
          </button>

          {/* Insights (SEO + score) */}
          <button
            type="button"
            onClick={() => setShowInsights((v) => !v)}
            title={t("imageEdit.toolbar.insights")}
            className={cn(iconBtn, showInsights && "border-primary bg-primary/10 text-primary")}
          >
            <BarChart3 className="h-3.5 w-3.5" />
          </button>

          {/* Keyboard shortcuts */}
          <button
            type="button"
            onClick={() => setShowShortcuts((v) => !v)}
            title={t("imageEdit.toolbar.shortcuts")}
            className={cn(iconBtn, showShortcuts && "border-primary bg-primary/10 text-primary")}
          >
            <Keyboard className="h-3.5 w-3.5" />
          </button>

          {/* Export dialog (format / quality / size) */}
          <button
            type="button"
            disabled={!displayImage?.image_url}
            onClick={() => setShowExport(true)}
            title={t("imageEdit.toolbar.export")}
            className={cn(iconBtn, showExport && "border-primary bg-primary/10 text-primary")}
          >
            <Download className="h-3.5 w-3.5" />
          </button>

          <div className="h-5 w-px bg-border mx-0.5" />

          <button
            type="button"
            onClick={() => router.push(`/${projectId}/images`)}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Check className="h-3.5 w-3.5" /> Done
          </button>
        </div>
      </div>

      {/* ── Workspace ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left — tool rail */}
        <div className="w-[210px] shrink-0 border-r border-border overflow-y-auto bg-card/30">
          <EditToolsSidebar selected={selectedTool} onSelect={setSelectedTool} />
        </div>

        {/* Center — stage */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="relative flex-1 overflow-hidden">
            <EditCanvas
              ref={canvasRef}
              imageUrl={displayImage?.image_url ?? ""}
              hideBaseImage={hideBaseImage}
              tool={selectedTool}
              cropAspect={cropAspect}
              rotationAngle={rotationAngle}
              onRotationChange={setRotationAngle}
              previewFilter={previewFilter}
              layers={layers}
              selectedLayerId={selectedLayerId}
              editingLayerId={editingLayerId}
              onLayerMove={handleLayerMove}
              onLayerResize={handleLayerResize}
              onLayerRotate={(id, rotation) => handleUpdateLayer(id, { rotation })}
              onSelectLayer={setSelectedLayerId}
              isProcessing={isAiProcessing}
              onStartEdit={handleStartEdit}
              onEditText={handleEditText}
              onFinishEdit={handleFinishEdit}
            />

            {/* Before/after compare overlay */}
            {comparing && sourceImage?.image_url && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-muted/30 p-10 pointer-events-none animate-fade-in">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sourceImage.image_url} alt="Original" className="max-w-full max-h-full object-contain select-none" />
                <span className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-foreground/80 px-2.5 py-1 text-[10px] font-semibold text-background">
                  Original
                </span>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-border">
            <VersionStrip
              source={sourceImage}
              versions={versions}
              historyIdx={historyIdx}
              onSelect={setHistoryIdx}
            />
          </div>

          {/* Insights drawer — collapsed by default to keep the canvas roomy */}
          {showInsights && (
            <div className="shrink-0 border-t border-border max-h-[42%] overflow-y-auto bg-card/30">
              <SeoPanel imageId={editTargetId} image={displayImage} />
              <ScorePanel imageId={editTargetId} />
            </div>
          )}
        </div>

        {/* Right — tabbed panel: Edit controls / AI assistant */}
        <div className="w-[320px] shrink-0 border-l border-border overflow-hidden flex flex-col">
          <div className="shrink-0 border-b border-border p-1.5 flex gap-1">
            {([
              { id: "edit", label: "Edit", Icon: SlidersHorizontal },
              { id: "assistant", label: "Mirage", Icon: Sparkles },
            ] as const).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setRightTab(id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                  rightTab === id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent",
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.8} /> {t(`imageEdit.tabs.${id}`)}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-hidden">
            {rightTab === "assistant" ? (
              <AiChatPanel imageId={editTargetId} onVersionAdded={handleVersionAdded} />
            ) : (
              <EditControlsPanel
                tool={selectedTool}
                imageId={editTargetId}
                imageUrl={displayImage?.image_url ?? ""}
                projectId={projectId}
                canvasRef={canvasRef}
                onVersionAdded={handleVersionAdded}
                rotationAngle={rotationAngle}
                onRotationChange={setRotationAngle}
                onPreviewChange={setPreviewFilter}
                layers={layers}
                selectedLayerId={selectedLayerId}
                onAddTextLayer={handleAddTextLayer}
                onAddImageLayer={handleAddImageLayer}
                onSetLayers={setLayers}
                onRemoveLayer={handleRemoveLayer}
                onBurnLayers={handleBurnLayers}
                onSelectLayer={setSelectedLayerId}
                onUpdateLayer={handleUpdateLayer}
                onMoveLayerUp={handleMoveLayerUp}
                onMoveLayerDown={handleMoveLayerDown}
                onMoveLayerToFront={handleMoveLayerToFront}
                onMoveLayerToBack={handleMoveLayerToBack}
                onToggleLayerVisible={handleToggleLayerVisible}
                isBurning={isBurning}
                burnError={burnError}
                onProcessingChange={setIsAiProcessing}
                onHideBaseImage={setHideBaseImage}
                cropAspect={cropAspect}
                onCropAspectChange={setCropAspect}
                onDuplicateLayer={handleDuplicateLayer}
                onAlignLayer={handleAlignLayer}
                onRequestTool={setSelectedTool}
              />
            )}
          </div>
        </div>
      </div>

      {/* Export dialog */}
      {showExport && (
        <ExportModal
          imageId={editTargetId}
          originalWidth={displayImage?.width}
          originalHeight={displayImage?.height}
          onClose={() => setShowExport(false)}
        />
      )}

      {/* Keyboard shortcuts overlay */}
      {showShortcuts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={(e) => e.target === e.currentTarget && setShowShortcuts(false)}
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border p-4">
              <div className="flex items-center gap-2">
                <Keyboard className="h-4 w-4 text-primary" strokeWidth={1.8} />
                <h2 className="text-sm font-semibold text-foreground">Keyboard shortcuts</h2>
              </div>
              <button type="button" onClick={() => setShowShortcuts(false)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-2">
              {([
                ["Undo / Redo", "Ctrl+Z / Ctrl+Shift+Z"],
                ["Zoom in / out", "Ctrl + Scroll"],
                ["Pan the canvas", "Space + Drag"],
                ["Nudge selected layer", "Arrow keys"],
                ["Nudge faster", "Shift + Arrows"],
                ["Duplicate layer", "Ctrl+D"],
                ["Delete layer", "Delete"],
                ["Toggle this panel", "?"],
              ] as [string, string][]).map(([action, keys]) => (
                <div key={action} className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">{action}</span>
                  <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground whitespace-nowrap">{keys}</kbd>
                </div>
              ))}
              <p className="mt-1 text-[10px] text-muted-foreground">
                Tip: hold the eye button in the toolbar to compare with the original.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
