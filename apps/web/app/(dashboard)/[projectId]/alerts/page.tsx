"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Bell, ShieldCheck, type LucideIcon } from "lucide-react";
import {
  getUnreadAlertCount, listAlerts, markAlertRead, markAllAlertsRead, type Alert,
} from "@/lib/api";
import { FENNEX_AGENTS, type AgentId } from "@/lib/agents";
import { PageHeader } from "@/components/ui/PageHeader";
import { WatchlistCard } from "@/components/monitoring/WatchlistCard";
import { cn } from "@/lib/cn";

const KINDS = ["ranking_drop", "ranking_gain", "competitor_change", "market_shift"] as const;
type Kind = (typeof KINDS)[number];

const KIND_AGENT: Record<string, AgentId> = {
  ranking_drop: "zerda",
  ranking_gain: "zerda",
  serp_drop: "zerda",
  serp_gain: "zerda",
  competitor_change: "sable",
  market_shift: "oasis",
};

const KIND_GRADIENT: Record<AgentId, string> = {
  zerda: "from-indigo-500 to-violet-500",
  sirocco: "from-violet-500 to-fuchsia-500",
  dune: "from-blue-500 to-indigo-500",
  mirage: "from-fuchsia-500 to-pink-500",
  sable: "from-slate-600 to-indigo-600",
  oasis: "from-emerald-500 to-teal-500",
  nomad: "from-amber-500 to-orange-500",
};

const SEVERITY_DOT: Record<Alert["severity"], string> = {
  info: "bg-muted-foreground/40",
  warning: "bg-warning",
  critical: "bg-destructive",
};

function agentFor(kind: string): { Icon: LucideIcon; gradient: string; name: string } {
  const agentId = KIND_AGENT[kind] ?? "zerda";
  const agent = FENNEX_AGENTS[agentId];
  return { Icon: agent.Icon, gradient: KIND_GRADIENT[agentId], name: agent.name };
}

export default function AlertsPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);

  const { data: unread } = useQuery({
    queryKey: ["alerts-unread", projectId],
    queryFn: () => getUnreadAlertCount(projectId),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ["alerts", projectId, unreadOnly, kind],
    queryFn: () => listAlerts(projectId, { unreadOnly, kind: kind ?? undefined }),
    enabled: !!projectId,
  });

  const markAllMutation = useMutation({
    mutationFn: () => markAllAlertsRead(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts-unread", projectId] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });

  function handleOpenAlert(alert: Alert) {
    if (!alert.is_read) {
      markAlertRead(alert.id).then(() => {
        queryClient.invalidateQueries({ queryKey: ["alerts-unread", projectId] });
        queryClient.invalidateQueries({ queryKey: ["alerts"] });
      });
    }
  }

  const unreadCount = unread?.count ?? 0;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <PageHeader
        icon={Bell}
        title={t("alertsCenter.title")}
        description={t("alertsCenter.subtitle")}
        actions={
          <button
            onClick={() => markAllMutation.mutate()}
            disabled={unreadCount === 0 || markAllMutation.isPending}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            {t("alertsCenter.markAllRead")}
          </button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setUnreadOnly(false)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                !unreadOnly ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground hover:bg-accent",
              )}
            >
              {t("alertsCenter.all")}
            </button>
            <button
              onClick={() => setUnreadOnly(true)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                unreadOnly ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground hover:bg-accent",
              )}
            >
              {t("alertsCenter.unreadOnly")}
            </button>
            <span className="mx-1 h-4 w-px bg-border" />
            {KINDS.map((k) => (
              <button
                key={k}
                onClick={() => setKind((cur) => (cur === k ? null : k))}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  kind === k ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground hover:bg-accent",
                )}
              >
                {t(`alertsCenter.kinds.${k}`)}
              </button>
            ))}
          </div>

          {alerts.length === 0 ? (
            <div className="glass flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
                <ShieldCheck className="h-6 w-6 text-success" strokeWidth={1.9} />
              </div>
              <p className="text-sm font-medium text-foreground">{t("alertsCenter.empty")}</p>
            </div>
          ) : (
            <div className="glass flex flex-col overflow-hidden">
              {alerts.map((alert) => {
                const { Icon, gradient, name } = agentFor(alert.kind);
                return (
                  <div
                    key={alert.id}
                    className={cn(
                      "flex items-start gap-3 border-b border-border px-4 py-3.5 last:border-b-0",
                      !alert.is_read && "bg-primary/[0.03]",
                    )}
                  >
                    <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", SEVERITY_DOT[alert.severity])} />
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white", gradient)}>
                      <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={cn("truncate text-sm", alert.is_read ? "text-muted-foreground" : "font-medium text-foreground")}>
                          {alert.title}
                        </p>
                        <span className="shrink-0 text-[10px] font-medium text-muted-foreground/70">{name}</span>
                      </div>
                      {alert.detail && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{alert.detail}</p>
                      )}
                      <p className="mt-1 text-[10px] text-muted-foreground/70">
                        {new Date(alert.created_at).toLocaleDateString(i18n.language, {
                          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <Link
                      href={alert.url}
                      onClick={() => handleOpenAlert(alert)}
                      className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                    >
                      {t("alertsCenter.open")}
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <WatchlistCard projectId={projectId} />
        </div>
      </div>
    </div>
  );
}
