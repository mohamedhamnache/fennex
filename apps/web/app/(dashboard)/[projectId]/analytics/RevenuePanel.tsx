"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ShoppingBag, ExternalLink, Users, MousePointerClick, Package, FlaskConical } from "lucide-react";
import { RevenueTrend, ProductBars } from "./StoreCharts";
import { Card } from "@/components/ui/Card";
import { getStoreRevenue, getShopifyStatus } from "@/lib/api";

/**
 * Revenue that started on published content.
 *
 * Sits beside the Search Console figures on purpose: clicks answer what got
 * found, this answers what got bought, and neither is worth much alone.
 *
 * The attributed number is never shown without its denominator. A 12% share is
 * a normal result -- most sales do not begin on an article -- but a figure
 * presented alone invites the reader to assume it is everything.
 */
export function RevenuePanel({ projectId, days }: { projectId: string; days: number }) {
  const { t } = useTranslation();

  // Gated on the CONNECTION, not on whether any orders came back. A connected
  // store with a quiet month should still show its panel reading zero -- that
  // is a real answer. Hiding on empty data instead would make the feature
  // vanish exactly when a merchant most wants to know nothing sold.
  const { data: status } = useQuery({
    queryKey: ["shopify-status", projectId],
    queryFn: () => getShopifyStatus(projectId),
    retry: false,
  });
  const connected = !!status?.connected;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["store-revenue", projectId, days],
    queryFn: () => getStoreRevenue(projectId, days),
    enabled: connected,          // no store, no request
    retry: false,
  });

  // An unconnected store is the normal case, not an error worth a red box.
  if (!connected || isLoading || isError || !data) return null;

  // Connected but nothing synced yet. The KPI block would otherwise render
  // $0 revenue, 0 orders and 0% share -- which reads as "your content earns
  // nothing" when it actually means "no orders have been pulled". A confident
  // zero is worse than an empty state.
  const hasOrders = data.orders_total > 0;

  const money = (n: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: data.currency || "USD",
      maximumFractionDigits: 0,
    }).format(n);

  const moneyShort = (n: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency", currency: data.currency || "USD",
      notation: "compact", maximumFractionDigits: 1,
    }).format(n);
  const fmt = (n: number) => new Intl.NumberFormat().format(n);

  const share = data.revenue_total > 0
    ? Math.round((data.revenue_attributed / data.revenue_total) * 100)
    : 0;

  const bar = Math.max(2, Math.min(100, share));

  return (
    <Card className="flex flex-col gap-5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-500">
            <ShoppingBag className="h-4 w-4" strokeWidth={1.9} />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">{t("analytics.revenue.title")}</p>
            <p className="text-xs text-muted-foreground">{t("analytics.revenue.subtitle")}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground tabular-nums">
          {t("analytics.revenue.window", { count: data.window_days })}
        </span>
      </div>

      {/* Four numbers a store owner manages against. Each attributed figure is
          shown against its store-wide counterpart rather than alone: "£4,934"
          reads as everything, "£4,934 of £7,014" reads as what it is. */}
      {!hasOrders && (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {t("analytics.revenue.noOrders")}
        </p>
      )}

      {hasOrders && (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t("analytics.revenue.kpiRevenue")} value={money(data.revenue_attributed)}
             sub={t("analytics.revenue.ofStore", { value: money(data.revenue_total) })} accent />
        <Kpi label={t("analytics.revenue.kpiOrders")} value={String(data.orders_attributed)}
             sub={t("analytics.revenue.ofStore", { value: String(data.orders_total) })} />
        <Kpi label={t("analytics.revenue.kpiAov")} value={money(data.aov_attributed)}
             sub={t("analytics.revenue.ofStore", { value: money(data.aov_total) })} />
        <Kpi label={t("analytics.revenue.kpiShare")} value={`${share}%`}
             sub={t("analytics.revenue.shareSub")} />
      </div>
      )}

      {/* The share as a bar, because a proportion is easier to judge than to
          read. Labelled at both ends so it is never a decorative stripe. */}
      {hasOrders && (
      <div className="flex flex-col gap-1.5">
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-emerald-500 transition-all"
               style={{ width: `${bar}%` }} />
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>{t("analytics.revenue.fromContent", { value: money(data.revenue_attributed) })}</span>
          <span>{t("analytics.revenue.storeTotal", { value: money(data.revenue_total) })}</span>
        </div>
      </div>
      )}

      {data.series.length > 1 && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-sm font-semibold text-foreground">{t("analytics.revenue.trend")}</p>
          <RevenueTrend data={data.series} money={moneyShort} />
        </div>
      )}

      {/* Everything below needs data the orders sync does not collect yet, so
          it is labelled. A dashboard that shows invented numbers without
          saying so is worse than one that shows nothing. */}
      {data.is_mock && (
        <div className="flex flex-col gap-4 rounded-xl border border-dashed border-border p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <FlaskConical className="h-3.5 w-3.5" />
            {t("analytics.revenue.mockNotice")}
          </p>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label={t("analytics.revenue.kpiSessions")} value={fmt(data.traffic.sessions)}
                 sub={t("analytics.revenue.fromContentCount", { count: data.traffic.sessions_from_content })} />
            <Kpi label={t("analytics.revenue.kpiConversion")}
                 value={data.traffic.sessions > 0
                   ? `${((data.products.reduce((n, p) => n + p.units, 0) / data.traffic.sessions) * 100).toFixed(2)}%`
                   : "—"}
                 sub={t("analytics.revenue.kpiConversionSub")} />
            <Kpi label={t("analytics.revenue.kpiNew")} value={fmt(data.customers.new)}
                 sub={t("analytics.revenue.kpiNewSub")} />
            <Kpi label={t("analytics.revenue.kpiRepeat")} value={`${data.customers.repeat_rate}%`}
                 sub={t("analytics.revenue.kpiRepeatSub", { count: data.customers.returning })} />
          </div>

          {data.products.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Package className="h-4 w-4 text-muted-foreground" />
                {t("analytics.revenue.byProduct")}
              </p>
              <ProductBars data={data.products} money={moneyShort} />
            </div>
          )}
        </div>
      )}

      {data.articles.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-4">
          <p className="text-sm font-semibold text-foreground">
            {t("analytics.revenue.byArticle")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col />
                <col className="w-28" />
                <col className="w-28" />
              </colgroup>
              <tbody>
                {data.articles.slice(0, 8).map((a) => {
                  const pct = data.revenue_attributed > 0
                    ? Math.round((a.revenue / data.revenue_attributed) * 100) : 0;
                  return (
                    <tr key={a.article_id} className="border-b border-border/60 last:border-b-0">
                      <td className="py-2.5 pr-3">
                        <span className="block truncate font-medium text-foreground">{a.title}</span>
                        {a.path && (
                          <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            {a.path}
                          </span>
                        )}
                        {/* Each article against the content total, so one big
                            earner is visible at a glance rather than inferred. */}
                        <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-muted">
                          <span className="block h-full rounded-full bg-emerald-500/70"
                                style={{ width: `${Math.max(2, pct)}%` }} />
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-right align-top text-xs text-muted-foreground tabular-nums">
                        {t("analytics.revenue.orderCount", { count: a.orders })}
                      </td>
                      <td className="whitespace-nowrap py-2.5 text-right align-top font-semibold tabular-nums text-foreground">
                        {money(a.revenue)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
        {t("analytics.revenue.caveat")}
      </p>
    </Card>
  );
}

/** One KPI: the attributed figure, with the store-wide number under it. */
function Kpi({ label, value, sub, accent = false }: {
  label: string; value: string; sub: string; accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/25 px-3.5 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${accent ? "text-emerald-500" : "text-foreground"}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{sub}</p>
    </div>
  );
}
