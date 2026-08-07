"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, CircleDot, Clock,
  Lightbulb, PackageX, Tent, TrendingDown, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { FENNEX_AGENTS } from "@/lib/agents";
import type { StoreDashboardData, StoreProductRow } from "@/lib/api";
import { CohortHeatmap, CustomerGrowth, Funnel, GeoList, RankBars } from "./charts";
import { DataTable, Section, Segmented, SourceBadge, Stat, type Fmt } from "./primitives";

/* ── Insights ───────────────────────────────────────────────────────────────
   Ranked by impact and capped: an insight list long enough to scroll is one
   nobody reads. Every line states only what its own data supports, and a line
   built on sample figures says so — the alternative is a plausible sentence
   the merchant acts on and later discovers was invented. */

export function InsightsPanel({ data, projectId }: {
  data: StoreDashboardData; projectId: string;
}) {
  if (!data.insights.length) return null;
  const tone = {
    good: "text-emerald-500 bg-emerald-500/10",
    bad: "text-destructive bg-destructive/10",
    info: "text-foreground/70 bg-muted",
  } as const;
  return (
    <Section
      title="What changed" subtitle="Ranked by how much it moves the business" id="insights"
      /* These observations state what happened. Deciding what to DO about it is
         Souk's job, and the handoff belongs here -- next to the finding -- not
         in a menu the merchant has to go looking for. */
      action={
        <Link
          href={`/${projectId}/chat?q=${encodeURIComponent(
            "Audit my store and tell me the one thing limiting growth right now")}`}
          className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
        >
          <Tent className="h-3.5 w-3.5" strokeWidth={1.9} />
          Ask {FENNEX_AGENTS.souk.name}
        </Link>
      }
    >
      <ul className="flex flex-col gap-2">
        {data.insights.map((ins, i) => {
          const Icon = ins.severity === "good" ? TrendingUp
            : ins.severity === "bad" ? AlertTriangle : Lightbulb;
          return (
            <li key={i} className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 px-3.5 py-3">
              <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg",
                                  tone[ins.severity])}>
                <Icon className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
              <p className="min-w-0 flex-1 text-sm leading-relaxed text-foreground">{ins.text}</p>
              <SourceBadge source={ins.source} className="mt-0.5" />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/* ── Alerts ─────────────────────────────────────────────────────────────── */

export function AlertsBar({ data }: { data: StoreDashboardData }) {
  if (!data.alerts.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {data.alerts.map((a, i) => (
        <div key={i} className={cn(
          "flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm",
          a.severity === "bad" ? "border-destructive/30 bg-destructive/5 text-foreground"
            : a.severity === "good" ? "border-emerald-500/30 bg-emerald-500/5 text-foreground"
              : "border-amber-500/30 bg-amber-500/5 text-foreground",
        )}>
          {a.severity === "good"
            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            : <AlertTriangle className={cn("h-4 w-4 shrink-0",
                a.severity === "bad" ? "text-destructive" : "text-amber-500")} />}
          <span className="min-w-0 flex-1">{a.text}</span>
          <SourceBadge source={a.source} />
        </div>
      ))}
    </div>
  );
}

/* ── Funnel ─────────────────────────────────────────────────────────────── */

export function FunnelSection({ data, fmt }: { data: StoreDashboardData; fmt: Fmt }) {
  const rows = data.funnel.rows;
  const worst = rows.slice(1).reduce((a, b) => (b.dropoff > a.dropoff ? b : a), rows[1] ?? rows[0]);
  return (
    <Section title="Conversion funnel" source={data.funnel.source}
             subtitle={worst ? `Biggest drop: ${worst.stage} (−${worst.dropoff.toFixed(0)}%)` : undefined}>
      <Funnel rows={rows} money={fmt.money} />
    </Section>
  );
}

/* ── Sales breakdown ────────────────────────────────────────────────────── */

const DIMENSIONS = [
  { key: "channel", label: "Channel" },
  { key: "traffic_source", label: "Referrer" },
  { key: "landing_page", label: "Landing page" },
  { key: "campaign", label: "Campaign" },
  { key: "product", label: "Product" },
  { key: "collection", label: "Collection" },
  { key: "variant", label: "Variant" },
  { key: "vendor", label: "Vendor" },
  { key: "country", label: "Country" },
  { key: "city", label: "City" },
  { key: "device", label: "Device" },
] as const;

export function BreakdownSection({ data, fmt }: { data: StoreDashboardData; fmt: Fmt }) {
  const [dim, setDim] = useState<string>("channel");
  const block = data.breakdowns[dim];
  return (
    <Section
      title="Where revenue comes from"
      source={block?.source}
      subtitle="Every dimension the orders sync can see, plus the ones waiting on a connector"
      action={
        <div className="flex flex-wrap items-center gap-1">
          {DIMENSIONS.map((d) => {
            const s = data.breakdowns[d.key]?.source;
            return (
              <button
                key={d.key}
                onClick={() => setDim(d.key)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  dim === d.key
                    ? "border-foreground/20 bg-foreground/5 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                  // Sample dimensions are dashed in the picker itself, so the
                  // reader knows before clicking whether the answer is real.
                  s !== "live" && "border-dashed",
                )}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      }
    >
      {!block?.rows.length ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No orders in this period carry that dimension.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr,1fr]">
          <RankBars rows={block.rows} money={fmt.moneyShort} />
          <DataTable
            rows={block.rows.slice(0, 8) as unknown as Record<string, unknown>[]}
            initialSort="revenue"
            columns={[
              { key: "label", label: "Name" },
              { key: "orders", label: "Orders", align: "right" },
              { key: "share", label: "Share", align: "right",
                render: (r) => `${Number(r.share).toFixed(1)}%` },
              { key: "revenue", label: "Revenue", align: "right",
                render: (r) => <span className="font-semibold">{fmt.money(Number(r.revenue))}</span> },
            ]}
          />
        </div>
      )}
    </Section>
  );
}

/* ── Products ───────────────────────────────────────────────────────────── */

function productColumns(fmt: Fmt) {
  return [
    { key: "product", label: "Product" },
    { key: "units", label: "Units", align: "right" as const },
    { key: "inventory", label: "Stock", align: "right" as const,
      render: (r: Record<string, unknown>) => (
        <span className={Number(r.inventory) < 12 ? "font-semibold text-amber-500" : ""}>
          {Number(r.inventory)}
        </span>
      ) },
    { key: "margin", label: "Margin", align: "right" as const,
      render: (r: Record<string, unknown>) => `${Number(r.margin).toFixed(0)}%` },
    { key: "refund_rate", label: "Refunds", align: "right" as const,
      render: (r: Record<string, unknown>) => (
        <span className={Number(r.refund_rate) > 5 ? "text-destructive" : ""}>
          {Number(r.refund_rate).toFixed(1)}%
        </span>
      ) },
    { key: "trend", label: "Trend", align: "right" as const,
      render: (r: Record<string, unknown>) => {
        const t = Number(r.trend);
        return (
          <span className={cn("inline-flex items-center gap-0.5 font-semibold",
                              t >= 0 ? "text-emerald-500" : "text-destructive")}>
            {t >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(t).toFixed(0)}%
          </span>
        );
      } },
    { key: "revenue", label: "Revenue", align: "right" as const,
      render: (r: Record<string, unknown>) => (
        <span className="font-semibold">{fmt.money(Number(r.revenue))}</span>
      ) },
  ];
}

export function ProductsSection({ data, fmt }: { data: StoreDashboardData; fmt: Fmt }) {
  const [view, setView] = useState<"top" | "trending" | "worst">("top");
  const rows: StoreProductRow[] = data.products[view];
  const subtitle = {
    top: "Ranked by revenue in this period",
    trending: "Growing fastest against the previous period",
    // Ranked by trend, not by size: a small niche line is not a problem, but a
    // former best-seller in free fall is.
    worst: "Falling fastest — not the smallest, the ones losing ground",
  }[view];
  return (
    <Section
      title="Product performance" source={data.products.source} subtitle={subtitle}
      action={<Segmented value={view} onChange={setView} size="xs" options={[
        { key: "top", label: "Best sellers" },
        { key: "trending", label: "Trending" },
        { key: "worst", label: "Losing ground" },
      ]} />}
    >
      <DataTable rows={rows as unknown as Record<string, unknown>[]}
                 initialSort="revenue" columns={productColumns(fmt)} />
    </Section>
  );
}

/* ── Customers ──────────────────────────────────────────────────────────── */

export function CustomersSection({ data, fmt }: { data: StoreDashboardData; fmt: Fmt }) {
  const c = data.customers;
  return (
    <Section title="Customers" source={c.source}
             subtitle="Who buys, how often they come back, and what they are worth">
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="New" value={fmt.num(c.new)} sub="first purchase" />
          <Stat label="Returning" value={fmt.num(c.returning)} sub="bought before" />
          <Stat label="Repeat rate" value={`${c.repeat_rate.toFixed(1)}%`} sub="of customers"
                tone={c.repeat_rate >= 25 ? "good" : "default"} />
          <Stat label="Lifetime value" value={fmt.money(c.ltv)} sub="per customer" />
          <Stat label="Days between orders" value={c.avg_days_between.toFixed(0)} sub="average" />
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-foreground">New vs returning over time</p>
            <CustomerGrowth rows={c.growth} />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-foreground">Highest-value customers</p>
            <DataTable
              rows={c.top as unknown as Record<string, unknown>[]}
              initialSort="revenue"
              columns={[
                { key: "label", label: "Customer" },
                { key: "orders", label: "Orders", align: "right" },
                { key: "revenue", label: "Revenue", align: "right",
                  render: (r) => <span className="font-semibold">{fmt.money(Number(r.revenue))}</span> },
              ]}
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Initials only. Identifying customers here would mean storing personal
              data this feature has no other use for.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-foreground">Cohort retention</p>
          <p className="text-[11px] text-muted-foreground">
            Share of each month&apos;s new customers who ordered again in later months.
          </p>
          <CohortHeatmap rows={c.cohorts} />
        </div>
      </div>
    </Section>
  );
}

/* ── Marketing ──────────────────────────────────────────────────────────── */

export function MarketingSection({ data, fmt }: { data: StoreDashboardData; fmt: Fmt }) {
  const m = data.marketing;
  return (
    <Section title="Marketing efficiency" source={m.source}
             subtitle="ROAS is ads only; MER is the whole business over the same spend">
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Ad spend" value={fmt.money(m.spend)} />
          <Stat label="Ad revenue" value={fmt.money(m.ad_revenue)} />
          <Stat label="ROAS" value={`${m.roas.toFixed(2)}x`} sub="ad revenue / spend"
                tone={m.roas >= 2.5 ? "good" : m.roas < 1.5 ? "bad" : "warn"} />
          <Stat label="MER" value={`${m.mer.toFixed(2)}x`} sub="total revenue / spend"
                tone={m.mer >= 4 ? "good" : "default"} />
          <Stat label="CAC" value={fmt.money(m.cac)} sub="per new customer" />
        </div>
        <DataTable
          rows={m.campaigns as unknown as Record<string, unknown>[]}
          initialSort="roas"
          columns={[
            { key: "label", label: "Campaign" },
            { key: "spend", label: "Spend", align: "right",
              render: (r) => fmt.money(Number(r.spend)) },
            { key: "orders", label: "Orders", align: "right" },
            { key: "revenue", label: "Revenue", align: "right",
              render: (r) => fmt.money(Number(r.revenue)) },
            { key: "roas", label: "ROAS", align: "right",
              render: (r) => {
                const v = Number(r.roas);
                return (
                  <span className={cn("font-semibold",
                                      v >= 2.5 ? "text-emerald-500" : v < 1 ? "text-destructive" : "")}>
                    {v.toFixed(2)}x
                  </span>
                );
              } },
          ]}
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Spend comes from the ad platforms, not from Shopify. These figures stay
          placeholders until Meta or Google Ads is connected.
        </p>
      </div>
    </Section>
  );
}

/* ── Live ───────────────────────────────────────────────────────────────── */

export function LiveSection({ data, fmt }: { data: StoreDashboardData; fmt: Fmt }) {
  const l = data.live;
  return (
    <Section title="Right now" source={l.source}
             subtitle="Today's orders and revenue are measured; visitor counts need the Analytics API">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Revenue today" value={fmt.money(l.revenue_today)} tone="good" />
          <Stat label="Orders today" value={fmt.num(l.orders_today)} />
          <Stat label="Live visitors" value={fmt.num(l.visitors)} />
          <Stat label="Active carts" value={fmt.num(l.carts)} />
          <Stat label="In checkout" value={fmt.num(l.checkouts)} />
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-foreground">Newest orders</p>
          {!l.feed.length ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No orders yet.</p>
          ) : (
            <ul className="flex flex-col">
              {l.feed.map((o) => (
                <li key={o.id} className="flex items-center gap-3 border-b border-border/50 py-2 text-xs last:border-b-0">
                  <CircleDot className={cn("h-3 w-3 shrink-0",
                                           o.attributed ? "text-emerald-500" : "text-muted-foreground/50")} />
                  <span className="w-28 shrink-0 tabular-nums text-muted-foreground">
                    {o.at ? new Date(o.at).toLocaleString(undefined,
                      { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </span>
                  <span className="w-24 shrink-0 truncate text-muted-foreground">{o.channel}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground">{o.path ?? "—"}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-foreground">
                    {fmt.money(o.total)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            A green dot marks an order that started on a page you published.
          </p>
        </div>
      </div>
    </Section>
  );
}

/* ── Operations ─────────────────────────────────────────────────────────── */

export function OperationsSection({ data, fmt }: { data: StoreDashboardData; fmt: Fmt }) {
  const o = data.operations;
  return (
    <Section title="Operations" source={o.source}
             subtitle="Stock, returns and fulfilment — what needs doing rather than what happened">
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Unfulfilled" value={fmt.num(o.unfulfilled)} sub="awaiting shipment"
                tone={o.unfulfilled > 15 ? "warn" : "default"} />
          <Stat label="Pending" value={fmt.num(o.pending)} sub="payment or review" />
          <Stat label="Returns" value={fmt.num(o.returns)} sub="this period" />
          <Stat label="Refunds" value={fmt.money(o.refunds)} sub={`${o.refund_rate.toFixed(1)}% of revenue`}
                tone={o.refund_rate > 4 ? "bad" : "default"} />
          <Stat label="Fulfilment time" value={`${o.avg_fulfillment_hours.toFixed(0)}h`} sub="average" />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Clock className="h-3.5 w-3.5 text-amber-500" /> Running low
            </p>
            <ul className="flex flex-col">
              {o.low_stock.map((p) => (
                <li key={p.product} className="flex items-center gap-3 border-b border-border/50 py-2 text-xs last:border-b-0">
                  <span className="min-w-0 flex-1 truncate text-foreground">{p.product}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{p.stock} left</span>
                  <span className={cn("w-28 shrink-0 text-right font-semibold tabular-nums",
                                      p.days_left <= 7 ? "text-destructive" : "text-muted-foreground")}>
                    {p.days_left.toFixed(0)} days left
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <PackageX className="h-3.5 w-3.5 text-destructive" /> Out of stock
            </p>
            {!o.out_of_stock.length ? (
              <p className="py-4 text-xs text-muted-foreground">Nothing is out of stock.</p>
            ) : (
              <ul className="flex flex-col">
                {o.out_of_stock.map((p) => (
                  <li key={p} className="border-b border-border/50 py-2 text-xs text-foreground last:border-b-0">
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ── Geography ──────────────────────────────────────────────────────────── */

export function GeoSection({ data, fmt }: { data: StoreDashboardData; fmt: Fmt }) {
  return (
    <Section title="Where your buyers are" source={data.geo.source}
             subtitle="Revenue, orders and conversion by country">
      <GeoList rows={data.geo.rows} money={fmt.money} />
    </Section>
  );
}

/* ── Forecast ───────────────────────────────────────────────────────────── */

export function ForecastSection({ data, fmt }: { data: StoreDashboardData; fmt: Fmt }) {
  const f = data.forecast;
  if (!f.rows.length) {
    return (
      <Section title="Next two weeks" source={f.source}>
        <p className="py-6 text-center text-sm text-muted-foreground">
          A projection needs at least a week of orders. Sync more history to see one.
        </p>
      </Section>
    );
  }
  const daily = f.projected_revenue / f.horizon_days;
  return (
    <Section title="Next two weeks" source={f.source}
             subtitle="Your own trend and weekly rhythm continued forward — not a prediction">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Projected ${f.horizon_days}d`} value={fmt.money(f.projected_revenue)} />
        <Stat label="Per day" value={fmt.money(daily)} sub="average" />
        <Stat label="Best day ahead"
              value={fmt.money(Math.max(...f.rows.map((r) => r.revenue)))} />
        <Stat label="Quietest day ahead"
              value={fmt.money(Math.min(...f.rows.map((r) => r.revenue)))} />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Extrapolated from the revenue above using a least-squares trend and your
        day-of-week pattern. It cannot know about a launch, a holiday or a
        stock-out, so treat a divergence as news rather than an error.
      </p>
    </Section>
  );
}

/* ── Content attribution — the part only this product can compute ───────── */

export function ContentSection({ data, fmt }: { data: StoreDashboardData; fmt: Fmt }) {
  const c = data.content;
  return (
    <Section title="Revenue from your content" source={c.source}
             subtitle="Orders whose session started on a page you published">
      {!c.rows.length ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No orders in this period started on a published page.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="From content" value={fmt.money(c.revenue)} tone="good"
                  sub={`${c.share.toFixed(0)}% of store revenue`} />
            <Stat label="Earning pages" value={String(c.rows.length)} />
            <Stat label="Orders started" value={fmt.num(c.rows.reduce((n, r) => n + r.orders, 0))} />
            <Stat label="Best page"
                  value={fmt.money(Math.max(...c.rows.map((r) => r.revenue)))} />
          </div>
          <DataTable
            rows={c.rows as unknown as Record<string, unknown>[]}
            initialSort="revenue"
            columns={[
              { key: "title", label: "Article",
                render: (r) => (
                  <span className="block max-w-md">
                    <span className="block truncate font-medium text-foreground">{String(r.title)}</span>
                    {r.path ? <span className="block truncate text-[11px] text-muted-foreground">{String(r.path)}</span> : null}
                  </span>
                ) },
              { key: "orders", label: "Orders", align: "right" },
              { key: "revenue", label: "Revenue", align: "right",
                render: (r) => <span className="font-semibold">{fmt.money(Number(r.revenue))}</span> },
            ]}
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Counts orders whose session began on one of your pages. It shows where
            buying started, not what caused the sale — a reader who returns later
            and buys direct is not counted here, and a buyer who would have
            purchased anyway is.
          </p>
        </div>
      )}
    </Section>
  );
}
