"use client";

import {
  forwardRef,
  useRef,
  useEffect,
  useImperativeHandle,
  useState,
  useCallback,
} from "react";

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

export interface EditCanvasRef {
  getMaskBase64: () => string | null;
  clearMask: () => void;
}

interface EditCanvasProps {
  imageUrl: string;
  tool: string;
}

export const EditCanvas = forwardRef<EditCanvasRef, EditCanvasProps>(
  function EditCanvas({ imageUrl, tool }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const maskRef = useRef<HTMLCanvasElement>(null);
    const [painting, setPainting] = useState(false);
    const [canvasRect, setCanvasRect] = useState({ top: 0, left: 0, width: 0, height: 0 });
    const needsMask = MASK_TOOLS.has(tool);

    // Sync canvas size + position to the rendered image bounds
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

    const onMouseDown = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!needsMask) return;
        syncCanvas();
        setPainting(true);
        drawCircle(...getPos(e));
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [needsMask],
    );

    const onMouseMove = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!painting || !needsMask) return;
        drawCircle(...getPos(e));
      },
      [painting, needsMask],
    );

    const onMouseUp = useCallback(() => setPainting(false), []);

    useImperativeHandle(ref, () => ({
      getMaskBase64() {
        const canvas = maskRef.current;
        if (!canvas) return null;
        // Binarize: any painted pixel becomes full white, rest black
        const { width, height } = canvas;
        if (width === 0 || height === 0) return null;
        const ctx = canvas.getContext("2d")!;
        const src = ctx.getImageData(0, 0, width, height);
        const out = ctx.createImageData(width, height);
        for (let i = 0; i < src.data.length; i += 4) {
          const a = src.data[i + 3];
          const v = a > 10 ? 255 : 0;
          out.data[i] = v;
          out.data[i + 1] = v;
          out.data[i + 2] = v;
          out.data[i + 3] = 255;
        }
        // Draw to temp canvas and export
        const tmp = document.createElement("canvas");
        tmp.width = width;
        tmp.height = height;
        tmp.getContext("2d")!.putImageData(out, 0, 0);
        return tmp.toDataURL("image/png");
      },
      clearMask() {
        const canvas = maskRef.current;
        if (!canvas) return;
        canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
      },
    }));

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
        />
        {/* Mask overlay — only shown for mask-capable tools */}
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
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />
        {needsMask && (
          <div className="absolute bottom-3 left-0 right-0 flex justify-center">
            <span className="text-xs bg-background/80 text-muted-foreground px-2 py-1 rounded-full">
              Paint the area to edit
            </span>
          </div>
        )}
      </div>
    );
  },
);
