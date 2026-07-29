"use client";

/**
 * The in-app 3D viewer for Product-to-3D output. This file is the reason
 * Product3DTab.tsx loads it with `next/dynamic({ ssr: false })` rather than
 * a static import: three.js + @react-three/fiber + @react-three/drei are
 * heavy, and every other studio route (Generate, Social, Marketing, the
 * Product Showcase tab...) must not pay for them. Do not import this module
 * anywhere outside a dynamic() boundary.
 */
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ElementRef, type ReactNode } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stage, useGLTF, useProgress } from "@react-three/drei";
import { useTranslation } from "react-i18next";
import {
  Download,
  Loader2,
  Maximize2,
  Minimize2,
  Repeat,
  Sparkles,
  SquareDashedBottom,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { Product3DFormat } from "@/lib/api";

type LightingPresetId = "studio" | "warm" | "neutral" | "dark";

// Design spec section 3 names the four presets "studio/warm/neutral/dark",
// but drei's Environment only ships a fixed set of stock HDRI names -- each
// one maps to the closest fit: sunset for warm tones, city for a neutral
// even light, night for a dark rig.
const LIGHTING_PRESETS: Record<LightingPresetId, "studio" | "sunset" | "city" | "night"> = {
  studio: "studio",
  warm: "sunset",
  neutral: "city",
  dark: "night",
};

const LIGHTING_ORDER: LightingPresetId[] = ["studio", "warm", "neutral", "dark"];

interface ModelViewerProps {
  /** GLB url -- the only format the viewer can render. */
  modelUrl: string;
  /** Every completed format, offered as direct downloads. */
  downloadUrls: Partial<Record<Product3DFormat, string>>;
  className?: string;
}

function Model({ url, wireframe, materialPreview }: { url: string; wireframe: boolean; materialPreview: boolean }) {
  const { scene } = useGLTF(url);
  const originalMaterials = useRef(new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>());
  const clayMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#b6b6b6", roughness: 0.65, metalness: 0.05 }),
    [],
  );

  useEffect(() => {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!originalMaterials.current.has(mesh)) {
        originalMaterials.current.set(mesh, mesh.material);
      }
      const original = originalMaterials.current.get(mesh)!;
      mesh.material = materialPreview ? clayMaterial : original;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((m) => {
        (m as THREE.MeshStandardMaterial).wireframe = wireframe;
      });
    });
  }, [scene, wireframe, materialPreview, clayMaterial]);

  return <primitive object={scene} />;
}

function ProgressOverlay() {
  const { progress, active } = useProgress();
  const { t } = useTranslation();
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80">
      <Loader2 className="h-6 w-6 animate-spin text-primary" strokeWidth={1.9} />
      <span className="font-mono tabular-nums text-xs text-muted-foreground">
        {t("product3dTab.viewer.loading", { defaultValue: "Loading model…" })} {Math.round(progress)}%
      </span>
    </div>
  );
}

// useGLTF's suspense rejects (bad url, corrupt GLB, network failure) don't
// resolve through <Suspense> -- they need a real error boundary so a broken
// model shows an honest message instead of taking down the studio panel.
class ViewerErrorBoundary extends Component<
  { children: ReactNode; fallback: (message: string) => ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) return this.props.fallback(this.state.error.message);
    return this.props.children;
  }
}

const iconButtonClass = (active: boolean) =>
  cn(
    "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-primary bg-primary/10 text-primary"
      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
  );

