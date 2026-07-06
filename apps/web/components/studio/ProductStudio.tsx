"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Upload, Loader2, X, ShoppingBag, Wand2, Pencil, Globe,
  AlertCircle, CheckCircle2, Sparkles, Scissors,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  uploadImage, editImage, getImage, generateProductScene,
  type GeneratedImage,
} from "@/lib/api";
import { PublishModal } from "./PublishModal";
import { SaveCollectionButton } from "./SaveCollectionButton";

const SCENES = [
  { id: "white_studio",      label: "White Studio",  category: "packshot"  },
  { id: "gradient_studio",   label: "Gradient BG",   category: "packshot"  },
  { id: "floating_shadow",   label: "Floating",      category: "packshot"  },
  { id: "marble_countertop", label: "Marble",        category: "lifestyle" },
  { id: "cafe_table",        label: "Café Table",    category: "lifestyle" },
  { id: "home_living_room",  label: "Living Room",   category: "lifestyle" },
  { id: "outdoor_nature",    label: "Nature",        category: "lifestyle" },
  { id: "food_table_scene",  label: "Food Scene",    category: "food"      },
  { id: "desk_setup",        label: "Desk Setup",    category: "tech"      },
  { id: "model_studio",      label: "Model Studio",  category: "fashion"   },
  { id: "athlete_action",    label: "Athlete",       category: "fashion"   },
] as const;

type Category = "all" | "packshot" | "lifestyle" | "food" | "tech" | "fashion";
const CATEGORIES: { id: Category; label: string }[] = [
  { id: "all", label: "All" },
  { id: "packshot", label: "Packshot" },
  { id: "lifestyle", label: "Lifestyle" },
  { id: "food", label: "Food" },
  { id: "tech", label: "Tech" },
  { id: "fashion", label: "Fashion" },
];

const SCENE_LABEL: Record<string, string> = Object.fromEntries(SCENES.map((s) => [s.id, s.label]));

type SceneResult = { sceneId: string; status: "loading" | "ready" | "error"; image?: GeneratedImage; error?: string };

interface ProductStudioProps {
  projectId: string;
  useBrandKit: boolean;
  onBack: () => void;
}

