"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle, Check, ChevronDown, HelpCircle, Loader2, Lock, Play,
  RotateCcw, Zap,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { WorkflowStep } from "@/lib/chat";
import { departmentAccent, employeeIcon, type Employee } from "@/lib/employees";

export type StepState = "locked" | "ready" | "running" | "done" | "failed";

/** A multi-specialist plan where every step is validated on its own.
 *
 *  Each step is a separate decision: the user reads why that specialist was
 *  chosen and what it will produce, runs it, sees the result, and only then
 *  unlocks the next one. "Run all" remains for when they trust the whole plan. */
export function WorkflowCard({
  message,
  steps,
  byId,
  stateOf,
  runningIndex,
  onRunStep,
  onRunAll,
  busy,
}: {
  message: { id: string; content: string };
  steps: WorkflowStep[];
  byId: Map<string, Employee>;
  stateOf: (index: number) => StepState;
  runningIndex: number | null;
  onRunStep: (messageId: string, steps: WorkflowStep[], index: number) => void;
  onRunAll: (messageId: string, steps: WorkflowStep[]) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const done = steps.filter((_, i) => stateOf(i) === "done").length;
  const allDone = done === steps.length;

  return (
    <div className="overflow-hidden rounded-2xl border border-primary/25 bg-primary/[0.04] animate-slide-up">
      <header className="flex flex-wrap items-center gap-2 border-b border-primary/15 px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
          {t("chat.workflow.title")}
        </span>
        <span className="rounded-full bg-background/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {t("chat.workflow.progress", { done, total: steps.length })}
        </span>

        {/* Progress rail -- one segment per step */}
        <span className="ml-auto flex items-center gap-1" aria-hidden>
          {steps.map((_, index) => {
            const state = stateOf(index);
            return (
              <span
                key={index}
                className={cn(
                  "h-1 w-6 rounded-full transition-colors duration-300",
                  state === "done" && "bg-success",
                  state === "running" && "bg-primary animate-pulse-dot",
                  state === "failed" && "bg-destructive",
                  (state === "ready" || state === "locked") && "bg-border",
                )}
              />
            );
          })}
        </span>
      </header>

      <p className="px-4 pt-3 text-sm text-foreground">{message.content}</p>

      <ol className="flex flex-col gap-2 p-4">
        {steps.map((step, index) => (
          <StepRow
            key={`${step.employeeId}-${step.actionId}-${index}`}
            step={step}
            index={index}
            state={stateOf(index)}
            employee={byId.get(step.employeeId)}
            busy={busy}
            isRunning={runningIndex === index}
            onRun={() => onRunStep(message.id, steps, index)}
          />
        ))}
      </ol>

      {!allDone && (
        <div className="flex flex-wrap items-center gap-2 border-t border-primary/15 px-4 py-3">
          <button
            type="button"
            onClick={() => onRunAll(message.id, steps)}
            disabled={busy}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Zap className="h-3 w-3" strokeWidth={2.5} />
            {t("chat.workflow.runAll", { count: steps.length - done })}
          </button>
          <p className="text-[10px] text-muted-foreground">
            {t("chat.workflow.stepHint")}
          </p>
        </div>
      )}
    </div>
  );
}

function StepRow({
  step, index, state, employee, busy, isRunning, onRun,
}: {
  step: WorkflowStep;
  index: number;
  state: StepState;
  employee?: Employee;
  busy: boolean;
  isRunning: boolean;
  onRun: () => void;
}) {
  const { t } = useTranslation();
  const [showWhy, setShowWhy] = useState(false);
  const Icon = employeeIcon(employee?.icon ?? step.icon ?? "sparkles");
  const locked = state === "locked";

  return (
    <li
      className={cn(
        "rounded-xl border transition-all duration-200",
        state === "done" && "border-success/30 bg-success/[0.05]",
        state === "failed" && "border-destructive/30 bg-destructive/[0.05]",
        state === "running" && "border-primary/45 bg-primary/[0.06]",
        state === "ready" && "border-border bg-card",
        locked && "border-dashed border-border bg-transparent opacity-60",
      )}
    >
      <div className="flex items-start gap-3 p-3">
        <span className="flex w-4 shrink-0 justify-center pt-1.5 text-[10px] font-bold text-muted-foreground">
          {index + 1}
        </span>

        <span className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-200",
          departmentAccent(employee?.department ?? step.department ?? ""),
          state === "running" && "scale-105",
        )}>
          <Icon className="h-4 w-4" strokeWidth={1.8} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-foreground">{step.employeeName}</span>
            <span className="text-[10px] text-muted-foreground">{step.employeeRole}</span>
            <StateBadge state={state} />
          </p>
          <p className="mt-0.5 text-xs text-foreground">{step.label}</p>
          {step.description && (
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {step.description}
            </p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {step.outputs.map((output) => (
              <span key={output}
                    className="rounded-full bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {output}
              </span>
            ))}
            {step.weight === "heavy" && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {t("chat.actions.takesLonger")}
              </span>
            )}
            {step.why && (
              <button
                type="button"
                onClick={() => setShowWhy((v) => !v)}
                aria-expanded={showWhy}
                className="flex cursor-pointer items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-primary"
              >
                <HelpCircle className="h-2.5 w-2.5" />
                {t("chat.workflow.why")}
                <ChevronDown className={cn("h-2.5 w-2.5 transition-transform duration-200",
                  showWhy && "rotate-180")} />
              </button>
            )}
          </div>

          {showWhy && step.why && (
            <p className="mt-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground animate-fade-in">
              {step.why}
            </p>
          )}
        </div>

        <StepButton
          state={state}
          busy={busy}
          isRunning={isRunning}
          locked={locked}
          onRun={onRun}
        />
      </div>
    </li>
  );
}

