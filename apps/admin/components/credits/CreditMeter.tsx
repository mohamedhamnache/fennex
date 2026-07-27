import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { compactNumber } from "@/lib/format";

export interface CreditMeterProps {
  label: string;
  icon: LucideIcon;
  /** Whole credits already -- both come straight off the admin org payload
   * (`ai_credits_used`/`ai_credits_allowance`, `seo_credits_used`/
   * `seo_credits_allowance`). Never run these through `money()`: that
   * helper divides micros by 1e6 and these are already whole counts. */
  used: number;
  allowance: number;
  className?: string;
}

/**
 * Compact used/allowance bar for the AI and SEO credit buckets (Billing v2).
 * Same thresholds/coloring as `providers/page.tsx`'s `BudgetBar` (>=100%
 * destructive, >=80% warning, else primary) so credit meters read as the
 * same visual language as the provider budget bars elsewhere in the
 * console, rather than inventing a second bar style.
 */
export function CreditMeter({ label, icon: Icon, used, allowance, className }: CreditMeterProps) {
  const ratio = allowance > 0 ? used / allowance : 0;
  const pctWidth = Math.min(100, Math.max(0, ratio * 100));
  const isOver = allowance > 0 && ratio >= 1;
  const isNear = ratio >= 0.8 && !isOver;

  return (
    <div className={cn("flex w-full flex-col gap-1", className)}>
      <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
          {label}
        </span>
        <span className={cn("font-mono tabular-nums", isOver && "font-semibold text-destructive")}>
          {compactNumber(used)} / {compactNumber(allowance)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            isOver ? "bg-destructive" : isNear ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${pctWidth}%` }}
        />
      </div>
    </div>
  );
}
