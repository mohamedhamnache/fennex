"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight, Bookmark, BookmarkCheck, Check, ChevronDown, Copy, Download,
  EyeOff, FileText, Image as ImageIcon, Megaphone, Printer, Share2, Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { ChatMessage } from "@/lib/chat";
import { departmentAccent, employeeIcon, type Employee } from "@/lib/employees";
import { Markdown, markdownToHtml } from "./Markdown";
import { saveDocument } from "@/lib/documents";
import { printDocument } from "@/lib/printDocument";

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
  const structured = (message.structured ?? {}) as {
    label?: string; body?: string; format?: string;
  };
  // A report or plan has no saved record -- the document IS the result, so it
  // is rendered here rather than reduced to a one-line summary.
  if (structured.body) {
    return (
      <DocumentCard message={message} employee={employee} body={structured.body}
                    projectId={projectId} />
    );
  }
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


/** A written deliverable: rendered in full, collapsible, copyable. */
function DocumentCard({
  message, employee, body, projectId,
}: {
  message: ChatMessage; employee?: Employee; body: string; projectId: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const EmployeeIcon = employee ? employeeIcon(employee.icon) : Sparkles;
  const label = (message.structured as { label?: string } | null)?.label;
  const words = body.trim().split(/\s+/).length;
  const long = words > 180;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked; not worth an error state here.
    }
  };

  const title = (message.content || t("chat.artifact.generic")).slice(0, 120);

  const save = async () => {
    if (saved || saving) return;
    setSaving(true);
    try {
      await saveDocument({
        project_id: projectId, title, body,
        employee_id: employee?.id ?? null, kind: "report",
      });
      setSaved(true);
    } catch {
      // Leave the button actionable so the user can try again.
    } finally {
      setSaving(false);
    }
  };

  const toPdf = () => printDocument(title, markdownToHtml(body));

  const download = () => {
    const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(message.content || "report").slice(0, 60).replace(/[^\w-]+/g, "-")}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        className="flex cursor-pointer items-center gap-2 self-start rounded-full border border-border px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
      >
        <EmployeeIcon className="h-3 w-3" strokeWidth={2} />
        {t("chat.artifact.hidden", { title: title.slice(0, 60) })}
        <span className="text-[10px] underline">{t("chat.artifact.show")}</span>
      </button>
    );
  }

  return (
    <div className="flex gap-3 animate-slide-up">
      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
        departmentAccent(employee?.department ?? ""))}>
        <EmployeeIcon className="h-4 w-4" strokeWidth={1.8} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="mb-1 flex flex-wrap items-baseline gap-2">
          <span className="font-display text-xs font-bold text-foreground">
            {employee?.name ?? t("chat.artifact.done")}
          </span>
          {label && <span className="text-[10px] text-muted-foreground">{label}</span>}
          <span className="text-[10px] text-muted-foreground">
            {t("chat.artifact.words", { count: words })}
          </span>
        </p>

        <div className="overflow-hidden rounded-2xl rounded-tl-md border border-success/30 bg-success/[0.04]">
          <div className={cn("relative px-4 py-3", long && !open && "max-h-72 overflow-hidden")}>
            <Markdown text={body} />
            {long && !open && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent"
              />
            )}
          </div>

          <div className="flex items-center gap-1.5 border-t border-success/20 px-3 py-2">
            {long && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-success/10"
              >
                <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
                {open ? t("chat.artifact.collapse") : t("chat.artifact.expand")}
              </button>
            )}
            <button
              type="button"
              onClick={() => setHidden(true)}
              className="ml-auto flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <EyeOff className="h-3 w-3" />
              {t("chat.artifact.hide")}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className={cn(
                "flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
                saved ? "text-success" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {saved ? <BookmarkCheck className="h-3 w-3" strokeWidth={2.5} />
                     : <Bookmark className="h-3 w-3" />}
              {saved ? t("chat.artifact.saved") : t("chat.artifact.save")}
            </button>
            <button
              type="button"
              onClick={toPdf}
              className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Printer className="h-3 w-3" />
              {t("chat.artifact.pdf")}
            </button>
            <button
              type="button"
              onClick={copy}
              className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {copied ? <Check className="h-3 w-3 text-success" strokeWidth={2.5} />
                      : <Copy className="h-3 w-3" />}
              {t("chat.copy")}
            </button>
            <button
              type="button"
              onClick={download}
              className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Download className="h-3 w-3" />
              {t("chat.artifact.download")}
            </button>
          </div>
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
