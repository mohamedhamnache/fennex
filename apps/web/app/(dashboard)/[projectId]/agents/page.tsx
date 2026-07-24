"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRight, Building2, Loader2, Megaphone } from "lucide-react";
import { listProjects } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  employeeHealth, listEmployees, type Employee, type EmployeeHealth,
} from "@/lib/employees";
import { DelegatePanel } from "@/components/employees/DelegatePanel";
import { EmployeeCard } from "@/components/employees/EmployeeCard";
import { EmployeeSheet } from "@/components/employees/EmployeeSheet";
import { ConnectorsPanel } from "@/components/employees/ConnectorsPanel";

/** Deep links into the tool each employee actually drives. Keyed by employee id
 *  so a newly hired employee simply has no shortcut until one is added. */
function shortcut(employeeId: string, base: string): { key: string; href: string } | null {
  switch (employeeId) {
    case "zerda":   return { key: "askZerda", href: `${base}/analytics?copilot=1` };
    case "sirocco": return { key: "directCampaign", href: `${base}/campaigns` };
    case "dune":    return { key: "writeArticle", href: `${base}/articles` };
    case "mirage":  return { key: "productShots", href: `${base}/images/studio?mode=create&intent=product` };
    case "sable":   return { key: "scanCompetitor", href: `${base}/analytics?ws=competitors` };
    case "oasis":   return { key: "marketReport", href: `${base}/analytics?ws=market&oasis=1` };
    case "nomad":   return { key: "planOutreach", href: `${base}/agents/nomad` };
    default:        return null;
  }
}

export default function CompanyPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { t } = useTranslation();
  const base = `/${projectId}`;
  const [selected, setSelected] = useState<Employee | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"], queryFn: listProjects, staleTime: 60_000,
  });
  const persona = projects.find((p) => p.id === projectId)?.persona ?? "creator";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["employees"], queryFn: () => listEmployees(), staleTime: 300_000,
  });

  // Health is best-effort: the roster must still render if the check fails.
  const { data: health } = useQuery({
    queryKey: ["employees", "health", projectId],
    queryFn: () => employeeHealth(projectId),
    staleTime: 60_000,
    retry: false,
  });

  const healthById = useMemo(() => {
    const map = new Map<string, EmployeeHealth>();
    health?.employees.forEach((h) => map.set(h.id, h));
    return map;
  }, [health]);

  const employees = data?.employees ?? [];

  // Departments are a filter rather than a section split: at seven employees
  // across seven departments, grouped sections leave mostly-empty rows, and the
  // filter keeps working as the roster grows.
  const [department, setDepartment] = useState<string | null>(null);
  const departments = useMemo(() => {
    const counts = new Map<string, number>();
    employees.forEach((e) => counts.set(e.department, (counts.get(e.department) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [employees]);

  const visible = department
    ? employees.filter((e) => e.department === department)
    : employees;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl gradient-brand glow-primary">
          <Building2 className="h-5 w-5 text-white" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-bold leading-tight text-foreground">
            {t("company.title")}
          </h1>
          <p className="text-xs leading-tight text-muted-foreground">
            {t("company.subtitle")}
          </p>
        </div>

        {data && (
          <dl className="flex flex-wrap gap-2">
            <Stat value={data.stats.employees} label={t("company.stats.employees")} />
            <Stat value={data.stats.departments} label={t("company.stats.departments")} />
            <Stat value={data.stats.actions} label={t("company.stats.actions")} />
            <Stat value={data.stats.capabilities} label={t("company.stats.capabilities")} />
          </dl>
        )}
      </header>

      {/* Delegate a goal -- the Orchestrator, made visible */}
      {employees.length > 0 && (
        <DelegatePanel projectId={projectId} persona={persona} employees={employees} />
      )}

      {/* Run the full campaign engine */}
      <Link
        href={`${base}/campaigns`}
        className="group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.09] via-primary/[0.03] to-transparent p-5 transition-colors hover:border-primary/40"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{ background: "radial-gradient(520px 160px at 8% -40%, hsl(var(--primary) / 0.16), transparent 60%)" }}
        />
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-white shadow-sm">
          <Megaphone className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div className="relative min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">{t("agentsPage.squad.title")}</p>
          <p className="text-xs text-muted-foreground">{t("agentsPage.squad.desc")}</p>
        </div>
        <span className="relative flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-transform group-hover:translate-x-0.5">
          {t("agentsPage.squad.cta")} <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </Link>

      {/* States */}
      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("company.loading")}
        </div>
      )}

      {isError && (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t("company.error")}
        </p>
      )}

      {/* Department filter + the roster */}
      {employees.length > 0 && (
        <section>
          <div
            role="tablist"
            aria-label={t("company.filterLabel")}
            className="mb-4 flex flex-wrap gap-1.5"
          >
            <FilterChip
              active={department === null}
              onClick={() => setDepartment(null)}
              label={t("company.allDepartments")}
              count={employees.length}
            />
            {departments.map(([name, count]) => (
              <FilterChip
                key={name}
                active={department === name}
                onClick={() => setDepartment(name)}
                label={name}
                count={count}
              />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((employee) => {
              const link = shortcut(employee.id, base);
              return (
                <div key={employee.id} className="flex flex-col gap-2">
                  <EmployeeCard
                    employee={employee}
                    health={healthById.get(employee.id)}
                    onOpen={setSelected}
                  />
                  {link && (
                    <Link
                      href={link.href}
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/30 hover:bg-accent"
                    >
                      {t(`agentsPage.actions.${link.key}`)}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {employees.length > 0 && <ConnectorsPanel />}

      <EmployeeSheet
        employee={selected}
        health={selected ? healthById.get(selected.id) : undefined}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function FilterChip({
  active, onClick, label, count,
}: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:border-primary/20 hover:text-foreground",
      )}
    >
      {label}
      <span className={cn("text-[10px]", active ? "text-primary/70" : "text-muted-foreground/60")}>
        {count}
      </span>
    </button>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-border px-3 py-1.5 text-center">
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="font-display text-base font-bold text-foreground">{value}</span>
        <span className="ml-1 text-[10px] text-muted-foreground">{label}</span>
      </dd>
    </div>
  );
}
