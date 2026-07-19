"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { X, Sparkles, Loader2, UploadCloud, CheckCircle2 } from "lucide-react";
import {
  generateProductCopy, publishProductCopy, type StoreProduct,
} from "@/lib/api";

interface Props {
  projectId: string;
  product: StoreProduct;
  onClose: () => void;
}

const KNOWN_ERRORS = new Set(["no_ai_key", "not_connected", "not_found"]);

export function ProductCopyModal({ projectId, product, onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(product.title);
  const [descriptionHtml, setDescriptionHtml] = useState("");
  const [meta, setMeta] = useState("");
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasCopy, setHasCopy] = useState(false);

  function errMsg(code: string | null | undefined): string {
    if (code && KNOWN_ERRORS.has(code)) return t(`productCopy.errors.${code}`);
    return t("productCopy.errors.generic");
  }

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    setError(null);
    setPublished(false);
    try {
      const res = await generateProductCopy(projectId, product.id);
      if (!res.ok) { setError(errMsg(res.error)); return; }
      setTitle(res.title || product.title);
      setDescriptionHtml(res.description_html || "");
      setMeta(res.meta_description || "");
      setHasCopy(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("productCopy.errors.generic"));
    } finally {
      setGenerating(false);
    }
  }

  async function handlePublish() {
    if (publishing || !title.trim() || !descriptionHtml.trim()) return;
    setPublishing(true);
    setError(null);
    try {
      const res = await publishProductCopy(projectId, product.id, title.trim(), descriptionHtml);
      if (!res.ok) { setError(errMsg(res.error)); return; }
      setPublished(true);
      queryClient.invalidateQueries({ queryKey: ["store-products", projectId] });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("productCopy.errors.generic"));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex min-w-0 items-center gap-2">
            {product.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.image_url} alt={product.title} className="h-8 w-8 shrink-0 rounded object-cover" />
            )}
            <h2 className="truncate text-sm font-semibold text-foreground">{t("productCopy.title")}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          {!hasCopy ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <p className="text-sm text-muted-foreground">{t("productCopy.intro", { product: product.title })}</p>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {t("productCopy.generate")}
              </button>
            </div>
          ) : (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-foreground">{t("productCopy.titleLabel")}</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-foreground">{t("productCopy.descLabel")}</span>
                <textarea
                  value={descriptionHtml}
                  onChange={(e) => setDescriptionHtml(e.target.value)}
                  rows={8}
                  className="resize-none rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary"
                />
              </label>
              {meta && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-foreground">{t("productCopy.metaLabel")}</span>
                  <input
                    value={meta}
                    onChange={(e) => setMeta(e.target.value)}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                  />
                  <span className="text-[11px] text-muted-foreground tabular-nums">{meta.length}/155</span>
                </label>
              )}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="inline-flex items-center gap-1.5 self-start text-xs font-medium text-primary hover:underline disabled:opacity-60"
              >
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {t("productCopy.regenerate")}
              </button>
            </>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {hasCopy && (
          <div className="flex items-center justify-between gap-2 border-t border-border p-4">
            <span className="text-[11px] text-muted-foreground">{t("productCopy.publishHint")}</span>
            <button
              type="button"
              onClick={handlePublish}
              disabled={publishing || !title.trim() || !descriptionHtml.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : published ? <CheckCircle2 className="h-3.5 w-3.5" />
                : <UploadCloud className="h-3.5 w-3.5" />}
              {published ? t("productCopy.published") : t("productCopy.publish")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
