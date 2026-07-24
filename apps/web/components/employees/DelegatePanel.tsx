"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CornerDownLeft, Loader2, Sparkles, Users, Zap } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  departmentAccent, employeeIcon, previewPlan, type Employee, type PlanPreview,
} from "@/lib/employees";

/** Hand a goal to the company and watch the Orchestrator assemble the team.
 *
 *  This previews only -- it resolves the plan without spending credits, so the
 *  user always sees who would work and in what order before committing. */
export function DelegatePanel({
  projectId, persona, employees,
}: {
  projectId: string;
  persona: string;
  employees: Employee[];
}) {
  const { t } = useTranslation();
  const [goal, setGoal] = useState("");

  const plan = useMutation({
    mutationFn: (g: string) => previewPlan({ goal: g, project_id: projectId, persona }),
  });

  const byId = new Map(employees.map((e) => [e.id, e]));
  const submit = () => {
    const trimmed = goal.trim();
    if (trimmed && !plan.isPending) plan.mutate(trimmed);
  };

  return (
    <section className="glass overflow-hidden">
      <div className="relative p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(620px 180px at 10% -30%, hsl(var(--primary) / 0.14), transparent 62%)" }}
        />

        <div className="relative flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl gradient-brand glow-primary">
            <Sparkles className="h-5 w-5 text-white" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold leading-tight text-foreground">
              {t("company.delegate.title")}
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("company.delegate.subtitle")}
            </p>
          </div>
        </div>

        <div className="relative mt-4 flex flex-col gap-2 sm:flex-row">
          <label htmlFor="delegate-goal" className="sr-only">
            {t("company.delegate.label")}
          </label>
          <input
            id="delegate-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={t("company.delegate.placeholder")}
            className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!goal.trim() || plan.isPending}
            className="btn-primary flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {plan.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Users className="h-4 w-4" />}
            {t("company.delegate.cta")}
            {!plan.isPending && <CornerDownLeft className="hidden h-3 w-3 opacity-60 sm:block" />}
          </button>
        </div>

        {/* Example goals -- removes the blank-input problem */}
        {!plan.data && !plan.isPending && (
          <div className="relative mt-3 flex flex-wrap gap-1.5">
            {(t("company.delegate.examples", { returnObjects: true }) as string[]).map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => { setGoal(ex); plan.mutate(ex); }}
                className="cursor-pointer rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        {plan.isError && (
          <p className="relative mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {t("company.delegate.error")}
          </p>
        )}
      </div>

      {plan.data && <PlanGraph plan={plan.data} byId={byId} />}
    </section>
  );
}

/** The execution plan, drawn as the Orchestrator sees it: dependency layers
 *  stacked in order, employees inside a layer running in parallel. */
function PlanGraph({
  plan, byId,
}: { plan: PlanPreview; byId: Map<string, Employee> }) {
  const { t } = useTranslation();
  const taskById = new Map(plan.tasks.map((task) => [task.id, task]));

  if (plan.tasks.length === 0) {
    return (
      <div className="border-t border-border px-5 py-4 sm:px-6">
        <p className="text-xs text-muted-foreground">{t("company.delegate.unstaffed")}</p>
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-muted/20 px-5 py-5 sm:px-6 animate-slide-up">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold text-foreground">
          {t("company.delegate.planTitle")}
        </h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {t("company.delegate.stepCount", { count: plan.tasks.length })}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {t("company.delegate.layerCount", { count: plan.layers.length })}
        </span>
      </div>

      <ol className="flex flex-col gap-2">
        {plan.layers.map((layer, index) => {
          const parallel = layer.length > 1;
          return (
            <li key={index} className="flex items-stretch gap-3">
              {/* Layer rail */}
              <div className="flex w-6 shrink-0 flex-col items-center">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-card text-[10px] font-bold text-muted-foreground ring-1 ring-inset ring-border">
                  {index + 1}
                </span>
                {index < plan.layers.length - 1 && (
                  <span aria-hidden className="mt-1 w-px flex-1 bg-border" />
                )}
              </div>

              <div className="min-w-0 flex-1 pb-2">
                {parallel && (
                  <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    <Zap className="h-3 w-3" strokeWidth={2.5} />
                    {t("company.delegate.parallel")}
                  </p>
                )}
                <div className={cn("grid gap-2", parallel ? "sm:grid-cols-2" : "grid-cols-1")}>
                  {layer.map((taskId) => {
                    const task = taskById.get(taskId);
                    if (!task) return null;
                    const employee = task.employeeId ? byId.get(task.employeeId) : undefined;
                    const Icon = employeeIcon(employee?.icon ?? "sparkles");
                    const action = employee?.actions.find((a) => a.id === task.actionId);
                    return (
                      <div
                        key={taskId}
                        className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-3"
                      >
                        <span className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          departmentAccent(employee?.department ?? ""),
                        )}>
                          <Icon className="h-4 w-4" strokeWidth={1.8} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-foreground">
                            {employee?.name ?? task.employeeId}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {action?.label ?? task.actionId}
                          </p>
                          {task.capabilities.map((c) => (
                            <span
                              key={c}
                              className="mt-1 inline-block rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        {t("company.delegate.previewNote")}
      </p>
    </div>
  );
}
