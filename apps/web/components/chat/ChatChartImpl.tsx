"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { ChartSpec } from "./ChatChart";

/* Chat charts read the same theme tokens as the rest of the app, so light and
   dark are handled by the theme rather than per-chart colour. */
const GRID = "hsl(var(--border))";
const MUTED = "hsl(var(--muted-foreground))";
const ACCENT = "hsl(var(--primary))";

// A ramp rather than a categorical palette: these charts rank things, and a
// rainbow implies categories that are not comparable when in fact they are.
const RAMP = [ACCENT, "hsl(var(--primary) / 0.78)", "hsl(var(--primary) / 0.6)",
               "hsl(var(--primary) / 0.46)", "hsl(var(--primary) / 0.34)",
               "hsl(var(--primary) / 0.24)"];

const axis = { stroke: MUTED, fontSize: 10, tickLine: false, axisLine: false } as const;

const tip = {
  contentStyle: {
    background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
    borderRadius: 8, fontSize: 11,
  },
  labelStyle: { color: MUTED, fontSize: 10 },
} as const;

const clip = (s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s);

export default function ChatChartImpl({ spec, fmt }: {
  spec: ChartSpec; fmt: (n: number) => string;
}) {
  const { type, data } = spec;
  const height = type === "donut" ? 190 : Math.max(150, Math.min(data.length * 30, 260));

  if (type === "donut") {
    const total = data.reduce((n, d) => n + d.value, 0) || 1;
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <ResponsiveContainer width="100%" height={height} className="sm:!w-1/2">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="55%" outerRadius="85%"
                 paddingAngle={2} stroke="none">
              {data.map((_, i) => <Cell key={i} fill={RAMP[i % RAMP.length]} />)}
            </Pie>
            <Tooltip {...tip} formatter={(v: number) => fmt(v)} />
          </PieChart>
        </ResponsiveContainer>
        {/* The legend carries the numbers. A donut read by angle alone is
            unreadable past three slices, and unusable without colour vision. */}
        <ul className="flex flex-1 flex-col gap-1">
          {data.map((d, i) => (
            <li key={d.label} className="flex items-center gap-2 text-[11px]">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: RAMP[i % RAMP.length] }} />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{d.label}</span>
              <span className="shrink-0 font-semibold tabular-nums text-foreground">{fmt(d.value)}</span>
              <span className="w-9 shrink-0 text-right tabular-nums text-muted-foreground">
                {((d.value / total) * 100).toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (type === "line" || type === "area") {
    const Chart = type === "area" ? AreaChart : LineChart;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <Chart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="chatFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" {...axis} tickFormatter={clip} minTickGap={16} />
          <YAxis {...axis} width={52} tickFormatter={fmt} />
          <Tooltip {...tip} formatter={(v: number) => fmt(v)} />
          {type === "area"
            ? <Area type="monotone" dataKey="value" stroke={ACCENT} strokeWidth={2} fill="url(#chatFill)" dot={false} />
            : <Line type="monotone" dataKey="value" stroke={ACCENT} strokeWidth={2} dot={false} />}
        </Chart>
      </ResponsiveContainer>
    );
  }

  // Horizontal bars: the labels are words, so the category axis has to be
  // vertical or every label rotates to 45 degrees and stops being readable.
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" {...axis} tickFormatter={fmt} />
        <YAxis type="category" dataKey="label" {...axis} width={110} tickFormatter={clip} />
        <Tooltip {...tip} cursor={{ fill: "hsl(var(--muted) / 0.4)" }} formatter={(v: number) => fmt(v)} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
          {data.map((_, i) => <Cell key={i} fill={RAMP[i % RAMP.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
