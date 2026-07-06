"use client";

import { Share2, ShoppingBag, Newspaper, Megaphone, Wand2, ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type CreateIntent = "social" | "product" | "blog" | "banner" | "freeform";

interface IntentDef {
  id: CreateIntent;
  label: string;
  desc: string;
  Icon: LucideIcon;
  featured?: boolean;
}

const INTENTS: IntentDef[] = [
  {
    id: "social",
    label: "Social post",
    desc: "Platform-ready posts, stories & reels — one voice, every size, captions included.",
    Icon: Share2,
    featured: true,
  },
  {
    id: "product",
    label: "Product shot",
    desc: "Studio & lifestyle photography for Shopify and WordPress, export-ready.",
    Icon: ShoppingBag,
    featured: true,
  },
  {
    id: "blog",
    label: "Blog image",
    desc: "Article covers and inline visuals with SEO alt-text baked in.",
    Icon: Newspaper,
    featured: true,
  },
  {
    id: "banner",
    label: "Banner / Ad",
    desc: "Marketing banners and ad creatives that convert.",
    Icon: Megaphone,
  },
  {
    id: "freeform",
    label: "Free-form",
    desc: "Describe anything and generate — full control over style and quality.",
    Icon: Wand2,
  },
];

interface CreateLauncherProps {
  onPick: (intent: CreateIntent) => void;
}

export function CreateLauncher({ onPick }: CreateLauncherProps) {
  const featured = INTENTS.filter((i) => i.featured);
  const secondary = INTENTS.filter((i) => !i.featured);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-10 animate-fade-in">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-foreground">What are you making?</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pick a goal and we&apos;ll tailor the studio — the right sizes, styles, and export targets.
          </p>
        </div>

        {/* Featured personas */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {featured.map(({ id, label, desc, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onPick(id)}
              className={cn(
                "group relative flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-5 text-left",
                "transition-all hover:border-primary/50 hover:shadow-lg hover:-translate-y-0.5",
              )}
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <Icon className="h-5 w-5" strokeWidth={1.8} />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{label}</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{desc}</p>
              </div>
              <ArrowRight className="absolute top-5 right-5 h-4 w-4 text-muted-foreground/0 group-hover:text-primary transition-all group-hover:translate-x-0.5" />
            </button>
          ))}
        </div>

        {/* Secondary options */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {secondary.map(({ id, label, desc, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onPick(id)}
              className={cn(
                "group flex items-center gap-4 rounded-2xl border border-border bg-card p-4 text-left",
                "transition-all hover:border-primary/50 hover:shadow-md",
              )}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                <Icon className="h-5 w-5" strokeWidth={1.8} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">{label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{desc}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
