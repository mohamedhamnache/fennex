"use client";

import { useTranslation } from "react-i18next";
import { ArrowUpRight, CircleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  departmentAccent, employeeIcon, type Employee, type EmployeeHealth,
} from "@/lib/employees";

/** One member of the AI company. Everything shown comes from the registry. */
export function EmployeeCard({
  employee, health, onOpen,
}: {
  employee: Employee;
  health?: EmployeeHealth;
  onOpen: (employee: Employee) => void;
}) {
  const { t } = useTranslation();
  const Icon = employeeIcon(employee.icon);
  const accent = departmentAccent(employee.department);
  const actionCount = employee.actions.length;

  return (
    <button
      type="button"
      onClick={() => onOpen(employee)}
      aria-label={t("company.card.open", { name: employee.name })}
      className="group glass glass-hover relative flex cursor-pointer flex-col items-start gap-3 overflow-hidden p-5 text-left transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div className="flex w-full items-start gap-3">
        <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105", accent)}>
          <Icon className="h-5 w-5" strokeWidth={1.8} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-display text-base font-bold leading-tight text-foreground">
              {employee.name}
            </p>
            {health && (
              <span
                title={health.detail}
                className={cn("flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                  health.ok ? "bg-success/12 text-success" : "bg-warning/12 text-warning")}
              >
                {health.ok
                  ? <CircleCheck className="h-2.5 w-2.5" strokeWidth={2.5} />
                  : <CircleAlert className="h-2.5 w-2.5" strokeWidth={2.5} />}
                {health.ok ? t("company.health.ready") : t("company.health.blocked")}
              </span>
            )}
          </div>
          <p className="truncate text-xs font-medium text-primary">{employee.role}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {employee.department}
            <span className="mx-1 opacity-40">·</span>
            <span className="italic">{employee.codename}</span>
          </p>
        </div>

        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>

      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {employee.description}
      </p>

      <div className="mt-auto flex w-full flex-wrap items-center gap-1.5 pt-1">
        <Stat value={employee.capabilities.length} label={t("company.card.skills")} />
        <Stat value={actionCount} label={t("company.card.actions")} />
        {employee.connectedApps.length > 0 && (
          <Stat value={employee.connectedApps.length} label={t("company.card.apps")} />
        )}
        <span className="ml-auto rounded-full bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          v{employee.version}
        </span>
      </div>
    </button>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="rounded-full bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <span className="font-semibold text-foreground">{value}</span> {label}
    </span>
  );
}
