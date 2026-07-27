"use client";

import { AreaChart, type Color } from "@tremor/react";
import { cn } from "@/lib/cn";
import type { SeriesPoint } from "@/lib/overview-types";

export interface AreaTrendProps {
  data: SeriesPoint[];
  valueFormatter: (value: number) => string;
  /** Tremor's fixed palette name — not an arbitrary hex, so it can't be
   * pulled from the CSS-variable token set directly. */
  color?: Color;
  /** Text alternative for the chart as a whole (axis ticks are still
   * rendered as real text, but this gives assistive tech the summary a
   * sighted user gets from the shape). */
  ariaLabel: string;
  className?: string;
}

/** Thin Tremor `AreaChart` wrapper for a single `{day,value}[]` series.
 * `font-mono` on the wrapper cascades onto the chart's SVG `<text>` ticks so
 * axis labels share the tabular-nums treatment used on the KPI values. */
export function AreaTrend({ data, valueFormatter, color = "emerald", ariaLabel, className }: AreaTrendProps) {
  const chartData = data.map((p) => ({ day: p.day, value: p.value }));

  return (
    <div role="img" aria-label={ariaLabel} className={cn("font-mono", className)}>
      <AreaChart
        className="h-64"
        data={chartData}
        index="day"
        categories={["value"]}
        colors={[color]}
        valueFormatter={valueFormatter}
        showLegend={false}
        showAnimation
        animationDuration={280}
        curveType="monotone"
        yAxisWidth={56}
      />
    </div>
  );
}
