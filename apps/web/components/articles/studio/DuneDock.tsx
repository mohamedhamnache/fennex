"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Wand2, ListChecks, Tags, X } from "lucide-react";
import { FENNEX_AGENTS } from "@/lib/agents";
import { OptimizePanel } from "@/components/seo/OptimizePanel";
import { MetaTab } from "./MetaTab";
import { ChecksTab } from "./ChecksTab";
import { AssistantTab } from "./AssistantTab";

type DockTab = "assistant" | "optimize" | "checks" | "meta";

const TAB_ICONS: Record<DockTab, typeof Sparkles> = {
  assistant: Sparkles,
  optimize: Wand2,
  checks: ListChecks,
  meta: Tags,
};

interface DuneDockProps {
  projectId: string;
  articleId: string;
  articleTitle: string;
  targetKeyword: string | null;
  metaTitle: string;
  metaDesc: string;
  onMetaTitleChange: (val: string) => void;
  onMetaTitleBlur: () => void;
  onMetaDescChange: (val: string) => void;
  onMetaDescBlur: () => void;
  breakdown: Record<string, number>;
  body: string;
  onBodyChange: (val: string) => void;
  onInsert: (text: string) => void;
  onApplyRevision: (markdown: string) => void;
  /** Mobile/narrow-viewport overlay state (ignored at `lg` and above, where the dock is always visible). */
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

/**
 * Right-hand dock of the article studio — Dune's home base beside the canvas.
 * Tabs: assistant (Task 6+), optimize (existing OptimizePanel), checks
 * (Task 7+), meta (moved meta title/description/breakdown inputs).
 *
 * Below `lg`, the dock is hidden by default and only rendered as a fixed
 * overlay (with backdrop) when `mobileOpen` is true, toggled from a button in
 * the canvas header. At `lg` and above it renders as the static column.
 */
export function DuneDock({
  projectId,
  articleId,
  articleTitle,
  targetKeyword,
  metaTitle,
  metaDesc,
  onMetaTitleChange,
  onMetaTitleBlur,
  onMetaDescChange,
  onMetaDescBlur,
  breakdown,
  body,
  onBodyChange,
  onInsert,
  onApplyRevision,
  mobileOpen = false,
  onCloseMobile,
}: DuneDockProps) {
  const { t } = useTranslation();
  const dune = FENNEX_AGENTS.dune;
  const [tab, setTab] = useState<DockTab>("assistant");

  const tabs: DockTab[] = ["assistant", "optimize", "checks", "meta"];

  const content = (
    <>
      {/* Header — Dune identity */}
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3.5">
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl gradient-brand glow-primary">
          <dune.Icon className="h-4 w-4 text-white" strokeWidth={1.9} />
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-card" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{dune.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{t("articleStudio.dock.subtitle")}</p>
        </div>
        {onCloseMobile && (
          <button
            onClick={onCloseMobile}
            className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors lg:hidden"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Segmented tab control — active tab expands to show its label */}
      <div className="px-3 pt-3">
        <div className="flex gap-1 rounded-xl border border-border bg-muted/40 p-1">
          {tabs.map((tabKey) => {
            const Icon = TAB_ICONS[tabKey];
            const active = tab === tabKey;
            return (
              <button
                key={tabKey}
                onClick={() => setTab(tabKey)}
                title={t(`articleStudio.dock.tabs.${tabKey}`)}
                aria-label={t(`articleStudio.dock.tabs.${tabKey}`)}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-medium transition-all ${
                  active
                    ? "flex-1 bg-card px-2.5 text-primary shadow-sm ring-1 ring-primary/20"
                    : "shrink-0 px-2 text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {active && (
                  <span className="truncate">{t(`articleStudio.dock.tabs.${tabKey}`)}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "assistant" && (
          <AssistantTab
            articleId={articleId}
            body={body}
            onInsert={onInsert}
            onApplyRevision={onApplyRevision}
          />
        )}
        {tab === "checks" && (
          <ChecksTab articleId={articleId} body={body} onBodyChange={onBodyChange} />
        )}
        {tab === "optimize" && (
          <OptimizePanel projectId={projectId} articleId={articleId} targetKeyword={targetKeyword} />
        )}
        {tab === "meta" && (
          <MetaTab
            articleTitle={articleTitle}
            targetKeyword={targetKeyword}
            metaTitle={metaTitle}
            metaDesc={metaDesc}
            onMetaTitleChange={onMetaTitleChange}
            onMetaTitleBlur={onMetaTitleBlur}
            onMetaDescChange={onMetaDescChange}
            onMetaDescBlur={onMetaDescBlur}
            breakdown={breakdown}
          />
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Desktop: static column, always visible at lg+ */}
      <aside className="glass hidden w-[340px] shrink-0 flex-col overflow-hidden lg:flex">
        {content}
      </aside>

      {/* Mobile/narrow: overlay drawer, shown only when toggled open */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex justify-end lg:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
            onClick={onCloseMobile}
          />
          <aside className="glass animate-scale-in relative z-10 flex h-full w-[340px] max-w-[90vw] origin-right flex-col overflow-hidden">
            {content}
          </aside>
        </div>
      )}
    </>
  );
}
