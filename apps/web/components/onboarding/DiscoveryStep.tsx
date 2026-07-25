"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowRight, Check, Globe, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { startDiscovery, type DiscoveryResult } from "@/lib/api";
import { useDiscoveryPoll } from "./useDiscoveryPoll";

/**
 * The fixed pipeline the live-discovery checklist renders. The backend only
 * ever sets `stage` to one of: "Analyzing website", "Reading pages",
 * "Understanding products", "Finding competitors", "Analyzing SEO",
 * "Building profile", "Done" -- there is no separate Brand DNA stage, so
 * that row has no `match` and is driven purely by the progress threshold
 * (see `currentStageIndex`). Thresholds are approximate midpoints between
 * the real backend stages so the UI advances smoothly even if a stage
 * string is missing or unrecognized.
 */
const STAGES = [
  { key: "onboarding.discovery.stages.analyzing", match: ["analyzing website"], threshold: 0 },
  { key: "onboarding.discovery.stages.reading", match: ["reading pages"], threshold: 14 },
  { key: "onboarding.discovery.stages.products", match: ["understanding products"], threshold: 28 },
  { key: "onboarding.discovery.stages.competitors", match: ["finding competitors"], threshold: 42 },
  { key: "onboarding.discovery.stages.brandDna", match: [] as string[], threshold: 58 },
  { key: "onboarding.discovery.stages.seo", match: ["analyzing seo"], threshold: 74 },
  { key: "onboarding.discovery.stages.profile", match: ["building profile", "done"], threshold: 90 },
] as const;

/**
 * Resolves the active checklist row from the live poll data. Combines two
 * signals and takes the further-along of the two, so the list always
 * advances even when the backend reports a stage string we don't have an
 * exact row for (e.g. mid-way through "Extracting Brand DNA"):
 *  - idxFromProgress: last row whose threshold the current progress % clears
 *  - idxFromStage: the row whose backend name matches `stage` exactly
 */
function currentStageIndex(stage: string | null | undefined, progress: number): number {
  if (progress >= 100) return STAGES.length - 1;
  const normalized = stage?.trim().toLowerCase() ?? "";
  let idxFromProgress = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (progress >= STAGES[i].threshold) idxFromProgress = i;
  }
  let idxFromStage = -1;
  STAGES.forEach((s, i) => {
    if ((s.match as readonly string[]).includes(normalized)) idxFromStage = i;
  });
  return Math.max(idxFromProgress, idxFromStage);
}

/**
 * Welcome's follow-up: collect a URL (or, failing that, a typed description)
 * and start the backend discovery run, then show its live progress until it
 * reaches a terminal state.
 *
 * The backend always finishes a run with status "done" -- including failed
 * ones (progress 100, a non-null `error`, and whatever partial `result` it
 * gathered before failing). So reaching "done" is not itself success: a
 * failed run stops the auto-advance and shows an inline failure affordance
 * instead, with a way to retry (go back to the form) or continue anyway
 * (the partial result is still a full, editable `DiscoveryResult` the
 * review step can work with).
 */
export function DiscoveryStep({
  onComplete,
}: {
  onComplete: (runId: string, result: DiscoveryResult) => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [noSite, setNoSite] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const { run } = useDiscoveryPoll(runId);
  const completedRef = useRef(false);

  const succeeded = run?.status === "done" && !run.error;
  const failed = run?.status === "done" && !!run.error;

  useEffect(() => {
    if (succeeded && runId && run && !completedRef.current) {
      completedRef.current = true;
      onComplete(runId, run.result);
    }
  }, [succeeded, runId, run, onComplete]);

  async function begin() {
    setStartError(null);
    try {
      const { run_id } = await startDiscovery(noSite ? { description } : { url });
      completedRef.current = false;
      setRunId(run_id);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : t("onboarding.discovery.error.startFailed"));
    }
  }

  function retry() {
    completedRef.current = false;
    setRunId(null);
    setStartError(null);
  }

  if (runId && failed) {
    return (
      <div className="animate-fade-in">
        <div className="flex items-center gap-3 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          <p className="text-sm font-medium">{t("onboarding.discovery.error.heading")}</p>
        </div>
        {run?.error && <p className="mt-2 text-xs text-muted-foreground">{run.error}</p>}
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            onClick={retry}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {t("onboarding.discovery.error.retry")}
          </button>
          <button
            onClick={() => run && onComplete(runId, run.result)}
            className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
          >
            {t("onboarding.discovery.error.continue")} <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  if (runId) {
    const progress = run?.progress ?? 5;
    const stageIdx = currentStageIndex(run?.stage, progress);
    const allDone = progress >= 100;
    const headerLabel = run ? t(STAGES[Math.min(stageIdx, STAGES.length - 1)].key) : t("onboarding.discovery.starting");

    return (
      <div className="animate-fade-in">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground">{headerLabel}</p>
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{Math.round(progress)}%</span>
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        <ol className="mt-6 space-y-1">
          {STAGES.map((s, i) => {
            const state = allDone ? "done" : i < stageIdx ? "done" : i === stageIdx ? "active" : "pending";
            return (
              <li key={s.key} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm">
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors",
                    state === "done" && "bg-primary text-primary-foreground",
                    state === "active" && "border-2 border-primary/40 bg-primary/10",
                    state === "pending" && "border border-border bg-muted",
                  )}
                >
                  {state === "done" && <Check className="h-3.5 w-3.5" />}
                  {state === "active" && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                  {state === "pending" && <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />}
                </span>
                <span
                  className={cn(
                    state === "active" && "font-medium text-foreground",
                    state === "done" && "text-muted-foreground",
                    state === "pending" && "text-muted-foreground/60",
                  )}
                >
                  {t(s.key)}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="mt-4 text-xs text-muted-foreground">{t("onboarding.discovery.hint")}</p>

        <p className="mt-8 text-xs font-medium text-muted-foreground">{t("onboarding.discovery.previewHint")}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-border bg-card p-3" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="h-3 w-2/3 skeleton" />
              <div className="mt-2 h-2 w-1/2 skeleton" />
              <div className="mt-3 h-6 w-full skeleton" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <h2 className="font-display text-2xl font-bold text-foreground">{t("onboarding.discovery.title")}</h2>
      {!noSite ? (
        <div className="mt-6">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-input px-3 transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
            <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://company.com"
              className="w-full bg-transparent py-2.5 text-sm text-foreground outline-none"
            />
          </div>
          <button
            onClick={() => setNoSite(true)}
            className="mt-3 text-xs text-muted-foreground underline decoration-border underline-offset-2 transition-colors hover:text-foreground"
          >
            {t("onboarding.discovery.noSite")}
          </button>
        </div>
      ) : (
        <div className="mt-6">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder={t("onboarding.discovery.describe")}
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary/50"
          />
          <button
            onClick={() => setNoSite(false)}
            className="mt-3 text-xs text-muted-foreground underline decoration-border underline-offset-2 transition-colors hover:text-foreground"
          >
            {t("onboarding.discovery.backToUrl")}
          </button>
        </div>
      )}
      {startError && <p className="mt-3 text-xs text-destructive">{startError}</p>}
      <button
        onClick={begin}
        disabled={noSite ? !description.trim() : !url.trim()}
        className="btn-primary mt-6 px-6 py-2.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {t("onboarding.discovery.analyze")}
      </button>
    </div>
  );
}
