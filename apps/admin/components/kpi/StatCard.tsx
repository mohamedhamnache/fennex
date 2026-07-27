import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/cn";

export interface StatCardProps {
  label: string;
  /** Pre-formatted display value (via `lib/format.ts`) — "—" for null/empty. */
  value: string;
  icon?: LucideIcon;
  /** Percent change vs. the prior period. Omit entirely rather than
   * fabricating one — the overview KPIs endpoint doesn't return a prior-
   * period comparison yet, so no card populates this today. Wired here so
   * it lights up for free once the API adds it. */
  delta?: number | null;
  /** Short context line under the value, e.g. a token in/out breakdown or
   * "pending billing data". */
  hint?: string;
  className?: string;
}

/**
 * Dense KPI tile for the admin overview. Deliberately not `@fennex/ui`'s
 * `MetricCard` — that component hard-codes `text-emerald-500`/`text-red-500`
 * for deltas, which fights the admin console's CSS-variable token system,
 * and has no null-safe value path. This one uses `text-success` /
 * `text-destructive` and expects already-formatted, empty-state-aware
 * strings from `lib/format.ts`.
 */
export function StatCard({ label, value, icon: Icon, delta, hint, className }: StatCardProps) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const isPositive = hasDelta && delta! > 0;
  const isNegative = hasDelta && delta! < 0;

  return (
    <div
      className={cn(
        "card-base card-shadow motion-safe:animate-fade-in flex flex-col gap-2 border border-border bg-card p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      </div>

      <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </span>

      {(hasDelta || hint) && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {hasDelta && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-mono tabular-nums",
                isPositive && "text-success",
                isNegative && "text-destructive",
              )}
            >
              {isPositive && <ArrowUpRight className="h-3 w-3" aria-hidden="true" />}
              {isNegative && <ArrowDownRight className="h-3 w-3" aria-hidden="true" />}
              {!isPositive && !isNegative && <Minus className="h-3 w-3" aria-hidden="true" />}
              {isPositive ? "+" : ""}
              {delta!.toFixed(1)}%
            </span>
          )}
          {hint && <span className="truncate">{hint}</span>}
        </div>
      )}
    </div>
  );
}