function StateBadge({ state }: { state: StepState }) {
  const { t } = useTranslation();
  if (state === "ready") return null;
  const map: Record<Exclude<StepState, "ready">, string> = {
    locked: "bg-muted text-muted-foreground",
    running: "bg-primary/15 text-primary",
    done: "bg-success/15 text-success",
    failed: "bg-destructive/15 text-destructive",
  };
  return (
    <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
      map[state as Exclude<StepState, "ready">])}>
      {t(`chat.workflow.state.${state}`)}
    </span>
  );
}

function StepButton({
  state, busy, isRunning, locked, onRun,
}: {
  state: StepState;
  busy: boolean;
  isRunning: boolean;
  locked: boolean;
  onRun: () => void;
}) {
  const { t } = useTranslation();

  if (state === "done") {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success/12 text-success">
        <Check className="h-4 w-4" strokeWidth={2.5} />
      </span>
    );
  }

  if (isRunning) {
    return (
      <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary/12 px-2.5 text-[11px] font-semibold text-primary">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("chat.workflow.state.running")}
      </span>
    );
  }

  if (locked) {
    return (
      <span
        title={t("chat.workflow.lockedHint")}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground/50"
      >
        <Lock className="h-3.5 w-3.5" />
      </span>
    );
  }

  const failed = state === "failed";
  return (
    <button
      type="button"
      onClick={onRun}
      disabled={busy}
      className={cn(
        "flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold transition-all duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40",
        failed
          ? "border border-destructive/40 text-destructive hover:bg-destructive/10"
          : "btn-primary",
      )}
    >
      {failed
        ? <><RotateCcw className="h-3 w-3" strokeWidth={2.5} /> {t("chat.workflow.retry")}</>
        : <><Play className="h-3 w-3" strokeWidth={2.5} /> {t("chat.workflow.run")}</>}
    </button>
  );
}

/** Shown when a step fails, so the reason is not buried in the transcript. */
export function StepError({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      {message}
    </p>
  );
}
