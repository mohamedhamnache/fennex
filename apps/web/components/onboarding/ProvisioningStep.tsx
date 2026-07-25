"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { provisionWorkspace, type ProjectPersona } from "@/lib/api";

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
  // Guards against React strict-mode double-invoking effects (and any
  // re-render before onDone flips the step away from "provisioning"), which
  // would otherwise fire a second POST /onboarding/provision for the same run.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    provisionWorkspace(runId, persona ?? undefined)
      .then((r) => onDone(r.project_id))
      .catch((e) => setError(e instanceof Error ? e.message : t("onboarding.provisioning.error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, persona]);

  return (
    <div className="animate-fade-in text-center">
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <>
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
          <p className="mt-4 text-sm font-medium text-foreground">{t("onboarding.provisioning.title")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("onboarding.provisioning.hint")}</p>
        </>
      )}
    </div>
  );
}
