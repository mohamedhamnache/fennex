"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Box, Download, Gauge, Loader2, RefreshCw, Sparkles, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  getProductTo3DStatus,
  getUsageSummary,
  startProductTo3D,
  type Product3DFormat,
  type Product3DQuality,
  type Product3DTextureResolution,
} from "@/lib/api";
import { estimateProduct3DCredits } from "@/lib/creditCosts";
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

// Measured end-to-end time for a `high` / 2K run against firtoz/trellis. Used
// only to shape the progress bar's expectation -- the bar eases toward 90% and
// waits for the real terminal status rather than ever claiming to be finished.
const TYPICAL_RUN_SECONDS = 26;

interface Product3DTabProps {
  projectId: string;
}

// 44x44 minimum touch target on every interactive pill, even at this
// surface's 8/10 (dense/dashboard) density -- accessibility floor wins over
// visual tightness. `aria-pressed` marks these as toggle buttons.
const pillClass = (active: boolean) =>
  cn(
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-primary bg-primary text-primary-foreground"
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
    // Stops once the job reaches a KNOWN terminal status (completed or
    // failed). Previously this fell back to `?? ""` when `query.state.data`
    // was undefined -- which happens not just before the first successful
    // poll but also after ANY transient poll error, since an error leaves
    // `data` unset rather than populated. `PENDING_STATUSES.has("")` is
    // false, so a single transient error permanently stopped polling and
    // the UI was stuck showing "Queued..." forever with no error surfaced.
    // Gating on jobId (via `enabled` above) and only stopping once we have
    // a definite non-pending status keeps polling through transient errors
    // and only ever stops once the job is genuinely terminal.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && !PENDING_STATUSES.has(status) ? false : 2500;
    },
  });

  function toggleFormat(format: Product3DFormat) {
    setFormats((prev) => (prev.includes(format) ? prev.filter((f) => f !== format) : [...prev, format]));
  }

  function handleReset() {
    setJobId(null);
    enqueue.reset();
  }

  // Live -- recomputed on every render from the currently selected quality /
  // texture, so it updates the instant either control changes and never
  // implies a fixed price. See lib/creditCosts.ts for the estimate's basis
  // and why the exact cost cannot be known before the run completes.
  const estimatedCredits = estimateProduct3DCredits(quality, textureResolution);
  const remaining = usage?.credits_remaining;
  const insufficient = typeof remaining === "number" && remaining < estimatedCredits;

  const missingImage = sourceUrl.trim().length === 0;
  const missingFormat = formats.length === 0;
  const canGenerate = !missingImage && !missingFormat && !enqueue.isPending;
  const disabledReason = missingImage
    ? t("product3dTab.disabledReason.noImage", { defaultValue: "Add a product image to continue" })
    : missingFormat
      ? t("product3dTab.formatsRequired", { defaultValue: "Pick at least one format" })
      : null;

  const isTerminal = job.data ? !PENDING_STATUSES.has(job.data.status) : false;

  // A generation takes ~26s. Without a clock the panel looks frozen, so show
  // elapsed time and an easing bar; both stop the moment the job is terminal.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!jobId || isTerminal) return;
    setElapsed(0);
    const started = Date.now();
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [jobId, isTerminal]);

  // Asymptotic: approaches 90% and never implies completion we cannot confirm.
  const progressPct = Math.min(90, Math.round((1 - Math.exp(-elapsed / TYPICAL_RUN_SECONDS)) * 100));
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
          projectId={projectId}
        value={sourceUrl}
        onChange={setSourceUrl}
        label={t("productTab.imageUrl.label", { defaultValue: "Product Image URL" }) ?? undefined}
      />

      {!jobId && (
        <>
          {/* Quality + texture are the two cost drivers -- grouped together so
              their effect on the estimate below reads as one choice, not two
              unrelated settings. */}
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/10 p-3">
            <div className="flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.9} />
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("product3dTab.section.qualityDetail", { defaultValue: "Quality & detail" })}
              </p>
            </div>
            <p className="-mt-2 text-[10px] text-muted-foreground/70">
              {t("product3dTab.section.qualityDetailHint", {
                defaultValue: "These settings drive how long generation takes, and its estimated cost below.",
              })}
            </p>

            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("product3dTab.quality", { defaultValue: "Quality" })}
              </p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("product3dTab.quality", { defaultValue: "Quality" }) ?? undefined}>
                {QUALITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setQuality(opt.value)}
                    aria-pressed={quality === opt.value}
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
              <div
                className="flex flex-wrap gap-1.5"
                role="group"
                aria-label={t("product3dTab.textureResolution", { defaultValue: "Texture resolution" }) ?? undefined}
              >
                {TEXTURE_OPTIONS.map((res) => (
                  <button
                    key={res}
                    type="button"
                    onClick={() => setTextureResolution(res)}
                    aria-pressed={textureResolution === res}
                    className={pillClass(textureResolution === res)}
                  >
                    <span className="font-mono tabular-nums">{res}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("product3dTab.formats", { defaultValue: "Formats" })}
            </p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("product3dTab.formats", { defaultValue: "Formats" }) ?? undefined}>
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
            {missingFormat && (
              <p className="mt-1 text-[10px] text-destructive">
                {t("product3dTab.formatsRequired", { defaultValue: "Pick at least one format" })}
              </p>
            )}
          </div>

          {/* Estimate + submit -- one action block, so the cost consequence
              of the choices above is visible right next to the button that
              commits to them. Recomputed live from quality/textureResolution
              on every render. */}
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
            <div
              className={cn(
                "flex items-center justify-between gap-2 text-xs",
                insufficient ? "text-destructive" : "text-muted-foreground",
              )}
            >
              <span className="flex items-center gap-1.5 font-medium">
                <Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                <span className="font-mono tabular-nums">
                  {t("product3dTab.cost", { count: estimatedCredits, defaultValue: "About {{count}} credits" })}
                </span>
              </span>
              {typeof remaining === "number" && (
                <span className="font-mono tabular-nums">
                  {t("productTab.showcase.remaining", { count: remaining, defaultValue: "{{count}} remaining" })}
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              {t("product3dTab.costEstimateNote", {
                defaultValue: "Estimate only -- the exact cost is metered after the run.",
              })}
            </p>
            {insufficient && (
              <p className="text-[11px] text-destructive">
                {t("productTab.showcase.insufficientCredits", { defaultValue: "Not enough credits for this run" })}
              </p>
            )}

            <button
              type="button"
              disabled={!canGenerate}
              onClick={() => enqueue.mutate()}
              aria-describedby={disabledReason ? "product3d-disabled-reason" : undefined}
              className={cn(
                "flex min-h-11 w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
            {!canGenerate && !enqueue.isPending && disabledReason && (
              <p id="product3d-disabled-reason" className="text-center text-[11px] text-muted-foreground">
                {disabledReason}
              </p>
            )}
          </div>

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
            <div className="flex flex-col gap-2">
              <div
                className="rounded-lg border border-border bg-muted/20 p-3"
                role="status"
                aria-live="polite"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
                  </span>
                  <span className="flex-1 text-xs text-muted-foreground">
                    {job.data?.status === "running"
                      ? t("product3dTab.status.running", { defaultValue: "Building mesh and textures…" })
                      : t("product3dTab.status.pending", { defaultValue: "Queued…" })}
                  </span>
                  <span className="font-mono tabular-nums text-[11px] text-muted-foreground/70">
                    {elapsed}s
                  </span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground/70">
                  {t("product3dTab.status.typical", {
                    defaultValue: "Usually about {{seconds}} seconds. You can leave this page and come back.",
                    seconds: TYPICAL_RUN_SECONDS,
                  })}
                </p>
              </div>
              {job.isError && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
                  <span>
                    {t("product3dTab.status.pollError", {
                      defaultValue: "Having trouble checking on your model. Still retrying…",
                    })}
                  </span>
                </div>
              )}
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
                            className="flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <Download className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
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
            className="min-h-11 w-full rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("product3dTab.newModel", { defaultValue: "Convert another product" })}
          </button>
        </div>
      )}
    </div>
  );
}
