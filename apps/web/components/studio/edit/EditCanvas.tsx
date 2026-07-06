"use client";

import {
  forwardRef,
  useRef,
  useEffect,
  useImperativeHandle,
  useState,
  useCallback,
} from "react";
import { RotateCw, Sparkles, Plus, Minus, Maximize2 } from "lucide-react";

const MASK_TOOLS = new Set([
  "replace_background",
  "remove_object",
  "insert_object",
  "generative_fill",
  "smart_erase",
]);

const BRUSH_RADIUS = 20;
const MASK_COLOR = "rgba(255, 80, 80, 0.45)";
const MIN_CROP = 0.02;

export interface TextLayer {
  id: string;
  type: "text";
  text: string;
  xPct: number;
  yPct: number;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  fontFamily: string;
  visible: boolean;
  locked?: boolean;
  // Text effects (all optional — defaults preserve legacy layers)
  opacity?: number;          // 0-1, default 1
  letterSpacing?: number;    // px at the layer's fontSize, default 0
  outlineWidth?: number;     // px, 0 = off
  outlineColor?: string;
  bgColor?: string | null;   // background pill colour, null/undefined = off
  shadow?: boolean;          // drop shadow, default true (legacy behaviour)
  uppercase?: boolean;
}

export interface ImageLayer {
  id: string;
  type: "image";
  imageUrl: string;
  name: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  aspectRatio: number;
  /** Explicit height as % of canvas height. When set, overrides aspect-derived
   *  height and allows free (independent) width/height resizing. */
  heightPct?: number;
  opacity: number;
  visible: boolean;
  rotation?: number;
  locked?: boolean;
}

export type Layer = TextLayer | ImageLayer;

/** Backward-compat alias used in burn function */
export type TextItem = TextLayer;

export interface EditCanvasRef {
  getMaskBase64: () => string | null;
  clearMask: () => void;
  getCropRect: () => { x: number; y: number; w: number; h: number } | null;
  getImageSize: () => { width: number; height: number } | null;
  getDisplayedSize: () => { width: number; height: number } | null;
}

interface EditCanvasProps {
  imageUrl: string;
  hideBaseImage?: boolean;
  tool: string;
  /** Locked crop aspect ratio (w/h in image pixels), or null for freeform. */
  cropAspect?: number | null;
  rotationAngle?: number;
  onRotationChange?: (angle: number) => void;
  previewFilter?: string;
  layers?: Layer[];
  selectedLayerId?: string | null;
  editingLayerId?: string | null;
  onLayerMove?: (id: string, xPct: number, yPct: number) => void;
  onLayerResize?: (id: string, patch: { widthPct: number; heightPct?: number; xPct?: number; yPct?: number }) => void;
  onLayerRotate?: (id: string, rotation: number) => void;
  onSelectLayer?: (id: string | null) => void;
  isProcessing?: boolean;
  onStartEdit?: (id: string) => void;
  onEditText?: (id: string, text: string) => void;
  onFinishEdit?: () => void;
}

interface CropRect { x: number; y: number; w: number; h: number }
type DragHandle = "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function normalizeCrop(r: CropRect): CropRect {
  let { x, y, w, h } = r;
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1), w: clamp(w, 0, 1 - x), h: clamp(h, 0, 1 - y) };
}

