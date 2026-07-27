"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Ban, CheckCircle2, Lock, Search } from "lucide-react";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/cn";
import { DataTable, type DataTableColumn } from "@/components/table/DataTable";
import type { AdminUserRow, Paginated } from "@/lib/admin-types";

const PAGE_SIZE = 20;

const ROLES: { value: string; label: string }[] = [
  { value: "", label: "All roles" },
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "seo_manager", label: "SEO manager" },
  { value: "content_writer", label: "Content writer" },
  { value: "editor", label: "Editor" },
  { value: "designer", label: "Designer" },
  { value: "marketing_manager", label: "Marketing manager" },
  { value: "viewer", label: "Viewer" },
];

function roleLabel(role: string): string {
  return ROLES.find((r) => r.value === role)?.label ?? role;
}

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

export default function UsersPage() {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [inactiveOnly, setInactiveOnly] = useState(false);
  const [page, setPage] = useState(1);

  const debouncedQ = useDebouncedValue(search, 300);

  // Any filter change invalidates the current page — jump back to page 1
  // rather than risk landing on a page past the end of the new result set.
  useEffect(() => {
    setPage(1);
  }, [debouncedQ, role, inactiveOnly]);

  const params = new URLSearchParams();
  if (debouncedQ) params.set("q", debouncedQ);
  if (role) params.set("role", role);
  if (inactiveOnly) params.set("active", "false");
  params.set("page", String(page));
  params.set("page_size", String(PAGE_SIZE));

  const usersQuery = useQuery({
    queryKey: ["admin", "users", { q: debouncedQ, role, active: inactiveOnly ? false : undefined, page }],
    queryFn: () => apiClient.get<Paginated<AdminUserRow>>(`/admin/users?${params.toString()}`),
  });

  const rows = usersQuery.data?.items ?? [];
  const total = usersQuery.data?.total ?? 0;
  const hasActiveFilters = !!debouncedQ || !!role || inactiveOnly;

  const columns: DataTableColumn<AdminUserRow>[] = [
    {
      key: "full_name",
      header: "Name",
      render: (row) => (
        <Link
          href={`/users/${row.id}`}
          className="rounded text-sm font-medium text-foreground transition-colors duration-150 hover:text-primary hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {row.full_name || "—"}
        </Link>
      ),
    },
    {
      key: "email",
      header: "Email",
      mono: true,
      render: (row) => row.email,
    },
    {
      key: "role",
      header: "Role",
      render: (row) => <span className="badge bg-secondary text-secondary-foreground">{roleLabel(row.role)}</span>,
    },
    {
      key: "org_name",
      header: "Org",
      render: (row) => (
        <Link
          href={`/orgs/${row.org_id}`}
          className="rounded text-sm text-foreground transition-colors duration-150 hover:text-primary hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {row.org_name}
        </Link>
      ),
    },
    {
      key: "is_active",
      header: "Status",
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {row.is_active ? (
            <span className="badge bg-muted text-muted-foreground">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              Active
            </span>
          ) : (
            <span className="badge bg-destructive/10 text-destructive">
              <Ban className="h-3 w-3" aria-hidden="true" />
              Inactive
            </span>
          )}
          {row.locked && (
            <span className="badge bg-destructive/10 text-destructive">
              <Lock className="h-3 w-3" aria-hidden="true" />
              Locked
            </span>
          )}
        </div>
      ),
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
        <h1 className="font-display text-2xl font-semibold text-foreground">Users</h1>
        <p className="text-sm text-muted-foreground">
          {usersQuery.isSuccess
            ? `${total.toLocaleString("en-US")} user${total === 1 ? "" : "s"} across all organizations.`
            : "Manage users, roles, and account status across the platform."}
        </p>
      </header>

      {usersQuery.isError && (
        <div
          role="alert"
          className="card-base flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Couldn't load users. Check the API connection and try again.
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={usersQuery.isLoading}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        empty={
          <div className="flex flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <span className="text-sm">{hasActiveFilters ? "No users match these filters." : "No users yet."}</span>
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
                placeholder="Search users..."
                aria-label="Search users"
                className="h-9 w-56 rounded-lg border border-border bg-card pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              aria-label="Filter by role"
              className="h-9 cursor-pointer rounded-lg border border-border bg-card px-2.5 text-sm text-foreground"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setInactiveOnly((v) => !v)}
              aria-pressed={inactiveOnly}
              className={cn(
                "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                inactiveOnly
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Ban className="h-3.5 w-3.5" aria-hidden="true" />
              Inactive only
            </button>
          </>
        }
      />
    </div>
  );
}
