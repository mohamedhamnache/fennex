"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check, X } from "lucide-react";
import { FennecMark } from "@fennex/ui";
import { cn } from "@/lib/cn";
import { patchDiscovery, type DiscoveryResult, type ProjectPersona } from "@/lib/api";
import { STEP_ORDER, type OnboardingStep } from "./types";
import { WelcomeStep } from "./WelcomeStep";
import { DiscoveryStep } from "./DiscoveryStep";
import { ReviewStep } from "./ReviewStep";
import { GoalsStep } from "./GoalsStep";
import { BrandStep } from "./BrandStep";
import { AudienceStep } from "./AudienceStep";
import { SummaryStep } from "./SummaryStep";
import { ProvisioningStep } from "./ProvisioningStep";
import { DoneStep } from "./DoneStep";

const RAIL: { step: OnboardingStep; key: string }[] = [
  { step: "discovery", key: "onboarding.rail.discover" },
  { step: "review", key: "onboarding.rail.review" },
  { step: "goals", key: "onboarding.rail.goals" },
  { step: "brand", key: "onboarding.rail.brand" },
  { step: "audience", key: "onboarding.rail.audience" },
  { step: "summary", key: "onboarding.rail.summary" },
];

// The editable steps all mutate the same `result` with no hard dependencies
// between them, so once discovery has produced a result the user may jump
// freely among them (rail clicks) or step back one at a time (Back button).
// "welcome" and "discovery" are one-way entry points -- re-entering discovery
// would restart the run -- and "provisioning"/"done" are terminal, so none of
// those are navigable.
const EDITABLE: OnboardingStep[] = ["review", "goals", "brand", "audience", "summary"];

/**
 * Owns onboarding flow state: the current step, the discovery run id, the
 * (eventually user-edited) discovery result, and the chosen persona. Later
 * tasks (11-16) mount their step screens inside `<main>` below, driven off
 * `step`, and call `setStep` / `setRunId` / `setResult` / `setPersona` to
 * advance the flow -- see task-10-report.md for the exact contract.
 */
