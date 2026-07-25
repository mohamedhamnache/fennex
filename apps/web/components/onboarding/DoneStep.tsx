"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { CheckCircle2 } from "lucide-react";

export function DoneStep({ projectId }: { projectId: string }) {
  const { t } = useTranslation();

  const tasks = [
    { key: "onboarding.done.article", href: `/${projectId}/articles` },
    { key: "onboarding.done.competitors", href: `/${projectId}/seo` },
    { key: "onboarding.done.instagram", href: `/${projectId}/social` },
    { key: "onboarding.done.roadmap", href: `/${projectId}/seo` },
  ];

  return (
    <div className="animate-fade-in text-center">
      <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
      <h2 className="mt-4 text-2xl font-bold text-foreground">{t("onboarding.done.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("onboarding.done.subtitle")}</p>

      <div className="mx-auto mt-6 grid max-w-md grid-cols-2 gap-3">
        {tasks.map((task) => (
          <Link
            key={task.key}
            href={task.href}
            className="rounded-xl border border-border bg-card p-4 text-sm text-foreground transition-colors hover:border-primary/50"
          >
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
