"use client";

import { LineChart, type Color } from "@tremor/react";
import { cn } from "@/lib/cn";
import type { SeriesPoint } from "@/lib/overview-types";

export interface LineTrendProps {
  data: SeriesPoint[];
  valueFormatter: (value: number) => string;
  color?: Color;
  ariaLabel: string;
  className?: string;
}

/** Thin Tremor `LineChart` wrapper — same shape as `AreaTrend`, used for
 * series better read as a rate than a cumulative volume (API requests). */
export function LineTrend({ data, valueFormatter, color = "blue", ariaLabel, className }: LineTrendProps) {
  const chartData = data.map((p) => ({ day: p.day, value: p.value }));

  return (
    <div role="img" aria-label={ariaLabel} className={cn("font-mono", className)}>
      <LineChart
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
