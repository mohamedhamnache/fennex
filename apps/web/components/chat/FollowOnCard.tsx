"use client";

import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ChatMessage, FollowOnAction } from "@/lib/chat";
import { departmentAccent, employeeIcon, type Employee } from "@/lib/employees";

/** What the company would do next, once the current work is delivered.
 *
 *  An article wants a campaign; a campaign wants visuals. Surfacing the next
 *  specialist as a button means the user never has to know who to ask for --
 *  which is the whole promise of one assistant over a roster of agents. */
export function FollowOnCard({
  message, actions, byId, onRun, chosen,
}: {
  message: ChatMessage;
  actions: FollowOnAction[];
  byId: Map<string, Employee>;
  onRun: (messageId: string, employeeId: string, actionId: string) => void;
  chosen?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="rounded-2xl border border-border bg-card/60 p-4 animate-slide-up">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Sparkles className="h-3 w-3" strokeWidth={2.5} />
        {t("chat.followOn.title")}
      </p>
      <p className="mt-1.5 text-sm text-foreground">{message.content}</p>

      <div className="mt-3 flex flex-col gap-2">
        {actions.map((action) => {
          const employee = byId.get(action.employeeId);
          const Icon = employeeIcon(employee?.icon ?? action.icon ?? "sparkles");
          const key = `${action.employeeId}:${action.actionId}`;
          const isChosen = chosen === key;
          const dimmed = !!chosen && !isChosen;
          return (
            <button
              key={key}
              type="button"
              disabled={!!chosen}
              onClick={() => onRun(message.id, action.employeeId, action.actionId)}
              className={cn(
                "group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-200",
                isChosen
                  ? "border-success/40 bg-success/[0.07]"
                  : "border-border hover:border-primary/30 hover:bg-accent active:scale-[0.99]",
                chosen ? "cursor-not-allowed" : "cursor-pointer",
                dimmed && "opacity-40",
              )}
            >
              <span className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                departmentAccent(employee?.department ?? action.department ?? ""),
              )}>
                <Icon className="h-4 w-4" strokeWidth={1.8} />
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground">
                    {action.employeeName}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {action.employeeRole}
                  </span>
                  {action.destructive && (
                    <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[9px] font-semibold text-warning">
                      {t("chat.actions.external")}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-foreground">{action.label}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                  {action.description}
                </span>
              </span>

              {isChosen
                ? <Check className="h-4 w-4 shrink-0 text-success" strokeWidth={2.5} />
                : <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-primary" />}
            </button>
          );
        })}
      </div>

      {!chosen && (
        <p className="mt-2.5 text-[10px] text-muted-foreground">
          {t("chat.followOn.hint")}
        </p>
      )}
    </div>
  );
}
