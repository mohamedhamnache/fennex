"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Check, FileText, Search, Sparkles, TrendingUp } from "lucide-react";

export function DoneStep({ projectId }: { projectId: string }) {
  const { t } = useTranslation();

  const tasks = [
    { key: "onboarding.done.article", href: `/${projectId}/articles`, icon: FileText },
    { key: "onboarding.done.competitors", href: `/${projectId}/seo`, icon: Search },
    { key: "onboarding.done.instagram", href: `/${projectId}/social`, icon: Sparkles },
    { key: "onboarding.done.roadmap", href: `/${projectId}/seo`, icon: TrendingUp },
  ];

  return (
    <div className="animate-fade-in text-center">
      <span className="mx-auto inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
        {t("onboarding.done.badge")}
      </span>

      <div className="mx-auto mt-5 flex h-16 w-16 items-center justify-center rounded-2xl gradient-brand glow-primary animate-scale-in">
        <Check className="h-9 w-9 text-primary-foreground" strokeWidth={2.5} />
      </div>

      <h2 className="mt-5 font-display text-3xl font-bold text-foreground">{t("onboarding.done.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("onboarding.done.subtitle")}</p>

      <div className="mx-auto mt-8 grid max-w-md grid-cols-2 gap-3">
        {tasks.map((task, i) => (
          <Link
            key={task.key}
            href={task.href}
            style={{ animationDelay: `${i * 60}ms` }}
            className="flex flex-col items-start gap-2.5 rounded-xl border border-border bg-card p-4 text-left text-sm text-foreground transition-colors animate-slide-up hover:border-primary/50"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <task.icon className="h-4 w-4" />
            </span>
            {t(task.key)}
          </Link>
        ))}
      </div>

      <Link href={`/${projectId}/overview`} className="btn-primary mt-8 inline-block px-6 py-2.5 text-sm">
        {t("onboarding.done.dashboard")}
      </Link>
    </div>
  );
}
