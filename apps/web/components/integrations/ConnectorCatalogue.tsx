"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Plug, Search, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { listConnectors, startConnectorOAuth, type ConnectorInfo } from "@/lib/api";
import { employeeIcon } from "@/lib/employees";
import { ConnectorLogo } from "./ConnectorLogo";

/**
 * Everything the agents can be connected to.
 *
 * Two rules shape this list, and both are about honesty rather than looks:
 *
 * An app that already has a METERED NATIVE tool is not offered here. MCP would
 * be a second route to the same paid API with no meter on it, which is the one
 * failure the metering audit exists to catch. Those apps appear above, in the
 * native section, where connecting them is the supported path.
 *
 * A connector shows WHO GAINS from it. "Connect Meta Ads" means nothing on its
 * own; "Meta Ads — Souk can then measure your real ROAS" is a reason. The
 * server already returns that list, so the card cannot claim an employee that
 * does not declare the app.
 */
export function ConnectorCatalogue({ projectId }: { projectId?: string }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");

  const { data = [], isLoading } = useQuery({
    queryKey: ["connectors"],
    queryFn: listConnectors,
    staleTime: 120_000,
    retry: false,
  });

  // Apps with a native path are handled by the section above. Showing them
  // twice invites the user to connect the unmetered one.
  const available = useMemo(() => data.filter((c) => !c.nativeTool), [data]);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(available.map((c) => c.category))).sort()],
    [available],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return available
      .filter((c) => category === "All" || c.category === category)
      .filter((c) => !q || c.label.toLowerCase().includes(q)
        || c.description.toLowerCase().includes(q)
        || c.category.toLowerCase().includes(q)
        || c.usedBy.some((e) => e.name.toLowerCase().includes(q)))
      // Connected first: what is already working should not be hunted for.
      .sort((a, b) => Number(b.connected) - Number(a.connected)
        || a.label.localeCompare(b.label));
  }, [available, category, query]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-muted/30" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search connectors, or an agent's name"
            aria-label="Search connectors"
            className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={cn(
                "cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                category === c
                  ? "border-foreground/20 bg-foreground/5 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {!shown.length ? (
        <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          Nothing matches “{query}”.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((c) => <ConnectorCard key={c.app} connector={c} projectId={projectId} />)}
        </div>
      )}
    </div>
  );
}

function ConnectorCard({ connector: c, projectId }: {
  connector: ConnectorInfo; projectId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gains = c.usedBy.slice(0, 3);

  async function connect() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await startConnectorOAuth(c.app, { project_id: projectId ?? null });
      // A full navigation, not a popup: the provider decides what its consent
      // screen looks like and several refuse to render in a frame.
      if (r.ok && r.redirect_url) { window.location.href = r.redirect_url; return; }
      setError(
        r.error === "not_configured"
          ? `${c.label} is not set up yet — its OAuth client ID and secret need configuring first.`
          : r.error === "unknown_connector"
            ? `${c.label} has no connection flow yet.`
            : `Could not start the connection${r.error ? ` (${r.error})` : ""}.`,
      );
    } catch {
      setError("Could not reach the server. Try again.");
    }
    setBusy(false);
  }
  return (
    <Card className={cn(
      "group flex flex-col gap-2.5 p-4 transition-colors",
      c.connected ? "border-emerald-500/30" : "hover:border-foreground/15",
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <ConnectorLogo app={c.app} label={c.label} className="h-9 w-9 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{c.label}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{c.category}</p>
          </div>
        </div>
        {c.connected ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">
            <Check className="h-3 w-3" strokeWidth={3} />
            {c.toolCount ? `${c.toolCount} tools` : "Connected"}
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground">
            Not connected
          </span>
        )}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">{c.description}</p>

      {/* Who gains. A connector is abstract until you can see whose work it
          unblocks -- and this comes from the roster, so it cannot name an
          employee that has not declared the app. */}
      {gains.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
          {gains.map((e) => {
            const Icon = employeeIcon(e.icon);
            return (
              <span key={e.id} title={e.role}
                    className="flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                <Icon className="h-2.5 w-2.5" strokeWidth={2} />
                {e.name}
              </span>
            );
          })}
          {c.usedBy.length > gains.length && (
            <span className="text-[10px] text-muted-foreground">
              +{c.usedBy.length - gains.length}
            </span>
          )}
        </div>
      )}

      {/* Offered only where it will actually complete. An app whose client
          credentials are not configured says so instead of showing a button
          that dead-ends after the redirect. */}
      {!c.connected && (
        <button
          onClick={connect}
          disabled={busy}
          className="mt-0.5 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
          {busy ? "Opening…" : `Connect ${c.label}`}
        </button>
      )}

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[10px] leading-relaxed text-destructive">
          {error}
        </p>
      )}

      {c.lastError && (
        <p className="truncate text-[10px] text-destructive" title={c.lastError}>
          {c.lastError}
        </p>
      )}
    </Card>
  );
}
