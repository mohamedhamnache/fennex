"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { generateProductScene, type GeneratedImage } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { ShoppingBag, RefreshCw, CheckCircle2, XCircle } from "lucide-react";

const SCENES = [
  { id: "white_studio",      label: "White Studio",  category: "packshot"  },
  { id: "gradient_studio",   label: "Gradient BG",   category: "packshot"  },
  { id: "floating_shadow",   label: "Floating",      category: "packshot"  },
  { id: "marble_countertop", label: "Marble",        category: "lifestyle" },
  { id: "cafe_table",        label: "Cafe Table",    category: "lifestyle" },
  { id: "home_living_room",  label: "Living Room",   category: "lifestyle" },
  { id: "outdoor_nature",    label: "Nature",        category: "lifestyle" },
  { id: "food_table_scene",  label: "Food Scene",    category: "food"      },
  { id: "desk_setup",        label: "Desk Setup",    category: "tech"      },
  { id: "model_studio",      label: "Model Studio",  category: "fashion"   },
  { id: "athlete_action",    label: "Athlete",       category: "fashion"   },
] as const;

type SceneId = typeof SCENES[number]["id"];
type Category = "all" | "packshot" | "lifestyle" | "food" | "tech" | "fashion";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "all",      label: "All" },
  { id: "packshot", label: "Packshot" },
  { id: "lifestyle",label: "Lifestyle" },
  { id: "food",     label: "Food" },
  { id: "tech",     label: "Tech" },
  { id: "fashion",  label: "Fashion" },
];

interface ProductTabProps {
  projectId: string;
  useBrandKit: boolean;
}

export function ProductTab({ projectId, useBrandKit }: ProductTabProps) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<Category>("all");
  const [selectedScene, setSelectedScene] = useState<SceneId>("white_studio");
  const [productUrl, setProductUrl] = useState("");
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<GeneratedImage | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      generateProductScene({
        project_id: projectId,
        product_image_url: productUrl.trim(),
        product_description: description.trim(),
        scene_id: selectedScene,
        use_brand_kit: useBrandKit,
      }),
    onSuccess: (data) => setResult(data),
  });

  const filtered = category === "all" ? SCENES : SCENES.filter((s) => s.category === category);
  const canGenerate = productUrl.trim().length > 0 && description.trim().length > 0 && !mutation.isPending;

  function handleReset() {
    setResult(null);
    mutation.reset();
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Product inputs */}
      <div className="flex flex-col gap-3">
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">
            Product Image URL
          </label>
          <input
            type="url"
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            placeholder="https://your-store.com/product.jpg"
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">
            Product Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="A sleek stainless steel water bottle with minimalist branding..."
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
          />
        </div>
      </div>

      {/* Scene category filter */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Scene</p>
        <div className="flex flex-wrap gap-1 mb-3">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={cn(
                "px-2 py-0.5 rounded-full text-xs font-medium transition-colors border",
                category === c.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Scene grid */}
        <div className="grid grid-cols-3 gap-2">
          {filtered.map((scene) => (
            <button
              key={scene.id}
              type="button"
              onClick={() => setSelectedScene(scene.id)}
              className={cn(
                "rounded-lg border p-2 text-center transition-all",
                selectedScene === scene.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:border-primary/50 text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="text-[10px] font-medium leading-tight">{scene.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Generate button */}
      {!result && (
        <button
          type="button"
          disabled={!canGenerate}
          onClick={() => mutation.mutate()}
          className={cn(
            "w-full rounded-lg py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-colors",
            canGenerate
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground cursor-not-allowed",
          )}
        >
          {mutation.isPending ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <ShoppingBag className="h-4 w-4" />
              Generate Product Shot
            </>
          )}
        </button>
      )}

      {/* Error */}
      {mutation.isError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{(mutation.error as Error).message ?? "Generation failed"}</span>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="flex flex-col gap-3">
          {result.status === "ready" && result.image_url ? (
            <>
              <div className="relative overflow-hidden rounded-lg border border-border aspect-square bg-muted">
                <img
                  src={result.image_url}
                  alt="Product shot"
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-medium text-green-600">
                  <CheckCircle2 className="h-3 w-3" />
                  Ready
                </div>
              </div>
              <div className="flex gap-2">
                <a
                  href={result.image_url}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 rounded-lg border border-border px-3 py-2 text-center text-xs font-medium hover:bg-accent transition-colors"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={handleReset}
                  className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-accent transition-colors"
                >
                  Generate Again
                </button>
              </div>
            </>
          ) : result.status === "failed" ? (
            <div className="text-xs text-destructive p-3 rounded-lg bg-destructive/10 border border-destructive/30">
              {result.error ?? "Generation failed"}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
