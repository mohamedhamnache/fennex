"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle, Check, Loader2, Plug, Plus, RefreshCw, Trash2, X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  connectConnector, disconnectConnector, listConnectors, startConnectorOAuth,
  testConnector, toggleConnector, type ConnectorInfo,
} from "@/lib/connectors";
import { departmentAccent, employeeIcon } from "@/lib/employees";

/** Connect the tools the employees work through.
 *
 *  Each row names the employees that gain reach, because a connector is
 *  abstract until you can see that connecting LinkedIn is what gives the
 *  Creative Director somewhere to publish. */
export function ConnectorsPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["connectors"], queryFn: listConnectors, staleTime: 30_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["connectors"] });
  const connectors = data?.connectors ?? [];
  const live = connectors.filter((c) => c.connected).length;

  return (
    <section className="glass overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <Plug className="h-4 w-4" strokeWidth={1.8} />
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

      {isLoading && (
        <p className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> {t("connectors.loading")}
        </p>
      )}

      <div className="divide-y divide-border">
        {connectors.map((connector) => (
          <ConnectorRow
            key={connector.app}
            connector={connector}
            editing={editing === connector.app}
            onEdit={() => setEditing(editing === connector.app ? null : connector.app)}
            onDone={() => { setEditing(null); refresh(); }}
          />
        ))}
      </div>
    </section>
  );
}

function ConnectorRow({
  connector, editing, onEdit, onDone,
}: {
  connector: ConnectorInfo;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(connector.url);
  const [token, setToken] = useState("");

  const connect = useMutation({
    mutationFn: () => connectConnector({
      app: connector.app, url, token: token || undefined,
    }),
    onSuccess: () => { setToken(""); onDone(); },
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
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold uppercase",
          connector.connected
            ? failing ? "bg-destructive/12 text-destructive" : "bg-success/12 text-success"
            : "bg-muted text-muted-foreground",
        )}>
          {connector.label.slice(0, 2)}
        </span>

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-foreground">{connector.label}</span>
            <StatusPill connector={connector} />
            <span className="rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {connector.permission}
            </span>
          </p>

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

        <div className="flex shrink-0 items-center gap-1.5">
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
          <button
            type="button"
            onClick={onEdit}
            disabled={connector.fromEnvironment}
            title={connector.fromEnvironment ? t("connectors.fromEnv") : undefined}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              connector.connected
                ? "border border-border text-foreground hover:bg-accent"
                : "btn-primary",
            )}
          >
            {editing ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            {connector.connected ? t("connectors.edit") : t("connectors.connect")}
          </button>
        </div>
      </div>

      {/* One click where the provider supports it. Asking a user for a server
          URL and a bearer token is asking them to do the integration by hand --
          they have to find the endpoint, mint a token, and scope it correctly.
          The manual form stays below as an escape hatch for self-hosted or
          unlisted servers, which is the only case that genuinely needs it. */}
      {!connector.connected && connector.oauth && (
        <button
          onClick={async () => {
            const r = await startConnectorOAuth(connector.app);
            if (r.ok && r.redirect_url) window.location.href = r.redirect_url;
          }}
          className="btn-primary mt-3 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
        >
          <Plus className="h-3.5 w-3.5" />
          Connect {connector.label}
        </button>
      )}

      {editing && (
        <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3 animate-slide-up">
          {connector.oauth && (
            <p className="mb-2.5 rounded-lg border border-dashed border-border px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
              {connector.label} connects in one click above. These fields are for
              a self-hosted or unlisted server only.
            </p>
          )}
          <label className="block text-[10px] font-semibold text-muted-foreground" htmlFor={`url-${connector.app}`}>
            {t("connectors.url")}
          </label>
          <input
            id={`url-${connector.app}`}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mcp.example.com/sse"
            className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/30"
          />

          <label className="mt-2.5 block text-[10px] font-semibold text-muted-foreground" htmlFor={`token-${connector.app}`}>
            {t("connectors.token")}
            {connector.hasToken && (
              <span className="ml-1 font-normal text-muted-foreground/70">
                {t("connectors.tokenStored")}
              </span>
            )}
          </label>
          <input
            id={`token-${connector.app}`}
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={connector.hasToken ? "••••••••" : t("connectors.tokenPlaceholder")}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/30"
          />

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => connect.mutate()}
              disabled={!url.trim() || connect.isPending}
              className="btn-primary flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50"
            >
              {connect.isPending
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Check className="h-3 w-3" />}
              {t("connectors.saveAndTest")}
            </button>
            {connect.isError && (
              <span className="text-[10px] text-destructive">{t("connectors.failed")}</span>
            )}
            {connect.data?.test && !connect.data.test.ok && (
              <span className="text-[10px] text-destructive">{connect.data.test.error}</span>
            )}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            {t("connectors.hint")}
          </p>
        </div>
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
