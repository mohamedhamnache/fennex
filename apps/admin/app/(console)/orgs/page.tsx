"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, CheckCircle2, KeyRound, Search } from "lucide-react";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/cn";
import { DataTable, type DataTableColumn } from "@/components/table/DataTable";
import { money, compactNumber } from "@/lib/format";
import type { AdminOrgRow, Paginated } from "@/lib/admin-types";

const PAGE_SIZE = 20;

const PLANS: { value: string; label: string }[] = [
  { value: "", label: "All plans" },
  { value: "free", label: "Free" },
  { value: "starter", label: "Starter" },
  { value: "pro", label: "Pro" },
  { value: "agency", label: "Agency" },
  { value: "enterprise", label: "Enterprise" },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(d);
}

/** Debounces `value` by `delayMs`, resetting the timer on every change —
 * used so the search input doesn't fire a request per keystroke. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export default function OrgsPage() {
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState("");
  const [suspendedOnly, setSuspendedOnly] = useState(false);
  const [page, setPage] = useState(1);

  const debouncedQ = useDebouncedValue(search, 300);

  // Any filter change invalidates the current page — jump back to page 1
  // rather than risk landing on a page past the end of the new result set.
  useEffect(() => {
    setPage(1);
  }, [debouncedQ, plan, suspendedOnly]);

  const params = new URLSearchParams();
  if (debouncedQ) params.set("q", debouncedQ);
  if (plan) params.set("plan", plan);
  if (suspendedOnly) params.set("suspended", "true");
  params.set("page", String(page));
  params.set("page_size", String(PAGE_SIZE));

  const orgsQuery = useQuery({
    queryKey: ["admin", "orgs", { q: debouncedQ, plan, suspended: suspendedOnly, page }],
    queryFn: () => apiClient.get<Paginated<AdminOrgRow>>(`/admin/orgs?${params.toString()}`),
  });

  const rows = orgsQuery.data?.items ?? [];
  const total = orgsQuery.data?.total ?? 0;
  const hasActiveFilters = !!debouncedQ || !!plan || suspendedOnly;

  const columns: DataTableColumn<AdminOrgRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <Link
          href={`/orgs/${row.id}`}
          className="rounded text-sm font-medium text-foreground transition-colors duration-150 hover:text-primary hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="block">{row.name}</span>
          <span className="block text-xs font-normal text-muted-foreground">{row.slug}</span>
        </Link>
      ),
    },
    {
      key: "plan_tier",
      header: "Plan",
      render: (row) => <span className="badge bg-secondary text-secondary-foreground capitalize">{row.plan_tier}</span>,
    },
    {
      key: "byok_enabled",
      header: "BYOK",
      render: (row) =>
        row.byok_enabled ? (
          <span className="badge bg-info/10 text-info">
            <KeyRound className="h-3 w-3" aria-hidden="true" />
            BYOK
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "suspended",
      header: "Status",
      render: (row) =>
        row.suspended ? (
          <span className="badge bg-destructive/10 text-destructive">
            <Ban className="h-3 w-3" aria-hidden="true" />
            Suspended
          </span>
        ) : (
          <span className="badge bg-muted text-muted-foreground">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            Active
          </span>
        ),
    },
    {
      key: "user_count",
      header: "Users",
      mono: true,
      align: "right",
      render: (row) => row.user_count.toLocaleString("en-US"),
    },
    {
      key: "project_count",
      header: "Projects",
      mono: true,
      align: "right",
      render: (row) => row.project_count.toLocaleString("en-US"),
    },
    {
      key: "cost_micros",
      header: "Monthly cost",
      mono: true,
      align: "right",
      render: (row) => money(row.cost_micros),
    },
    {
      key: "ai_requests",
      header: "AI requests",
      mono: true,
      align: "right",
      render: (row) => compactNumber(row.ai_requests),
    },
    {
      key: "created_at",
      header: "Created",
      render: (row) => formatDate(row.created_at),
    },
  ];

  return (
    <div className="motion-safe:animate-fade-in flex flex-col gap-6 p-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-foreground">Organizations</h1>
        <p className="text-sm text-muted-foreground">
          {orgsQuery.isSuccess
            ? `${total.toLocaleString("en-US")} organization${total === 1 ? "" : "s"} on the platform.`
            : "Manage organizations, plans, and billing status across the platform."}
        </p>
      </header>

      {orgsQuery.isError && (
        <div
          role="alert"
          className="card-base flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Couldn't load organizations. Check the API connection and try again.
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={orgsQuery.isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        empty={
          <div className="flex flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <span className="text-sm">
              {hasActiveFilters ? "No organizations match these filters." : "No organizations yet."}
            </span>
          </div>
        }
        toolbar={
          <>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search organizations..."
                aria-label="Search organizations"
                className="h-9 w-56 rounded-lg border border-border bg-card pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              aria-label="Filter by plan"
              className="h-9 cursor-pointer rounded-lg border border-border bg-card px-2.5 text-sm text-foreground"
            >
              {PLANS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setSuspendedOnly((v) => !v)}
              aria-pressed={suspendedOnly}
              className={cn(
                "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                suspendedOnly
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Ban className="h-3.5 w-3.5" aria-hidden="true" />
              Suspended only
            </button>
          </>
        }
      />
    </div>
  );
}
