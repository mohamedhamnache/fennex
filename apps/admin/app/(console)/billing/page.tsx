"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  Gauge,
  Info,
  Landmark,
  ReceiptText,
  TrendingUp,
  Users,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/cn";
import { StatCard } from "@/components/kpi/StatCard";
import { DataTable, type DataTableColumn } from "@/components/table/DataTable";
import { compactNumber, moneyUsd, pct } from "@/lib/format";
import type { BillingEvent, BillingKpis, Paginated } from "@/lib/admin-types";

const PAGE_SIZE = 20;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Shortens a UUID-shaped id to its first 8 chars for dense table cells. */
function short(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

/** Debounces `value` by `delayMs` — mirrors the orgs/audit pages so the
 * event-type filter doesn't fire a request per keystroke. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** `invoice.paid` reads as success; anything ending in `payment_failed`
 * (e.g. `invoice.payment_failed`) reads as destructive; everything else
 * (subscription updates, customer changes, ...) is a neutral, informational
 * event rather than implying good/bad. */
function EventTypeBadge({ eventType }: { eventType: string }) {
  const isSuccess = eventType === "invoice.paid";
  const isFailure = eventType.endsWith("payment_failed");
  return (
    <span
      className={cn(
        "badge",
        isSuccess && "bg-success/10 text-success",
        isFailure && "bg-destructive/10 text-destructive",
        !isSuccess && !isFailure && "bg-muted text-muted-foreground",
      )}
    >
      {eventType}
    </span>
  );
}

/** MRR-by-plan breakdown — a small table rather than Tremor's `BarList` so
 * it sits visually consistent with every other console table (badge +
 * `font-mono tabular-nums` numerals) instead of introducing a second bar
 * component's styling. Rows arrive pre-sorted by `mrr_usd` descending from
 * the API; sorted again here defensively. */
function MrrByPlanTable({ rows }: { rows: BillingKpis["by_plan"] }) {
  const sorted = [...rows].sort((a, b) => b.mrr_usd - a.mrr_usd);

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
        <Landmark className="h-5 w-5" aria-hidden="true" />
        <span className="text-sm">No revenue yet.</span>
      </div>
    );
  }

  const maxMrr = Math.max(...sorted.map((r) => r.mrr_usd), 1);

  return (
    <div className="flex flex-col gap-2.5">
      {sorted.map((row) => (
        <div key={row.plan} className="flex items-center gap-3">
          <span className="badge w-24 shrink-0 justify-center bg-secondary text-secondary-foreground capitalize">
            {row.plan}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="presentation">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${Math.max(2, (row.mrr_usd / maxMrr) * 100)}%` }}
            />
          </div>
          <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
            {compactNumber(row.orgs)} orgs
          </span>
          <span className="w-20 shrink-0 text-right font-mono text-sm font-medium tabular-nums text-foreground">
            {moneyUsd(row.mrr_usd)}
          </span>
        </div>
      ))}
    </div>
  );
}

function BillingSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading billing data">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card-base border border-border bg-card p-4">
            <div className="skeleton mb-3 h-3 w-20" />
            <div className="skeleton h-7 w-24" />
          </div>
        ))}
      </div>
      <div className="card-base border border-border bg-card p-4">
        <div className="skeleton mb-3 h-4 w-32" />
        <div className="skeleton h-32 w-full" />
      </div>
      <div className="card-base border border-border bg-card p-4">
        <div className="skeleton mb-3 h-4 w-32" />
        <div className="skeleton h-64 w-full" />
      </div>
    </div>
  );
}

export default function BillingPage() {
  const [eventType, setEventType] = useState("");
  const [page, setPage] = useState(1);

  const debouncedType = useDebouncedValue(eventType, 300);

  // A new type filter invalidates the current page — jump back to page 1
  // rather than risk landing on a page past the end of the new result set.
  useEffect(() => {
    setPage(1);
  }, [debouncedType]);

  const kpisQuery = useQuery({
    queryKey: ["admin", "billing", "kpis"],
    queryFn: () => apiClient.get<BillingKpis>("/admin/billing/kpis"),
  });

  const params = new URLSearchParams();
  if (debouncedType) params.set("type", debouncedType);
  params.set("page", String(page));
  params.set("page_size", String(PAGE_SIZE));

  const eventsQuery = useQuery({
    queryKey: ["admin", "billing", "events", { type: debouncedType, page }],
    queryFn: () => apiClient.get<Paginated<BillingEvent>>(`/admin/billing/events?${params.toString()}`),
  });

  const kpis = kpisQuery.data;
  const events = eventsQuery.data?.items ?? [];
  const total = eventsQuery.data?.total ?? 0;
  const hasActiveFilters = !!debouncedType;
  const isLoading = kpisQuery.isLoading;
  const isError = kpisQuery.isError;

  const columns: DataTableColumn<BillingEvent>[] = [
    {
      key: "processed_at",
      header: "When",
      mono: true,
      render: (row) => formatDateTime(row.processed_at),
    },
    {
      key: "org_id",
      header: "Org",
      mono: true,
      render: (row) => (row.org_id ? <span title={row.org_id}>{short(row.org_id)}</span> : "—"),
    },
    {
      key: "event_type",
      header: "Event type",
      render: (row) => <EventTypeBadge eventType={row.event_type} />,
    },
    {
      key: "amount_usd",
      header: "Amount",
      mono: true,
      align: "right",
      render: (row) => (row.amount_usd === null ? "—" : moneyUsd(row.amount_usd)),
    },
  ];

  return (
    <div className="motion-safe:animate-fade-in flex flex-col gap-6 p-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-foreground">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Revenue, margin, and the recent Stripe event feed across every organization.
        </p>
      </header>

      {isError && (
        <div
          role="alert"
          className="card-base flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Couldn't load billing data. Check the API connection and try again.
        </div>
      )}

      {isLoading ? (
        <BillingSkeleton />
      ) : (
        kpis && (
          <>
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0 translate-y-0.5" aria-hidden="true" />
              Revenue estimated from plan tier — not a live Stripe MRR pull.
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="MRR" value={moneyUsd(kpis.mrr_usd)} icon={Banknote} hint="monthly recurring revenue" />
              <StatCard label="ARR" value={moneyUsd(kpis.arr_usd)} icon={TrendingUp} hint="annualized run rate" />
              <StatCard
                label="Gross margin"
                value={pct(kpis.gross_margin_pct)}
                icon={Gauge}
                hint={kpis.gross_margin_pct === null ? "no MRR yet" : `${moneyUsd(kpis.mtd_cost_usd)} MTD cost`}
              />
              <StatCard label="ARPU" value={moneyUsd(kpis.arpu_usd)} icon={ReceiptText} hint="per paying org" />
              <StatCard
                label="Paying orgs"
                value={compactNumber(kpis.paying_orgs)}
                icon={Users}
                hint={`${compactNumber(kpis.enterprise_orgs)} enterprise`}
              />
              <StatCard label="Trialing orgs" value={compactNumber(kpis.trialing_orgs)} icon={Users} />
              {kpis.failed_payments_30d > 0 && (
                <StatCard
                  label="Failed payments"
                  value={`${compactNumber(kpis.failed_payments_30d)} · 30d`}
                  icon={AlertTriangle}
                  className="border-warning/40 bg-warning/10"
                  hint="review the Stripe dashboard"
                />
              )}
            </div>

            <div className="card-base card-shadow flex flex-col gap-3 border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">MRR by plan</h2>
              <MrrByPlanTable rows={kpis.by_plan} />
            </div>
          </>
        )
      )}

      <DataTable
        columns={columns}
        rows={events}
        rowKey={(row) => row.id}
        loading={eventsQuery.isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        empty={
          <div className="flex flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <ReceiptText className="h-5 w-5" aria-hidden="true" />
            <span className="text-sm">
              {hasActiveFilters ? "No billing events match this filter." : "No billing events yet."}
            </span>
          </div>
        }
        toolbar={
          <input
            type="text"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            placeholder="Event type (e.g. invoice.paid)"
            aria-label="Filter by event type"
            className="h-9 w-56 rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground"
          />
        }
      />
    </div>
  );
}