export const EditCanvas = forwardRef<EditCanvasRef, EditCanvasProps>(
  function EditCanvas({
    imageUrl,
    hideBaseImage = false,
    tool,
    cropAspect = null,
    rotationAngle = 0,
    onRotationChange,
    previewFilter,
    layers = [],
    selectedLayerId,
    editingLayerId,
    onLayerMove,
    onLayerResize,
    onLayerRotate,
    onSelectLayer,
    isProcessing = false,
    onStartEdit,
    onEditText,
    onFinishEdit,
  }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const maskRef = useRef<HTMLCanvasElement>(null);
    const [painting, setPainting] = useState(false);
    const [isDraggingRotate, setIsDraggingRotate] = useState(false);
    const [canvasRect, setCanvasRect] = useState({ top: 0, left: 0, width: 0, height: 0 });

    // View transform (zoom + pan). The <img> is transformed; every overlay derives
    // from img.getBoundingClientRect(), so the coordinate math stays consistent.
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [spaceHeld, setSpaceHeld] = useState(false);
    const panStartRef = useRef<{ cx: number; cy: number; px: number; py: number } | null>(null);
    const pannedRef = useRef(false);

    // Alignment guides shown while dragging a layer (values are canvas 0-100%).
    const [guides, setGuides] = useState<{ v: number | null; h: number | null }>({ v: null, h: null });

    const layerDragRef = useRef<{
      id: string;
      startClientX: number;
      startClientY: number;
      startXPct: number;
      startYPct: number;
      hasMoved: boolean;
    } | null>(null);

    const resizeDragRef = useRef<{
      id: string;
      handle: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
      startClientX: number;
      startClientY: number;
      startXPct: number;
      startYPct: number;
      startWidthPct: number;
      startHeightPct: number;
    } | null>(null);

    const rotLayerDragRef = useRef<{
      id: string;
      centerX: number;
      centerY: number;
      startAngle: number;
      startRotation: number;
    } | null>(null);

    const needsMask = MASK_TOOLS.has(tool);
    const isCrop = tool === "crop";
    const isRotate = tool === "rotate";

    // ── Canvas sync ────────────────────────────────────────────────────────────

    function syncCanvas() {
      const img = imageRef.current;
      const container = containerRef.current;
      const canvas = maskRef.current;
      if (!img || !container || !canvas) return;
      const imgRect = img.getBoundingClientRect();
      const conRect = container.getBoundingClientRect();
      const top = imgRect.top - conRect.top;
      const left = imgRect.left - conRect.left;
      const { width, height } = imgRect;
      setCanvasRect({ top, left, width, height });
      canvas.width = width;
      canvas.height = height;
    }

    useEffect(() => {
      const observer = new ResizeObserver(syncCanvas);
      if (imageRef.current) observer.observe(imageRef.current);
      if (containerRef.current) observer.observe(containerRef.current);
      return () => observer.disconnect();
    }, []);

    useEffect(() => {
      requestAnimationFrame(syncCanvas);
    }, [tool]);

    // ── Zoom / pan ─────────────────────────────────────────────────────────────

    const clampZoom = (z: number) => Math.min(5, Math.max(0.15, z));
    function zoomBy(f: number) { setZoom((z) => clampZoom(z * f)); }
    function resetView() { setZoom(1); setPan({ x: 0, y: 0 }); }
    function actualSize() {
      const img = imageRef.current;
      if (!img?.naturalWidth || !canvasRect.width) return;
      const baseW = canvasRect.width / zoom; // object-contain fit width at zoom = 1
      if (baseW > 0) setZoom(clampZoom(img.naturalWidth / baseW));
    }

    // CSS transforms don't trigger ResizeObserver — re-measure overlays on change.
    useEffect(() => {
      requestAnimationFrame(syncCanvas);
    }, [zoom, pan.x, pan.y]); // eslint-disable-line react-hooks/exhaustive-deps

    // Ctrl/Cmd + wheel to zoom (native, non-passive so we can block page zoom)
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      function onWheel(e: WheelEvent) {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.1 : 0.9)));
      }
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    }, []);

    // Hold Space to enable pan mode
    useEffect(() => {
      function isTyping(t: EventTarget | null) {
        const el = t as HTMLElement | null;
        return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      }
      function kd(e: KeyboardEvent) { if (e.code === "Space" && !isTyping(e.target)) { e.preventDefault(); setSpaceHeld(true); } }
      function ku(e: KeyboardEvent) { if (e.code === "Space") setSpaceHeld(false); }
      window.addEventListener("keydown", kd);
      window.addEventListener("keyup", ku);
      return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
    }, []);

    // ── Crop state ─────────────────────────────────────────────────────────────

    const [cropRect, setCropRect] = useState<CropRect>({ x: 0, y: 0, w: 1, h: 1 });
    const cropDragHandle = useRef<DragHandle | null>(null);
    const cropDragStart = useRef({ mx: 0, my: 0, crop: { x: 0, y: 0, w: 1, h: 1 } });

    useEffect(() => {
      setCropRect({ x: 0, y: 0, w: 1, h: 1 });
    }, [tool, imageUrl]);

    // When an aspect preset is chosen, seed a centered crop of that ratio.
    useEffect(() => {
      if (!isCrop) return;
      if (!cropAspect) {
        setCropRect({ x: 0, y: 0, w: 1, h: 1 });
        return;
      }
      const { width: W, height: H } = canvasRect;
      if (!W || !H) return;
      // Normalized height per normalized width for this pixel aspect ratio.
      const k = W / (H * cropAspect);
      let w = 0.9, h = w * k;
      if (h > 0.9) { h = 0.9; w = h / k; }
      setCropRect({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
    }, [cropAspect, isCrop]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Rotation state ─────────────────────────────────────────────────────────

    const rotDrag = useRef<{ startMouseAngle: number; startRotation: number } | null>(null);

    function getAngleFromImageCenter(clientX: number, clientY: number): number {
      const conRect = containerRef.current!.getBoundingClientRect();
      const cx = conRect.left + canvasRect.left + canvasRect.width / 2;
      const cy = conRect.top + canvasRect.top + canvasRect.height / 2;
      return Math.atan2(clientY - cy, clientX - cx) * (180 / Math.PI);
    }

    function onRotHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
      rotDrag.current = {
        startMouseAngle: getAngleFromImageCenter(e.clientX, e.clientY),
        startRotation: rotationAngle,
      };
      setIsDraggingRotate(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    }

    function onRotHandlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
      if (!rotDrag.current) return;
      const current = getAngleFromImageCenter(e.clientX, e.clientY);
      let delta = current - rotDrag.current.startMouseAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      let newAngle = rotDrag.current.startRotation + delta;
      if (e.shiftKey) newAngle = Math.round(newAngle / 15) * 15;
      else newAngle = Math.round(newAngle);
      onRotationChange?.(newAngle);
    }

    function onRotHandlePointerUp() {
      rotDrag.current = null;
      setIsDraggingRotate(false);
    }

    // ── Mask painting ──────────────────────────────────────────────────────────

    function getPos(e: React.MouseEvent<HTMLCanvasElement>): [number, number] {
      const canvas = maskRef.current!;
      const rect = canvas.getBoundingClientRect();
      // Map screen coords to the canvas's internal pixel space (correct under zoom).
      const sx = rect.width ? canvas.width / rect.width : 1;
      const sy = rect.height ? canvas.height / rect.height : 1;
      return [(e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy];
    }

    function drawCircle(x: number, y: number) {
      const ctx = maskRef.current?.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = MASK_COLOR;
      ctx.beginPath();
      ctx.arc(x, y, BRUSH_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    const onMaskMouseDown = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!needsMask) return;
        syncCanvas();
        setPainting(true);
        drawCircle(...getPos(e));
      },
      [needsMask],
    );

    const onMaskMouseMove = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!painting || !needsMask) return;
        drawCircle(...getPos(e));
      },
      [painting, needsMask],
    );

    const onMaskMouseUp = useCallback(() => setPainting(false), []);

    // ── Crop interaction ───────────────────────────────────────────────────────

    function normalizedCoords(e: React.PointerEvent<HTMLDivElement>): [number, number] {
      const rect = overlayRef.current!.getBoundingClientRect();
      return [
        clamp((e.clientX - rect.left) / rect.width, 0, 1),
        clamp((e.clientY - rect.top) / rect.height, 0, 1),
      ];
    }

    function getHandleAt(nx: number, ny: number, r: CropRect): DragHandle | null {
      const { x, y, w, h } = r;
      const T = 0.025;
      const inX = (v: number) => Math.abs(nx - v) < T;
      const inY = (v: number) => Math.abs(ny - v) < T;
      const midX = nx > x + T && nx < x + w - T;
      const midY = ny > y + T && ny < y + h - T;
      if (inX(x) && inY(y)) return "nw";
      if (inX(x + w) && inY(y)) return "ne";
      if (inX(x) && inY(y + h)) return "sw";
      if (inX(x + w) && inY(y + h)) return "se";
      if (inY(y) && midX) return "n";
      if (inY(y + h) && midX) return "s";
      if (inX(x) && midY) return "w";
      if (inX(x + w) && midY) return "e";
      if (nx > x + T && nx < x + w - T && ny > y + T && ny < y + h - T) return "move";
      return null;
    }

    const CURSORS: Record<DragHandle, string> = {
      move: "move",
      nw: "nw-resize", ne: "ne-resize", sw: "sw-resize", se: "se-resize",
      n: "n-resize", s: "s-resize", e: "e-resize", w: "w-resize",
    };

    const [cropCursor, setCropCursor] = useState("crosshair");

    function onCropPointerDown(e: React.PointerEvent<HTMLDivElement>) {
      if (!isCrop) return;
      const [nx, ny] = normalizedCoords(e);
      const handle = getHandleAt(nx, ny, cropRect);
      cropDragHandle.current = handle ?? "se";
      cropDragStart.current = { mx: nx, my: ny, crop: { ...cropRect } };
      if (!handle) {
        const snap = { x: nx, y: ny, w: 0, h: 0 };
        setCropRect(snap);
        cropDragStart.current.crop = snap;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    }

    function onCropPointerMove(e: React.PointerEvent<HTMLDivElement>) {
      if (!isCrop) return;
      const [nx, ny] = normalizedCoords(e);
      if (cropDragHandle.current === null) {
        setCropCursor((CURSORS[getHandleAt(nx, ny, cropRect) ?? "move"]) ?? "crosshair");
        return;
      }
      const dx = nx - cropDragStart.current.mx;
      const dy = ny - cropDragStart.current.my;
      const o = cropDragStart.current.crop;
      const handle = cropDragHandle.current;
      setCropRect(() => {
        let { x, y, w, h } = o;
        if (handle === "move") { x = clamp(x + dx, 0, 1 - w); y = clamp(y + dy, 0, 1 - h); }
        else if (handle === "se") { w = clamp(w + dx, MIN_CROP, 1 - x); h = clamp(h + dy, MIN_CROP, 1 - y); }
        else if (handle === "nw") { const nx2 = clamp(x + dx, 0, x + w - MIN_CROP), ny2 = clamp(y + dy, 0, y + h - MIN_CROP); w += x - nx2; h += y - ny2; x = nx2; y = ny2; }
        else if (handle === "ne") { const ny2 = clamp(y + dy, 0, y + h - MIN_CROP); w = clamp(w + dx, MIN_CROP, 1 - x); h += y - ny2; y = ny2; }
        else if (handle === "sw") { const nx2 = clamp(x + dx, 0, x + w - MIN_CROP); w += x - nx2; x = nx2; h = clamp(h + dy, MIN_CROP, 1 - y); }
        else if (handle === "n") { const ny2 = clamp(y + dy, 0, y + h - MIN_CROP); h += y - ny2; y = ny2; }
        else if (handle === "s") { h = clamp(h + dy, MIN_CROP, 1 - y); }
        else if (handle === "w") { const nx2 = clamp(x + dx, 0, x + w - MIN_CROP); w += x - nx2; x = nx2; }
        else if (handle === "e") { w = clamp(w + dx, MIN_CROP, 1 - x); }
        // Enforce a locked aspect ratio while resizing (move keeps size already).
        if (cropAspect && handle !== "move" && canvasRect.width && canvasRect.height) {
          const k = canvasRect.width / (canvasRect.height * cropAspect);
          h = w * k;
          if (y + h > 1) { h = 1 - y; w = h / k; }
          if (x + w > 1) { w = 1 - x; h = w * k; }
        }
        return { x, y, w, h };
      });
    }

    function onCropPointerUp() { cropDragHandle.current = null; }

    // ── Imperative ref ─────────────────────────────────────────────────────────

    useImperativeHandle(ref, () => ({
      getMaskBase64() {
        const canvas = maskRef.current;
        if (!canvas) return null;
        const { width, height } = canvas;
        if (width === 0 || height === 0) return null;
        const ctx = canvas.getContext("2d")!;
        const src = ctx.getImageData(0, 0, width, height);
        const out = ctx.createImageData(width, height);
        for (let i = 0; i < src.data.length; i += 4) {
          const a = src.data[i + 3];
          const v = a > 10 ? 255 : 0;
          out.data[i] = v; out.data[i + 1] = v; out.data[i + 2] = v; out.data[i + 3] = 255;
        }
        const tmp = document.createElement("canvas");
        tmp.width = width; tmp.height = height;
        tmp.getContext("2d")!.putImageData(out, 0, 0);
        return tmp.toDataURL("image/png");
      },
      clearMask() {
        const canvas = maskRef.current;
        if (!canvas) return;
        canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
      },
      getCropRect() {
        const img = imageRef.current;
        if (!img) return null;
        const { naturalWidth: nw, naturalHeight: nh } = img;
        if (!nw || !nh) return null;
        const n = normalizeCrop(cropRect);
        return { x: Math.round(n.x * nw), y: Math.round(n.y * nh), w: Math.max(1, Math.round(n.w * nw)), h: Math.max(1, Math.round(n.h * nh)) };
      },
      getImageSize() {
        const img = imageRef.current;
        if (!img || !img.naturalWidth) return null;
        return { width: img.naturalWidth, height: img.naturalHeight };
      },
      getDisplayedSize() {
        if (canvasRect.width === 0) return null;
        return { width: canvasRect.width, height: canvasRect.height };
      },
    }), [cropRect, canvasRect]);

    // ── Layer drag & resize ────────────────────────────────────────────────────

    function onLayerPointerDown(e: React.PointerEvent<HTMLDivElement>, layer: Layer) {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      layerDragRef.current = {
        id: layer.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startXPct: layer.xPct,
        startYPct: layer.yPct,
        hasMoved: false,
      };
    }

    function onLayerPointerMove(e: React.PointerEvent<HTMLDivElement>, layer: Layer) {
      if (!layerDragRef.current || layerDragRef.current.id !== layer.id || !canvasRect.width) return;
      const dx = e.clientX - layerDragRef.current.startClientX;
      const dy = e.clientY - layerDragRef.current.startClientY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        layerDragRef.current.hasMoved = true;
      }
      if (!layerDragRef.current.hasMoved) return;
      let newXPct = layerDragRef.current.startXPct + (dx / canvasRect.width) * 100;
      let newYPct = layerDragRef.current.startYPct + (dy / canvasRect.height) * 100;

      // ── Snapping with live guides: canvas edges/centre AND other layers ────
      const pctDims = (l: Layer): [number, number] => {
        if (l.type !== "image") return [0, 0]; // text extents unknown — anchor by origin
        const il = l as ImageLayer;
        const wpx = (il.widthPct / 100) * canvasRect.width;
        const hpx = il.aspectRatio > 0 ? wpx / il.aspectRatio : wpx;
        return [il.widthPct, (hpx / canvasRect.height) * 100];
      };
      const [wPct, hPct] = pctDims(layer);
      const thX = (6 / canvasRect.width) * 100;
      const thY = (6 / canvasRect.height) * 100;

      // Guide targets: canvas 0/50/100 plus every other visible layer's edges & centres
      const xTargets: number[] = [0, 50, 100];
      const yTargets: number[] = [0, 50, 100];
      for (const other of layers) {
        if (other.id === layer.id || other.visible === false) continue;
        const [ow, oh] = pctDims(other);
        xTargets.push(other.xPct, other.xPct + ow / 2, other.xPct + ow);
        yTargets.push(other.yPct, other.yPct + oh / 2, other.yPct + oh);
      }

      // The dragged layer can snap by its left/centre/right (top/middle/bottom)
      const xAnchors = [0, wPct / 2, wPct];
      const yAnchors = [0, hPct / 2, hPct];
      let guideV: number | null = null, guideH: number | null = null;
      snapX:
      for (const g of xTargets) {
        for (const a of xAnchors) {
          if (Math.abs(newXPct + a - g) < thX) { newXPct = g - a; guideV = g; break snapX; }
        }
      }
      snapY:
      for (const g of yTargets) {
        for (const a of yAnchors) {
          if (Math.abs(newYPct + a - g) < thY) { newYPct = g - a; guideH = g; break snapY; }
        }
      }
      setGuides({ v: guideV, h: guideH });
      onLayerMove?.(layer.id, newXPct, newYPct);
    }

    function onLayerPointerUp(layer: Layer) {
      if (layerDragRef.current && !layerDragRef.current.hasMoved) {
        onSelectLayer?.(layer.id);
      }
      layerDragRef.current = null;
      setGuides({ v: null, h: null });
    }

    const dc = normalizeCrop(cropRect);
    const visibleLayers = layers.filter((l) => l.visible !== false);

    return (
      <div
        ref={containerRef}
        className="relative w-full h-full flex items-center justify-center overflow-hidden p-10"
        style={{
          backgroundColor: "hsl(var(--muted) / 0.4)",
          backgroundImage:
            "repeating-conic-gradient(hsl(var(--muted-foreground) / 0.08) 0% 25%, transparent 0% 50%)",
          backgroundSize: "20px 20px",
        }}
        onClick={() => { if (pannedRef.current) { pannedRef.current = false; return; } onSelectLayer?.(null); }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={imageUrl}
          alt="Edit preview"
          className="max-w-full max-h-full object-contain select-none"
          draggable={false}
          onLoad={syncCanvas}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})${isRotate ? ` rotate(${rotationAngle}deg)` : ""}`,
            transformOrigin: "center center",
            transition: isDraggingRotate || isPanning ? "none" : isRotate ? "transform 0.05s linear" : undefined,
            filter: previewFilter || undefined,
            opacity: hideBaseImage ? 0 : 1,
          }}
        />

        {/* Mask canvas for AI tools */}
        <canvas
          ref={maskRef}
          className="absolute"
          style={{
            top: canvasRect.top,
            left: canvasRect.left,
            width: canvasRect.width,
            height: canvasRect.height,
            cursor: needsMask ? "crosshair" : "default",
            pointerEvents: needsMask ? "auto" : "none",
          }}
          onMouseDown={onMaskMouseDown}
          onMouseMove={onMaskMouseMove}
          onMouseUp={onMaskMouseUp}
          onMouseLeave={onMaskMouseUp}
        />

        {/* Crop overlay */}
        {isCrop && canvasRect.width > 0 && (
          <div
            ref={overlayRef}
            className="absolute select-none"
            style={{ top: canvasRect.top, left: canvasRect.left, width: canvasRect.width, height: canvasRect.height, cursor: cropCursor }}
            onPointerDown={onCropPointerDown}
            onPointerMove={onCropPointerMove}
            onPointerUp={onCropPointerUp}
          >
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute bg-black/55" style={{ top: 0, left: 0, right: 0, height: `${dc.y * 100}%` }} />
              <div className="absolute bg-black/55" style={{ bottom: 0, left: 0, right: 0, top: `${(dc.y + dc.h) * 100}%` }} />
              <div className="absolute bg-black/55" style={{ top: `${dc.y * 100}%`, left: 0, width: `${dc.x * 100}%`, height: `${dc.h * 100}%` }} />
              <div className="absolute bg-black/55" style={{ top: `${dc.y * 100}%`, right: 0, left: `${(dc.x + dc.w) * 100}%`, height: `${dc.h * 100}%` }} />
            </div>
            <div
              className="absolute border-2 border-white pointer-events-none"
              style={{ left: `${dc.x * 100}%`, top: `${dc.y * 100}%`, width: `${dc.w * 100}%`, height: `${dc.h * 100}%` }}
            >
              <div className="absolute border-t border-white/30 left-0 right-0" style={{ top: "33.33%" }} />
              <div className="absolute border-t border-white/30 left-0 right-0" style={{ top: "66.66%" }} />
              <div className="absolute border-l border-white/30 top-0 bottom-0" style={{ left: "33.33%" }} />
              <div className="absolute border-l border-white/30 top-0 bottom-0" style={{ left: "66.66%" }} />
            </div>
            {(["nw","ne","sw","se"] as const).map((h) => (
              <div key={h} className="absolute w-3.5 h-3.5 bg-white rounded-sm shadow pointer-events-none"
                style={{ left: `${(h.includes("e") ? dc.x + dc.w : dc.x) * 100}%`, top: `${(h.includes("s") ? dc.y + dc.h : dc.y) * 100}%`, transform: "translate(-50%,-50%)", cursor: CURSORS[h] }} />
            ))}
            {(["n","s","e","w"] as const).map((h) => {
              const lx = h === "w" ? dc.x : h === "e" ? dc.x + dc.w : dc.x + dc.w / 2;
              const ly = h === "n" ? dc.y : h === "s" ? dc.y + dc.h : dc.y + dc.h / 2;
              return (
                <div key={h} className="absolute w-3 h-3 bg-white rounded-sm shadow pointer-events-none"
                  style={{ left: `${lx * 100}%`, top: `${ly * 100}%`, transform: "translate(-50%,-50%)", cursor: CURSORS[h] }} />
              );
            })}
          </div>
        )}

        {/* Layer overlays — always visible, interactive only when tool === "text" */}
        {canvasRect.width > 0 && visibleLayers.map((layer) => {
          const x = canvasRect.left + (layer.xPct / 100) * canvasRect.width;
          const y = canvasRect.top + (layer.yPct / 100) * canvasRect.height;
          const isSelected = selectedLayerId === layer.id;
          const isEditing = editingLayerId === layer.id;
          const isLocked = !!(layer as ImageLayer | TextLayer).locked;
          const interactive = !isLocked && (tool === "text" || tool === "add_image" || tool === "convert_canvas" || tool === "templates" || tool === "shapes");

          if (layer.type === "text") {
            if (isEditing && interactive) {
              return (
                <input
                  key={layer.id}
                  type="text"
                  autoFocus
                  value={layer.text}
                  onChange={(e) => onEditText?.(layer.id, e.target.value)}
                  onBlur={() => onFinishEdit?.()}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" || e.key === "Enter") {
                      e.preventDefault();
                      onFinishEdit?.();
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    left: x,
                    top: y,
                    fontSize: layer.fontSize,
                    color: layer.color,
                    fontFamily: layer.fontFamily,
                    fontWeight: layer.bold ? "bold" : "normal",
                    fontStyle: layer.italic ? "italic" : "normal",
                    background: "rgba(0,0,0,0.3)",
                    border: "2px solid hsl(var(--primary))",
                    borderRadius: "3px",
                    outline: "none",
                    padding: "2px 6px",
                    minWidth: "80px",
                    textShadow: "0 1px 4px rgba(0,0,0,0.6)",
                    userSelect: "text",
                    cursor: "text",
                    lineHeight: 1.2,
                    zIndex: 20,
                  }}
                />
              );
            }
            return (
              <div
                key={layer.id}
                style={{
                  position: "absolute",
                  left: x,
                  top: y,
                  fontSize: layer.fontSize,
                  color: layer.color,
                  fontFamily: layer.fontFamily,
                  fontWeight: layer.bold ? "bold" : "normal",
                  fontStyle: layer.italic ? "italic" : "normal",
                  opacity: layer.opacity ?? 1,
                  letterSpacing: `${layer.letterSpacing ?? 0}px`,
                  WebkitTextStroke: (layer.outlineWidth ?? 0) > 0
                    ? `${layer.outlineWidth}px ${layer.outlineColor ?? "#000000"}`
                    : undefined,
                  background: layer.bgColor || undefined,
                  textTransform: layer.uppercase ? "uppercase" : undefined,
                  userSelect: "none",
                  cursor: interactive ? "move" : "default",
                  // em padding scales with fontSize and matches the burn geometry
                  padding: layer.bgColor ? "0.18em 0.3em" : "2px 6px",
                  border: isSelected
                    ? "2px solid hsl(var(--primary))"
                    : isLocked ? "none" : "1.5px dashed rgba(255,255,255,0.7)",
                  borderRadius: layer.bgColor ? "0.25em" : "3px",
                  textShadow: (layer.shadow ?? true)
                    ? "0 1px 4px rgba(0,0,0,0.6), 0 0 1px rgba(0,0,0,0.8)"
                    : "none",
                  whiteSpace: "nowrap",
                  lineHeight: 1.2,
                  pointerEvents: interactive ? "auto" : "none",
                  transform: "translate(-1px, -1px)",
                  zIndex: isSelected ? 10 : 5,
                }}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => { e.stopPropagation(); if (interactive) onStartEdit?.(layer.id); }}
                onPointerDown={(e) => { if (interactive) onLayerPointerDown(e, layer); }}
                onPointerMove={(e) => { if (interactive) onLayerPointerMove(e, layer); }}
                onPointerUp={() => { if (interactive) onLayerPointerUp(layer); }}
              >
                {layer.text}
              </div>
            );
          }

          // ImageLayer
          const w = (layer.widthPct / 100) * canvasRect.width;
          const h = layer.heightPct != null
            ? (layer.heightPct / 100) * canvasRect.height
            : (layer.aspectRatio > 0 ? w / layer.aspectRatio : w);
          const rot = (layer as ImageLayer).rotation ?? 0;

          return (
            <div
              key={layer.id}
              style={{
                position: "absolute",
                left: x,
                top: y,
                width: w,
                height: h,
                opacity: layer.opacity ?? 1,
                outline: isSelected
                  ? "2px solid hsl(var(--primary))"
                  : isLocked ? "none" : "1.5px dashed rgba(255,255,255,0.5)",
                outlineOffset: "0px",
                cursor: interactive ? "move" : "default",
                userSelect: "none",
                pointerEvents: interactive ? "auto" : "none",
                zIndex: isSelected ? 10 : 5,
                transform: rot !== 0 ? `rotate(${rot}deg)` : undefined,
                transformOrigin: "center center",
              }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => { if (interactive) onLayerPointerDown(e, layer); }}
              onPointerMove={(e) => { if (interactive) onLayerPointerMove(e, layer); }}
              onPointerUp={() => { if (interactive) onLayerPointerUp(layer); }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={layer.imageUrl}
                alt={layer.name}
                draggable={false}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "fill",
                  display: "block",
                  pointerEvents: "none",
                  userSelect: "none",
                }}
              />
              {/* Rotation handle at top-center */}
              {isSelected && interactive && (
                <div
                  style={{
                    position: "absolute",
                    top: -30,
                    left: "50%",
                    transform: "translateX(-50%)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    pointerEvents: "auto",
                    zIndex: 12,
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const conRect = containerRef.current!.getBoundingClientRect();
                    const cx = conRect.left + x + w / 2;
                    const cy = conRect.top + y + h / 2;
                    rotLayerDragRef.current = {
                      id: layer.id,
                      centerX: cx,
                      centerY: cy,
                      startAngle: Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI),
                      startRotation: rot,
                    };
                  }}
                  onPointerMove={(e) => {
                    if (!rotLayerDragRef.current || rotLayerDragRef.current.id !== layer.id) return;
                    const { centerX, centerY, startAngle, startRotation } = rotLayerDragRef.current;
                    const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);
                    let delta = angle - startAngle;
                    if (delta > 180) delta -= 360;
                    if (delta < -180) delta += 360;
                    let newRotation = startRotation + delta;
                    if (e.shiftKey) newRotation = Math.round(newRotation / 15) * 15;
                    else newRotation = Math.round(newRotation);
                    onLayerRotate?.(layer.id, newRotation);
                  }}
                  onPointerUp={() => { rotLayerDragRef.current = null; }}
                >
                  <div style={{ width: 1, height: 14, background: "hsl(var(--primary))", pointerEvents: "none" }} />
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: "white",
                      border: "2px solid hsl(var(--primary))",
                      cursor: "grab",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                      pointerEvents: "none",
                    }}
                  >
                    <RotateCw style={{ width: 10, height: 10, color: "hsl(var(--primary))" }} />
                  </div>
                </div>
              )}
              {/* Free-resize handles — 4 corners + 4 edges (independent W/H) */}
              {isSelected && interactive && ([
                { id: "nw" as const, pos: { top: -5, left: -5 }, cursor: "nwse-resize" },
                { id: "n" as const,  pos: { top: -5, left: "50%", marginLeft: -5 }, cursor: "ns-resize" },
                { id: "ne" as const, pos: { top: -5, right: -5 }, cursor: "nesw-resize" },
                { id: "e" as const,  pos: { top: "50%", right: -5, marginTop: -5 }, cursor: "ew-resize" },
                { id: "se" as const, pos: { bottom: -5, right: -5 }, cursor: "nwse-resize" },
                { id: "s" as const,  pos: { bottom: -5, left: "50%", marginLeft: -5 }, cursor: "ns-resize" },
                { id: "sw" as const, pos: { bottom: -5, left: -5 }, cursor: "nesw-resize" },
                { id: "w" as const,  pos: { top: "50%", left: -5, marginTop: -5 }, cursor: "ew-resize" },
              ]).map((hd) => (
                <div
                  key={hd.id}
                  style={{
                    position: "absolute",
                    ...hd.pos,
                    width: 10,
                    height: 10,
                    background: "white",
                    border: "1.5px solid hsl(var(--primary))",
                    borderRadius: 2,
                    cursor: hd.cursor,
                    zIndex: 11,
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const il = layer as ImageLayer;
                    resizeDragRef.current = {
                      id: layer.id,
                      handle: hd.id,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      startXPct: il.xPct,
                      startYPct: il.yPct,
                      startWidthPct: il.widthPct,
                      startHeightPct: il.heightPct ?? (h / canvasRect.height) * 100,
                    };
                  }}
                  onPointerMove={(e) => {
                    const r = resizeDragRef.current;
                    if (!r || r.id !== layer.id || !canvasRect.width) return;
                    const dxPct = ((e.clientX - r.startClientX) / canvasRect.width) * 100;
                    const dyPct = ((e.clientY - r.startClientY) / canvasRect.height) * 100;
                    const MIN = 1.5;
                    let x = r.startXPct, y = r.startYPct, wp = r.startWidthPct, hp = r.startHeightPct;
                    if (r.handle.includes("e")) wp = r.startWidthPct + dxPct;
                    if (r.handle.includes("w")) { wp = r.startWidthPct - dxPct; x = r.startXPct + dxPct; }
                    if (r.handle.includes("s")) hp = r.startHeightPct + dyPct;
                    if (r.handle.includes("n")) { hp = r.startHeightPct - dyPct; y = r.startYPct + dyPct; }
                    if (wp < MIN) { if (r.handle.includes("w")) x = r.startXPct + r.startWidthPct - MIN; wp = MIN; }
                    if (hp < MIN) { if (r.handle.includes("n")) y = r.startYPct + r.startHeightPct - MIN; hp = MIN; }
                    onLayerResize?.(layer.id, { widthPct: wp, heightPct: hp, xPct: x, yPct: y });
                  }}
                  onPointerUp={() => { resizeDragRef.current = null; }}
                />
              ))}
            </div>
          );
        })}

        {/* Rotation: drag overlay + handle pinned to image bottom-center */}
        {isRotate && canvasRect.width > 0 && (
          <>
            <div
              className="absolute select-none"
              style={{
                top: canvasRect.top,
                left: canvasRect.left,
                width: canvasRect.width,
                height: canvasRect.height,
                cursor: isDraggingRotate ? "grabbing" : "grab",
              }}
              onPointerDown={onRotHandlePointerDown}
              onPointerMove={onRotHandlePointerMove}
              onPointerUp={onRotHandlePointerUp}
            />
            <div
              className="absolute pointer-events-none"
              style={{
                width: 2,
                height: 24,
                left: canvasRect.left + canvasRect.width / 2 - 1,
                top: canvasRect.top + canvasRect.height + 1,
                background: "repeating-linear-gradient(to bottom, rgba(255,255,255,0.55) 0px, rgba(255,255,255,0.55) 4px, transparent 4px, transparent 8px)",
              }}
            />
            <div
              className="absolute flex items-center gap-1.5 rounded-full bg-background/95 border-2 border-primary px-3 py-1.5 shadow-lg hover:bg-accent transition-colors select-none pointer-events-none"
              style={{
                left: canvasRect.left + canvasRect.width / 2,
                top: canvasRect.top + canvasRect.height + 26,
                transform: "translateX(-50%)",
                whiteSpace: "nowrap",
              }}
            >
              <RotateCw className="h-3.5 w-3.5 text-primary" strokeWidth={2.2} />
              <span className="text-xs font-semibold text-foreground tabular-nums">
                {rotationAngle > 0 ? "+" : ""}{rotationAngle}°
              </span>
            </div>
          </>
        )}

        {/* AI processing overlay */}
        {isProcessing && canvasRect.width > 0 && (
          <>
            {/* Dimmed + scan overlay over the image only */}
            <div
              className="absolute overflow-hidden pointer-events-none"
              style={{ left: canvasRect.left, top: canvasRect.top, width: canvasRect.width, height: canvasRect.height, zIndex: 30 }}
            >
              <div className="absolute inset-0 bg-black/50" />
              <div className="absolute inset-0 border-2 border-primary/70 animate-pulse" />
              <div
                className="absolute left-0 right-0 animate-ai-scan pointer-events-none"
                style={{
                  height: "28%",
                  top: "-28%",
                  background: "linear-gradient(to bottom, transparent 0%, hsl(var(--primary) / 0.45) 50%, transparent 100%)",
                }}
              />
            </div>
            {/* Centered processing card */}
            <div
              className="absolute flex items-center justify-center pointer-events-none"
              style={{ left: canvasRect.left, top: canvasRect.top, width: canvasRect.width, height: canvasRect.height, zIndex: 31 }}
            >
              <div className="flex flex-col items-center gap-3 bg-background/90 border border-border rounded-xl px-6 py-4 shadow-xl backdrop-blur-sm">
                <div className="relative w-10 h-10 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
                  <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
                  <Sparkles className="h-4 w-4 text-primary" strokeWidth={1.8} />
                </div>
                <span className="text-xs font-semibold text-foreground">Processing…</span>
              </div>
            </div>
          </>
        )}

        {/* Layer alignment guides */}
        {guides.v !== null && canvasRect.width > 0 && (
          <div className="absolute z-[55] pointer-events-none"
            style={{ left: canvasRect.left + (guides.v / 100) * canvasRect.width, top: canvasRect.top, width: 1, height: canvasRect.height, background: "hsl(var(--primary))", opacity: 0.8 }} />
        )}
        {guides.h !== null && canvasRect.width > 0 && (
          <div className="absolute z-[55] pointer-events-none"
            style={{ top: canvasRect.top + (guides.h / 100) * canvasRect.height, left: canvasRect.left, height: 1, width: canvasRect.width, background: "hsl(var(--primary))", opacity: 0.8 }} />
        )}

        {/* Pan catcher — active while Space is held (or mid-pan) */}
        {(spaceHeld || isPanning) && (
          <div
            className="absolute inset-0 z-[60]"
            style={{ cursor: isPanning ? "grabbing" : "grab" }}
            onPointerDown={(e) => {
              setIsPanning(true);
              panStartRef.current = { cx: e.clientX, cy: e.clientY, px: pan.x, py: pan.y };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!isPanning || !panStartRef.current) return;
              pannedRef.current = true;
              setPan({ x: panStartRef.current.px + (e.clientX - panStartRef.current.cx), y: panStartRef.current.py + (e.clientY - panStartRef.current.cy) });
            }}
            onPointerUp={() => { setIsPanning(false); panStartRef.current = null; }}
            onPointerLeave={() => { setIsPanning(false); panStartRef.current = null; }}
          />
        )}

        {/* Zoom controls */}
        <div
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-0.5 rounded-full border border-border bg-background/95 px-1.5 py-1 shadow-lg backdrop-blur"
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => zoomBy(0.8)} title="Zoom out"
            className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={resetView} title="Reset view"
            className="min-w-[46px] rounded-full px-1 text-center text-[11px] font-medium tabular-nums text-foreground hover:bg-accent transition-colors">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={() => zoomBy(1.25)} title="Zoom in"
            className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <Plus className="h-3.5 w-3.5" />
          </button>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <button type="button" onClick={resetView} title="Fit to screen"
            className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={actualSize} title="Actual size (100%)"
            className="rounded-full px-1.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            1:1
          </button>
        </div>
      </div>
    );
  },
);
