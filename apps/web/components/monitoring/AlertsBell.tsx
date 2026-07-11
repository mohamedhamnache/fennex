"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Bell, Check, type LucideIcon } from "lucide-react";
import {
  getUnreadAlertCount, listAlerts, listProjects, markAlertRead, type Alert,
} from "@/lib/api";
import { FENNEX_AGENTS, type AgentId } from "@/lib/agents";
import { useProjectStore } from "@/lib/store";
import { cn } from "@/lib/cn";

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

function agentFor(kind: string): { Icon: LucideIcon; gradient: string } {
  const agentId = KIND_AGENT[kind] ?? "zerda";
  const agent = FENNEX_AGENTS[agentId];
  return { Icon: agent.Icon, gradient: KIND_GRADIENT[agentId] };
}

/** Close a popover when clicking outside its ref. */
function useClickOutside(ref: React.RefObject<HTMLElement>, onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onClose, active]);
}

export function AlertsBell() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useClickOutside(ref, () => setOpen(false), open);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 5 * 60_000,
  });

  const urlProjectId = pathname?.split("/").filter(Boolean)[0] ?? null;
  const storeProjectId = useProjectStore((s) => s.currentProjectId);
  const projectId =
    projects?.find((p) => p.id === urlProjectId)?.id ??
    projects?.find((p) => p.id === storeProjectId)?.id ??
    projects?.[0]?.id ??
    null;

  const { data: unread } = useQuery({
    queryKey: ["alerts-unread", projectId],
    queryFn: () => getUnreadAlertCount(projectId as string),
    enabled: !!projectId,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const { data: recent = [] } = useQuery({
    queryKey: ["alerts", projectId, "recent"],
    queryFn: () => listAlerts(projectId as string, { limit: 5 }),
    enabled: open && !!projectId,
  });

  const count = unread?.count ?? 0;

  function handleOpenAlert(alert: Alert) {
    if (!projectId) return;
    markAlertRead(alert.id).then(() => {
      queryClient.invalidateQueries({ queryKey: ["alerts-unread", projectId] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    });
    setOpen(false);
    router.push(alert.url);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative rounded-lg p-2 transition-colors hover:bg-accent hover:text-foreground",
          open ? "bg-accent text-foreground" : "text-muted-foreground",
        )}
        aria-label={t("alertsCenter.bell")}
      >
        <Bell className="h-4 w-4" strokeWidth={1.8} />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>
      {open && (
        <div className="popover animate-scale-in absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-semibold">{t("alertsCenter.title")}</p>
            {projectId && (
              <Link
                href={`/${projectId}/alerts`}
                onClick={() => setOpen(false)}
                className="text-xs font-medium text-primary hover:underline"
              >
                {t("alertsCenter.viewAll")}
              </Link>
            )}
          </div>
          {recent.length > 0 ? (
            <div className="flex max-h-80 flex-col overflow-y-auto">
              {recent.map((alert) => {
                const { Icon, gradient } = agentFor(alert.kind);
                return (
                  <button
                    key={alert.id}
                    onClick={() => handleOpenAlert(alert)}
                    className="flex w-full items-start gap-2.5 border-b px-4 py-3 text-left last:border-b-0 transition-colors hover:bg-accent"
                  >
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white", gradient)}>
                      <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{alert.title}</span>
                        {!alert.is_read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">
                        {new Date(alert.created_at).toLocaleDateString(i18n.language, {
                          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-success/10">
                <Check className="h-5 w-5 text-success" strokeWidth={2} />
              </div>
              <p className="text-sm font-medium text-foreground">{t("alertsCenter.caughtUp")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
