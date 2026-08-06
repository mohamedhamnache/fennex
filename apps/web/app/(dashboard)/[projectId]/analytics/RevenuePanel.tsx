"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ShoppingBag, ExternalLink } from "lucide-react";
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

  const money = (n: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: data.currency || "USD",
      maximumFractionDigits: 0,
    }).format(n);

  const share = data.revenue_total > 0
    ? Math.round((data.revenue_attributed / data.revenue_total) * 100)
    : 0;

  return (
    <Card className="flex flex-col gap-4 p-5">
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

      {/* The share and its denominator, never one without the other. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-bold tabular-nums text-foreground">
          {money(data.revenue_attributed)}
        </span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {t("analytics.revenue.ofTotal", { total: money(data.revenue_total), share })}
        </span>
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {t("analytics.revenue.orders", {
          attributed: data.orders_attributed, total: data.orders_total,
        })}
      </p>

      {data.articles.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("analytics.revenue.byArticle")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                {/* The title is the column worth reading; the two numeric ones
                    need only enough for their digits. Without this the title
                    collapsed to "Créez un …" while the counts kept room they
                    did not use. */}
                <col />
                <col className="w-24" />
                <col className="w-24" />
              </colgroup>
              <tbody>
                {data.articles.slice(0, 8).map((a) => (
                  <tr key={a.article_id} className="border-b border-border/60 last:border-b-0">
                    <td className="py-2 pr-3">
                      <span className="block truncate font-medium text-foreground">{a.title}</span>
                      {a.path && (
                        <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          {a.path}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right text-xs text-muted-foreground tabular-nums">
                      {t("analytics.revenue.orderCount", { count: a.orders })}
                    </td>
                    <td className="whitespace-nowrap py-2 text-right font-semibold tabular-nums text-foreground">
                      {money(a.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Said plainly rather than buried in a tooltip. This is last-touch on
          entry: it credits where a buying session STARTED, which is not the
          same as what caused the sale, and it is wrong in both directions. */}
      <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
        {t("analytics.revenue.caveat")}
      </p>
    </Card>
  );
}
