"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Wand2, ListChecks, Tags } from "lucide-react";
import { FENNEX_AGENTS } from "@/lib/agents";
import { OptimizePanel } from "@/components/seo/OptimizePanel";
import { MetaTab } from "./MetaTab";

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
  targetKeyword: string | null;
  metaTitle: string;
  metaDesc: string;
  onMetaTitleChange: (val: string) => void;
  onMetaTitleBlur: () => void;
  onMetaDescChange: (val: string) => void;
  onMetaDescBlur: () => void;
  breakdown: Record<string, number>;
}

/**
 * Right-hand dock of the article studio — Dune's home base beside the canvas.
 * Tabs: assistant (Task 6+), optimize (existing OptimizePanel), checks
 * (Task 7+), meta (moved meta title/description/breakdown inputs).
 */
export function DuneDock({
  projectId,
  articleId,
  targetKeyword,
  metaTitle,
  metaDesc,
  onMetaTitleChange,
  onMetaTitleBlur,
  onMetaDescChange,
  onMetaDescBlur,
  breakdown,
}: DuneDockProps) {
  const { t } = useTranslation();
  const dune = FENNEX_AGENTS.dune;
  const [tab, setTab] = useState<DockTab>("assistant");

  const tabs: DockTab[] = ["assistant", "optimize", "checks", "meta"];

  return (
    <aside className="glass flex w-[340px] shrink-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl gradient-brand glow-primary shrink-0">
          <dune.Icon className="h-4 w-4 text-white" strokeWidth={1.9} />
        </div>
        <p className="text-sm font-semibold text-foreground truncate">
          {t("articleStudio.dock.title")}
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-white/[0.06] px-2">
        {tabs.map((tabKey) => {
          const Icon = TAB_ICONS[tabKey];
          return (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
                tab === tabKey
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(`articleStudio.dock.tabs.${tabKey}`)}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "assistant" && <ComingSoonCard />}
        {tab === "checks" && <ComingSoonCard />}
        {tab === "optimize" && (
          <OptimizePanel projectId={projectId} articleId={articleId} targetKeyword={targetKeyword} />
        )}
        {tab === "meta" && (
          <MetaTab
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
    </aside>
  );
}

function ComingSoonCard() {
  const { t } = useTranslation();
  return (
    <div className="card-base flex flex-col items-center gap-2 px-4 py-10 text-center">
      <p className="text-sm text-muted-foreground">{t("articleStudio.comingSoon")}</p>
    </div>
  );
}
