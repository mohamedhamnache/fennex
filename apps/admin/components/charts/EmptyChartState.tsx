import { AreaChart as AreaChartIcon } from "lucide-react";

/** Honest empty state for a series with no points, or every point at zero
 * (real states for a fresh instance — never rendered as a flat fake line). */
export function EmptyChartState({ message }: { message?: string }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-center">
      <AreaChartIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      <p className="text-xs text-muted-foreground">{message ?? "No data for this range yet."}</p>
    </div>
  );
}
