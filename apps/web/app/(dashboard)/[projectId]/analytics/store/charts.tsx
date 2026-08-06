"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, ComposedChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from "recharts";
import type { BreakdownRow, FunnelStage, StoreSeriesPoint } from "@/lib/api";

/* Chart chrome, defined once. Every chart here reads the same tokens as the
   rest of the app, so light and dark are handled by the theme rather than by
   per-chart colour overrides that drift apart. */
const GRID = "hsl(var(--border))";
const MUTED = "hsl(var(--muted-foreground))";
export const ACCENT = "#10b981";
export const ACCENT_SOFT = "hsl(var(--muted-foreground) / 0.32)";
const WARN = "#f59e0b";

const axis = { stroke: MUTED, fontSize: 11, tickLine: false, axisLine: false } as const;

const tip = {
  contentStyle: {
    background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
    borderRadius: 10, fontSize: 12, boxShadow: "0 8px 24px -8px rgb(0 0 0 / 0.25)",
  },
  labelStyle: { color: MUTED, fontSize: 11, marginBottom: 2 },
  cursor: { stroke: MUTED, strokeWidth: 1, strokeDasharray: "3 3" },
} as const;

const shortDate = (d: string) => d.slice(5);

/**
 * The main revenue chart.
 *
 * One metric at a time rather than five stacked series: revenue, orders and
 * AOV have incompatible scales, and drawing them together forces either a
 * second axis nobody reads or a normalisation that destroys the values. The
 * toggle is the honest version of "show me everything".
 */
