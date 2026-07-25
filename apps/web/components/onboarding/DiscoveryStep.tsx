"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowRight, Globe, Loader2 } from "lucide-react";
import { startDiscovery, type DiscoveryResult } from "@/lib/api";
import { useDiscoveryPoll } from "./useDiscoveryPoll";

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
    return (
      <div className="animate-fade-in">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <p className="text-sm font-medium text-foreground">{run?.stage ?? t("onboarding.discovery.starting")}</p>
        </div>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${run?.progress ?? 5}%` }}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t("onboarding.discovery.hint")}</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <h2 className="text-2xl font-bold text-foreground">{t("onboarding.discovery.title")}</h2>
      {!noSite ? (
        <div className="mt-6">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-input px-3">
            <Globe className="h-4 w-4 text-muted-foreground" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://company.com"
              className="w-full bg-transparent py-2.5 text-sm text-foreground outline-none"
            />
          </div>
          <button onClick={() => setNoSite(true)} className="mt-3 text-xs text-muted-foreground underline">
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
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none"
          />
          <button onClick={() => setNoSite(false)} className="mt-3 text-xs text-muted-foreground underline">
            {t("onboarding.discovery.backToUrl")}
          </button>
        </div>
      )}
      {startError && <p className="mt-3 text-xs text-destructive">{startError}</p>}
      <button
        onClick={begin}
        disabled={noSite ? !description.trim() : !url.trim()}
        className="btn-primary mt-6 px-6 py-2.5 text-sm disabled:opacity-50"
      >
        {t("onboarding.discovery.analyze")}
      </button>
    </div>
  );
}
