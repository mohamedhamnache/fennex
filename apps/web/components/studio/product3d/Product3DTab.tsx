"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Box, Download, Loader2, RefreshCw, Sparkles, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  getProductTo3DStatus,
  getUsageSummary,
  startProductTo3D,
  type Product3DFormat,
  type Product3DQuality,
  type Product3DTextureResolution,
} from "@/lib/api";
import { PRODUCT_3D_CREDIT_COST } from "@/lib/creditCosts";
import { ImageUrlField } from "../product/ImageUrlField";

// three.js + @react-three/fiber + @react-three/drei only ship to the browser
// once this dynamic import actually resolves -- i.e. only after a job has a
// GLB to show. Every other studio tab (Generate, Social, the Product
// Showcase tab, this tab's own form before completion) never touches it.
const ModelViewer = dynamic(() => import("./ModelViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[280px] items-center justify-center rounded-lg border border-border bg-muted/20">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" strokeWidth={1.9} />
    </div>
  ),
});

const QUALITY_OPTIONS: { value: Product3DQuality; defaultLabel: string }[] = [
  { value: "draft", defaultLabel: "Draft" },
  { value: "high", defaultLabel: "High" },
  { value: "ultra", defaultLabel: "Ultra" },
];

const TEXTURE_OPTIONS: Product3DTextureResolution[] = ["2K", "4K", "8K"];

// GLB and OBJ only -- see design spec section 3 "Format conversion". FBX and
// USDZ are deliberately out of scope for this iteration; do not add them
// here, not even disabled.
const FORMAT_OPTIONS: Product3DFormat[] = ["glb", "obj"];

const PENDING_STATUSES = new Set(["pending", "running"]);

interface Product3DTabProps {
  projectId: string;
}

const pillClass = (active: boolean) =>
  cn(
    "px-2.5 py-1 rounded-full text-xs font-medium transition-colors border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "bg-primary text-primary-foreground border-primary"
      : "border-border text-muted-foreground hover:text-foreground",
  );

