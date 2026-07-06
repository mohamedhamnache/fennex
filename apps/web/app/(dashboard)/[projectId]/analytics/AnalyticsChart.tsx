"use client";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  ComposedChart,
  Cell,
  PieChart,
  Pie,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const TOOLTIP_STYLE = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
} as const;

const PALETTE = [
  "hsl(var(--primary))",
  "hsl(var(--success))",
  "hsl(var(--warning))",
  "hsl(var(--info))",
  "hsl(var(--destructive))",
  "hsl(var(--muted-foreground))",
];

function truncate(s: string, n = 22) {
  const clean = String(s).replace(/^https?:\/\/[^/]+/, "") || String(s);
  return clean.length > n ? clean.slice(0, n - 1) + "…" : clean;
}

type ChartPoint = { date: string; clicks: number; impressions: number };

export function AnalyticsAreaChart({ data }: { data: ChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="colorClicks" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorImpressions" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.15} />
            <stop offset="95%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        <Area
          type="monotone"
          dataKey="impressions"
          stroke="hsl(var(--muted-foreground))"
          strokeWidth={1.5}
          fill="url(#colorImpressions)"
          name="Impressions"
        />
        <Area
          type="monotone"
          dataKey="clicks"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          fill="url(#colorClicks)"
          name="Clicks"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── SEO Health gauge (radial) ─────────────────────────────────────────────────

export function HealthGauge({ score, grade, size = 190 }: { score: number; grade: string; size?: number }) {
  const color = score >= 65 ? "hsl(var(--success))" : score >= 45 ? "hsl(var(--warning))" : "hsl(var(--destructive))";
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <RadialBarChart
        width={size}
        height={size}
        innerRadius="74%"
        outerRadius="100%"
        startAngle={225}
        endAngle={-45}
        data={[{ value: score }]}
      >
        <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
        <RadialBar dataKey="value" cornerRadius={12} fill={color} background={{ fill: "hsl(var(--muted))" }} />
      </RadialBarChart>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold tabular-nums text-foreground leading-none">{score}</span>
        <span className="mt-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color }}>
          Grade {grade}
        </span>
      </div>
    </div>
  );
}

// ── Donut (distribution) ──────────────────────────────────────────────────────

export function DonutChart({ data, height = 220 }: { data: { name: string; value: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="55%"
          outerRadius="82%"
          paddingAngle={3}
          cornerRadius={5}
          stroke="hsl(var(--card))"
          strokeWidth={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Traffic with previous-period compare ──────────────────────────────────────

type ComparePoint = { date: string; clicks: number; clicksPrev?: number | null };

export function TrafficCompareChart({ data }: { data: ComparePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="cmpClicks" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={36} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
        <Line type="monotone" dataKey="clicksPrev" name="Previous period" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
        <Area type="monotone" dataKey="clicks" name="Current" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#cmpClicks)" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Clicks vs average position (dual axis, the classic SEO view) ──────────────

type PosPoint = { date: string; clicks: number; avg_position: number };

export function ClicksPositionChart({ data }: { data: PosPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="cpClicks" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis yAxisId="clicks" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={36} />
        {/* Position axis reversed — lower (better) rank at the top */}
        <YAxis yAxisId="pos" orientation="right" reversed tick={{ fontSize: 11, fill: "hsl(var(--warning))" }} tickLine={false} axisLine={false} width={30} domain={["dataMin - 1", "dataMax + 1"]} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
        <Area yAxisId="clicks" type="monotone" dataKey="clicks" name="Clicks" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#cpClicks)" />
        <Line yAxisId="pos" type="monotone" dataKey="avg_position" name="Avg position" stroke="hsl(var(--warning))" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Horizontal bar (top pages / queries) ──────────────────────────────────────

export function HorizontalBar({
  data,
  labelKey,
  valueKey,
  height = 260,
}: {
  data: Record<string, unknown>[];
  labelKey: string;
  valueKey: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey={labelKey}
          width={150}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => truncate(v)}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "hsl(var(--muted) / 0.4)" }} />
        <Bar dataKey={valueKey} radius={[0, 4, 4, 0]} maxBarSize={22}>
          {data.map((_, i) => (
            <Cell key={i} fill="hsl(var(--primary))" fillOpacity={1 - i * 0.03} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Agent chart (rendered inside AI answers) ──────────────────────────────────

export interface AgentChartSpec {
  type: "bar" | "line";
  title?: string;
  x_key: string;
  series: { key: string; name: string }[];
  data: Record<string, unknown>[];
}

export function AgentChart({ spec }: { spec: AgentChartSpec }) {
  const { type, x_key, series, data, title } = spec;
  const height = type === "bar" ? Math.max(150, Math.min(320, data.length * 30 + 40)) : 200;

  return (
    <div className="w-full">
      {title && <p className="mb-1.5 text-[11px] font-semibold text-foreground">{title}</p>}
      <ResponsiveContainer width="100%" height={height}>
        {type === "line" ? (
          <LineChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey={x_key} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" tickFormatter={(v) => truncate(v, 10)} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={32} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            {series.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        ) : (
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey={x_key} width={130} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v) => truncate(v, 20)} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "hsl(var(--muted) / 0.4)" }} />
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} fill={PALETTE[i % PALETTE.length]} radius={[0, 4, 4, 0]} maxBarSize={20} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
