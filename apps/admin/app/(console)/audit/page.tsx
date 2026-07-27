"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ScrollText, X } from "lucide-react";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/cn";
import { DataTable, type DataTableColumn } from "@/components/table/DataTable";
import type { AdminAuditRow, Paginated } from "@/lib/admin-types";

const PAGE_SIZE = 50;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

/** Shortens a UUID-shaped id to its first 8 chars for dense table cells —
 * the full value is still available in the details drawer. */
function short(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

/** Debounces `value` by `delayMs`, resetting the timer on every change —
 * mirrors the orgs page so free-text filters don't fire a request per
 * keystroke. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** Pretty-prints a before/after JSON blob for the details drawer. `null`
 * (no snapshot recorded — e.g. a create action has no "before") renders an
 * explicit placeholder rather than the literal string "null". */
function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {value === null || value === undefined ? (
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          No data
        </div>
      ) : (
        <pre className="max-h-80 overflow-x-auto overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

function AuditDetailsDrawer({ row, onClose }: { row: AdminAuditRow | null; onClose: () => void }) {
  useEffect(() => {
    if (!row) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [row, onClose]);

  if (!row) return null;

  return (
    <div
      className="cmd-overlay fixed inset-0 z-50 flex items-stretch justify-end motion-safe:animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-drawer-title"
        className="popover flex h-full w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-none border-l border-border p-5 motion-safe:animate-scale-in sm:rounded-l-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="audit-drawer-title" className="font-display text-lg font-semibold text-foreground">
              Audit entry #{row.id}
            </h2>
            <p className="mt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
              {formatDateTime(row.created_at)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border bg-muted/20 p-3 text-xs">
          <div>
            <dt className="text-muted-foreground">Actor</dt>
            <dd className="mt-0.5 break-all font-mono text-foreground">{row.actor_admin_id}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Action</dt>
            <dd className="mt-0.5 font-mono text-foreground">{row.action}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Resource</dt>
            <dd className="mt-0.5 font-mono text-foreground">
              {row.resource_type}
              {row.resource_id ? ` / ${row.resource_id}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">IP</dt>
            <dd className="mt-0.5 font-mono tabular-nums text-foreground">{row.ip ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Result</dt>
            <dd className="mt-0.5">
              <span
                className={cn(
                  "badge",
                  row.result === "ok" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
                )}
              >
                {row.result}
              </span>
            </dd>
          </div>
        </dl>

        <JsonBlock label="Before" value={row.before_json} />
        <JsonBlock label="After" value={row.after_json} />
      </div>
    </div>
  );
}

export default function AuditPage() {
  const [action, setAction] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminAuditRow | null>(null);

  const debouncedAction = useDebouncedValue(action, 300);
  const debouncedResourceType = useDebouncedValue(resourceType, 300);

  // Any filter change invalidates the current page — jump back to page 1
  // rather than risk landing on a page past the end of the new result set.
  useEffect(() => {
    setPage(1);
  }, [debouncedAction, debouncedResourceType, from, to]);

  const params = new URLSearchParams();
  if (debouncedAction) params.set("action", debouncedAction);
  if (debouncedResourceType) params.set("resource_type", debouncedResourceType);
  if (from) params.set("from", from);
  // Inclusive of the whole "to" day — the backend does `created_at <= to`,
  // and a bare date parses as that day's midnight.
  if (to) params.set("to", `${to}T23:59:59`);
  params.set("page", String(page));
  params.set("page_size", String(PAGE_SIZE));

  const auditQuery = useQuery({
    queryKey: [
      "admin",
      "audit",
      { action: debouncedAction, resourceType: debouncedResourceType, from, to, page },
    ],
    queryFn: () => apiClient.get<Paginated<AdminAuditRow>>(`/admin/audit?${params.toString()}`),
  });

  const rows = auditQuery.data?.items ?? [];
  const total = auditQuery.data?.total ?? 0;
  const hasActiveFilters = !!debouncedAction || !!debouncedResourceType || !!from || !!to;

  const columns: DataTableColumn<AdminAuditRow>[] = [
    {
      key: "created_at",
      header: "When",
      mono: true,
      render: (row) => formatDateTime(row.created_at),
    },
    {
      key: "actor_admin_id",
      header: "Actor",
      mono: true,
      render: (row) => <span title={row.actor_admin_id}>{short(row.actor_admin_id)}</span>,
    },
    {
      key: "action",
      header: "Action",
      render: (row) => <span className="badge bg-secondary text-secondary-foreground">{row.action}</span>,
    },
    {
      key: "resource_type",
      header: "Resource",
      render: (row) => (
        <span className="font-mono text-xs text-foreground">
          {row.resource_type}
          {row.resource_id ? (
            <span className="text-muted-foreground" title={row.resource_id}>
              {" "}
              / {short(row.resource_id)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "ip",
      header: "IP",
      mono: true,
      render: (row) => row.ip ?? "—",
    },
    {
      key: "result",
      header: "Result",
      render: (row) => (
        <span
          className={cn(
            "badge",
            row.result === "ok" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
          )}
        >
          {row.result}
        </span>
      ),
    },
  ];

  return (
    <div className="motion-safe:animate-fade-in flex flex-col gap-6 p-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-foreground">Audit Logs</h1>
        <p className="text-sm text-muted-foreground">
          {auditQuery.isSuccess
            ? `${total.toLocaleString("en-US")} audit ${total === 1 ? "entry" : "entries"} recorded.`
            : "Every admin mutation across the platform, with before/after snapshots."}
        </p>
      </header>

      {auditQuery.isError && (
        <div
          role="alert"
          className="card-base flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Couldn't load audit logs. Check the API connection and try again.
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={auditQuery.isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        onRowClick={setSelected}
        empty={
          <div className="flex flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <ScrollText className="h-5 w-5" aria-hidden="true" />
            <span className="text-sm">
              {hasActiveFilters ? "No audit entries match these filters." : "No audit entries yet."}
            </span>
          </div>
        }
        toolbar={
          <>
            <input
              type="text"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="Action (e.g. org.suspend)"
              aria-label="Filter by action"
              className="h-9 w-48 rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
            <input
              type="text"
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value)}
              placeholder="Resource type (e.g. org)"
              aria-label="Filter by resource type"
              className="h-9 w-44 rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              From
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="From date"
                className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              To
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label="To date"
                className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
              />
            </label>
          </>
        }
      />

      <AuditDetailsDrawer row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
