"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, FlaskConical, Minus, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import type { MetricSource, StoreKpi } from "@/lib/api";
import { Spark } from "./charts";

/**
 * The badge that says where a number came from.
 *
 * This is the load-bearing component of the dashboard. Half of these figures
 * are measured from synced orders and half are placeholders for sources not
 * connected yet, and a merchant who cannot tell them apart will either trust
 * an invented number or distrust a real one. It is small and quiet, but it is
 * never optional -- `source` is required on every section for that reason.
 */
export function SourceBadge({ source, className }: { source: MetricSource; className?: string }) {
  if (source === "live") return null;      // measured data needs no apology
  const map = {
    sample: { label: "Sample", title: "Placeholder data — this source is not connected yet", Icon: FlaskConical },
    derived: { label: "Projected", title: "Computed from your real revenue, not measured", Icon: Sparkles },
    mixed: { label: "Partly sample", title: "Some figures here are measured, some are placeholders", Icon: FlaskConical },
  } as const;
  const { label, title, Icon } = map[source];
  return (
    <span title={title} className={cn(
      "inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border",
      "px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
      className,
    )}>
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

/** A dashboard section: title, optional source badge, optional right-hand
 *  control, and a body. Collapsible so a long dashboard stays navigable. */
export function Section({ title, subtitle, source, action, children, defaultOpen = true, id }: {
  title: string; subtitle?: string; source?: MetricSource; action?: ReactNode;
  children: ReactNode; defaultOpen?: boolean; id?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card id={id} className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="group flex min-w-0 items-center gap-2 text-left"
        >
          <ChevronDown className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
            !open && "-rotate-90",
          )} />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{title}</span>
              {source && <SourceBadge source={source} />}
            </span>
            {subtitle && <span className="mt-0.5 block text-xs text-muted-foreground">{subtitle}</span>}
          </span>
        </button>
        {action && open && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {open && <div className="animate-fade-in">{children}</div>}
    </Card>
  );
}

export type Fmt = {
  money: (n: number) => string;
  moneyShort: (n: number) => string;
  num: (n: number) => string;
};

export function formatters(currency: string): Fmt {
  const money = (n: number) => new Intl.NumberFormat(undefined, {
    style: "currency", currency, maximumFractionDigits: n >= 1000 ? 0 : 2,
  }).format(n);
  return {
    money,
    moneyShort: (n: number) => new Intl.NumberFormat(undefined, {
      style: "currency", currency, notation: "compact", maximumFractionDigits: 1,
    }).format(n),
    num: (n: number) => new Intl.NumberFormat().format(Math.round(n)),
  };
}

export function formatKpi(k: StoreKpi, f: Fmt): string {
  switch (k.unit) {
    case "money": return f.money(k.value);
    case "pct": return `${k.value.toFixed(k.value >= 10 ? 0 : 2)}%`;
    case "x": return `${k.value.toFixed(2)}x`;
    default: return f.num(k.value);
  }
}

/**
 * One executive KPI.
 *
 * `change: null` renders a dash, not 0%. The backend returns null when the
 * previous period is empty or too small for a percentage to mean anything,
 * and printing "0%" there would state that nothing changed when the truth is
 * that nothing is known.
 */
export function KpiCard({ label, kpi, fmt, invert = false }: {
  label: string; kpi: StoreKpi; fmt: Fmt; invert?: boolean;
}) {
  const change = kpi.change;
  // A flat period is neither good nor bad. Colouring change === 0 red -- which
  // "change > 0" does -- painted every unchanged figure as a loss.
  const good = change === null || change === 0 ? null : invert ? change < 0 : change > 0;
  const Arrow = change !== null && change > 0 ? ArrowUp
    : change !== null && change < 0 ? ArrowDown : Minus;

  return (
    <Card className="group flex flex-col gap-2 p-4 transition-colors hover:border-foreground/15">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <SourceBadge source={kpi.source} />
      </div>

      <p className="text-2xl font-bold leading-none tracking-tight tabular-nums text-foreground">
        {formatKpi(kpi, fmt)}
      </p>

      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className={cn(
            "inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums",
            good === null ? "text-muted-foreground"
              : good ? "text-emerald-500" : "text-destructive",
          )}>
            {/* No arrow at all when there is nothing to compare -- a dash beside
                a dash read as two separate blanks. */}
            {change !== null && <Arrow className="h-3 w-3" strokeWidth={2.5} />}
            {change === null ? "—" : `${Math.abs(change).toFixed(1)}%`}
          </span>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {change === null
              ? (kpi.source === "sample" ? "sample figure" : "no comparable period")
              : `was ${formatKpi({ ...kpi, value: kpi.prev }, fmt)}`}
          </span>
        </div>
        {kpi.spark.length > 1 && (
          <div className="w-20 shrink-0 opacity-70 transition-opacity group-hover:opacity-100">
            <Spark data={kpi.spark} tone={good === false ? "down" : good === null ? "muted" : "accent"} />
          </div>
        )}
      </div>
    </Card>
  );
}

/** A compact stat for the dense secondary panels. */
export function Stat({ label, value, sub, tone = "default" }: {
  label: string; value: string; sub?: string; tone?: "default" | "good" | "bad" | "warn";
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/25 px-3.5 py-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        "mt-1 text-lg font-bold tabular-nums",
        tone === "good" ? "text-emerald-500" : tone === "bad" ? "text-destructive"
          : tone === "warn" ? "text-amber-500" : "text-foreground",
      )}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  );
}

/** Segmented control used for every toggle on the dashboard, so they all
 *  behave and look the same. */
export function Segmented<T extends string>({ value, onChange, options, size = "sm" }: {
  value: T; onChange: (v: T) => void;
  options: { key: T; label: string }[]; size?: "sm" | "xs";
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={cn(
            "rounded-md font-semibold transition-colors",
            size === "xs" ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs",
            value === o.key ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A sortable, searchable table. Used by every tabular panel so sorting and
 *  filtering behave identically everywhere. */
export function DataTable<T extends Record<string, unknown>>({ rows, columns, initialSort, empty }: {
  rows: T[];
  columns: { key: keyof T & string; label: string; align?: "left" | "right";
             render?: (row: T) => ReactNode; sortable?: boolean; width?: string }[];
  initialSort?: keyof T & string;
  empty?: string;
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>(
    { key: initialSort ?? columns[0].key, desc: true },
  );

  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    if (typeof av === "number" && typeof bv === "number") return sort.desc ? bv - av : av - bv;
    return sort.desc
      ? String(bv).localeCompare(String(av))
      : String(av).localeCompare(String(bv));
  });

  if (!rows.length) {
    return <p className="py-8 text-center text-xs text-muted-foreground">{empty ?? "Nothing here yet."}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((c) => (
              <th key={c.key} style={c.width ? { width: c.width } : undefined}
                  className={cn("pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground",
                                c.align === "right" ? "text-right" : "text-left")}>
                {c.sortable === false ? c.label : (
                  <button
                    onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}
                    className={cn("transition-colors hover:text-foreground",
                                  sort.key === c.key && "text-foreground")}
                  >
                    {c.label}{sort.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} className="border-b border-border/50 transition-colors last:border-b-0 hover:bg-muted/30">
              {columns.map((c) => (
                <td key={c.key} className={cn("py-2.5 align-middle",
                                              c.align === "right" ? "text-right tabular-nums" : "")}>
                  {c.render ? c.render(r) : String(r[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