export function ProductStudio({ projectId, useBrandKit, onBack }: ProductStudioProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  // Product source
  const [original, setOriginal] = useState<GeneratedImage | null>(null);
  const [isolated, setIsolated] = useState<GeneratedImage | null>(null);
  const [isolate, setIsolate] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [isolating, setIsolating] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Config
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [selectedScenes, setSelectedScenes] = useState<Set<string>>(new Set(["white_studio"]));

  // Results
  const [results, setResults] = useState<SceneResult[]>([]);
  const [generating, setGenerating] = useState(false);
  const [publishId, setPublishId] = useState<string | null>(null);

  const source = isolate ? (isolated ?? original) : original;
  const productUrl = source?.image_url ?? "";

  const runIsolate = useCallback(async (base: GeneratedImage) => {
    setIsolating(true);
    try {
      const r = await editImage(base.id, "remove_background");
      if (r.ok && r.image_id) {
        const iso = await getImage(r.image_id);
        setIsolated(iso);
      }
    } catch {
      /* keep original if isolation fails */
    } finally {
      setIsolating(false);
    }
  }, []);

  const handleUpload = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      setUploading(true);
      setUploadError(null);
      setIsolated(null);
      try {
        const img = await uploadImage(projectId, file);
        setOriginal(img);
        if (isolate) runIsolate(img);
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [projectId, isolate, runIsolate],
  );

  function toggleIsolate() {
    const next = !isolate;
    setIsolate(next);
    if (next && original && !isolated) runIsolate(original);
  }

  function toggleScene(id: string) {
    setSelectedScenes((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const canGenerate = !!productUrl && description.trim().length > 0 && selectedScenes.size > 0 && !generating && !isolating;

  async function handleGenerate() {
    if (!canGenerate) return;
    const scenes = [...selectedScenes];
    setGenerating(true);
    setResults(scenes.map((sceneId) => ({ sceneId, status: "loading" })));

    async function generateOne(sceneId: string, i: number) {
      try {
        const img = await generateProductScene({
          project_id: projectId,
          product_image_url: productUrl,
          product_description: description.trim(),
          scene_id: sceneId,
          use_brand_kit: useBrandKit,
        });
        setResults((prev) => {
          const n = [...prev];
          n[i] = img.status === "ready" && img.image_url
            ? { sceneId, status: "ready", image: img }
            : { sceneId, status: "error", error: img.error ?? "Generation failed" };
          return n;
        });
      } catch (e) {
        setResults((prev) => {
          const n = [...prev];
          n[i] = { sceneId, status: "error", error: e instanceof Error ? e.message : "Failed" };
          return n;
        });
      }
    }

    // Bounded concurrency — flux-kontext scenes are heavy; running a few at a
    // time avoids connection pressure that can cause transient network failures.
    const CONCURRENCY = 3;
    let cursor = 0;
    async function worker() {
      while (cursor < scenes.length) {
        const idx = cursor++;
        await generateOne(scenes[idx], idx);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, scenes.length) }, worker));
    setGenerating(false);
  }

  const filteredScenes = category === "all" ? SCENES : SCENES.filter((s) => s.category === category);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-4 py-2.5 flex items-center gap-2">
        <button type="button" onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <ShoppingBag className="h-4 w-4 text-primary" strokeWidth={1.8} />
        <span className="text-sm font-semibold text-foreground">Product shot</span>
        <span className="text-xs text-muted-foreground">— studio &amp; lifestyle sets for Shopify / WordPress</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Config column */}
        <div className="w-[380px] shrink-0 border-r border-border overflow-y-auto p-4 flex flex-col gap-5">
          {/* 1. Product */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">1</span>
              <span className="text-xs font-semibold text-foreground">Your product</span>
            </div>

            {source ? (
              <div className="relative">
                <div className="relative w-full overflow-hidden rounded-xl border border-border bg-[repeating-conic-gradient(#0000000d_0%_25%,transparent_0%_50%)_0_0/16px_16px]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={source.image_url ?? ""} alt="Product" className="w-full max-h-52 object-contain" />
                  {isolating && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                      <div className="flex items-center gap-2 text-xs text-foreground">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" /> Isolating…
                      </div>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setOriginal(null); setIsolated(null); if (fileRef.current) fileRef.current.value = ""; }}
                  className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                onClick={() => !uploading && fileRef.current?.click()}
                onKeyDown={(e) => { if (e.key === "Enter") fileRef.current?.click(); }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
                className="w-full rounded-xl border-2 border-dashed border-border px-4 py-8 flex flex-col items-center gap-2 text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors cursor-pointer"
              >
                {uploading ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : <Upload className="h-6 w-6" />}
                <span className="text-xs font-medium">{uploading ? "Uploading…" : "Upload product photo"}</span>
                <span className="text-[10px] text-muted-foreground/70">PNG, JPG or WebP</span>
              </div>
            )}
            {uploadError && <p className="mt-1 text-xs text-destructive">{uploadError}</p>}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); if (e.target) e.target.value = ""; }} />

            {/* Isolate toggle */}
            <button
              type="button"
              onClick={toggleIsolate}
              className="mt-2 flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-accent"
            >
              <Scissors className={cn("h-3.5 w-3.5 shrink-0", isolate ? "text-primary" : "text-muted-foreground")} />
              <span className="flex-1 text-xs text-foreground">Isolate product <span className="text-muted-foreground">(remove background)</span></span>
              <span className={cn("relative inline-flex h-4 w-7 items-center rounded-full transition-colors", isolate ? "bg-primary" : "bg-border")}>
                <span className={cn("inline-block h-3 w-3 transform rounded-full bg-white transition-transform", isolate ? "translate-x-3.5" : "translate-x-0.5")} />
              </span>
            </button>
          </div>

          {/* 2. Description */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">2</span>
              <span className="text-xs font-semibold text-foreground">Describe it</span>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="A sleek matte-black water bottle with minimal branding…"
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
          </div>

          {/* 3. Scenes */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">3</span>
                <span className="text-xs font-semibold text-foreground">Pick scenes</span>
              </div>
              <span className="text-[10px] text-muted-foreground">{selectedScenes.size} selected</span>
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              {CATEGORIES.map((c) => (
                <button key={c.id} type="button" onClick={() => setCategory(c.id)}
                  className={cn("px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors border",
                    category === c.id ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground")}>
                  {c.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {filteredScenes.map((scene) => {
                const on = selectedScenes.has(scene.id);
                return (
                  <button key={scene.id} type="button" onClick={() => toggleScene(scene.id)}
                    className={cn("relative rounded-lg border p-2 text-center transition-all",
                      on ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/50 text-muted-foreground hover:text-foreground")}>
                    {on && <CheckCircle2 className="absolute top-1 right-1 h-3 w-3 text-primary" />}
                    <span className="text-[10px] font-medium leading-tight">{scene.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Results column */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Toolbar */}
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">
              {results.length > 0 ? "Your product set" : "Results"}
            </p>
            <div className="flex items-center gap-2">
              {results.some((r) => r.status === "ready") && (
                <SaveCollectionButton
                  projectId={projectId}
                  imageIds={results.filter((r) => r.status === "ready" && r.image).map((r) => r.image!.id)}
                  defaultName={description.trim() ? `${description.trim().slice(0, 40)} — product set` : "Product set"}
                />
              )}
              <button
                type="button"
                disabled={!canGenerate}
                onClick={handleGenerate}
                className={cn("flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
                  canGenerate ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground cursor-not-allowed")}
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {generating ? "Generating…" : `Generate ${selectedScenes.size > 0 ? selectedScenes.size : ""} shot${selectedScenes.size === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>

          {results.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border py-24 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                <ShoppingBag className="h-7 w-7 text-muted-foreground/50" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Build a product set</p>
                <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                  Upload your product, describe it, and pick the scenes you want. We&apos;ll generate them all at once.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {results.map((res, i) => (
                <div key={i} className="rounded-xl border border-border overflow-hidden bg-card">
                  <div className="group relative aspect-square bg-muted">
                    {res.status === "ready" && res.image?.image_url ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={res.image.image_url} alt={SCENE_LABEL[res.sceneId]} className="absolute inset-0 h-full w-full object-cover" />
                        <div className="absolute inset-0 flex items-end justify-end gap-1 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button type="button" onClick={() => router.push(`/${projectId}/images/edit/${res.image!.id}`)}
                            className="flex items-center gap-1 rounded-lg bg-background/95 px-2 py-1 text-[10px] font-semibold text-foreground">
                            <Pencil className="h-3 w-3 text-primary" /> Edit
                          </button>
                          <button type="button" onClick={() => setPublishId(res.image!.id)}
                            className="flex items-center gap-1 rounded-lg bg-background/95 px-2 py-1 text-[10px] font-semibold text-foreground">
                            <Globe className="h-3 w-3 text-primary" /> Publish
                          </button>
                        </div>
                      </>
                    ) : res.status === "error" ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-destructive px-2 text-center">
                        <AlertCircle className="h-5 w-5" />
                        <span className="text-[10px]">{res.error ?? "Failed"}</span>
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="px-2.5 py-2 flex items-center gap-1.5">
                    <Wand2 className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-medium text-foreground truncate">{SCENE_LABEL[res.sceneId] ?? res.sceneId}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {publishId && <PublishModal imageId={publishId} onClose={() => setPublishId(null)} />}
    </div>
  );
}
