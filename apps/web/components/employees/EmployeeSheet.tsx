"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Boxes, Brain, Database, Plug, Quote, Target, Wrench, X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  departmentAccent, employeeIcon, type Employee, type EmployeeHealth,
} from "@/lib/employees";

/** The full employee contract: prompt, knowledge, apps, memory, tools, actions. */
export function EmployeeSheet({
  employee, health, onClose,
}: {
  employee: Employee | null;
  health?: EmployeeHealth;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  // Escape closes, and the body must not scroll behind the panel.
  useEffect(() => {
    if (!employee) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [employee, onClose]);

  if (!employee) return null;

  const Icon = employeeIcon(employee.icon);
  const accent = departmentAccent(employee.department);
  const byDomain = groupByDomain(employee.capabilities);
  const unbacked = new Set(
    employee.capabilities.filter(
      (c) => !employee.actions.some((a) => a.capabilities.includes(c)),
    ),
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm animate-fade-in"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={employee.name}
        className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-border bg-card shadow-2xl animate-slide-in-right"
      >
        {/* Identity */}
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-border bg-card/95 px-6 py-5 backdrop-blur">
          <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", accent)}>
            <Icon className="h-6 w-6" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl font-bold leading-tight text-foreground">
              {employee.name}
            </h2>
            <p className="text-xs font-medium text-primary">{employee.role}</p>
            <p className="text-[11px] text-muted-foreground">
              {employee.department} · v{employee.version} · {t(`company.status.${employee.status}`)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-col gap-6 px-6 py-6">
          {health && !health.ok && (
            <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
              {health.detail}
            </p>
          )}

          <p className="text-sm leading-relaxed text-muted-foreground">{employee.description}</p>

          {employee.personality && (
            <blockquote className="relative rounded-xl border border-border bg-muted/40 p-4 pl-9 text-xs italic leading-relaxed text-muted-foreground">
              <Quote className="absolute left-3 top-4 h-3.5 w-3.5 text-primary/50" />
              {employee.personality}
            </blockquote>
          )}

          {employee.goals.length > 0 && (
            <Section icon={Target} title={t("company.sheet.goals")}>
              <ul className="flex flex-col gap-1.5">
                {employee.goals.map((g) => (
                  <li key={g} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                    <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                    {g}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Actions -- the assignable units of work */}
          <Section icon={Boxes} title={t("company.sheet.actions")}>
            <div className="flex flex-col gap-2">
              {employee.actions.map((a) => (
                <div key={a.id} className="rounded-xl border border-border p-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-foreground">{a.label}</p>
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                      a.weight === "heavy"
                        ? "bg-primary/12 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}>
                      {t(`company.weight.${a.weight}`)}
                    </span>
                    {a.requiresApproval && (
                      <span className="rounded-full bg-warning/12 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                        {t("company.sheet.needsApproval")}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {a.description}
                  </p>
                  {a.capabilities.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {a.capabilities.map((c) => <Chip key={c}>{c}</Chip>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>

          {/* Capabilities, grouped by domain */}
          <Section icon={Brain} title={t("company.sheet.capabilities")}>
            <div className="flex flex-col gap-3">
              {Object.entries(byDomain).map(([domain, slugs]) => (
                <div key={domain}>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {domain}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {slugs.map((c) => (
                      <Chip key={c} muted={unbacked.has(c)}
                            title={unbacked.has(c) ? t("company.sheet.plannedHint") : undefined}>
                        {c.split(".")[1]?.replace(/_/g, " ") ?? c}
                      </Chip>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {unbacked.size > 0 && (
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                {t("company.sheet.plannedNote", { count: unbacked.size })}
              </p>
            )}
          </Section>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {employee.allowedTools.length > 0 && (
              <Section icon={Wrench} title={t("company.sheet.tools")}>
                <div className="flex flex-wrap gap-1">
                  {employee.allowedTools.map((x) => <Chip key={x}>{x}</Chip>)}
                </div>
              </Section>
            )}

            {employee.connectedApps.length > 0 && (
              <Section icon={Plug} title={t("company.sheet.apps")}>
                <div className="flex flex-wrap gap-1">
                  {employee.connectedApps.map((app) => {
                    const connected = health?.connectedApps?.[app];
                    return (
                      <span
                        key={app}
                        title={connected ? t("company.sheet.connected") : t("company.sheet.notConnected")}
                        className={cn(
                          "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                          connected
                            ? "bg-success/12 text-success"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full",
                          connected ? "bg-success" : "bg-muted-foreground/40")} />
                        {app}
                      </span>
                    );
                  })}
                </div>
              </Section>
            )}
          </div>

          <Section icon={Database} title={t("company.sheet.knowledge")}>
            <dl className="flex flex-col gap-2 text-xs">
              <Row label={t("company.sheet.memoryScope")}>
                <Chip>{t(`company.scope.${employee.memoryScope}`)}</Chip>
              </Row>
              <Row label={t("company.sheet.sources")}>
                <div className="flex flex-wrap gap-1">
                  {employee.knowledgeSources.map((s) => <Chip key={s}>{s}</Chip>)}
                </div>
              </Row>
              <Row label={t("company.sheet.io")}>
                <div className="flex flex-wrap gap-1">
                  {employee.supportedInputs.map((s) => <Chip key={`in-${s}`}>{s}</Chip>)}
                  <span aria-hidden className="text-muted-foreground">&rarr;</span>
                  {employee.supportedOutputs.map((s) => <Chip key={`out-${s}`}>{s}</Chip>)}
                </div>
              </Row>
              <Row label={t("company.sheet.permissions")}>
                <div className="flex flex-wrap gap-1">
                  {employee.permissions.map((p) => <Chip key={p}>{p}</Chip>)}
                </div>
              </Row>
            </dl>
          </Section>
        </div>
      </aside>
    </div>
  );
}

function Section({
  icon: Icon, title, children,
}: { icon: typeof Brain; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
      <dt className="w-28 shrink-0 text-[11px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function Chip({
  children, muted = false, title,
}: { children: React.ReactNode; muted?: boolean; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium",
        muted
          ? "border border-dashed border-border text-muted-foreground/70"
          : "bg-muted/70 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function groupByDomain(slugs: string[]): Record<string, string[]> {
  return slugs.reduce<Record<string, string[]>>((acc, slug) => {
    const domain = slug.split(".")[0];
    (acc[domain] ??= []).push(slug);
    return acc;
  }, {});
}
