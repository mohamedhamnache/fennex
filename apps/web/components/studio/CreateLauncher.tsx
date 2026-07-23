"use client";

import { useTranslation } from "react-i18next";
import { Share2, ShoppingBag, Newspaper, Megaphone, Wand2, ArrowRight, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type CreateIntent = "social" | "product" | "blog" | "banner" | "freeform";

interface IntentDef {
  id: CreateIntent;
  Icon: LucideIcon;
  featured?: boolean;
  /** Icon-chip + accent classes and a soft top glow colour. */
  chip: string;
  glow: string;
  /** Short capability tags (brand/format names — kept literal across locales). */
  tags: string[];
}

const INTENTS: IntentDef[] = [
  { id: "social", Icon: Share2, featured: true, chip: "bg-sky-500/12 text-sky-500", glow: "56 189 248", tags: ["Instagram", "TikTok", "LinkedIn"] },
  { id: "product", Icon: ShoppingBag, featured: true, chip: "bg-amber-500/12 text-amber-500", glow: "245 158 11", tags: ["Shopify", "WordPress", "Lifestyle"] },
  { id: "blog", Icon: Newspaper, featured: true, chip: "bg-primary/12 text-primary", glow: "217 120 72", tags: ["Covers", "Inline", "Alt-text"] },
  { id: "banner", Icon: Megaphone, chip: "bg-rose-500/12 text-rose-500", glow: "244 63 94", tags: ["Ads", "Display", "Promo"] },
  { id: "freeform", Icon: Wand2, chip: "bg-violet-500/12 text-violet-500", glow: "168 85 247", tags: ["Any prompt", "Full control"] },
];

interface CreateLauncherProps {
  onPick: (intent: CreateIntent) => void;
}

export function CreateLauncher({ onPick }: CreateLauncherProps) {
  const { t } = useTranslation();
  const featured = INTENTS.filter((i) => i.featured);
  const secondary = INTENTS.filter((i) => !i.featured);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-10 animate-fade-in">
        {/* Hero */}
        <div className="mb-9 flex flex-col items-center text-center">
          <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl gradient-brand glow-primary">
            <Sparkles className="h-7 w-7 text-white" strokeWidth={1.8} />
          </span>
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">{t("studio.createLauncher.heading")}</h1>
          <p className="mt-2.5 max-w-md text-sm leading-relaxed text-muted-foreground">
            {t("studio.createLauncher.subtitle")}
          </p>
        </div>

        {/* Featured intents */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {featured.map(({ id, Icon, chip, glow, tags }) => (
            <button
              key={id}
              type="button"
              onClick={() => onPick(id)}
              className="group relative flex flex-col items-start gap-3.5 overflow-hidden rounded-2xl border border-border bg-card/60 p-5 text-left transition-all hover:-translate-y-1 hover:border-primary/30 hover:shadow-xl"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{ background: `radial-gradient(120% 80% at 50% -10%, rgb(${glow} / 0.14), transparent 60%)` }}
              />
              <span className={cn("relative flex h-12 w-12 items-center justify-center rounded-2xl transition-transform group-hover:scale-105", chip)}>
                <Icon className="h-6 w-6" strokeWidth={1.8} />
              </span>
              <div className="relative">
                <p className="font-display text-base font-bold text-foreground">{t(`studio.createLauncher.intents.${id}.label`)}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t(`studio.createLauncher.intents.${id}.desc`)}</p>
              </div>
              <div className="relative mt-auto flex flex-wrap gap-1.5 pt-1">
                {tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{tag}</span>
                ))}
              </div>
              <ArrowRight className="absolute right-5 top-5 h-4 w-4 text-muted-foreground/0 transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
            </button>
          ))}
        </div>

        {/* Secondary options */}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {secondary.map(({ id, Icon, chip, tags }) => (
            <button
              key={id}
              type="button"
              onClick={() => onPick(id)}
              className="group flex items-center gap-4 rounded-2xl border border-border bg-card/60 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
            >
              <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105", chip)}>
                <Icon className="h-5 w-5" strokeWidth={1.8} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-sm font-bold text-foreground">{t(`studio.createLauncher.intents.${id}.label`)}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t(`studio.createLauncher.intents.${id}.desc`)}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{tag}</span>
                  ))}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