export function OnboardingShell() {
  const { t } = useTranslation();
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [runId, setRunId] = useState<string | null>(null);
  // Phase 1 has no persona picker; provisioning treats null as "unset".
  const [persona, setPersona] = useState<ProjectPersona | null>(null);
  const [result, setResult] = useState<DiscoveryResult | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  // Persist edits made on the review screen so a refresh resumes from saved
  // state instead of losing the user's corrections. Debounced to avoid
  // hammering the API on every keystroke.
  useEffect(() => {
    if (!runId || !result) return;
    const id = setTimeout(() => {
      patchDiscovery(runId, result).catch(() => {});
    }, 800);
    return () => clearTimeout(id);
  }, [runId, result]);

  const activeIndex = STEP_ORDER.indexOf(step);
  // "provisioning" and "done" are terminal states reached after "summary" and
  // are not in STEP_ORDER, so activeIndex is -1 for them. Without this flag
  // every rail item's idx (>= 0) would be neither `< -1` nor `=== -1`, and the
  // whole rail would render as "todo" right when the user finishes the flow.
  // Terminal steps show the rail fully completed instead.
  const isTerminalStep = activeIndex === -1;

  // Whether the user is currently in the free-navigation phase: only the
  // editable steps expose the clickable rail and the Back control.
  const isEditablePhase = EDITABLE.includes(step);
  const editableIndex = EDITABLE.indexOf(step);
  const canGoBack = isEditablePhase && editableIndex > 0;

  return (
    // h-full (not min-h-screen): the ancestor chain in
    // app/(dashboard)/layout.tsx already bounds height down to this root via
    // h-screen -> flex-1 (x2) -> this <main>, all overflow-hidden on takeover
    // routes. A definite height here is what lets the content column below
    // actually scroll (min-h-screen is only a floor, not a box overflow can
    // clip against).
    <div className="relative flex h-full bg-background">
      {/* Persistent escape hatch: onboarding is a full-screen takeover, so the
          user needs a way back to the app. Hidden while provisioning (don't
          interrupt workspace creation) and on the done screen (which has its
          own dashboard CTA). The discovery run is persisted server-side, so
          leaving loses nothing. */}
      {step !== "provisioning" && step !== "done" && (
        <button
          type="button"
          onClick={() => router.push("/")}
          aria-label={t("onboarding.exit")}
          className="absolute right-4 top-4 z-10 flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <X className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("onboarding.exit")}</span>
        </button>
      )}
      {/* Step back one editable step at a time. Only shown once discovery has
          handed off to the editable phase and there is a previous editable
          step to return to (never on "review", the first one). */}
      {canGoBack && (
        <button
          type="button"
          onClick={() => setStep(EDITABLE[editableIndex - 1])}
          aria-label={t("onboarding.back")}
          className="absolute left-4 top-4 z-10 flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("onboarding.back")}</span>
        </button>
      )}
      <aside className="hidden w-64 shrink-0 border-r border-border p-6 md:flex md:flex-col">
        <div className="mb-8 flex items-center gap-2.5">
          <FennecMark className="h-9 w-9 shrink-0 dark:brightness-0 dark:invert" />
          <span className="font-display text-xl font-bold tracking-tight text-foreground">Fennex</span>
        </div>
        <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
          {t("onboarding.title")}
        </p>
        <ol className="space-y-1">
          {RAIL.map((item, i) => {
            const idx = STEP_ORDER.indexOf(item.step);
            const state = isTerminalStep || idx < activeIndex ? "done" : idx === activeIndex ? "active" : "todo";
            const isLast = i === RAIL.length - 1;
            // Only the editable steps (never "discovery") are jumpable, and
            // only once the flow has reached the editable phase -- a step
            // navigated back from still counts, since `isEditablePhase` and
            // the rail item set don't depend on `state`/position.
            const isClickable = isEditablePhase && EDITABLE.includes(item.step);
            const itemClassName = cn(
              "relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
              state === "active" && "bg-primary/10 text-primary font-medium",
              state === "done" && "text-muted-foreground",
              state === "todo" && "text-muted-foreground/60",
              isClickable && "cursor-pointer hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
            );
            const itemContent = (
              <>
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors",
                    state === "active" && "bg-primary text-primary-foreground",
                    state === "done" && "bg-primary/15 text-primary",
                    state === "todo" && "bg-muted",
                  )}
                >
                  {state === "done" ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                {t(item.key)}
              </>
            );
            return (
              <li key={item.step} className="relative">
                {!isLast && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute left-[24px] top-9 h-[calc(100%-8px)] w-px transition-colors",
                      state === "done" ? "bg-primary/40" : "bg-border",
                    )}
                  />
                )}
                {isClickable ? (
                  <button type="button" onClick={() => setStep(item.step)} aria-label={t(item.key)} className={itemClassName}>
                    {itemContent}
                  </button>
                ) : (
                  <div className={itemClassName}>{itemContent}</div>
                )}
              </li>
            );
          })}
        </ol>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 border-b border-border px-6 py-4 md:hidden">
          <FennecMark className="h-7 w-7 shrink-0 dark:brightness-0 dark:invert" />
          <span className="font-display text-base font-bold tracking-tight text-foreground">Fennex</span>
        </div>
        <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center p-6 animate-fade-in">
          {step === "welcome" && <WelcomeStep onStart={() => setStep("discovery")} />}
          {step === "discovery" && (
            <DiscoveryStep
              onComplete={(id, res) => {
                setRunId(id);
                setResult(res);
                setStep("review");
              }}
            />
          )}
          {step === "review" && result && (
            <ReviewStep result={result} onChange={setResult} onNext={() => setStep("goals")} runId={runId} />
          )}
          {step === "goals" && result && (
            <GoalsStep result={result} onChange={setResult} onNext={() => setStep("brand")} runId={runId} />
          )}
          {step === "brand" && result && (
            <BrandStep result={result} onChange={setResult} onNext={() => setStep("audience")} />
          )}
          {step === "audience" && result && (
            <AudienceStep result={result} onChange={setResult} onNext={() => setStep("summary")} runId={runId} />
          )}
          {step === "summary" && result && (
            <SummaryStep result={result} onEdit={setStep} onCreate={() => setStep("provisioning")} />
          )}
          {step === "provisioning" && runId && (
            <ProvisioningStep
              runId={runId}
              persona={persona}
              onDone={(id) => {
                setProjectId(id);
                setStep("done");
              }}
            />
          )}
          {step === "done" && projectId && <DoneStep projectId={projectId} />}
        </div>
      </main>
    </div>
  );
}
