"use client";

import { useState, useEffect, useRef, RefObject, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Lock, Unlock, RotateCcw, RotateCw, FlipHorizontal2, FlipVertical2,
  Trash2, Bold, Italic, Eye, EyeOff, ChevronUp, ChevronDown, ChevronsUp, ChevronsDown,
  ImageIcon, Type, Upload, ScanLine, Sparkles, Loader2, Box, Copy,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
} from "lucide-react";
import { editImage, getImage, listImages, uploadImage, decomposeImage, getBrandKit, type GeneratedImage, type DecomposeResult, type InpaintMethod } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Histogram } from "./Histogram";
import { TEXT_TEMPLATES, TEMPLATE_CATEGORIES, brandTemplate, type TextTemplate, type TemplateCategory, type TemplateTextDef, type ResolvedTemplate } from "./text-templates";
import { SHAPE_GROUPS, shapeAspect, shapeDataUri, parseShapeStyle, backgroundDataUri, backgroundCss, type ShapeId, type ShapeStyle } from "./shapes";
import type { EditCanvasRef, Layer, TextLayer, ImageLayer } from "./EditCanvas";

const CANVAS_FONTS = [
  { value: "Inter, sans-serif", label: "Inter" },
  { value: "'Plus Jakarta Sans', sans-serif", label: "Plus Jakarta Sans" },
  { value: "'Playfair Display', serif", label: "Playfair Display" },
  { value: "Montserrat, sans-serif", label: "Montserrat" },
  { value: "'Bebas Neue', cursive", label: "Bebas Neue" },
  { value: "Roboto, sans-serif", label: "Roboto" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "'Courier New', monospace", label: "Courier New" },
];

interface EditControlsPanelProps {
  tool: string;
  imageId: string;
  imageUrl: string;
  projectId?: string;
  canvasRef: RefObject<EditCanvasRef>;
  onVersionAdded: (img: GeneratedImage) => void;
  rotationAngle: number;
  onRotationChange: (angle: number) => void;
  onPreviewChange?: (filter: string) => void;
  layers: Layer[];
  selectedLayerId: string | null;
  onAddTextLayer: (layer: Omit<TextLayer, "id">) => void;
  onAddImageLayer: (imageUrl: string, name: string, aspectRatio: number, widthPct?: number) => void;
  onSetLayers: (layers: Layer[]) => void;
  onRemoveLayer: (id: string) => void;
  onBurnLayers: () => void;
  onSelectLayer: (id: string | null) => void;
  onUpdateLayer: (id: string, patch: Partial<TextLayer> | Partial<ImageLayer>) => void;
  onMoveLayerUp: (id: string) => void;
  onMoveLayerDown: (id: string) => void;
  onMoveLayerToFront: (id: string) => void;
  onMoveLayerToBack: (id: string) => void;
  onToggleLayerVisible: (id: string) => void;
  isBurning?: boolean;
  burnError?: string | null;
  onProcessingChange?: (pending: boolean) => void;
  onHideBaseImage?: (hide: boolean) => void;
  cropAspect?: number | null;
  onCropAspectChange?: (aspect: number | null) => void;
  onDuplicateLayer?: (id: string) => void;
  onAlignLayer?: (id: string, align: "left" | "centerX" | "right" | "top" | "middleY" | "bottom") => void;
  /** Ask the editor shell to switch the active tool (used after applying a template). */
  onRequestTool?: (tool: string) => void;
}

