"use client";

import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";

const GRID = "hsl(var(--border))";
const MUTED = "hsl(var(--muted-foreground))";
const GREEN = "#10b981";

const axis = { stroke: MUTED, fontSize: 11, tickLine: false, axisLine: false } as const;

const tooltip = {
  contentStyle: {
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 10,
    fontSize: 12,
  },
  labelStyle: { color: MUTED, fontSize: 11 },
} as const;

/**
 * Revenue over time, with the attributed share drawn beneath the total.
 *
 * Two series rather than one: a single revenue line answers "how are we doing",
 * which the store owner already knows from Shopify. The gap between the two is
 * the only thing this dashboard can show that Shopify cannot.
 */
export function RevenueTrend({ data, money }: {
  data: { date: string; revenue: number; attributed: number }[];
  money: (n: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={MUTED} stopOpacity={0.22} />
            <stop offset="100%" stopColor={MUTED} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gAttr" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GREEN} stopOpacity={0.45} />
            <stop offset="100%" stopColor={GREEN} stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" {...axis} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
        <YAxis {...axis} width={58} tickFormatter={(v: number) => money(v)} />
        <Tooltip {...tooltip} formatter={(v: number) => money(v)} />
        <Area type="monotone" dataKey="revenue" stroke={MUTED} strokeWidth={1.5}
              fill="url(#gTotal)" name="Store" />
        <Area type="monotone" dataKey="attributed" stroke={GREEN} strokeWidth={2}
              fill="url(#gAttr)" name="From content" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Revenue by product. Horizontal because product names are words, not dates —
 *  a vertical axis would rotate them to 45 degrees and cost legibility. */
export function ProductBars({ data, money }: {
  data: { product: string; revenue: number; units: number }[];
  money: (n: number) => string;
}) {
  const top = data.slice(0, 6);
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, top.length * 34)}>
      <BarChart data={top} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" {...axis} tickFormatter={(v: number) => money(v)} />
        <YAxis type="category" dataKey="product" {...axis} width={132} />
        <Tooltip {...tooltip} formatter={(v: number) => money(v)} cursor={{ fill: "hsl(var(--muted))" }} />
        <Bar dataKey="revenue" radius={[0, 5, 5, 0]} barSize={16}>
          {top.map((_, i) => (
            // The leader is emphasised; the rest recede. Ranking is the point of
            // this chart, so the top bar should not have to be found.
            <Cell key={i} fill={i === 0 ? GREEN : "hsl(var(--muted-foreground) / 0.35)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
