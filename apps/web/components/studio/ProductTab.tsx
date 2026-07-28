"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { generateProductScene, type GeneratedImage } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { CheckCircle2, XCircle, Store, ArrowRight, RefreshCw, ShoppingBag } from "lucide-react";
import { ShowcaseControls, showcaseOverrides, type ShowcaseAdvancedValues } from "./product/ShowcaseControls";
import { ImageUrlField } from "./product/ImageUrlField";
import {
  PRODUCT_SCENES as SCENES,
  SCENE_CATEGORIES as CATEGORIES,
  type CategoryFilter as Category,
} from "@/lib/productScenes";




interface ProductTabProps {
  projectId: string;
  useBrandKit: boolean;
}

export function ProductTab({ projectId, useBrandKit }: ProductTabProps) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<Category>("all");
  const [selectedScene, setSelectedScene] = useState<string>("white_studio");
  const [productUrl, setProductUrl] = useState("");
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<GeneratedImage | null>(null);
  // Photographic controls (Task 7). Every field starts unset, so a run that
  // never opens "Advanced controls" sends exactly the payload the tab has
  // always sent -- see the omit-if-unset spread below.
  const [advanced, setAdvanced] = useState<ShowcaseAdvancedValues>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      generateProductScene({
        project_id: projectId,
        product_image_url: productUrl.trim(),
        product_description: description.trim(),
        scene_id: selectedScene,
        use_brand_kit: useBrandKit,
        ...showcaseOverrides(advanced),
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
      {/* Store products live in the full Product Studio */}
      <Link
        href={`/${projectId}/images/studio?mode=create&intent=product`}
        className="group flex items-center gap-2.5 rounded-xl border border-primary/20 bg-primary/[0.04] p-3 transition-colors hover:border-primary/40"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Store className="h-4 w-4" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-foreground">{t("productTab.openStudio.title", { defaultValue: "Shoot your store products" })}</span>
          <span className="block text-[11px] text-muted-foreground">{t("productTab.openStudio.desc", { defaultValue: "Open the Product Studio to sync Shopify / WooCommerce and shoot real SKUs." })}</span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" />
      </Link>

      {/* Product inputs */}
      <div className="flex flex-col gap-3">
        <ImageUrlField value={productUrl} onChange={setProductUrl} />
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

      {/* Photographic controls (Task 7) */}
      {!result && (
        <ShowcaseControls
          value={advanced}
          onChange={setAdvanced}
          isOpen={advancedOpen}
          onToggle={() => setAdvancedOpen((v) => !v)}
        />
      )}

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
              {typeof result.seed === "number" && (
                <p className="text-[10px] text-muted-foreground">
                  {t("productTab.showcase.seed", { defaultValue: "Seed" })}:{" "}
                  <span className="font-mono tabular-nums text-foreground">{result.seed}</span>
                </p>
              )}
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
