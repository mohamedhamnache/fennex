"use client";

import Link from "next/link";
import { Sparkles, Share2, ShoppingBag, Newspaper, Pencil, ArrowRight, type LucideIcon } from "lucide-react";

interface QuickAction {
  label: string;
  desc: string;
  href: string;
  Icon: LucideIcon;
}

export function StudioQuickStart({ projectId }: { projectId: string }) {
  const base = `/${projectId}/images/studio`;

  const actions: QuickAction[] = [
    { label: "Social post", desc: "Every platform, sized + captioned", href: `${base}?mode=create&intent=social`, Icon: Share2 },
    { label: "Product shot", desc: "Studio & lifestyle sets", href: `${base}?mode=create&intent=product`, Icon: ShoppingBag },
    { label: "Blog image", desc: "Covers & inline, SEO-ready", href: `${base}?mode=create&intent=blog`, Icon: Newspaper },
    { label: "Edit an image", desc: "Upload & retouch", href: `${base}?mode=edit`, Icon: Pencil },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
      {/* Featured: AI Studio */}
      <Link
        href={`${base}?mode=ai`}
        className="group relative lg:col-span-1 overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-primary/80 p-4 text-primary-foreground shadow-sm transition-all hover:shadow-lg hover:-translate-y-0.5 flex flex-col justify-between min-h-[104px]"
      >
        <div className="flex items-center justify-between">
          <Sparkles className="h-5 w-5" strokeWidth={1.9} />
          <ArrowRight className="h-4 w-4 opacity-70 transition-transform group-hover:translate-x-0.5" />
        </div>
        <div>
          <p className="text-sm font-semibold">AI Studio</p>
          <p className="text-[11px] opacity-90 leading-tight">Plan a full campaign</p>
        </div>
      </Link>

      {/* Persona quick actions */}
      {actions.map(({ label, desc, href, Icon }) => (
        <Link
          key={label}
          href={href}
          className="group relative overflow-hidden rounded-2xl border border-border bg-card p-4 transition-all hover:border-primary/50 hover:shadow-md hover:-translate-y-0.5 flex flex-col justify-between min-h-[104px]"
        >
          <div className="flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <Icon className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground/0 transition-all group-hover:text-primary group-hover:translate-x-0.5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{label}</p>
            <p className="text-[11px] text-muted-foreground leading-tight">{desc}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