export function Product3DTab({ projectId }: Product3DTabProps) {
  const { t } = useTranslation();
  const [sourceUrl, setSourceUrl] = useState("");
  const [quality, setQuality] = useState<Product3DQuality>("high");
  const [textureResolution, setTextureResolution] = useState<Product3DTextureResolution>("2K");
  const [formats, setFormats] = useState<Product3DFormat[]>(["glb"]);
  const [jobId, setJobId] = useState<string | null>(null);

  const { data: usage } = useQuery({
    queryKey: ["usage-summary"],
    queryFn: getUsageSummary,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const enqueue = useMutation({
    mutationFn: () =>
      startProductTo3D({
        project_id: projectId,
        source_image_url: sourceUrl.trim(),
        quality,
        texture_resolution: textureResolution,
        formats,
      }),
    onSuccess: (data) => setJobId(data.job_id),
  });

  const job = useQuery({
    queryKey: ["product-3d-job", jobId],
    queryFn: () => getProductTo3DStatus(jobId as string),
    enabled: !!jobId,
    // Stops on its own once the job leaves pending/running -- no infinite
    // polling once the result is terminal (completed or failed).
    refetchInterval: (query) => (PENDING_STATUSES.has(query.state.data?.status ?? "") ? 2500 : false),
  });

  function toggleFormat(format: Product3DFormat) {
    setFormats((prev) => (prev.includes(format) ? prev.filter((f) => f !== format) : [...prev, format]));
  }

  function handleReset() {
    setJobId(null);
    enqueue.reset();
  }

  const remaining = usage?.credits_remaining;
  const insufficient = typeof remaining === "number" && remaining < PRODUCT_3D_CREDIT_COST;
  const canGenerate = sourceUrl.trim().length > 0 && formats.length > 0 && !enqueue.isPending;

  const isTerminal = job.data ? !PENDING_STATUSES.has(job.data.status) : false;
  const outputUrls = job.data?.output_urls ?? {};
  const hasOutput = Object.keys(outputUrls).length > 0;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="mb-0.5 text-xs font-semibold text-foreground">
          {t("product3dTab.title", { defaultValue: "Turn a product photo into a 3D model" })}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {t("product3dTab.subtitle", {
            defaultValue: "Generates a rotatable GLB/OBJ model you can preview here and drop into a store listing or AR view.",
          })}
        </p>
      </div>

      <ImageUrlField
        value={sourceUrl}
        onChange={setSourceUrl}
        label={t("productTab.imageUrl.label", { defaultValue: "Product Image URL" }) ?? undefined}
      />

      {!jobId && (
        <>
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("product3dTab.quality", { defaultValue: "Quality" })}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {QUALITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setQuality(opt.value)}
                  className={pillClass(quality === opt.value)}
                >
                  {t(`product3dTab.qualityOption.${opt.value}`, { defaultValue: opt.defaultLabel })}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("product3dTab.textureResolution", { defaultValue: "Texture resolution" })}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {TEXTURE_OPTIONS.map((res) => (
                <button
                  key={res}
                  type="button"
                  onClick={() => setTextureResolution(res)}
                  className={pillClass(textureResolution === res)}
                >
                  <span className="font-mono tabular-nums">{res}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("product3dTab.formats", { defaultValue: "Formats" })}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {FORMAT_OPTIONS.map((format) => (
                <button
                  key={format}
                  type="button"
                  onClick={() => toggleFormat(format)}
                  aria-pressed={formats.includes(format)}
                  className={pillClass(formats.includes(format))}
                >
                  {format.toUpperCase()}
                </button>
              ))}
            </div>
            {formats.length === 0 && (
              <p className="mt-1 text-[10px] text-destructive">
                {t("product3dTab.formatsRequired", { defaultValue: "Pick at least one format" })}
              </p>
            )}
          </div>

          {/* Credit cost -- always visible, before the user commits to a run */}
          <div
            className={cn(
              "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs",
              insufficient ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-muted/30 text-muted-foreground",
            )}
          >
            <span className="flex items-center gap-1.5 font-medium">
              <Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
              <span className="font-mono tabular-nums">
                {t("product3dTab.cost", { count: PRODUCT_3D_CREDIT_COST, defaultValue: "{{count}} credits per run" })}
              </span>
            </span>
            {typeof remaining === "number" && (
              <span className="font-mono tabular-nums">
                {t("productTab.showcase.remaining", { count: remaining, defaultValue: "{{count}} remaining" })}
              </span>
            )}
          </div>
          {insufficient && (
            <p className="-mt-1.5 text-[11px] text-destructive">
              {t("productTab.showcase.insufficientCredits", { defaultValue: "Not enough credits for this run" })}
            </p>
          )}

          <button
            type="button"
            disabled={!canGenerate}
            onClick={() => enqueue.mutate()}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              canGenerate
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "cursor-not-allowed bg-muted text-muted-foreground",
            )}
          >
            {enqueue.isPending ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={1.9} />
                {t("product3dTab.submitting", { defaultValue: "Starting…" })}
              </>
            ) : (
              <>
                <Box className="h-4 w-4" strokeWidth={1.9} />
                {t("product3dTab.submit", { defaultValue: "Convert to 3D" })}
              </>
            )}
          </button>

          {enqueue.isError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
              <span>{(enqueue.error as Error).message ?? t("product3dTab.genericFailure", { defaultValue: "The 3D conversion failed." })}</span>
            </div>
          )}
        </>
      )}

      {jobId && (
        <div className="flex flex-col gap-3">
          {!isTerminal ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
              <span>
                {job.data?.status === "running"
                  ? t("product3dTab.status.running", { defaultValue: "Generating your 3D model…" })
                  : t("product3dTab.status.pending", { defaultValue: "Queued…" })}
              </span>
            </div>
          ) : job.data?.status === "failed" ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
              <span>{job.data.error ?? t("product3dTab.genericFailure", { defaultValue: "The 3D conversion failed." })}</span>
            </div>
          ) : job.data?.status === "completed" ? (
            hasOutput ? (
              outputUrls.glb ? (
                <ModelViewer modelUrl={outputUrls.glb} downloadUrls={outputUrls} />
              ) : (
                <>
                  <div className="rounded-lg border border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
                    {t("product3dTab.noPreview", {
                      defaultValue: "No GLB was produced, so there is nothing to preview here — the format below still downloaded successfully.",
                    })}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.entries(outputUrls) as [Product3DFormat, string | undefined][]).map(
                      ([format, url]) =>
                        url && (
                          <a
                            key={format}
                            href={url}
                            download
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <Download className="h-3.5 w-3.5" strokeWidth={1.9} />
                            {format.toUpperCase()}
                          </a>
                        ),
                    )}
                  </div>
                </>
              )
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
                <span>{t("product3dTab.noOutput", { defaultValue: "The job finished but produced no usable files." })}</span>
              </div>
            )
          ) : null}

          <button
            type="button"
            onClick={handleReset}
            className="w-full rounded-lg border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("product3dTab.newModel", { defaultValue: "Convert another product" })}
          </button>
        </div>
      )}
    </div>
  );
}