export default function ModelViewer({ modelUrl, downloadUrls, className }: ModelViewerProps) {
  const { t } = useTranslation();
  const controlsRef = useRef<ElementRef<typeof OrbitControls>>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [materialPreview, setMaterialPreview] = useState(false);
  const [preset, setPreset] = useState<LightingPresetId>("studio");
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  function zoomBy(factor: number) {
    const controls = controlsRef.current;
    if (!controls) return;
    const camera = controls.object;
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target).multiplyScalar(factor);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }

  const downloads = (Object.entries(downloadUrls) as [Product3DFormat, string | undefined][]).filter(
    (entry): entry is [Product3DFormat, string] => !!entry[1],
  );

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-lg border border-border bg-muted/20",
        fullscreen && "fixed inset-0 z-50 rounded-none",
        className,
      )}
    >
      <div className="relative min-h-[280px] flex-1">
        <ViewerErrorBoundary
          fallback={(message) => (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 p-4 text-center">
              <span className="text-xs font-medium text-destructive">
                {t("product3dTab.viewer.loadError", { defaultValue: "Could not load the 3D model." })}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">{message}</span>
            </div>
          )}
        >
          <Canvas camera={{ position: [2.4, 1.8, 2.4], fov: 40 }} dpr={[1, 2]}>
            <Suspense fallback={null}>
              <Stage environment={LIGHTING_PRESETS[preset]} intensity={0.6} adjustCamera={1.3} shadows="contact">
                <Model url={modelUrl} wireframe={wireframe} materialPreview={materialPreview} />
              </Stage>
            </Suspense>
            <OrbitControls ref={controlsRef} autoRotate={autoRotate} autoRotateSpeed={2.2} enableDamping makeDefault />
          </Canvas>
        </ViewerErrorBoundary>
        <ProgressOverlay />

        {/* Fullscreen toggle floats over the canvas so it stays reachable in fullscreen mode */}
        <button
          type="button"
          onClick={() => setFullscreen((v) => !v)}
          aria-pressed={fullscreen}
          aria-label={t(fullscreen ? "product3dTab.viewer.exitFullscreen" : "product3dTab.viewer.fullscreen", {
            defaultValue: fullscreen ? "Exit fullscreen" : "Fullscreen",
          }) ?? undefined}
          title={t(fullscreen ? "product3dTab.viewer.exitFullscreen" : "product3dTab.viewer.fullscreen", {
            defaultValue: fullscreen ? "Exit fullscreen" : "Fullscreen",
          }) ?? undefined}
          className={cn(iconButtonClass(false), "absolute right-2 top-2 bg-background/90")}
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" strokeWidth={1.9} /> : <Maximize2 className="h-4 w-4" strokeWidth={1.9} />}
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-card/80 p-2">
        <button
          type="button"
          onClick={() => setAutoRotate((v) => !v)}
          aria-pressed={autoRotate}
          aria-label={t("product3dTab.viewer.autoRotate", { defaultValue: "Auto-rotate" }) ?? undefined}
          title={t("product3dTab.viewer.autoRotate", { defaultValue: "Auto-rotate" }) ?? undefined}
          className={iconButtonClass(autoRotate)}
        >
          <Repeat className="h-4 w-4" strokeWidth={1.9} />
        </button>

        <button
          type="button"
          onClick={() => zoomBy(0.85)}
          aria-label={t("product3dTab.viewer.zoomIn", { defaultValue: "Zoom in" }) ?? undefined}
          title={t("product3dTab.viewer.zoomIn", { defaultValue: "Zoom in" }) ?? undefined}
          className={iconButtonClass(false)}
        >
          <ZoomIn className="h-4 w-4" strokeWidth={1.9} />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1.18)}
          aria-label={t("product3dTab.viewer.zoomOut", { defaultValue: "Zoom out" }) ?? undefined}
          title={t("product3dTab.viewer.zoomOut", { defaultValue: "Zoom out" }) ?? undefined}
          className={iconButtonClass(false)}
        >
          <ZoomOut className="h-4 w-4" strokeWidth={1.9} />
        </button>

        <button
          type="button"
          onClick={() => setWireframe((v) => !v)}
          aria-pressed={wireframe}
          aria-label={t("product3dTab.viewer.wireframe", { defaultValue: "Wireframe" }) ?? undefined}
          title={t("product3dTab.viewer.wireframe", { defaultValue: "Wireframe" }) ?? undefined}
          className={iconButtonClass(wireframe)}
        >
          <SquareDashedBottom className="h-4 w-4" strokeWidth={1.9} />
        </button>
        <button
          type="button"
          onClick={() => setMaterialPreview((v) => !v)}
          aria-pressed={materialPreview}
          aria-label={t("product3dTab.viewer.materialPreview", { defaultValue: "Material preview" }) ?? undefined}
          title={t("product3dTab.viewer.materialPreview", { defaultValue: "Material preview" }) ?? undefined}
          className={iconButtonClass(materialPreview)}
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.9} />
        </button>

        <label className="sr-only" htmlFor="product3d-lighting-preset">
          {t("product3dTab.viewer.lighting", { defaultValue: "Lighting" }) ?? undefined}
        </label>
        <select
          id="product3d-lighting-preset"
          value={preset}
          onChange={(e) => setPreset(e.target.value as LightingPresetId)}
          aria-label={t("product3dTab.viewer.lighting", { defaultValue: "Lighting" }) ?? undefined}
          title={t("product3dTab.viewer.lighting", { defaultValue: "Lighting" }) ?? undefined}
          className="h-8 rounded-lg border border-border bg-input px-2 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {LIGHTING_ORDER.map((id) => (
            <option key={id} value={id}>
              {t(`product3dTab.viewer.lightingPreset.${id}`, {
                defaultValue: id.charAt(0).toUpperCase() + id.slice(1),
              })}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-1.5">
          {downloads.map(([format, url]) => (
            <a
              key={format}
              href={url}
              download
              target="_blank"
              rel="noreferrer"
              aria-label={t("product3dTab.viewer.download", { defaultValue: "Download {{format}}", format: format.toUpperCase() }) ?? undefined}
              title={t("product3dTab.viewer.download", { defaultValue: "Download {{format}}", format: format.toUpperCase() }) ?? undefined}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={1.9} />
              {format.toUpperCase()}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
