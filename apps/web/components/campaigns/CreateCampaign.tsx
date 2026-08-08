"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, X } from "lucide-react";
import {
  campaignPersona, campaignTemplates, createCampaign, type CampaignTemplate,
} from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

/**
 * "Create campaign with AI" — the fewest questions that still produce a real plan.
 *
 * Two answers, then it reads the store. Objective decides what the strategy
 * optimises for; the sentence decides what it is about. Everything else --
 * audience, offer, channels, timeline, KPIs, budget -- comes from the store's own
 * numbers, which is the point: asking the merchant to fill in twelve fields and
 * then generating from those fields is a form with a spinner, not a strategist.
 */

export function CreateCampaign({ projectId, onClose }: {
  projectId: string; onClose: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  // Objectives come from the project's persona. A creator offered "clear
  // inventory" is being shown a product that does not know what they do.
  const { data: persona } = useQuery({
    queryKey: ["campaign-persona", projectId],
    queryFn: () => campaignPersona(projectId),
    staleTime: 600_000,
  });
  const objectives = persona?.objectives ?? [];
  const [objective, setObjective] = useState<string>("");
  const [goal, setGoal] = useState("");
  const [templateKey, setTemplateKey] = useState<string>("");
  const [budget, setBudget] = useState("");

  const { data: templates = [] } = useQuery({
    queryKey: ["campaign-templates", projectId],
    queryFn: () => campaignTemplates(projectId),
    staleTime: 600_000,
  });

  // The first objective this persona offers is the default, once it is known.
  const chosen = objective || objectives[0]?.key || "";

  const create = useMutation({
    mutationFn: () => createCampaign(projectId, {
      goal: goal.trim(),
      objective: chosen,
      template_key: templateKey || undefined,
      with_ai: true,
      budget: budget ? Number(budget) : undefined,
      currency: "EUR",
    }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["campaigns", projectId] });
      qc.invalidateQueries({ queryKey: ["campaign-overview", projectId] });
      onClose();
      router.push(`/${projectId}/campaigns/${c.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function pickTemplate(tpl: CampaignTemplate) {
    const next = templateKey === tpl.key ? "" : tpl.key;
    setTemplateKey(next);
    if (next) {
      setObjective(tpl.objective);
      // The template names the occasion; the merchant still says what it is
      // about. Prefilling the sentence with the template's label would produce
      // a campaign called "Black Friday" with nothing in it about their store.
      if (!goal.trim()) setGoal("");
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-background/70 p-4 backdrop-blur-sm sm:p-8">
      <div className="animate-scale-in w-full max-w-2xl rounded-2xl border border-border bg-card shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-primary" strokeWidth={2} />
              {t("campaigns.create.title", { defaultValue: "Create a campaign with AI" })}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {persona?.measuresRevenue
                ? t("campaigns.create.subtitleSells", {
                    defaultValue: "Two answers. The strategy comes from your store's own numbers, and a team of agents produces the work.",
                  })
                : t("campaigns.create.subtitle", {
                    defaultValue: "Two answers. A team of agents plans the work and produces it.",
                  })}
            </p>
          </div>
          <button onClick={onClose} aria-label={t("common.close", { defaultValue: "Close" })}
                  className="cursor-pointer rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-col gap-5 p-5">
          <div>
            <label className="text-xs font-semibold text-foreground">
              {t("campaigns.create.objective", { defaultValue: "What are you trying to achieve?" })}
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {objectives.map(({ key, brief }) => (
                <button
                  key={key}
                  onClick={() => setObjective(key)}
                  title={brief}
                  aria-pressed={chosen === key}
                  className={cn(
                    "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    chosen === key
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(`campaigns.objective.${key}`, { defaultValue: key.replace(/_/g, " ") })}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="campaign-goal" className="text-xs font-semibold text-foreground">
              {t("campaigns.create.goal", { defaultValue: "In one sentence, what is it about?" })}
            </label>
            <textarea
              id="campaign-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              placeholder={persona?.measuresRevenue
                ? t("campaigns.create.goalPlaceholderSells", {
                    defaultValue: "Sell more of our best-selling product this month",
                  })
                : t("campaigns.create.goalPlaceholder", {
                    defaultValue: "Reach more people who care about what we make",
                  })}
              className="mt-2 w-full resize-none rounded-xl border border-border bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>

          {templates.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-foreground">
                {t("campaigns.create.template", { defaultValue: "Start from a known shape (optional)" })}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {templates.map((tpl) => (
                  <button
                    key={tpl.key}
                    onClick={() => pickTemplate(tpl)}
                    aria-pressed={templateKey === tpl.key}
                    title={tpl.description}
                    className={cn(
                      "cursor-pointer rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors",
                      templateKey === tpl.key
                        ? "border-foreground/25 bg-foreground/5 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(`campaigns.template.${tpl.key}`, { defaultValue: tpl.label })}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="campaign-budget" className="text-xs font-semibold text-foreground">
              {t("campaigns.create.budget", { defaultValue: "Budget (optional)" })}
            </label>
            <input
              id="campaign-budget"
              type="number"
              min={0}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="600"
              className="mt-2 w-40 rounded-xl border border-border bg-background px-3 py-2 text-sm tabular-nums text-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              {t("campaigns.create.budgetHint", {
                defaultValue: "If you set one, the plan works within it. If not, it will suggest one and say what the suggestion rests on.",
              })}
            </p>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border p-4">
          <button onClick={onClose}
                  className="cursor-pointer rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
            {t("common.cancel", { defaultValue: "Cancel" })}
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={!goal.trim() || !chosen || create.isPending}
            className="flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-default disabled:opacity-50"
          >
            {create.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Sparkles className="h-3.5 w-3.5" />}
            {create.isPending
              ? t("campaigns.create.working", { defaultValue: "Reading your store…" })
              : t("campaigns.create.submit", { defaultValue: "Build the campaign" })}
          </button>
        </footer>
      </div>
    </div>
  );
}
