"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ShieldCheck, Eye, Zap,
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

  // Portals render on the client only; without this the markup differs between
  // server and client and React discards the tree on hydration. Declared with
  // the other hooks, ABOVE the early return -- a hook after a conditional
  // return changes the hook count between renders and React tears the tree
  // down entirely.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [tab, setTab] = useState<"overview" | "actions" | "capabilities" | "access">("overview");
  // Reopening on a different employee must start at the top, not wherever the
  // last one was left.
  useEffect(() => { setTab("overview"); }, [employee?.id]);

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

  if (!employee || !mounted) return null;

  const Icon = employeeIcon(employee.icon);
  const accent = departmentAccent(employee.department);
  const byDomain = groupByDomain(employee.capabilities);
  const unbacked = new Set(
    employee.capabilities.filter(
      (c) => !employee.actions.some((a) => a.capabilities.includes(c)),
    ),
  );

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end">
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
        className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-border bg-card shadow-2xl animate-slide-in-right sm:max-w-xl"
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
            <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
              {employee.department}
              <span aria-hidden>·</span>
              v{employee.version}
              <span aria-hidden>·</span>
              {/* Health as a dot beside the status word, not a paragraph buried
                  below the fold: whether this employee can work at all is the
                  first thing worth knowing about it. */}
              <span className={cn(
                "inline-flex items-center gap-1 font-medium",
                health && !health.ok ? "text-warning" : "text-success",
              )}>
                <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full",
                  health && !health.ok ? "bg-warning" : "bg-success")} />
                {t(`company.status.${employee.status}`)}
              </span>
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

        {/* What this employee IS, in four numbers. A reader deciding whether to
            delegate here wants scale before prose -- how much it can do, and
            how much of that is real work rather than a declaration. */}
        <dl className="grid grid-cols-4 gap-px border-b border-border bg-border">
          <Stat n={employee.actions.length} label={t("company.sheet.actions")} />
          <Stat n={employee.capabilities.length} label={t("company.sheet.capabilities")} />
          <Stat n={employee.allowedTools?.length ?? 0} label={t("company.sheet.tools")} />
          <Stat n={employee.connectedApps?.length ?? 0} label={t("company.sheet.apps")} />
        </dl>

        {/* Four views instead of one 300-line scroll. Someone opening this
            panel has one question -- what can it do, or what can it reach --
            and had to scroll past everything else to answer either. */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-6">
          {([
            { key: "overview" as const, label: t("company.sheet.tabs.overview") },
            { key: "actions" as const, label: t("company.sheet.actions") },
            { key: "capabilities" as const, label: t("company.sheet.capabilities") },
            { key: "access" as const, label: t("company.sheet.tabs.access") },
          ]).map(({ key, label }) => {
            const on = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "relative shrink-0 cursor-pointer px-2.5 py-2.5 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                {on && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary" />}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-6 px-6 py-6">
          {tab === "overview" && (<>
          {health && !health.ok && (
            <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">
              {health.detail}
            </p>
          )}

          <p className="text-sm leading-relaxed text-foreground">{employee.description}</p>

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

          </>)}

          {tab === "actions" && (
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

          )}

          {tab === "capabilities" && (
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
          )}

          {tab === "access" && (<>
          {/* PERMISSIONS LEAD. This tab answers "what can this thing do to my
              account", and that was the last row on it, rendered as raw slugs.
              Split read from act because the split is the whole question: a
              reader skims the passive half and studies the consequential one. */}
          <Section icon={ShieldCheck} title={t("company.sheet.permissions")}>
            <div className="flex flex-col gap-3">
              {(() => {
                const acts = employee.permissions.filter((x) => !x.startsWith("read:"));
                const reads = employee.permissions.filter((x) => x.startsWith("read:"));
                return (
                  <>
                    <div>
                      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full",
                          acts.length ? "bg-warning" : "bg-muted-foreground/40")} />
                        {t("company.sheet.canAct")}
                      </p>
                      {acts.length ? (
                        <ul className="flex flex-col gap-1">
                          {acts.map((x) => (
                            <li key={x} className="flex items-start gap-2 text-xs text-foreground">
                              <Zap className="mt-0.5 h-3 w-3 shrink-0 text-warning" strokeWidth={2.2} />
                              {t(`company.permission.${x.replace(":", "_")}`, { defaultValue: x })}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        // Worth stating outright rather than leaving blank: an
                        // employee that can only read is a different risk, and
                        // an empty section reads as missing data.
                        <p className="text-xs text-muted-foreground">{t("company.sheet.readOnly")}</p>
                      )}
                    </div>

                    {reads.length > 0 && (
                      <div>
                        <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                          {t("company.sheet.canRead")}
                        </p>
                        <ul className="flex flex-col gap-1">
                          {reads.map((x) => (
                            <li key={x} className="flex items-start gap-2 text-xs text-muted-foreground">
                              <Eye className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} />
                              {t(`company.permission.${x.replace(":", "_")}`, { defaultValue: x })}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </Section>

          {/* Apps, with their live state. An app the org has not connected is
              reach this employee does not actually have, so the dot is the
              point rather than decoration. */}
          {employee.connectedApps.length > 0 && (
            <Section icon={Plug} title={t("company.sheet.apps")}>
              <ul className="flex flex-col gap-1">
                {employee.connectedApps.map((app) => {
                  const connected = health?.connectedApps?.[app];
                  return (
                    <li key={app} className="flex items-center gap-2 text-xs">
                      <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full",
                        connected ? "bg-success" : "bg-muted-foreground/40")} />
                      <span className="text-foreground">{app}</span>
                      <span className={cn("ml-auto text-[10px]",
                        connected ? "text-success" : "text-muted-foreground")}>
                        {connected ? t("company.sheet.connected") : t("company.sheet.notConnected")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {employee.allowedTools.length > 0 && (
            <Section icon={Wrench} title={`${t("company.sheet.tools")} (${employee.allowedTools.length})`}>
              <div className="flex flex-wrap gap-1">
                {employee.allowedTools.map((x) => <Chip key={x}>{x}</Chip>)}
              </div>
            </Section>
          )}

          {/* MEMORY AND CONTEXT. The scope was a bare chip -- "project" tells a
              reader nothing about what this employee actually remembers, or
              what it is told before it starts. Both are the difference between
              an employee and a prompt, so both are spelled out. */}
          <Section icon={Brain} title={t("company.sheet.memoryTitle")}>
            <div className="flex flex-col gap-3">
              <div className="rounded-xl border border-border bg-muted/30 p-3">
                <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <Database className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
                  {t(`company.scope.${employee.memoryScope}`)}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {t(`company.scopeExplain.${employee.memoryScope}`, {
                    defaultValue: t("company.scopeExplain.project"),
                  })}
                </p>
              </div>

              {/* What it is handed on EVERY run, before it does anything. */}
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("company.sheet.alwaysKnows")}
                </p>
                <ul className="flex flex-col gap-1">
                  {[
                    t("company.context.brand"),
                    t("company.context.published"),
                    t("company.context.memory"),
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
                      <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/60" />
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>

          <Section icon={Database} title={t("company.sheet.knowledge")}>
            <dl className="flex flex-col gap-2 text-xs">
              <Row label={t("company.sheet.sources")}>
                <div className="flex flex-wrap gap-1">
                  {employee.knowledgeSources.map((x) => <Chip key={x}>{x}</Chip>)}
                </div>
              </Row>
              <Row label={t("company.sheet.io")}>
                <div className="flex flex-wrap items-center gap-1">
                  {employee.supportedInputs.map((x) => <Chip key={`in-${x}`}>{x}</Chip>)}
                  <span aria-hidden className="px-0.5 text-muted-foreground">&rarr;</span>
                  {employee.supportedOutputs.map((x) => <Chip key={`out-${x}`}>{x}</Chip>)}
                </div>
              </Row>
            </dl>
          </Section>
          </>)}
        </div>
      </aside>
    </div>,
    document.body,
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

/** One number from the employee's own declaration. Reads as scale at a glance;
 *  the tabs below carry the detail. */
function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex flex-col items-center bg-card px-2 py-3">
      <dt className="order-2 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="order-1 font-display text-lg font-bold tabular-nums text-foreground">{n}</dd>
    </div>
  );
}
