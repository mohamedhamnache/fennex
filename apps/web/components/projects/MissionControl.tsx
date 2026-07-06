"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check, ChevronDown, ArrowRight, Rocket,
  PenLine, ShoppingBag, Briefcase, type LucideIcon,
} from "lucide-react";
import {
  getGscStatus, listArticles, listImages, getBrandKit, listPublishingConnections,
  updateProject, listSocialConnections, connectLinkedIn,
  type ProjectPersona,
} from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

interface Mission {
  id: string;
  label: string;
  desc: string;
  href?: string;
  /** Imperative missions (e.g. start an OAuth flow) use an action instead of a link */
  action?: () => void;
  /** undefined = pure "explore" link (no completion tracking) */
  done?: boolean;
}

const PERSONA_META: Record<ProjectPersona, { label: string; Icon: LucideIcon }> = {
  creator: { label: "Content creator", Icon: PenLine },
  ecommerce: { label: "Ecommerce seller", Icon: ShoppingBag },
  freelancer: { label: "Freelancer / business", Icon: Briefcase },
};

export function MissionControl({ projectId, persona }: { projectId: string; persona: ProjectPersona }) {
  const [collapsed, setCollapsed] = useState(false);
  const [personaMenu, setPersonaMenu] = useState(false);
  const queryClient = useQueryClient();

  async function changePersona(p: ProjectPersona) {
    setPersonaMenu(false);
    if (p === persona) return;
    await updateProject(projectId, { persona: p });
    // Keep the analytics studio in sync with the new profile
    localStorage.setItem("fx-analytics-persona", p);
    queryClient.invalidateQueries({ queryKey: ["projects"] });
  }

  const { data: gsc } = useQuery({
    queryKey: ["analytics", "gsc-status", projectId],
    queryFn: () => getGscStatus(projectId),
    staleTime: 30_000,
  });
  const { data: articles = [] } = useQuery({
    queryKey: ["articles", projectId],
    queryFn: () => listArticles(projectId),
    staleTime: 60_000,
  });
  const { data: images = [] } = useQuery({
    queryKey: ["images", projectId],
    queryFn: () => listImages(projectId),
    staleTime: 60_000,
  });
  const { data: brandKit } = useQuery({
    queryKey: ["brand-kit"],
    queryFn: getBrandKit,
    staleTime: 60_000,
  });
  const { data: connections = [] } = useQuery({
    queryKey: ["publishing-connections", projectId],
    queryFn: () => listPublishingConnections(projectId),
    staleTime: 60_000,
  });
  const { data: socialConns = [] } = useQuery({
    queryKey: ["social-connections"],
    queryFn: listSocialConnections,
    staleTime: 60_000,
  });
  const [missionError, setMissionError] = useState<string | null>(null);

  async function startLinkedIn() {
    setMissionError(null);
    try {
      const res = await connectLinkedIn(window.location.pathname);
      window.location.href = res.redirect_url;
    } catch (e) {
      setMissionError(e instanceof Error ? e.message : "Could not start LinkedIn connect.");
    }
  }

  const gscConnected = !!gsc?.is_connected;
  const gscSynced = !!gsc?.last_synced_at;
  const hasArticle = articles.length > 0;
  const hasSocialImage = images.some((i) => i.social_platform);
  const hasProductShot = images.some((i) => i.usage === "product_shot");
  const hasBrandKit = !!(brandKit && ((brandKit.colors?.length ?? 0) > 0 || brandKit.primary_font || brandKit.style_rules));
  const hasStore = connections.length > 0;
  const hasLinkedIn = socialConns.some((c) => c.platform === "linkedin");

  const base = `/${projectId}`;
  const missions: Mission[] =
    persona === "creator"
      ? [
          { id: "gsc", label: "Connect Google Search Console", desc: "See your real traffic, queries and rankings", href: `${base}/analytics`, done: gscConnected },
          { id: "sync", label: "Sync your search data", desc: "Pull 90 days of clicks, impressions and positions", href: `${base}/analytics`, done: gscSynced },
          { id: "article", label: "Generate your first article", desc: "AI-written, SEO-optimized for your niche", href: `${base}/articles`, done: hasArticle },
          { id: "social", label: "Create a multi-platform social set", desc: "One topic — every format, sized and captioned", href: `${base}/images/studio?mode=create&intent=social`, done: hasSocialImage },
          { id: "market", label: "Discover what your audience searches", desc: "Topic clusters and content ideas from real demand", href: `${base}/analytics?ws=market` },
        ]
      : persona === "ecommerce"
      ? [
          { id: "store", label: "Connect your store", desc: "Publish images and content straight to Shopify / WordPress", href: `${base}/publishing`, done: hasStore },
          { id: "gsc", label: "Connect Google Search Console", desc: "Track buyer-intent queries and product rankings", href: `${base}/analytics`, done: gscConnected },
          { id: "sync", label: "Sync your search data", desc: "Real clicks, impressions and positions for your store", href: `${base}/analytics`, done: gscSynced },
          { id: "product", label: "Shoot a product photo with AI", desc: "Studio & lifestyle scenes from one upload", href: `${base}/images/studio?mode=create&intent=product`, done: hasProductShot },
          { id: "market", label: "Study your market", desc: "Commercial queries, comparisons and competitor scans", href: `${base}/analytics?ws=market` },
        ]
      : [
          { id: "gsc", label: "Connect Google Search Console", desc: "Ground your market analysis in real data", href: `${base}/analytics`, done: gscConnected },
          { id: "sync", label: "Sync & size the market", desc: "Demand, topics and niche gaps from real searches", href: `${base}/analytics`, done: gscSynced },
          { id: "linkedin", label: "Connect LinkedIn", desc: "Publish outreach posts to your feed with one click", action: startLinkedIn, done: hasLinkedIn },
          { id: "brand", label: "Set up your brand kit", desc: "Colors and fonts applied across everything you create", href: `/settings`, done: hasBrandKit },
          { id: "competitor", label: "Run a competitor scan", desc: "Crawl a rival page and find the gaps to win", href: `${base}/analytics?ws=competitors` },
          { id: "outreach", label: "Create LinkedIn outreach content", desc: "Posts and visuals that attract your target clients", href: `${base}/images/studio?mode=create&intent=social`, done: hasSocialImage },
        ];

  const trackable = missions.filter((m) => m.done !== undefined);
  const doneCount = trackable.filter((m) => m.done).length;
  const allDone = trackable.length > 0 && doneCount === trackable.length;
  const meta = PERSONA_META[persona];

  return (
    <Card className="overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setCollapsed((v) => !v); }}
        className="flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left"
      >
        <div className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          allDone ? "bg-success/12 text-success" : "bg-primary/12 text-primary",
        )}>
          {allDone ? <Check className="h-4.5 w-4.5" strokeWidth={2.2} /> : <Rocket className="h-4 w-4" strokeWidth={1.9} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {allDone ? "Setup complete — you're flying" : "Get set up"}
          </p>
          <span className="relative flex items-center gap-1.5 text-xs text-muted-foreground">
            <meta.Icon className="h-3 w-3" /> {meta.label}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setPersonaMenu((v) => !v); }}
              className="text-primary hover:underline"
            >
              change
            </button>
            · {doneCount}/{trackable.length} missions done
            {personaMenu && (
              <span
                className="absolute left-0 top-6 z-20 flex w-52 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                {(Object.keys(PERSONA_META) as ProjectPersona[]).map((p) => {
                  const M = PERSONA_META[p];
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => changePersona(p)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent",
                        p === persona ? "font-semibold text-primary" : "text-foreground",
                      )}
                    >
                      <M.Icon className="h-3.5 w-3.5" /> {M.label}
                      {p === persona && <Check className="ml-auto h-3 w-3" />}
                    </button>
                  );
                })}
              </span>
            )}
          </span>
        </div>
        {/* Progress */}
        <div className="hidden w-32 sm:block">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-all", allDone ? "bg-success" : "bg-primary")}
              style={{ width: `${trackable.length ? Math.max(4, (doneCount / trackable.length) * 100) : 0}%` }}
            />
          </div>
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", !collapsed && "rotate-180")} />
      </div>

      {!collapsed && (
        <div className="border-t border-border">
          {missions.map((m) => {
            const inner = (
              <>
                {m.done === undefined ? (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <ArrowRight className="h-3 w-3" />
                  </span>
                ) : m.done ? (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success text-white">
                    <Check className="h-3 w-3" strokeWidth={2.5} />
                  </span>
                ) : (
                  <span className="h-5 w-5 shrink-0 rounded-full border-2 border-border transition-colors group-hover:border-primary" />
                )}
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium", m.done ? "text-muted-foreground line-through decoration-border" : "text-foreground")}>
                    {m.label}
                  </p>
                  <p className="text-xs text-muted-foreground">{m.desc}</p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/0 transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
              </>
            );
            const rowClass = "group flex w-full items-center gap-3 border-b border-border px-5 py-3 text-left transition-colors last:border-0 hover:bg-accent/50";
            return m.action ? (
              <button key={m.id} type="button" onClick={m.action} className={rowClass}>
                {inner}
              </button>
            ) : (
              <Link key={m.id} href={m.href!} className={rowClass}>
                {inner}
              </Link>
            );
          })}
          {missionError && (
            <p className="border-t border-border px-5 py-2.5 text-xs text-destructive">{missionError}</p>
          )}
        </div>
      )}
    </Card>
  );
}
