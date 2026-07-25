"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { FennecMark } from "@fennex/ui";
import { provisionWorkspace, type ProjectPersona } from "@/lib/api";

const STAGE_INTERVAL_MS = 1800;

export function ProvisioningStep({
  runId,
  persona,
  onDone,
}: {
  runId: string;
  persona: ProjectPersona | null;
  onDone: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [stageIndex, setStageIndex] = useState(0);
  // Guards against React strict-mode double-invoking effects (and any
  // re-render before onDone flips the step away from "provisioning"), which
  // would otherwise fire a second POST /onboarding/provision for the same
  // run. Only `retry()` (after a failure) resets this, so the happy path
  // still provisions exactly once.
  const started = useRef(false);

  const stages = t("onboarding.provisioning.staged", { returnObjects: true }) as string[];

  function provision() {
    started.current = true;
    setError(null);
    provisionWorkspace(runId, persona ?? undefined)
      .then((r) => onDone(r.project_id))
      .catch((e) => setError(e instanceof Error ? e.message : t("onboarding.provisioning.error")));
  }

  useEffect(() => {
    if (started.current) return;
    provision();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, persona]);

  // Cosmetic staged copy while we wait, so the wait doesn't read as a lone
  // frozen spinner. Purely presentational -- it has no bearing on when
  // provisioning actually completes, that's still driven by the promise
  // above resolving into `onDone`.
  useEffect(() => {
    if (error || stages.length <= 1) return;
    const id = setInterval(() => {
      setStageIndex((i) => (i + 1) % stages.length);
    }, STAGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [error, stages.length]);

  function retry() {
    setStageIndex(0);
    started.current = false;
    provision();
  }

  return (
    <div className="animate-fade-in text-center">
      {error ? (
        <>
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <p className="mt-4 text-sm font-medium text-foreground">{t("onboarding.provisioning.error")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
          <button onClick={retry} className="btn-primary mt-6 px-6 py-2.5 text-sm">
            {t("onboarding.provisioning.retry")}
          </button>
        </>
      ) : (
        <>
          <div className="relative mx-auto flex h-14 w-14 items-center justify-center">
            <span
              className="absolute -inset-1.5 rounded-2xl border-2 border-transparent border-t-primary animate-spin"
              style={{ animationDuration: "1.4s" }}
              aria-hidden
            />
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl gradient-brand glow-primary">
              <FennecMark className="h-8 w-8 brightness-0 invert" />
            </div>
          </div>
          <p className="mt-5 text-sm font-medium text-foreground">{t("onboarding.provisioning.title")}</p>
          <p className="mt-1 text-xs text-muted-foreground transition-opacity duration-300">
            {stages[stageIndex] ?? t("onboarding.provisioning.hint")}
          </p>
        </>
      )}
    </div>
  );
}