export function MainChart({ data, metric, money, compare, movingAverage, forecast }: {
  data: StoreSeriesPoint[];
  metric: "revenue" | "orders" | "aov" | "net_sales" | "profit";
  money: (n: number) => string;
  compare: boolean;
  movingAverage: boolean;
  forecast?: { date: string; revenue: number }[];
}) {
  const isMoney = metric !== "orders";
  const fmt = (v: number) => (isMoney ? money(v) : String(Math.round(v)));

  // The forecast continues the same line rather than starting a second chart:
  // a projection read next to history is judged against it, which is the only
  // safe way to read one.
  const rows: (Partial<StoreSeriesPoint> & { date: string; projected?: number })[] = [...data];
  if (forecast?.length && metric === "revenue") {
    const last = data[data.length - 1];
    if (last) rows[rows.length - 1] = { ...last, projected: last.revenue };
    forecast.forEach((f) => rows.push({ date: f.date, projected: f.revenue }));
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id="mainFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" {...axis} tickFormatter={shortDate} minTickGap={28} />
        <YAxis {...axis} width={64} tickFormatter={fmt} />
        <Tooltip {...tip} formatter={(v: number, n: string) => [fmt(v), n]} />
        {compare && (
          <Area type="monotone" dataKey="prev_revenue" name="Previous period"
                stroke={MUTED} strokeWidth={1.25} strokeDasharray="4 3"
                fill="transparent" dot={false} connectNulls />
        )}
        <Area type="monotone" dataKey={metric} name={LABELS[metric]} stroke={ACCENT}
              strokeWidth={2} fill="url(#mainFill)" dot={false} />
        {movingAverage && metric === "revenue" && (
          <Line type="monotone" dataKey="ma" name="7-day average" stroke={WARN}
                strokeWidth={1.75} dot={false} />
        )}
        {forecast?.length && metric === "revenue" ? (
          <Line type="monotone" dataKey="projected" name="Projected" stroke={ACCENT}
                strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />
        ) : null}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

const LABELS: Record<string, string> = {
  revenue: "Revenue", orders: "Orders", aov: "Avg order",
  net_sales: "Net sales", profit: "Profit",
};

/** A KPI sparkline. No axes, no grid — at this size they are texture, not data. */
export function Spark({ data, tone = "accent" }: { data: number[]; tone?: "accent" | "muted" | "down" }) {
  if (data.length < 2) return <div className="h-8" />;
  const rows = data.map((v, i) => ({ i, v }));
  const stroke = tone === "down" ? "#ef4444" : tone === "muted" ? MUTED : ACCENT;
  return (
    <ResponsiveContainer width="100%" height={32}>
      <AreaChart data={rows} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`sp-${tone}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.3} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={stroke} strokeWidth={1.5}
              fill={`url(#sp-${tone})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * The funnel, as proportional bars rather than a trapezoid.
 *
 * A classic funnel shape encodes the value in a width the eye cannot compare
 * across non-adjacent steps. Left-aligned bars against a shared baseline make
 * "half of the people who added to cart never reached checkout" readable at a
 * glance, which is the entire job.
 */
export function Funnel({ rows, money }: { rows: FunnelStage[]; money?: (n: number) => string }) {
  const top = rows[0]?.users || 1;
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r, i) => {
        const width = Math.max(2, (r.users / top) * 100);
        const heavy = r.dropoff >= 50 && i > 0;
        return (
          <div key={r.stage} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium text-foreground">{r.stage}</span>
              <span className="flex items-center gap-2.5 tabular-nums text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {new Intl.NumberFormat().format(r.users)}
                </span>
                <span>{r.conv.toFixed(1)}%</span>
              </span>
            </div>
            <div className="h-7 w-full overflow-hidden rounded-md bg-muted/50">
              <div
                className="h-full rounded-md transition-all duration-500"
                style={{
                  width: `${width}%`,
                  background: `linear-gradient(90deg, ${ACCENT}dd, ${ACCENT}88)`,
                }}
              />
            </div>
            {i > 0 && (
              <p className={`text-[11px] tabular-nums ${heavy ? "text-destructive" : "text-muted-foreground"}`}>
                −{r.dropoff.toFixed(0)}% from previous step
                {" · "}
                {new Intl.NumberFormat().format(r.lost)} lost
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Horizontal bars. Labels are words, so the category axis has to be vertical. */
export function RankBars({ rows, money, height }: {
  rows: BreakdownRow[]; money: (n: number) => string; height?: number;
}) {
  const top = rows.slice(0, 8);
  if (!top.length) {
    return <p className="py-8 text-center text-xs text-muted-foreground">No data in this period.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(150, top.length * 34)}>
      <BarChart data={top} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" {...axis} tickFormatter={money} />
        <YAxis type="category" dataKey="label" {...axis} width={140}
               tickFormatter={(s: string) => (s.length > 20 ? `${s.slice(0, 19)}…` : s)} />
        <Tooltip {...tip} cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
                 formatter={(v: number) => money(v)} />
        <Bar dataKey="revenue" name="Revenue" radius={[0, 5, 5, 0]} barSize={16}>
          {top.map((_, i) => (
            // Rank is the message: the leader is emphasised, the rest recede.
            <Cell key={i} fill={i === 0 ? ACCENT : ACCENT_SOFT} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** New vs returning customers over time. Stacked, because the total matters
 *  as much as the split. */
export function CustomerGrowth({ rows }: { rows: { date: string; new: number; returning: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={190}>
      {/* No negative left margin here: it clipped the leading digit off
          three-figure tick labels, so "120" rendered as "20" and the axis read
          as though it ran out of order. */}
      <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" {...axis} tickFormatter={shortDate} minTickGap={20} />
        <YAxis {...axis} width={44} />
        <Tooltip {...tip} cursor={{ fill: "hsl(var(--muted) / 0.5)" }} />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} iconType="circle" iconSize={7} />
        <Bar dataKey="new" name="New" stackId="c" fill={ACCENT} radius={[0, 0, 0, 0]} barSize={14} />
        <Bar dataKey="returning" name="Returning" stackId="c" fill={ACCENT_SOFT}
             radius={[3, 3, 0, 0]} barSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Cohort retention heatmap.
 *
 * Colour carries the value, but every cell also prints its number: a heatmap
 * read by hue alone is unusable for anyone with a colour vision deficiency,
 * and the exact figure is what gets quoted in a meeting anyway.
 */
export function CohortHeatmap({ rows }: {
  rows: { cohort: string; size: number; cells: number[] }[];
}) {
  const width = Math.max(...rows.map((r) => r.cells.length), 1);
  return (
    <div className="overflow-x-auto">
      {/* table-fixed keeps every month column the same width. Without it the
          first column stretched to fill the row's spare space, so M0 rendered
          three times wider than M5 and the grid read as a bar chart. */}
      <table className="w-full min-w-[520px] table-fixed border-separate border-spacing-1 text-[11px]">
        <colgroup>
          <col className="w-24" />
          <col className="w-14" />
          {Array.from({ length: width }, (_, i) => <col key={i} />)}
        </colgroup>
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-medium">Cohort</th>
            <th className="text-right font-medium">Size</th>
            {Array.from({ length: width }, (_, i) => (
              <th key={i} className="text-center font-medium tabular-nums">M{i}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cohort}>
              <td className="whitespace-nowrap text-foreground">{r.cohort}</td>
              <td className="text-right tabular-nums text-muted-foreground">{r.size}</td>
              {Array.from({ length: width }, (_, i) => {
                const v = r.cells[i];
                if (v === undefined) return <td key={i} />;
                return (
                  <td key={i} className="rounded-md px-1.5 py-1.5 text-center font-medium tabular-nums"
                      style={{
                        background: `color-mix(in srgb, ${ACCENT} ${Math.round(v * 0.9)}%, transparent)`,
                        color: v > 55 ? "#052e21" : "hsl(var(--foreground))",
                      }}>
                    {v.toFixed(0)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Revenue by country, as a ranked list with proportional fills.
 *
 * Deliberately not a choropleth. A world map makes Russia and Canada visually
 * dominant regardless of revenue, and the CSP forbids fetching topojson, so a
 * real map would mean shipping geometry for a chart that answers "which
 * countries earn most" worse than a sorted list does.
 */
export function GeoList({ rows, money }: {
  rows: (BreakdownRow & { code: string; conversion: number })[];
  money: (n: number) => string;
}) {
  const top = rows[0]?.revenue || 1;
  return (
    <div className="flex flex-col">
      {rows.slice(0, 8).map((r, i) => (
        <div key={r.label} className="relative flex items-center gap-3 border-b border-border/50 py-2 last:border-b-0">
          <span className="absolute inset-y-0 left-0 rounded-sm bg-emerald-500/8"
                style={{ width: `${(r.revenue / top) * 100}%` }} aria-hidden />
          <span className="relative w-7 shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {r.code}
          </span>
          <span className="relative min-w-0 flex-1 truncate text-xs text-foreground">{r.label}</span>
          <span className="relative shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {r.orders} {r.orders === 1 ? "order" : "orders"}
          </span>
          <span className="relative shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {r.conversion.toFixed(1)}%
          </span>
          <span className="relative w-20 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
            {money(r.revenue)}
          </span>
        </div>
      ))}
    </div>
  );
}
