"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DiscoveryResult, ProjectPersona } from "@/lib/api";
import { STEP_ORDER, type OnboardingStep } from "./types";

const RAIL: { step: OnboardingStep; key: string }[] = [
  { step: "discovery", key: "onboarding.rail.discover" },
  { step: "review", key: "onboarding.rail.review" },
  { step: "goals", key: "onboarding.rail.goals" },
  { step: "brand", key: "onboarding.rail.brand" },
  { step: "audience", key: "onboarding.rail.audience" },
  { step: "summary", key: "onboarding.rail.summary" },
];

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

  const activeIndex = STEP_ORDER.indexOf(step);
  // "provisioning" and "done" are terminal states reached after "summary" and
  // are not in STEP_ORDER, so activeIndex is -1 for them. Without this flag
  // every rail item's idx (>= 0) would be neither `< -1` nor `=== -1`, and the
  // whole rail would render as "todo" right when the user finishes the flow.
  // Terminal steps show the rail fully completed instead.
  const isTerminalStep = activeIndex === -1;

  const currentRailItem = RAIL.find((item) => item.step === step);
  const placeholderLabel = currentRailItem
    ? t(currentRailItem.key)
    : t("onboarding.rail.welcome", { defaultValue: step });

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 border-r border-border p-6 md:block">
        <p className="mb-6 text-sm font-semibold text-foreground">{t("onboarding.title")}</p>
        <ol className="space-y-1">
          {RAIL.map((item, i) => {
            const idx = STEP_ORDER.indexOf(item.step);
            const state = isTerminalStep || idx < activeIndex ? "done" : idx === activeIndex ? "active" : "todo";
            return (
              <li
                key={item.step}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  state === "active" && "bg-primary/10 text-primary font-medium",
                  state === "done" && "text-muted-foreground",
                  state === "todo" && "text-muted-foreground/60",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                    state === "active" ? "bg-primary text-primary-foreground" : "bg-muted",
                  )}
                >
                  {state === "done" ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                {t(item.key)}
              </li>
            );
          })}
        </ol>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center p-6 animate-fade-in">
          {/* Step components are wired in Tasks 11-16. Placeholder keeps typecheck green: */}
          <p className="text-sm text-muted-foreground">{placeholderLabel}</p>
        </div>
      </main>
    </div>
  );
}
