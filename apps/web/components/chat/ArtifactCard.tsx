"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight, FileText, Image as ImageIcon, Megaphone, Share2, Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { ChatMessage } from "@/lib/chat";
import { departmentAccent, employeeIcon, type Employee } from "@/lib/employees";

/** What an employee actually produced, and where to go and see it.
 *
 *  A result is not chat text -- it is a saved record. This card makes that
 *  concrete: what was made, how many, and a link straight to it. */
export function ArtifactCard({
  message, employee, projectId,
}: { message: ChatMessage; employee?: Employee; projectId: string }) {
  const { t } = useTranslation();
  const kind = message.artifactType ?? "result";
  const ids = message.artifactIds ?? [];
  const structured = (message.structured ?? {}) as { label?: string };
  const { Icon, href, tone } = artifactMeta(kind, ids, projectId);
  const EmployeeIcon = employee ? employeeIcon(employee.icon) : Sparkles;

  return (
    <div className="flex gap-3 animate-slide-up">
      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
        departmentAccent(employee?.department ?? ""))}>
        <EmployeeIcon className="h-4 w-4" strokeWidth={1.8} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="mb-1 flex items-baseline gap-2">
          <span className="font-display text-xs font-bold text-foreground">
            {employee?.name ?? t("chat.artifact.done")}
          </span>
          {structured.label && (
            <span className="text-[10px] text-muted-foreground">{structured.label}</span>
          )}
        </p>

        <div className={cn(
          "overflow-hidden rounded-2xl rounded-tl-md border",
          "border-success/30 bg-success/[0.05]",
        )}>
          <div className="flex items-start gap-3 p-3.5">
            <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tone)}>
              <Icon className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-foreground">
                {t(`chat.artifact.kind.${kind}`, {
                  defaultValue: t("chat.artifact.generic"),
                  count: ids.length || 1,
                })}
              </p>
              <p className="mt-0.5 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
                {message.content}
              </p>
            </div>
          </div>

          {href && (
            <Link
              href={href}
              className="flex items-center justify-center gap-1.5 border-t border-success/20 px-3 py-2 text-[11px] font-semibold text-foreground transition-colors hover:bg-success/10"
            >
              {t("chat.artifact.view")}
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function artifactMeta(
  kind: string, ids: string[], projectId: string,
): { Icon: LucideIcon; href: string | null; tone: string } {
  const first = ids[0];
  switch (kind) {
    case "article":
      // The editor lives on the list page and opens from ?article=<id>.
      return {
        Icon: FileText,
        href: first
          ? `/${projectId}/articles?article=${first}`
          : `/${projectId}/articles`,
        tone: "bg-amber-500/12 text-amber-500",
      };
    case "image":
      return {
        Icon: ImageIcon,
        href: first ? `/${projectId}/images/edit/${first}` : `/${projectId}/images`,
        tone: "bg-violet-500/12 text-violet-500",
      };
    case "social":
      return {
        Icon: Share2,
        href: `/${projectId}/social`,
        tone: "bg-sky-500/12 text-sky-500",
      };
    case "campaign":
      return {
        Icon: Megaphone,
        href: `/${projectId}/campaigns`,
        tone: "bg-rose-500/12 text-rose-500",
      };
    default:
      return { Icon: Sparkles, href: null, tone: "bg-primary/12 text-primary" };
  }
}
