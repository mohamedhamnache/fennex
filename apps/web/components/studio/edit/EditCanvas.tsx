"use client";

import {
  forwardRef,
  useRef,
  useEffect,
  useImperativeHandle,
  useState,
  useCallback,
} from "react";
import { RotateCw } from "lucide-react";

const MASK_TOOLS = new Set([
  "remove_background",
  "replace_background",
  "remove_object",
  "insert_object",
  "generative_fill",
  "smart_erase",
]);

const BRUSH_RADIUS = 20;
const MASK_COLOR = "rgba(255, 80, 80, 0.45)";
const MIN_CROP = 0.02;

export interface EditCanvasRef {
  getMaskBase64: () => string | null;
  clearMask: () => void;
  getCropRect: () => { x: number; y: number; w: number; h: number } | null;
  getImageSize: () => { width: number; height: number } | null;
}

interface EditCanvasProps {
  imageUrl: string;
  tool: string;
  /** Current rotation angle in degrees (controlled by parent for the rotate tool) */
  rotationAngle?: number;
  /** Called when the rotation handle is dragged */
  onRotationChange?: (angle: number) => void;
  /** CSS filter string applied live to the image (for adjust/filter preview) */
  previewFilter?: string;
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
  function EditCanvas({ imageUrl, tool, rotationAngle = 0, onRotationChange, previewFilter }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const maskRef = useRef<HTMLCanvasElement>(null);
    const [painting, setPainting] = useState(false);
    const [isDraggingRotate, setIsDraggingRotate] = useState(false);
    const [canvasRect, setCanvasRect] = useState({ top: 0, left: 0, width: 0, height: 0 });

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

    // Re-sync after tool switch so the crop overlay is positioned correctly
    // after the CSS rotation transform is applied/removed.
    useEffect(() => {
      requestAnimationFrame(syncCanvas);
    }, [tool]);

    // ── Crop state ─────────────────────────────────────────────────────────────

    const [cropRect, setCropRect] = useState<CropRect>({ x: 0, y: 0, w: 1, h: 1 });
    const cropDragHandle = useRef<DragHandle | null>(null);
    const cropDragStart = useRef({ mx: 0, my: 0, crop: { x: 0, y: 0, w: 1, h: 1 } });

    useEffect(() => {
      setCropRect({ x: 0, y: 0, w: 1, h: 1 });
    }, [tool, imageUrl]); // reset on tool switch AND whenever the displayed image changes (after save)

    // ── Rotation state ─────────────────────────────────────────────────────────

    const rotDrag = useRef<{ startMouseAngle: number; startRotation: number } | null>(null);

    // Angle from the IMAGE center (not container center) to the cursor.
    // canvasRect is in container-relative coords; conRect converts to screen coords.
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
      // Normalize to [-180, 180] to prevent wrap-around jump at the ±180° boundary
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
      const rect = maskRef.current!.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top];
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
    }), [cropRect]);

    const dc = normalizeCrop(cropRect);

    return (
      <div
        ref={containerRef}
        className="relative w-full h-full flex items-center justify-center bg-muted/30 overflow-hidden"
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
            transform: isRotate ? `rotate(${rotationAngle}deg)` : undefined,
            transition: isDraggingRotate ? "none" : isRotate ? "transform 0.05s linear" : undefined,
            filter: previewFilter || undefined,
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
            {/* Dark mask panels */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute bg-black/55" style={{ top: 0, left: 0, right: 0, height: `${dc.y * 100}%` }} />
              <div className="absolute bg-black/55" style={{ bottom: 0, left: 0, right: 0, top: `${(dc.y + dc.h) * 100}%` }} />
              <div className="absolute bg-black/55" style={{ top: `${dc.y * 100}%`, left: 0, width: `${dc.x * 100}%`, height: `${dc.h * 100}%` }} />
              <div className="absolute bg-black/55" style={{ top: `${dc.y * 100}%`, right: 0, left: `${(dc.x + dc.w) * 100}%`, height: `${dc.h * 100}%` }} />
            </div>
            {/* Crop frame + rule-of-thirds */}
            <div
              className="absolute border-2 border-white pointer-events-none"
              style={{ left: `${dc.x * 100}%`, top: `${dc.y * 100}%`, width: `${dc.w * 100}%`, height: `${dc.h * 100}%` }}
            >
              <div className="absolute border-t border-white/30 left-0 right-0" style={{ top: "33.33%" }} />
              <div className="absolute border-t border-white/30 left-0 right-0" style={{ top: "66.66%" }} />
              <div className="absolute border-l border-white/30 top-0 bottom-0" style={{ left: "33.33%" }} />
              <div className="absolute border-l border-white/30 top-0 bottom-0" style={{ left: "66.66%" }} />
            </div>
            {/* Handles */}
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

        {/* Rotation: drag overlay + handle pinned to image bottom-center */}
        {isRotate && canvasRect.width > 0 && (
          <>
            {/* Invisible drag overlay covers the whole image area */}
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
            {/* Connector line */}
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
            {/* Drag handle — pinned below image bottom-center */}
            <div
              className="absolute flex items-center gap-1.5 rounded-full bg-background/95 border-2 border-primary px-3 py-1.5 shadow-lg hover:bg-accent transition-colors select-none pointer-events-none"
              style={{
                left: canvasRect.left + canvasRect.width / 2,
                top: canvasRect.top + canvasRect.height + 26,
                transform: "translateX(-50%)",
                cursor: isDraggingRotate ? "grabbing" : "grab",
                pointerEvents: "auto",
              }}
              onPointerDown={onRotHandlePointerDown}
              onPointerMove={onRotHandlePointerMove}
              onPointerUp={onRotHandlePointerUp}
            >
              <RotateCw className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-xs font-semibold text-primary tabular-nums">
                {rotationAngle}°
              </span>
            </div>
          </>
        )}

        {needsMask && (
          <div className="absolute bottom-3 left-0 right-0 flex justify-center pointer-events-none">
            <span className="text-xs bg-background/80 text-muted-foreground px-2 py-1 rounded-full">
              Paint the area to edit
            </span>
          </div>
        )}
        {isCrop && canvasRect.width > 0 && (
          <div className="absolute bottom-3 left-0 right-0 flex justify-center pointer-events-none">
            <span className="text-xs bg-background/80 text-muted-foreground px-2 py-1 rounded-full">
              Drag handles to crop · click &amp; drag to redraw selection
            </span>
          </div>
        )}
      </div>
    );
  },
);