/** Six canvas-relative alignment buttons for the selected layer. */
function AlignRow({ layerId, onAlign }: { layerId: string; onAlign?: (id: string, a: "left" | "centerX" | "right" | "top" | "middleY" | "bottom") => void }) {
  if (!onAlign) return null;
  const items = [
    { a: "left" as const,    Icon: AlignStartVertical,    title: "Align left" },
    { a: "centerX" as const, Icon: AlignCenterVertical,   title: "Align centre" },
    { a: "right" as const,   Icon: AlignEndVertical,      title: "Align right" },
    { a: "top" as const,     Icon: AlignStartHorizontal,  title: "Align top" },
    { a: "middleY" as const, Icon: AlignCenterHorizontal, title: "Align middle" },
    { a: "bottom" as const,  Icon: AlignEndHorizontal,    title: "Align bottom" },
  ];
  return (
    <div className="grid grid-cols-6 gap-1">
      {items.map(({ a, Icon, title }) => (
        <button
          key={a}
          type="button"
          title={title}
          onClick={() => onAlign(layerId, a)}
          className="flex items-center justify-center rounded-lg border border-border py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

const CSS_PREVIEW: Record<string, string> = {
  grayscale: "grayscale(100%)",
  sepia: "sepia(90%) brightness(1.02)",
  warm: "sepia(30%) saturate(150%) hue-rotate(-15deg)",
  cool: "hue-rotate(210deg) saturate(80%) brightness(1.02)",
  vivid: "saturate(180%) contrast(115%)",
};

const FILTERS = [
  { value: "grayscale", label: "B&W" },
  { value: "sepia",     label: "Sepia" },
  { value: "warm",      label: "Warm" },
  { value: "cool",      label: "Cool" },
  { value: "vivid",     label: "Vivid" },
];

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums w-9 text-right">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

function makeSolidColorDataUri(hex: string, w = 200, h = 200): string {
  const safe = hex.replace(/[^#0-9a-fA-F]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${safe}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}


export function EditControlsPanel({
  tool,
  imageId,
  imageUrl,
  projectId,
  canvasRef,
  onVersionAdded,
  rotationAngle,
  onRotationChange,
  onPreviewChange,
  layers,
  selectedLayerId,
  onAddTextLayer,
  onAddImageLayer,
  onSetLayers,
  onRemoveLayer,
  onBurnLayers,
  onSelectLayer,
  onUpdateLayer,
  onMoveLayerUp,
  onMoveLayerDown,
  onMoveLayerToFront,
  onMoveLayerToBack,
  onToggleLayerVisible,
  isBurning = false,
  burnError,
  onProcessingChange,
  onHideBaseImage,
  cropAspect = null,
  onCropAspectChange,
  onDuplicateLayer,
  onAlignLayer,
  onRequestTool,
}: EditControlsPanelProps) {
  const [error, setError] = useState<string | null>(null);

  const { data: galleryImages = [], isLoading: galleryLoading } = useQuery<GeneratedImage[]>({
    queryKey: ["images", projectId],
    queryFn: () => listImages(projectId!),
    enabled: tool === "add_image" && !!projectId,
  });
  const [applied, setApplied] = useState(false);
  const appliedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [filterName, setFilterName] = useState("grayscale");
  const [denoiseStrength, setDenoiseStrength] = useState(0.5);
  const [sharpenStrength, setSharpenStrength] = useState(0.5);
  const [fillColor, setFillColor] = useState("#000000");
  const [fillTransparent, setFillTransparent] = useState(false);
  const [resizeW, setResizeW] = useState(1024);
  const [resizeH, setResizeH] = useState(1024);
  const [aspectLocked, setAspectLocked] = useState(true);
  const [aspectRatio, setAspectRatio] = useState(1);
  const [prompt, setPrompt] = useState("");
  const [shadowDir, setShadowDir] = useState("bottom");
  const [relightDir, setRelightDir] = useState("top");
  const [relightIntensity, setRelightIntensity] = useState(1.0);
  const [fidelity, setFidelity] = useState(0.7);
  const [scale, setScale] = useState("2");

  // Text tool add-new form state
  const [newText, setNewText] = useState("");
  const [textFontSize, setTextFontSize] = useState(32);
  const [textColor, setTextColor] = useState("#ffffff");
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);
  const [textFontFamily, setTextFontFamily] = useState("Inter, sans-serif");

  // Add image tool upload ref
  const addImageFileRef = useRef<HTMLInputElement>(null);
  const [addImageUploading, setAddImageUploading] = useState(false);

  // Shapes tool state
  const [shapeColor, setShapeColor] = useState("#3b82f6");
  const [shapeColor2, setShapeColor2] = useState<string | null>(null); // null = auto shade
  const [shapeGradient, setShapeGradient] = useState(false);
  const [shapeShadow, setShapeShadow] = useState(false);
  const shapeStyle: ShapeStyle = {
    color: shapeColor,
    color2: shapeColor2 ?? undefined,
    gradient: shapeGradient,
    shadow: shapeShadow,
  };

  // Text templates state
  const [templateCategory, setTemplateCategory] = useState<"all" | TemplateCategory>("all");
  const [brandTemplates, setBrandTemplates] = useState(true);
  const { data: templateBrandKit } = useQuery({
    queryKey: ["brand-kit"],
    queryFn: getBrandKit,
    enabled: tool === "templates",
  });
  const brandUsable = !!(
    templateBrandKit &&
    ((templateBrandKit.colors?.length ?? 0) > 0 || templateBrandKit.primary_font || templateBrandKit.secondary_font)
  );

  // Convert to canvas decompose state
  const [decomposeResult, setDecomposeResult] = useState<DecomposeResult | null>(null);
  const [decomposeError, setDecomposeError] = useState<string | null>(null);
  const [decomposeLoading, setDecomposeLoading] = useState(false);
  const [inpaintMethod, setInpaintMethod] = useState<InpaintMethod>("diffusion");

  useEffect(() => () => {
    if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current);
  }, []);

  useEffect(() => {
    setError(null);
    setApplied(false);
    setDecomposeResult(null);
    setDecomposeError(null);
    onPreviewChange?.("");
    setBrightness(0); setContrast(0); setSaturation(0);
    setFilterName("grayscale");
    setDenoiseStrength(0.5); setSharpenStrength(0.5);
    setFillColor("#000000"); setFillTransparent(false);
    setPrompt("");
    setShadowDir("bottom"); setRelightDir("top"); setRelightIntensity(1.0);
    setFidelity(0.7); setScale("2");
    if (tool === "resize") {
      const size = canvasRef.current?.getImageSize();
      if (size) {
        setResizeW(size.width);
        setResizeH(size.height);
        setAspectRatio(size.width / size.height);
      }
    }
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tool !== "adjust") return;
    const b = (1 + brightness / 100).toFixed(2);
    const c = (1 + contrast / 100).toFixed(2);
    const s = (1 + saturation / 100).toFixed(2);
    onPreviewChange?.(`brightness(${b}) contrast(${c}) saturate(${s})`);
  }, [brightness, contrast, saturation, tool]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tool !== "filter") return;
    onPreviewChange?.(CSS_PREVIEW[filterName] ?? "");
  }, [filterName, tool]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tool !== "denoise") return;
    onPreviewChange?.(`blur(${(denoiseStrength * 1.5).toFixed(1)}px)`);
  }, [denoiseStrength, tool]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tool !== "sharpen") return;
    const c = (1 + sharpenStrength * 0.25).toFixed(2);
    const s = (1 + sharpenStrength * 0.1).toFixed(2);
    onPreviewChange?.(`contrast(${c}) saturate(${s})`);
  }, [sharpenStrength, tool]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleWidthChange(v: number) {
    setResizeW(v);
    if (aspectLocked) setResizeH(Math.round(v / aspectRatio));
  }
  function handleHeightChange(v: number) {
    setResizeH(v);
    if (aspectLocked) setResizeW(Math.round(v * aspectRatio));
  }
  function toggleAspectLock() {
    if (!aspectLocked) setAspectRatio(resizeW / resizeH);
    setAspectLocked((p) => !p);
  }

  function handleAddText() {
    if (!newText.trim()) return;
    onAddTextLayer({
      type: "text",
      text: newText.trim(),
      xPct: 10,
      yPct: 10,
      fontSize: textFontSize,
      color: textColor,
      bold: textBold,
      italic: textItalic,
      fontFamily: textFontFamily,
      visible: true,
    });
    setNewText("");
  }

  /** Template (background + layers) with brand colours/fonts applied when the toggle is on. */
  function resolveTemplate(t: TextTemplate): ResolvedTemplate {
    return brandTemplates && brandUsable
      ? brandTemplate(t, templateBrandKit)
      : { background: t.background ?? null, layers: t.layers };
  }

  function applyTemplate(t: TextTemplate) {
    // Template sizes assume an ~800px canvas — scale to the real display size.
    const disp = canvasRef.current?.getDisplayedSize();
    const scale = disp?.width ? Math.max(0.5, Math.min(2.5, disp.width / 800)) : 1;
    const canvasAspect = disp?.width && disp?.height ? disp.width / disp.height : 1;
    const { background, layers: defs } = resolveTemplate(t);
    const now = Date.now();
    const newLayers: Layer[] = [];

    // Full-bleed background layer (covers the whole canvas)
    if (background) {
      newLayers.push({
        id: `tpl-${now}-bg`,
        type: "image",
        imageUrl: backgroundDataUri(background),
        name: "Background",
        xPct: 0, yPct: 0, widthPct: 100,
        aspectRatio: canvasAspect,
        opacity: 1,
        visible: true,
      });
    }

    defs.forEach((def, i) => {
      if (def.kind === "shape") {
        newLayers.push({
          id: `tpl-${now}-${i}`,
          type: "image",
          imageUrl: shapeDataUri(def.shape, def.color, { color2: def.color2, gradient: def.gradient, shadow: def.shadow }),
          name: `shape:${def.shape}`,
          xPct: def.xPct, yPct: def.yPct, widthPct: def.widthPct,
          aspectRatio: shapeAspect(def.shape, !!def.shadow),
          opacity: def.opacity ?? 1,
          rotation: def.rotation,
          visible: true,
        });
      } else {
        const { kind, fontRole, lockColor, ...l } = def as TemplateTextDef; // strip template-only fields
        void kind; void fontRole; void lockColor;
        newLayers.push({
          ...l,
          fontSize: Math.round(l.fontSize * scale),
          letterSpacing: l.letterSpacing !== undefined ? Math.round(l.letterSpacing * scale) : undefined,
          id: `tpl-${now}-${i}`,
        });
      }
    });

    onSetLayers([...layers, ...newLayers]);
    // Select the first foreground layer, not the background
    onSelectLayer((newLayers[background ? 1 : 0] ?? newLayers[0]).id);
    // Land the user in the Add Text tool so the layers are instantly editable
    onRequestTool?.("text");
  }

  const mutation = useMutation({
    mutationFn: async () => {
      setError(null);
      let params: Record<string, unknown> = {};

      switch (tool) {
        case "crop": {
          const r = canvasRef.current?.getCropRect();
          if (!r) throw new Error("No crop area selected");
          params = { x: r.x, y: r.y, w: r.w, h: r.h };
          break;
        }
        case "resize":
          params = { width: resizeW, height: resizeH, keep_aspect: false };
          break;
        case "rotate":
          params = {
            angle: rotationAngle,
            ...(fillTransparent ? {} : { fill_color: fillColor }),
          };
          break;
        case "adjust":
          params = { brightness, contrast, saturation };
          break;
        case "filter":
          params = { filter_name: filterName };
          break;
        case "denoise":
          params = { strength: denoiseStrength };
          break;
        case "sharpen":
          params = { strength: sharpenStrength };
          break;
        case "replace_background":
        case "insert_object":
        case "generative_fill":
          params = { prompt };
          if (canvasRef.current) {
            const m = canvasRef.current.getMaskBase64();
            if (m) params["mask_base64"] = m;
          }
          break;
        case "remove_background":
          break;
        case "remove_object":
        case "smart_erase":
          if (canvasRef.current) {
            const m = canvasRef.current.getMaskBase64();
            if (m) params["mask_base64"] = m;
          }
          break;
        case "generate_shadow":
          params = { direction: shadowDir };
          break;
        case "relight":
          params = { direction: relightDir, intensity: relightIntensity };
          break;
        case "restore_face":
          params = { fidelity };
          break;
        case "upscale":
          params = { scale: Number(scale) };
          break;
      }

      const result = await editImage(imageId, tool, params);
      if (!result.ok || !result.image_id) throw new Error(result.error ?? "Edit failed");
      const edited = await getImage(result.image_id);
      return edited;
    },
    onSuccess: (img) => {
      onPreviewChange?.("");
      onVersionAdded(img);
      canvasRef.current?.clearMask();
      if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current);
      setApplied(true);
      appliedTimerRef.current = setTimeout(() => setApplied(false), 2000);
    },
    onError: (e: Error) => setError(e.message),
  });

  // Instant flip — applies immediately as a new version (no Save step needed)
  const flipMutation = useMutation({
    mutationFn: async (direction: "horizontal" | "vertical") => {
      setError(null);
      const result = await editImage(imageId, "flip", { direction });
      if (!result.ok || !result.image_id) throw new Error(result.error ?? "Flip failed");
      return getImage(result.image_id);
    },
    onSuccess: (img) => onVersionAdded(img),
    onError: (e: Error) => setError(e.message),
  });

  useEffect(() => {
    onProcessingChange?.(mutation.isPending || flipMutation.isPending || decomposeLoading);
  }, [mutation.isPending, flipMutation.isPending, decomposeLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const toolLabel = tool.replace(/_/g, " ");
  const selectedLayer = layers.find((l) => l.id === selectedLayerId) ?? null;

  // Layers list (top-to-bottom = highest-index first)
  const reversedLayers = [...layers].reverse();

  return (
    <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground capitalize">
            {toolLabel}
          </p>
        </div>

        <div className="flex flex-col gap-4 p-4 flex-1 overflow-y-auto">

          {/* ── Crop ──────────────────────────────────────────────────────────── */}
          {tool === "crop" && (
            <div className="flex flex-col gap-3">
              <div>
                <span className="text-xs font-semibold text-foreground mb-2 block">Aspect ratio</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {([
                    { label: "Free", value: null },
                    { label: "1:1", value: 1 },
                    { label: "4:3", value: 4 / 3 },
                    { label: "3:2", value: 3 / 2 },
                    { label: "16:9", value: 16 / 9 },
                    { label: "9:16", value: 9 / 16 },
                  ] as { label: string; value: number | null }[]).map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => onCropAspectChange?.(p.value)}
                      className={cn(
                        "rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
                        cropAspect === p.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground hover:bg-accent",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Drag the handles on the image to select the area you want to keep.
                {cropAspect ? " The selection stays locked to the chosen ratio." : ""}
              </p>
            </div>
          )}

          {/* ── Resize ────────────────────────────────────────────────────────── */}
          {tool === "resize" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-xs font-medium text-foreground">Width</label>
                  <input
                    type="number"
                    value={resizeW}
                    min={1}
                    onChange={(e) => handleWidthChange(Number(e.target.value))}
                    className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <button
                  type="button"
                  onClick={toggleAspectLock}
                  className="mt-5 p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title={aspectLocked ? "Unlock aspect ratio" : "Lock aspect ratio"}
                >
                  {aspectLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                </button>
                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-xs font-medium text-foreground">Height</label>
                  <input
                    type="number"
                    value={resizeH}
                    min={1}
                    onChange={(e) => handleHeightChange(Number(e.target.value))}
                    className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {aspectLocked ? "Aspect ratio locked" : "Aspect ratio unlocked"}
              </p>
            </div>
          )}

          {/* ── Rotate ────────────────────────────────────────────────────────── */}
          {tool === "rotate" && (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-muted-foreground">
                Drag the handle at the bottom of the image, or use the controls below.
                Hold <kbd className="px-1 py-0.5 rounded border border-border text-[10px]">Shift</kbd> while dragging to snap to 15°.
              </p>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">Angle</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={rotationAngle}
                      min={-180}
                      max={180}
                      onChange={(e) => onRotationChange(Number(e.target.value))}
                      className="w-16 rounded-lg border border-border bg-background px-2 py-0.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <span className="text-xs text-muted-foreground">°</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={rotationAngle}
                  onChange={(e) => onRotationChange(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { icon: RotateCcw, label: "-90°", action: () => onRotationChange(rotationAngle - 90) },
                  { icon: RotateCw,  label: "+90°", action: () => onRotationChange(rotationAngle + 90) },
                  { icon: FlipHorizontal2, label: "Reset", action: () => onRotationChange(0) },
                  { icon: FlipVertical2,   label: "180°",  action: () => onRotationChange(180) },
                ].map(({ icon: Icon, label, action }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={action}
                    className="flex flex-col items-center gap-1 rounded-lg border border-border px-1 py-2 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="text-[10px] leading-none">{label}</span>
                  </button>
                ))}
              </div>

              {/* Flip — applies instantly as a new version */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground">Flip</span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    disabled={flipMutation.isPending}
                    onClick={() => flipMutation.mutate("horizontal")}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-2 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <FlipHorizontal2 className="h-3.5 w-3.5" /> Horizontal
                  </button>
                  <button
                    type="button"
                    disabled={flipMutation.isPending}
                    onClick={() => flipMutation.mutate("vertical")}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-2 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <FlipVertical2 className="h-3.5 w-3.5" /> Vertical
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-foreground">Background</label>
                  <button
                    type="button"
                    onClick={() => setFillTransparent((v) => !v)}
                    className={cn(
                      "text-xs px-2 py-0.5 rounded-full border transition-colors",
                      fillTransparent
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Transparent
                  </button>
                </div>
                {!fillTransparent && (
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={fillColor}
                      onChange={(e) => setFillColor(e.target.value)}
                      className="h-8 w-8 cursor-pointer rounded-md border border-border p-0.5 bg-transparent"
                    />
                    <span className="text-xs text-muted-foreground font-mono">{fillColor}</span>
                  </div>
                )}
                {fillTransparent && (
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-md border border-border"
                      style={{ background: "repeating-conic-gradient(#aaa 0% 25%, #fff 0% 50%) 0 0 / 8px 8px" }} />
                    <span className="text-xs text-muted-foreground">Transparent PNG</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Adjust (non-destructive stack + histogram) ────────────────────── */}
          {tool === "adjust" && (
            <div className="flex flex-col gap-4">
              <div>
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Quick looks</span>
                <div className="flex flex-wrap gap-1.5">
                  {([
                    { label: "Auto", b: 8, c: 12, s: 10 },
                    { label: "Punch", b: 5, c: 25, s: 30 },
                    { label: "Soft", b: 10, c: -8, s: -12 },
                    { label: "Fade", b: 14, c: -18, s: -22 },
                    { label: "Mono", b: 0, c: 10, s: -100 },
                  ]).map((p) => {
                    const active = brightness === p.b && contrast === p.c && saturation === p.s;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => { setBrightness(p.b); setContrast(p.c); setSaturation(p.s); }}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                          active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground hover:bg-accent",
                        )}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Histogram</span>
                <Histogram
                  imageUrl={imageUrl}
                  filter={`brightness(${(1 + brightness / 100).toFixed(2)}) contrast(${(1 + contrast / 100).toFixed(2)}) saturate(${(1 + saturation / 100).toFixed(2)})`}
                />
              </div>
              <Slider label="Brightness" value={brightness} min={-100} max={100} step={1} onChange={setBrightness} />
              <Slider label="Contrast" value={contrast} min={-100} max={100} step={1} onChange={setContrast} />
              <Slider label="Saturation" value={saturation} min={-100} max={100} step={1} onChange={setSaturation} />
              {(brightness !== 0 || contrast !== 0 || saturation !== 0) && (
                <button
                  type="button"
                  onClick={() => { setBrightness(0); setContrast(0); setSaturation(0); }}
                  className="self-start text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Reset adjustments
                </button>
              )}
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Changes preview live and stay non-destructive until you press Save.
              </p>
            </div>
          )}

          {/* ── Filter ────────────────────────────────────────────────────────── */}
          {tool === "filter" && (
            <div className="flex flex-col gap-3">
              <span className="text-xs font-medium text-foreground">Choose a filter</span>
              <div className="flex flex-col gap-1.5">
                {FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFilterName(f.value)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors text-left",
                      filterName === f.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-foreground hover:bg-accent",
                    )}
                  >
                    <span
                      className="h-5 w-5 rounded-full border border-border shrink-0"
                      style={{
                        background:
                          f.value === "grayscale" ? "linear-gradient(135deg, #999 50%, #ccc 50%)" :
                          f.value === "sepia" ? "linear-gradient(135deg, #a08060 50%, #c0a080 50%)" :
                          f.value === "warm" ? "linear-gradient(135deg, #f0a060 50%, #f8c080 50%)" :
                          f.value === "cool" ? "linear-gradient(135deg, #60a0f0 50%, #80c0f8 50%)" :
                          "linear-gradient(135deg, hsl(var(--primary)) 50%, hsl(var(--primary)/0.6) 50%)",
                      }}
                    />
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Denoise ───────────────────────────────────────────────────────── */}
          {tool === "denoise" && (
            <Slider label="Strength" value={denoiseStrength} min={0} max={1} step={0.1} onChange={setDenoiseStrength} />
          )}

          {/* ── Sharpen ───────────────────────────────────────────────────────── */}
          {tool === "sharpen" && (
            <Slider label="Strength" value={sharpenStrength} min={0} max={1} step={0.1} onChange={setSharpenStrength} />
          )}

          {/* ── Remove BG / Remove Object / Smart Erase ───────────────────────── */}
          {(tool === "remove_background" || tool === "remove_object" || tool === "smart_erase") && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {tool === "remove_background"
                ? "Automatically removes the background. No mask needed."
                : tool === "smart_erase"
                ? "Best for text, watermarks, and logos on simple backgrounds."
                : "AI-powered removal for furniture, products, and complex objects. Paint over the object and click Apply."}
            </p>
          )}

          {/* ── Mask-based AI tools that need a prompt ─────────────────────────── */}
          {(tool === "replace_background" || tool === "insert_object" || tool === "generative_fill") && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Paint the area on the image, then describe what you want.
              </p>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-foreground">
                  {tool === "replace_background" ? "New background" : "Description"}
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  placeholder={
                    tool === "replace_background"
                      ? "e.g. Sunny beach with clear blue water"
                      : "e.g. A red ball"
                  }
                  className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                />
              </div>
            </div>
          )}

          {/* ── Shadow ────────────────────────────────────────────────────────── */}
          {tool === "generate_shadow" && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-foreground">Direction</span>
              <div className="grid grid-cols-2 gap-1.5">
                {["bottom", "top", "left", "right"].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setShadowDir(d)}
                    className={cn(
                      "rounded-lg border px-2 py-1.5 text-xs font-medium capitalize transition-colors",
                      shadowDir === d
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-foreground hover:bg-accent",
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Relight ───────────────────────────────────────────────────────── */}
          {tool === "relight" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-foreground">Light direction</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {["top", "bottom", "left", "right"].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setRelightDir(d)}
                      className={cn(
                        "rounded-lg border px-2 py-1.5 text-xs font-medium capitalize transition-colors",
                        relightDir === d
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-foreground hover:bg-accent",
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <Slider label="Intensity" value={relightIntensity} min={0.1} max={3} step={0.1} onChange={setRelightIntensity} />
            </div>
          )}

          {/* ── Restore face ──────────────────────────────────────────────────── */}
          {tool === "restore_face" && (
            <Slider label="Fidelity" value={fidelity} min={0} max={1} step={0.05} onChange={setFidelity} />
          )}

          {/* ── Upscale ───────────────────────────────────────────────────────── */}
          {tool === "upscale" && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-foreground">Scale factor</span>
              <div className="flex gap-2">
                {["2", "4"].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScale(s)}
                    className={cn(
                      "flex-1 rounded-lg border py-2 text-sm font-semibold transition-colors",
                      scale === s
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-foreground hover:bg-accent",
                    )}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Text / Compose tool ───────────────────────────────────────────── */}
          {tool === "text" && (
            <div className="flex flex-col gap-5">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Add text or images as layers. Drag to reposition, double-click text to edit inline. Click <strong>Burn into image</strong> to flatten all layers.
              </p>

              {/* Add text form */}
              <div className="flex flex-col gap-2.5 rounded-xl border border-border p-3 bg-muted/20">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Add Text</p>
                <input
                  type="text"
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddText(); }}
                  placeholder="Type your text..."
                  className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />

                {/* Font picker */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-foreground">Font</label>
                  <select
                    value={textFontFamily}
                    onChange={(e) => setTextFontFamily(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    style={{ fontFamily: textFontFamily }}
                  >
                    {CANVAS_FONTS.map((f) => (
                      <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>

                <Slider label="Size" value={textFontSize} min={12} max={120} step={2} onChange={setTextFontSize} />

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-medium text-foreground">Color</label>
                    <input
                      type="color"
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="h-7 w-9 cursor-pointer rounded border border-border p-0.5 bg-transparent"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setTextBold((v) => !v)}
                    className={cn(
                      "flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors",
                      textBold ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Bold className="h-3 w-3" /> Bold
                  </button>
                  <button
                    type="button"
                    onClick={() => setTextItalic((v) => !v)}
                    className={cn(
                      "flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors",
                      textItalic ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Italic className="h-3 w-3" /> Italic
                  </button>
                </div>

                <button
                  type="button"
                  disabled={!newText.trim()}
                  onClick={handleAddText}
                  className="w-full rounded-lg bg-primary/10 border border-primary/30 text-primary text-xs font-semibold py-1.5 hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Add to canvas
                </button>
              </div>

              {/* Selected layer properties */}
              {selectedLayer && (
                <div className="flex flex-col gap-2.5 rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-primary uppercase tracking-wider">
                      {selectedLayer.type === "text" ? "Text Properties" : "Image Properties"}
                    </p>
                    <button
                      type="button"
                      onClick={() => onDuplicateLayer?.(selectedLayer.id)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="Duplicate layer (Ctrl+D)"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <AlignRow layerId={selectedLayer.id} onAlign={onAlignLayer} />

                  {selectedLayer.type === "text" && (
                    <>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-foreground">Text</label>
                        <input
                          type="text"
                          value={selectedLayer.text}
                          onChange={(e) => onUpdateLayer(selectedLayer.id, { text: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-foreground">Font</label>
                        <select
                          value={selectedLayer.fontFamily}
                          onChange={(e) => onUpdateLayer(selectedLayer.id, { fontFamily: e.target.value })}
                          className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                          style={{ fontFamily: selectedLayer.fontFamily }}
                        >
                          {CANVAS_FONTS.map((f) => (
                            <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Slider
                        label="Size"
                        value={selectedLayer.fontSize}
                        min={12}
                        max={120}
                        step={2}
                        onChange={(v) => onUpdateLayer(selectedLayer.id, { fontSize: v })}
                      />
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <label className="text-xs font-medium text-foreground">Color</label>
                          <input
                            type="color"
                            value={selectedLayer.color}
                            onChange={(e) => onUpdateLayer(selectedLayer.id, { color: e.target.value })}
                            className="h-7 w-9 cursor-pointer rounded border border-border p-0.5 bg-transparent"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => onUpdateLayer(selectedLayer.id, { bold: !selectedLayer.bold })}
                          className={cn(
                            "flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors",
                            selectedLayer.bold ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Bold className="h-3 w-3" /> Bold
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpdateLayer(selectedLayer.id, { italic: !selectedLayer.italic })}
                          className={cn(
                            "flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors",
                            selectedLayer.italic ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Italic className="h-3 w-3" /> Italic
                        </button>
                      </div>

                      {/* ── Text effects ─────────────────────────────────── */}
                      <div className="h-px bg-border/60" />
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Effects</p>

                      {/* Style toggles */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onUpdateLayer(selectedLayer.id, { uppercase: !selectedLayer.uppercase })}
                          title="Uppercase"
                          className={cn(
                            "rounded-lg border px-2 py-1 text-xs font-semibold transition-colors",
                            selectedLayer.uppercase ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                          )}
                        >
                          AA
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpdateLayer(selectedLayer.id, { shadow: !(selectedLayer.shadow ?? true) })}
                          className={cn(
                            "rounded-lg border px-2 py-1 text-xs font-medium transition-colors",
                            (selectedLayer.shadow ?? true) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                          )}
                        >
                          Shadow
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpdateLayer(selectedLayer.id, { bgColor: selectedLayer.bgColor ? null : "#111111" })}
                          className={cn(
                            "rounded-lg border px-2 py-1 text-xs font-medium transition-colors",
                            selectedLayer.bgColor ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                          )}
                        >
                          Background
                        </button>
                        {selectedLayer.bgColor && (
                          <input
                            type="color"
                            value={selectedLayer.bgColor}
                            onChange={(e) => onUpdateLayer(selectedLayer.id, { bgColor: e.target.value })}
                            className="h-7 w-9 cursor-pointer rounded border border-border p-0.5 bg-transparent"
                            title="Background colour"
                          />
                        )}
                      </div>

                      <Slider
                        label="Opacity"
                        value={Math.round((selectedLayer.opacity ?? 1) * 100)}
                        min={10}
                        max={100}
                        step={5}
                        onChange={(v) => onUpdateLayer(selectedLayer.id, { opacity: v / 100 })}
                      />
                      <Slider
                        label="Letter spacing"
                        value={selectedLayer.letterSpacing ?? 0}
                        min={0}
                        max={20}
                        step={1}
                        onChange={(v) => onUpdateLayer(selectedLayer.id, { letterSpacing: v })}
                      />
                      <Slider
                        label="Outline"
                        value={selectedLayer.outlineWidth ?? 0}
                        min={0}
                        max={10}
                        step={1}
                        onChange={(v) => onUpdateLayer(selectedLayer.id, { outlineWidth: v })}
                      />
                      {(selectedLayer.outlineWidth ?? 0) > 0 && (
                        <div className="flex items-center gap-1.5">
                          <label className="text-xs font-medium text-foreground">Outline colour</label>
                          <input
                            type="color"
                            value={selectedLayer.outlineColor ?? "#000000"}
                            onChange={(e) => onUpdateLayer(selectedLayer.id, { outlineColor: e.target.value })}
                            className="h-7 w-9 cursor-pointer rounded border border-border p-0.5 bg-transparent"
                          />
                        </div>
                      )}
                    </>
                  )}

                  {selectedLayer.type === "image" && (
                    <>
                      <Slider
                        label="Size"
                        value={Math.round((selectedLayer as ImageLayer).widthPct)}
                        min={5}
                        max={100}
                        step={1}
                        onChange={(v) => onUpdateLayer(selectedLayer.id, { widthPct: v })}
                      />
                      <Slider
                        label="Opacity"
                        value={Math.round(((selectedLayer as ImageLayer).opacity ?? 1) * 100)}
                        min={10}
                        max={100}
                        step={5}
                        onChange={(v) => onUpdateLayer(selectedLayer.id, { opacity: v / 100 })}
                      />
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-foreground">Rotation</span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              value={(selectedLayer as ImageLayer).rotation ?? 0}
                              min={-180}
                              max={180}
                              onChange={(e) => onUpdateLayer(selectedLayer.id, { rotation: Number(e.target.value) })}
                              className="w-14 rounded-lg border border-border bg-background px-2 py-0.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                            <span className="text-xs text-muted-foreground">°</span>
                            <button
                              type="button"
                              onClick={() => onUpdateLayer(selectedLayer.id, { rotation: 0 })}
                              className="text-muted-foreground hover:text-foreground transition-colors"
                              title="Reset rotation"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <input
                          type="range"
                          min={-180}
                          max={180}
                          step={1}
                          value={(selectedLayer as ImageLayer).rotation ?? 0}
                          onChange={(e) => onUpdateLayer(selectedLayer.id, { rotation: Number(e.target.value) })}
                          className="w-full accent-primary"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-foreground">Layer order</span>
                        <div className="grid grid-cols-4 gap-1">
                          {[
                            { icon: ChevronsUp,   label: "Front", title: "Send to front", action: () => onMoveLayerToFront(selectedLayer.id) },
                            { icon: ChevronUp,    label: "Up",    title: "Move up one",   action: () => onMoveLayerUp(selectedLayer.id) },
                            { icon: ChevronDown,  label: "Down",  title: "Move down one", action: () => onMoveLayerDown(selectedLayer.id) },
                            { icon: ChevronsDown, label: "Back",  title: "Send to back",  action: () => onMoveLayerToBack(selectedLayer.id) },
                          ].map(({ icon: Icon, label, title, action }) => (
                            <button
                              key={label}
                              type="button"
                              onClick={action}
                              title={title}
                              className="flex flex-col items-center gap-0.5 rounded-lg border border-border px-1 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                            >
                              <Icon className="h-3.5 w-3.5" />
                              <span className="text-[9px] leading-none">{label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Layers list */}
              {layers.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Layers</p>
                  {reversedLayers.map((layer, displayIdx) => {
                    const arrayIdx = layers.length - 1 - displayIdx;
                    const isSelected = selectedLayerId === layer.id;
                    return (
                      <div
                        key={layer.id}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-2 py-1.5 cursor-pointer transition-colors",
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-accent/50",
                        )}
                        onClick={() => onSelectLayer(layer.id)}
                      >
                        {/* Visibility toggle */}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onToggleLayerVisible(layer.id); }}
                          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                          title={layer.visible ? "Hide layer" : "Show layer"}
                        >
                          {layer.visible !== false
                            ? <Eye className="h-3.5 w-3.5" />
                            : <EyeOff className="h-3.5 w-3.5 opacity-40" />}
                        </button>

                        {/* Thumbnail / icon */}
                        {layer.type === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={(layer as ImageLayer).imageUrl}
                            alt={(layer as ImageLayer).name}
                            className="h-7 w-7 rounded object-cover shrink-0 border border-border"
                          />
                        ) : (
                          <div className="h-7 w-7 flex items-center justify-center rounded bg-muted shrink-0 border border-border">
                            <Type className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                        )}

                        {/* Name */}
                        <span
                          className="flex-1 text-xs text-foreground truncate"
                          style={layer.type === "text" ? {
                            fontFamily: (layer as TextLayer).fontFamily,
                            fontWeight: (layer as TextLayer).bold ? "bold" : "normal",
                            fontStyle: (layer as TextLayer).italic ? "italic" : "normal",
                          } : undefined}
                        >
                          {layer.type === "text"
                            ? (layer as TextLayer).text || "Empty text"
                            : (layer as ImageLayer).name}
                        </span>

                        {/* Reorder */}
                        <div className="flex flex-col shrink-0">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onMoveLayerUp(layer.id); }}
                            disabled={arrayIdx === layers.length - 1}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-25 transition-colors"
                            title="Move up"
                          >
                            <ChevronUp className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onMoveLayerDown(layer.id); }}
                            disabled={arrayIdx === 0}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-25 transition-colors"
                            title="Move down"
                          >
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </div>

                        {/* Delete */}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onRemoveLayer(layer.id); }}
                          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                          title="Delete layer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {burnError && (
                <p className="text-xs text-destructive">{burnError}</p>
              )}
            </div>
          )}

          {/* ── Shapes ────────────────────────────────────────────────────── */}
          {tool === "shapes" && (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Add shapes as layers — drag, resize, rotate and stack them like any other layer.
              </p>

              {/* Style controls — applied to newly inserted shapes */}
              <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-muted/20 p-3">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Style</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(["solid", "gradient"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setShapeGradient(m === "gradient")}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors",
                        (m === "gradient") === shapeGradient
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {m}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShapeShadow((v) => !v)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                      shapeShadow
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Shadow
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-medium text-foreground">{shapeGradient ? "From" : "Colour"}</label>
                    <input
                      type="color"
                      value={shapeColor}
                      onChange={(e) => setShapeColor(e.target.value)}
                      className="h-7 w-9 cursor-pointer rounded border border-border p-0.5 bg-transparent"
                    />
                  </div>
                  {shapeGradient && (
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs font-medium text-foreground">To</label>
                      <input
                        type="color"
                        value={shapeColor2 ?? shapeColor}
                        onChange={(e) => setShapeColor2(e.target.value)}
                        className="h-7 w-9 cursor-pointer rounded border border-border p-0.5 bg-transparent"
                      />
                      {shapeColor2 && (
                        <button
                          type="button"
                          onClick={() => setShapeColor2(null)}
                          className="text-[10px] text-muted-foreground hover:text-foreground"
                          title="Back to automatic darker shade"
                        >
                          Auto
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Grouped catalog — previews render the live style */}
              {SHAPE_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-5 gap-2">
                    {group.shapes.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        title={s.label}
                        onClick={() => onAddImageLayer(shapeDataUri(s.id, shapeStyle), `shape:${s.id}`, shapeAspect(s.id, shapeShadow), 28)}
                        className="flex aspect-square items-center justify-center rounded-lg border border-border p-1 transition-colors hover:border-primary/50 hover:bg-accent"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={shapeDataUri(s.id, shapeStyle)} alt={s.label} className="max-h-full max-w-full" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {/* Selected shape properties — style is parsed back and editable */}
              {selectedLayer?.type === "image" && selectedLayer.name.startsWith("shape:") && (() => {
                const sel = selectedLayer as ImageLayer;
                const shapeId = sel.name.split(":")[1] as ShapeId;
                const cur = parseShapeStyle(sel.imageUrl);
                const regen = (patch: Partial<ShapeStyle>) => {
                  const next = { ...cur, ...patch };
                  onUpdateLayer(sel.id, {
                    imageUrl: shapeDataUri(shapeId, next),
                    aspectRatio: shapeAspect(shapeId, !!next.shadow),
                  });
                };
                return (
                  <div className="flex flex-col gap-2.5 rounded-xl border border-primary/30 bg-primary/5 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-semibold text-primary uppercase tracking-wider">Shape</p>
                      <button
                        type="button"
                        onClick={() => onRemoveLayer(sel.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        title="Delete layer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => regen({ gradient: !cur.gradient })}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                          cur.gradient ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        Gradient
                      </button>
                      <button
                        type="button"
                        onClick={() => regen({ shadow: !cur.shadow })}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                          cur.shadow ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        Shadow
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <label className="text-xs font-medium text-foreground">{cur.gradient ? "From" : "Colour"}</label>
                        <input
                          type="color"
                          value={cur.color}
                          onChange={(e) => regen({ color: e.target.value })}
                          className="h-7 w-9 cursor-pointer rounded border border-border p-0.5 bg-transparent"
                        />
                      </div>
                      {cur.gradient && (
                        <div className="flex items-center gap-1.5">
                          <label className="text-xs font-medium text-foreground">To</label>
                          <input
                            type="color"
                            value={cur.color2 ?? cur.color}
                            onChange={(e) => regen({ color2: e.target.value })}
                            className="h-7 w-9 cursor-pointer rounded border border-border p-0.5 bg-transparent"
                          />
                        </div>
                      )}
                    </div>
                    <Slider
                      label="Size"
                      value={Math.round(sel.widthPct)}
                      min={2}
                      max={100}
                      step={1}
                      onChange={(v) => onUpdateLayer(sel.id, { widthPct: v })}
                    />
                    <Slider
                      label="Opacity"
                      value={Math.round((sel.opacity ?? 1) * 100)}
                      min={5}
                      max={100}
                      step={5}
                      onChange={(v) => onUpdateLayer(sel.id, { opacity: v / 100 })}
                    />
                    <AlignRow layerId={sel.id} onAlign={onAlignLayer} />
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── Text Templates ────────────────────────────────────────────── */}
          {tool === "templates" && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Drop a pre-styled text composition onto your image. Every layer stays fully editable — move, restyle, or rewrite it.
              </p>

              {/* Persona categories */}
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setTemplateCategory(c.id)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                      templateCategory === c.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground hover:bg-accent",
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              {/* Brand-aware toggle */}
              {brandUsable && (
                <button
                  type="button"
                  onClick={() => setBrandTemplates((v) => !v)}
                  className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-accent"
                >
                  <span className="flex-1 text-xs text-foreground">
                    Use brand kit <span className="text-muted-foreground">(badges take your colours &amp; fonts)</span>
                  </span>
                  <span className={cn("relative inline-flex h-4 w-7 items-center rounded-full transition-colors", brandTemplates ? "bg-primary" : "bg-border")}>
                    <span className={cn("inline-block h-3 w-3 transform rounded-full bg-white transition-transform", brandTemplates ? "translate-x-3.5" : "translate-x-0.5")} />
                  </span>
                </button>
              )}

              <div className="grid grid-cols-2 gap-2">
                {TEXT_TEMPLATES.filter((t) => templateCategory === "all" || t.category === templateCategory).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => applyTemplate(t)}
                    className="group rounded-xl border border-border overflow-hidden text-left transition-all hover:border-primary/50 hover:shadow-md"
                  >
                    {/* Live miniature preview — real backgrounds, shapes and text styles.
                        Overlay templates use a dark gradient photo stand-in. */}
                    {(() => {
                      const { background, layers: defs } = resolveTemplate(t);
                      return (
                        <div
                          className="relative aspect-[4/3] w-full overflow-hidden"
                          style={{ background: background ? backgroundCss(background) : "linear-gradient(135deg, #64748b, #1e293b)" }}
                        >
                          {defs.map((def, i) =>
                            def.kind === "shape" ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                key={i}
                                src={shapeDataUri(def.shape, def.color, { color2: def.color2, gradient: def.gradient, shadow: def.shadow })}
                                alt=""
                                style={{
                                  position: "absolute",
                                  left: `${def.xPct}%`,
                                  top: `${def.yPct}%`,
                                  width: `${def.widthPct}%`,
                                  opacity: def.opacity ?? 1,
                                  transform: def.rotation ? `rotate(${def.rotation}deg)` : undefined,
                                }}
                              />
                            ) : (
                              <span
                                key={i}
                                style={{
                                  position: "absolute",
                                  left: `${def.xPct}%`,
                                  top: `${def.yPct}%`,
                                  fontSize: Math.max(5, def.fontSize * 0.17),
                                  color: def.color,
                                  fontFamily: def.fontFamily,
                                  fontWeight: def.bold ? "bold" : "normal",
                                  fontStyle: def.italic ? "italic" : "normal",
                                  letterSpacing: `${(def.letterSpacing ?? 0) * 0.17}px`,
                                  WebkitTextStroke: (def.outlineWidth ?? 0) > 0
                                    ? `${Math.max(0.5, (def.outlineWidth ?? 0) * 0.17)}px ${def.outlineColor ?? "#000000"}`
                                    : undefined,
                                  background: def.bgColor || undefined,
                                  padding: def.bgColor ? "0.18em 0.3em" : undefined,
                                  borderRadius: def.bgColor ? "0.25em" : undefined,
                                  textTransform: def.uppercase ? "uppercase" : undefined,
                                  opacity: def.opacity ?? 1,
                                  textShadow: (def.shadow ?? true) ? "0 1px 2px rgba(0,0,0,0.5)" : undefined,
                                  whiteSpace: "nowrap",
                                  lineHeight: 1.2,
                                }}
                              >
                                {def.text}
                              </span>
                            ),
                          )}
                        </div>
                      );
                    })()}
                    <div className="px-2 py-1.5">
                      <span className="text-[11px] font-medium text-foreground group-hover:text-primary transition-colors">
                        {t.name}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Convert to Canvas ─────────────────────────────────────────── */}
          {tool === "convert_canvas" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-muted/20 p-3">
                <div className="flex items-center gap-2">
                  <ScanLine className="h-4 w-4 text-primary shrink-0" strokeWidth={1.8} />
                  <p className="text-xs font-semibold text-foreground">Convert to Canvas</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  AI breaks your image into fully editable layers — background, objects, and text. Move, resize, or restyle any element and burn back to a flat image.
                </p>
              </div>

              {!decomposeResult && !decomposeLoading && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Background quality
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([
                      { value: "diffusion", label: "Fast", hint: "Instant, smooth fill" },
                      { value: "lama", label: "High (AI)", hint: "LaMa — best quality, slower" },
                    ] as const).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setInpaintMethod(opt.value)}
                        title={opt.hint}
                        className={cn(
                          "flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                          inpaintMethod === opt.value
                            ? "border-primary bg-primary/10"
                            : "border-border hover:bg-accent",
                        )}
                      >
                        <span className={cn(
                          "text-xs font-semibold",
                          inpaintMethod === opt.value ? "text-primary" : "text-foreground",
                        )}>
                          {opt.label}
                        </span>
                        <span className="text-[10px] text-muted-foreground leading-tight">{opt.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!decomposeResult && !decomposeLoading && (
                <button
                  type="button"
                  onClick={async () => {
                    setDecomposeError(null);
                    setDecomposeLoading(true);
                    try {
                      const result = await decomposeImage(imageId, inpaintMethod);
                      setDecomposeResult(result);
                      const now = Date.now();
                      const bg = result.background;

                      // Background layer — full-size extracted background (objects/text cut out)
                      const bgAr = bg.image_width > 0 && bg.image_height > 0
                        ? bg.image_width / bg.image_height
                        : await new Promise<number>((res) => {
                            const i = new window.Image(); i.onload = () => res(i.naturalWidth / (i.naturalHeight || 1)); i.onerror = () => res(1); i.src = imageUrl;
                          });
                      const bgDataUri = bg.image_data || makeSolidColorDataUri(bg.dominant_color);
                      const bgLayer: ImageLayer = {
                        id: `ai-bg-${now}`,
                        type: "image",
                        imageUrl: bgDataUri,
                        name: "Background",
                        xPct: 0,
                        yPct: 0,
                        widthPct: 100,
                        aspectRatio: bgAr,
                        opacity: 1,
                        visible: true,
                      };

                      // Object layers — full-canvas RGBA PNGs (position baked into alpha)
                      // All layers use xPct=0, yPct=0, widthPct=100 so the PNG is drawn
                      // at full canvas size; the object sits at the right spot via transparency.
                      const objectLayers: Layer[] = result.objects
                        .filter((obj) => obj.image_data)
                        .map((obj, i) => ({
                          id: `ai-obj-${now}-${i}`,
                          type: "image" as const,
                          imageUrl: obj.image_data,
                          name: obj.description,
                          xPct: 0,
                          yPct: 0,
                          widthPct: 100,
                          aspectRatio: bgAr,
                          opacity: 1,
                          visible: true,
                        } as ImageLayer));

                      const textLayers: Layer[] = result.text_elements.map((el, i) => ({
                        id: `ai-t-${now}-${i}`,
                        type: "text" as const,
                        text: el.text,
                        xPct: el.x_pct,
                        yPct: el.y_pct,
                        fontSize: Math.max(10, Math.min(200, el.font_size)),
                        color: el.color,
                        bold: el.bold,
                        italic: el.italic,
                        fontFamily: "Inter, sans-serif",
                        visible: true,
                      }));

                      // Hide static base image — canvas is now entirely layers
                      onHideBaseImage?.(true);
                      onSetLayers([bgLayer, ...objectLayers, ...textLayers]);
                    } catch (e) {
                      setDecomposeError(e instanceof Error ? e.message : "Analysis failed");
                    } finally {
                      setDecomposeLoading(false);
                    }
                  }}
                  className="flex items-center justify-center gap-2 w-full rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors"
                >
                  <Sparkles className="h-4 w-4" strokeWidth={1.8} />
                  Analyze Image
                </button>
              )}

              {decomposeLoading && (
                <div className="flex flex-col items-center gap-3 py-6">
                  <div className="relative w-10 h-10 flex items-center justify-center">
                    <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
                    <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
                    <ScanLine className="h-4 w-4 text-primary" strokeWidth={1.8} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {inpaintMethod === "lama" ? "Reconstructing background (AI)…" : "Scanning image elements…"}
                  </p>
                  {inpaintMethod === "lama" && (
                    <p className="text-[10px] text-muted-foreground/70">High quality can take up to a minute</p>
                  )}
                </div>
              )}

              {decomposeError && (
                <p className="text-xs text-destructive leading-relaxed">{decomposeError}</p>
              )}

              {decomposeResult && !decomposeLoading && (
                <div className="flex flex-col gap-2">
                  {layers.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      No distinct elements found. Try with an image that has visible text or clear objects.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => { setDecomposeResult(null); setDecomposeError(null); onSetLayers([]); onHideBaseImage?.(false); }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
                  >
                    Re-analyze
                  </button>
                </div>
              )}

              {/* ── Editable layers (shown after decompose while on convert_canvas) ── */}
              {layers.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  <div className="h-px bg-border" />

                  {/* Selected layer properties */}
                  {selectedLayer && (
                    <div className="flex flex-col gap-2.5 rounded-xl border border-primary/30 bg-primary/5 p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-semibold text-primary uppercase tracking-wider">
                          {selectedLayer.type === "text" ? "Text" : "Object"}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onDuplicateLayer?.(selectedLayer.id)}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            title="Duplicate layer (Ctrl+D)"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemoveLayer(selectedLayer.id)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                            title="Delete layer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <AlignRow layerId={selectedLayer.id} onAlign={onAlignLayer} />

                      {selectedLayer.type === "text" && (
                        <>
                          <input
                            type="text"
                            value={(selectedLayer as TextLayer).text}
                            onChange={(e) => onUpdateLayer(selectedLayer.id, { text: e.target.value })}
                            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                          <div className="flex flex-col gap-1">
                            <select
                              value={(selectedLayer as TextLayer).fontFamily}
                              onChange={(e) => onUpdateLayer(selectedLayer.id, { fontFamily: e.target.value })}
                              className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                              style={{ fontFamily: (selectedLayer as TextLayer).fontFamily }}
                            >
                              {CANVAS_FONTS.map((f) => (
                                <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>
                              ))}
                            </select>
                          </div>
                          <Slider
                            label="Size"
                            value={(selectedLayer as TextLayer).fontSize}
                            min={12}
                            max={120}
                            step={2}
                            onChange={(v) => onUpdateLayer(selectedLayer.id, { fontSize: v })}
                          />
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1.5">
                              <label className="text-xs font-medium text-foreground">Color</label>
                              <input
                                type="color"
                                value={(selectedLayer as TextLayer).color}
                                onChange={(e) => onUpdateLayer(selectedLayer.id, { color: e.target.value })}
                                className="h-7 w-9 cursor-pointer rounded border border-border p-0.5 bg-transparent"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => onUpdateLayer(selectedLayer.id, { bold: !(selectedLayer as TextLayer).bold })}
                              className={cn(
                                "flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors",
                                (selectedLayer as TextLayer).bold ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                              )}
                            >
                              <Bold className="h-3 w-3" /> Bold
                            </button>
                            <button
                              type="button"
                              onClick={() => onUpdateLayer(selectedLayer.id, { italic: !(selectedLayer as TextLayer).italic })}
                              className={cn(
                                "flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors",
                                (selectedLayer as TextLayer).italic ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                              )}
                            >
                              <Italic className="h-3 w-3" /> Italic
                            </button>
                          </div>
                        </>
                      )}

                      {selectedLayer.type === "image" && (
                        <>
                          <Slider
                            label="Size"
                            value={Math.round((selectedLayer as ImageLayer).widthPct)}
                            min={5}
                            max={100}
                            step={1}
                            onChange={(v) => onUpdateLayer(selectedLayer.id, { widthPct: v })}
                          />
                          <Slider
                            label="Opacity"
                            value={Math.round(((selectedLayer as ImageLayer).opacity ?? 1) * 100)}
                            min={10}
                            max={100}
                            step={5}
                            onChange={(v) => onUpdateLayer(selectedLayer.id, { opacity: v / 100 })}
                          />
                          <div className="grid grid-cols-4 gap-1">
                            {[
                              { icon: ChevronsUp,   label: "Front", action: () => onMoveLayerToFront(selectedLayer.id) },
                              { icon: ChevronUp,    label: "Up",    action: () => onMoveLayerUp(selectedLayer.id) },
                              { icon: ChevronDown,  label: "Down",  action: () => onMoveLayerDown(selectedLayer.id) },
                              { icon: ChevronsDown, label: "Back",  action: () => onMoveLayerToBack(selectedLayer.id) },
                            ].map(({ icon: Icon, label, action }) => (
                              <button key={label} type="button" onClick={action}
                                className="flex flex-col items-center gap-0.5 rounded-lg border border-border px-1 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                                <Icon className="h-3.5 w-3.5" />
                                <span className="text-[9px] leading-none">{label}</span>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Layer list */}
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Layers ({layers.length})</p>
                  {[...layers].reverse().map((layer, displayIdx) => {
                    const arrayIdx = layers.length - 1 - displayIdx;
                    const isSelected = selectedLayerId === layer.id;
                    return (
                      <div
                        key={layer.id}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-2 py-1.5 cursor-pointer transition-colors",
                          isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-accent/50",
                        )}
                        onClick={() => onSelectLayer(layer.id)}
                      >
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); onToggleLayerVisible(layer.id); }}
                          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                          {layer.visible !== false ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 opacity-40" />}
                        </button>
                        <div className="h-7 w-7 flex items-center justify-center rounded bg-muted shrink-0 border border-border overflow-hidden">
                          {layer.type === "image"
                            ? <Box className="h-3.5 w-3.5 text-muted-foreground" />
                            : <Type className="h-3.5 w-3.5 text-muted-foreground" />}
                        </div>
                        <span className="flex-1 text-xs text-foreground truncate"
                          style={layer.type === "text" ? {
                            fontFamily: (layer as TextLayer).fontFamily,
                            fontWeight: (layer as TextLayer).bold ? "bold" : "normal",
                            fontStyle: (layer as TextLayer).italic ? "italic" : "normal",
                            color: (layer as TextLayer).color,
                          } : undefined}>
                          {layer.type === "text" ? (layer as TextLayer).text || "Empty text" : (layer as ImageLayer).name}
                        </span>
                        <div className="flex flex-col shrink-0">
                          <button type="button"
                            onClick={(e) => { e.stopPropagation(); onMoveLayerUp(layer.id); }}
                            disabled={arrayIdx === layers.length - 1}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-25 transition-colors">
                            <ChevronUp className="h-3 w-3" />
                          </button>
                          <button type="button"
                            onClick={(e) => { e.stopPropagation(); onMoveLayerDown(layer.id); }}
                            disabled={arrayIdx === 0}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-25 transition-colors">
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        </div>
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); onRemoveLayer(layer.id); }}
                          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Add Image tool ─────────────────────────────────────────────── */}
          {tool === "add_image" && (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Pick an image from your gallery or upload one. Drag it to position on the canvas, then click <strong>Burn into image</strong> to save.
              </p>

              {/* Selected image layer properties */}
              {selectedLayer && selectedLayer.type === "image" && (
                <div className="flex flex-col gap-2.5 rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-primary uppercase tracking-wider">Image Properties</p>
                    <button
                      type="button"
                      onClick={() => onRemoveLayer(selectedLayer.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete layer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <Slider
                    label="Size"
                    value={Math.round((selectedLayer as ImageLayer).widthPct)}
                    min={5}
                    max={100}
                    step={1}
                    onChange={(v) => onUpdateLayer(selectedLayer.id, { widthPct: v })}
                  />
                  <Slider
                    label="Opacity"
                    value={Math.round(((selectedLayer as ImageLayer).opacity ?? 1) * 100)}
                    min={10}
                    max={100}
                    step={5}
                    onChange={(v) => onUpdateLayer(selectedLayer.id, { opacity: v / 100 })}
                  />
                  {/* Rotation */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground">Rotation</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          value={(selectedLayer as ImageLayer).rotation ?? 0}
                          min={-180}
                          max={180}
                          onChange={(e) => onUpdateLayer(selectedLayer.id, { rotation: Number(e.target.value) })}
                          className="w-14 rounded-lg border border-border bg-background px-2 py-0.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        <span className="text-xs text-muted-foreground">°</span>
                        <button
                          type="button"
                          onClick={() => onUpdateLayer(selectedLayer.id, { rotation: 0 })}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="Reset rotation"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={(selectedLayer as ImageLayer).rotation ?? 0}
                      onChange={(e) => onUpdateLayer(selectedLayer.id, { rotation: Number(e.target.value) })}
                      className="w-full accent-primary"
                    />
                  </div>
                  {/* Layer order */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-foreground">Layer order</span>
                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { icon: ChevronsUp, label: "Front", title: "Send to front", action: () => onMoveLayerToFront(selectedLayer.id) },
                        { icon: ChevronUp,  label: "Up",    title: "Move up one",   action: () => onMoveLayerUp(selectedLayer.id) },
                        { icon: ChevronDown, label: "Down", title: "Move down one", action: () => onMoveLayerDown(selectedLayer.id) },
                        { icon: ChevronsDown, label: "Back", title: "Send to back", action: () => onMoveLayerToBack(selectedLayer.id) },
                      ].map(({ icon: Icon, label, title, action }) => (
                        <button
                          key={label}
                          type="button"
                          onClick={action}
                          title={title}
                          className="flex flex-col items-center gap-0.5 rounded-lg border border-border px-1 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        >
                          <Icon className="h-3.5 w-3.5" />
                          <span className="text-[9px] leading-none">{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleLayerVisible(selectedLayer.id)}
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {selectedLayer.visible !== false
                      ? <><Eye className="h-3.5 w-3.5" /> Visible</>
                      : <><EyeOff className="h-3.5 w-3.5 opacity-40" /> Hidden</>}
                  </button>
                </div>
              )}

              {/* Upload from device */}
              <button
                type="button"
                disabled={addImageUploading}
                onClick={() => addImageFileRef.current?.click()}
                className={cn(
                  "flex items-center justify-center gap-2 w-full rounded-xl border-2 border-dashed px-3 py-2.5 text-xs font-medium transition-colors",
                  addImageUploading
                    ? "border-border text-muted-foreground opacity-50 cursor-not-allowed"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-primary cursor-pointer",
                )}
              >
                <Upload className="h-4 w-4" />
                {addImageUploading ? "Uploading..." : "Upload from device"}
              </button>
              <input
                ref={addImageFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !projectId) return;
                  e.target.value = "";
                  setAddImageUploading(true);
                  try {
                    const uploaded = await uploadImage(projectId, file);
                    if (uploaded.image_url) {
                      const el = new window.Image();
                      el.onload = () => {
                        const ar = el.naturalWidth / (el.naturalHeight || 1);
                        onAddImageLayer(uploaded.image_url!, file.name, ar);
                      };
                      el.onerror = () => onAddImageLayer(uploaded.image_url!, file.name, 1);
                      el.src = uploaded.image_url;
                    }
                  } finally {
                    setAddImageUploading(false);
                  }
                }}
              />

              {/* Gallery grid */}
              {galleryLoading ? (
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="aspect-square rounded-lg bg-muted animate-pulse" />
                  ))}
                </div>
              ) : galleryImages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-24 gap-2 text-muted-foreground">
                  <ImageIcon className="h-6 w-6 opacity-40" />
                  <span className="text-xs">No images in this project yet.</span>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {galleryImages
                    .filter((img) => img.image_url && img.status === "ready")
                    .map((img) => (
                      <button
                        key={img.id}
                        type="button"
                        className="aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-primary transition-all focus:outline-none focus:border-primary hover:scale-[1.03]"
                        title={img.prompt}
                        onClick={() => {
                          const el = new window.Image();
                          el.onload = () => {
                            const ar = el.naturalWidth / (el.naturalHeight || 1);
                            onAddImageLayer(img.image_url!, img.prompt.slice(0, 40) || "Image", ar);
                          };
                          el.onerror = () => onAddImageLayer(img.image_url!, img.prompt.slice(0, 40) || "Image", 1);
                          el.src = img.image_url!;
                        }}
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
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border p-4 flex flex-col gap-2">
          {tool === "text" ? (
            <button
              type="button"
              disabled={layers.length === 0 || isBurning}
              onClick={onBurnLayers}
              className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBurning ? "Saving..." : "Burn into image"}
            </button>
          ) : tool === "add_image" || tool === "convert_canvas" || tool === "templates" || tool === "shapes" ? (
            layers.length > 0 ? (
              <>
                {burnError && (
                  <p className="text-xs text-destructive leading-relaxed">{burnError}</p>
                )}
                <button
                  type="button"
                  disabled={isBurning}
                  onClick={onBurnLayers}
                  className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isBurning ? "Saving..." : "Burn into image"}
                </button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground text-center">
                {tool === "convert_canvas"
                  ? "Analyze an image to create editable layers"
                  : tool === "templates"
                  ? "Pick a template to add an editable design"
                  : tool === "shapes"
                  ? "Pick a shape to add it as a layer"
                  : "Select an image above to add it as a layer"}
              </p>
            )
          ) : (
            <>
              {error && (
                <p className="text-xs text-destructive leading-relaxed">{error}</p>
              )}
              <button
                type="button"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className={cn(
                  "w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed",
                  applied && !mutation.isPending
                    ? "bg-green-600 text-white"
                    : "bg-primary text-primary-foreground hover:bg-primary/90",
                )}
              >
                {mutation.isPending ? "Saving..." : applied ? "Saved!" : "Save"}
              </button>
            </>
          )}
        </div>
    </div>
  );
}
