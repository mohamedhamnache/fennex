import Link from "next/link";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Sparkline } from "./Sparkline";
import { cn } from "@/lib/cn";

type StatTone = "primary" | "violet" | "emerald" | "amber";

const ICON_TONE: Record<StatTone, string> = {
  primary: "text-primary bg-primary/10",
  violet: "text-violet-500 bg-violet-500/10",
  emerald: "text-emerald-500 bg-emerald-500/10",
  amber: "text-amber-500 bg-amber-500/10",
};

const SPARK_TONE: Record<StatTone, string> = {
  primary: "text-primary/70",
  violet: "text-violet-500/70",
  emerald: "text-emerald-500/70",
  amber: "text-amber-500/70",
};

/**
 * Signature stat tile: label, large tabular value, optional delta vs. prior
 * period, optional icon chip and sparkline. Becomes a hover-lift link when
 * `href` is provided.
 *
 * `invertChange` flips delta polarity for metrics where lower is better
 * (e.g. average search position).
 */
export function StatCard({
  label,
  value,
  change,
  href,
  icon: Icon,
  tone = "primary",
  spark,
  invertChange = false,
}: {
  label: string;
  value: string;
  change?: number;
  href?: string;
  icon?: React.ElementType;
  tone?: StatTone;
  spark?: number[];
  invertChange?: boolean;
}) {
  const hasChange = typeof change === "number";
  const effective = invertChange ? -(change ?? 0) : change ?? 0;
  const isPositive = effective > 0;
  const isNeutral = Math.abs(effective) < 0.05;

  const inner = (
    <>
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span className="font-display text-3xl font-bold leading-none tracking-tight tabular-nums text-foreground">
            {value}
          </span>
        </div>
        {Icon && (
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", ICON_TONE[tone])}>
            <Icon className="h-4 w-4" strokeWidth={1.9} />
          </span>
        )}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        {hasChange ? (
          isNeutral ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Minus className="h-3.5 w-3.5" /> No change
            </span>
          ) : (
            <span
              className={cn(
                "flex items-center gap-1 text-xs font-semibold",
                isPositive ? "text-success" : "text-destructive",
              )}
            >
              {isPositive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {Math.abs(change ?? 0).toFixed(1)}%
            </span>
          )
        ) : (
          <span />
        )}
        {spark && spark.length > 1 && (
          <Sparkline data={spark} className={SPARK_TONE[tone]} />
        )}
      </div>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="glass glass-hover block p-5">
        {inner}
      </Link>
    );
  }
  return <div className="glass p-5">{inner}</div>;
}
