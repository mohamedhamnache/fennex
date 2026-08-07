"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle, Check, Loader2, Plug, Plus, RefreshCw, Search, Trash2, X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  disconnectConnector, listConnectors, startConnectorOAuth,
  testConnector, toggleConnector, type ConnectorInfo,
} from "@/lib/connectors";
import { departmentAccent, employeeIcon } from "@/lib/employees";
import { ConnectorLogo } from "@/components/integrations/ConnectorLogo";

/** Connect the tools the employees work through.
 *
 *  Each row names the employees that gain reach, because a connector is
 *  abstract until you can see that connecting LinkedIn is what gives the
 *  Creative Director somewhere to publish. */
export function ConnectorsPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["connectors"], queryFn: listConnectors, staleTime: 30_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["connectors"] });
  const connectors = data?.connectors ?? [];
  const live = connectors.filter((c) => c.connected).length;

  // Same control as the integrations page: 29 connectors is a directory, and
  // in a directory people type rather than scan. Matching agent names too --
  // "what can Souk reach?" is a real way to look.
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return connectors;
    return connectors.filter((c) =>
      c.label.toLowerCase().includes(q)
      || (c.category ?? "").toLowerCase().includes(q)
      || (c.description ?? "").toLowerCase().includes(q)
      || c.usedBy.some((e) => e.name.toLowerCase().includes(q)));
  }, [connectors, query]);

  const connectedCount = connectors.filter((c) => c.connected).length;

  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    filtered.forEach((c) => {
      const k = c.category || "Other";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const visible = useMemo(() => filtered
    .filter((c) => !category || (c.category || "Other") === category)
    // Connected first: what is already working should not be hunted for.
    .sort((a, b) => Number(b.connected) - Number(a.connected)
      || a.label.localeCompare(b.label)),
  [filtered, category]);

  return (
    <section className="glass overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Plug className="h-4 w-4" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-bold text-foreground">
            {t("connectors.title")}
          </h2>
          <p className="text-[11px] text-muted-foreground">{t("connectors.subtitle")}</p>
        </div>
        {connectors.length > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {t("connectors.count", { live, total: connectors.length })}
          </span>
        )}
      </header>

      {/* Search sits above the groups, and the count answers "how much of this
          is actually wired up" without counting badges by eye. */}
      {connectors.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("connectors.searchPlaceholder")}
              aria-label={t("connectors.searchPlaceholder")}
              className="w-full rounded-lg border border-border bg-background py-1.5 pl-9 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label={t("common.clear")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {connectedCount}/{connectors.length} {t("connectors.connectedCount")}
          </span>
        </div>
      )}

      {!isLoading && !visible.length && query && (
        <p className="px-5 py-10 text-center text-xs text-muted-foreground">
          {t("company.noMatch", { query })}
        </p>
      )}

      {isLoading && (
        <p className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> {t("connectors.loading")}
        </p>
      )}

      {/* Grouped, and connected first inside each group. A flat list of 29
          rows ran nearly four screens with no landmarks -- the reader had to
          hold "am I past Social yet?" in their head. Categories give the eye
          somewhere to stop. */}
      <div className="px-5 py-3">
        <div role="tablist" aria-label={t("connectors.title")} className="mb-3 flex flex-wrap gap-1.5">
          <CategoryChip
            active={category === null}
            onClick={() => setCategory(null)}
            label={t("company.allDepartments")}
            count={filtered.length}
          />
          {categories.map(([name, count]) => (
            <CategoryChip
              key={name}
              active={category === name}
              onClick={() => setCategory(name)}
              label={name}
              count={count}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((connector) => (
            <ConnectorRow key={connector.app} connector={connector} onDone={refresh} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ConnectorRow({
  connector, onDone,
}: {
  connector: ConnectorInfo;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  const oauth = useMutation({
    mutationFn: () => startConnectorOAuth(connector.app),
    onSuccess: (r) => {
      if (r.ok && r.redirect_url) {
        // A full navigation, not a popup: the provider owns its consent screen
        // and several refuse to render inside a frame.
        window.location.href = r.redirect_url;
        return;
      }
      setError(
        r.error === "not_configured"
          ? `${connector.label} is not set up yet. Its OAuth client ID and secret need to be configured before anyone can connect it.`
          : r.error === "shop_required"
            ? `${connector.label} needs a shop domain, which this panel does not ask for yet.`
            : `Could not start the connection${r.error ? ` (${r.error})` : ""}.`,
      );
    },
    onError: () => setError("Could not reach the server. Try again."),
  });

  const check = useMutation({ mutationFn: () => testConnector(connector.app), onSuccess: onDone });
  const toggle = useMutation({
    mutationFn: () => toggleConnector(connector.app, !connector.enabled), onSuccess: onDone,
  });
  const remove = useMutation({
    mutationFn: () => disconnectConnector(connector.app), onSuccess: onDone,
  });

  const failing = connector.connected && connector.lastStatus === "error";

  return (
    <div className={cn(
      "flex flex-col gap-2.5 rounded-xl border p-3.5 transition-colors",
      connector.connected
        ? failing ? "border-destructive/30 bg-destructive/[0.03]" : "border-success/30 bg-success/[0.03]"
        : "border-border hover:border-foreground/15",
    )}>
      <div className="flex items-start gap-2.5">
        <ConnectorLogo app={connector.app} label={connector.label} className="h-9 w-9 shrink-0" />

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-xs font-semibold text-foreground">{connector.label}</span>
            <StatusPill connector={connector} />
          </p>
          {connector.description && (
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
              {connector.description}
            </p>
          )}

          {/* Who this actually unlocks. */}
          {connector.usedBy.length > 0 ? (
            <p className="mt-1 flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-muted-foreground">
                {t("connectors.usedBy")}
              </span>
              {connector.usedBy.map((employee) => {
                const Icon = employeeIcon(employee.icon);
                return (
                  <span
                    key={employee.id}
                    title={`${employee.name} — ${employee.role}`}
                    className="flex items-center gap-1 rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    <span className={cn("flex h-3 w-3 items-center justify-center rounded-full",
                      departmentAccent(employee.department))}>
                      <Icon className="h-2 w-2" strokeWidth={2.5} />
                    </span>
                    {employee.name}
                  </span>
                );
              })}
            </p>
          ) : (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t("connectors.noEmployee")}
            </p>
          )}

          {failing && connector.lastError && (
            <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive">
              <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
              {connector.lastError}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
          {connector.connected && (
            <>
              <button
                type="button"
                onClick={() => check.mutate()}
                disabled={check.isPending}
                aria-label={t("connectors.test")}
                className="cursor-pointer rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw className={cn("h-3 w-3", check.isPending && "animate-spin")} />
              </button>
              <button
                type="button"
                onClick={() => toggle.mutate()}
                className="cursor-pointer rounded-lg border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {connector.enabled ? t("connectors.pause") : t("connectors.resume")}
              </button>
              <button
                type="button"
                onClick={() => remove.mutate()}
                aria-label={t("connectors.disconnect")}
                className="cursor-pointer rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </>
          )}

      {/* One click, always. The manual URL-and-token form is gone: asking a
          user to find an MCP endpoint, mint a bearer token and scope it
          correctly is asking them to do the integration by hand, and it was
          the only path on offer for every connector.

          When a provider has no client credentials configured the button still
          appears and says so on click, rather than the card hiding the feature
          entirely -- an explained gap is more useful than an absence the user
          has to guess at. */}
        {!connector.connected && (
          <button
            type="button"
            onClick={() => oauth.mutate()}
            disabled={oauth.isPending}
            className="btn-primary flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-default disabled:opacity-60"
          >
            {oauth.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Plus className="h-3.5 w-3.5" />}
            {oauth.isPending ? t("connectors.connecting") : t("connectors.connect")}
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[10px] leading-relaxed text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function StatusPill({ connector }: { connector: ConnectorInfo }) {
  const { t } = useTranslation();
  if (connector.fromEnvironment) {
    return (
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        {t("connectors.status.environment")}
      </span>
    );
  }
  if (!connector.connected) {
    return (
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        {t("connectors.status.notConnected")}
      </span>
    );
  }
  if (!connector.enabled) {
    return (
      <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
        {t("connectors.status.paused")}
      </span>
    );
  }
  if (connector.lastStatus === "error") {
    return (
      <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
        {t("connectors.status.failing")}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
      <Check className="h-2.5 w-2.5" strokeWidth={3} />
      {connector.toolCount
        ? t("connectors.status.connectedWithTools", { count: Number(connector.toolCount) })
        : t("connectors.status.connected")}
    </span>
  );
}

/** A category filter. Mirrors the team view's department chips so the two
 *  directories on this page behave identically -- learning one teaches the
 *  other. */
function CategoryChip({ active, onClick, label, count }: {
  active: boolean; onClick: () => void; label: string; count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-foreground/20 bg-foreground/5 text-foreground"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <span className="tabular-nums opacity-60">{count}</span>
    </button>
  );
}
