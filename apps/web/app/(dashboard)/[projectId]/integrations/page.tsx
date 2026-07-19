"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Plug, Search, Radar, Globe, ShoppingBag, KeyRound, ArrowRight, type LucideIcon,
} from "lucide-react";
import {
  listPublishingConnections, getGscStatus, listSocialConnections, getSeoProviderStatus, listApiKeys,
} from "@/lib/api";
import { LinkedInIcon, InstagramIcon, FacebookIcon, TikTokIcon } from "@/components/studio/SocialIcons";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";

type IconCmp = LucideIcon | ((p: { className?: string }) => JSX.Element);
type ConnState = "connected" | "off" | "soon";

interface HubData {
  gsc?: { is_connected: boolean; google_email: string | null };
  seo?: { connected: boolean; source: string | null };
  publishing?: { id: string }[];
  social?: { platform: string; handle: string | null }[];
  keys?: { provider: string }[];
}

interface Connector {
  id: string;
  group: "search" | "publishing" | "social" | "ai";
  name: string;
  Icon: IconCmp;
  status: (d: HubData) => { state: ConnState; detail?: string };
  href?: (projectId: string) => string; // where to connect/manage
}

const GROUPS: { id: Connector["group"]; icon: LucideIcon }[] = [
  { id: "search", icon: Search },
  { id: "publishing", icon: Globe },
  { id: "social", icon: Plug },
  { id: "ai", icon: KeyRound },
];

const CONNECTORS: Connector[] = [
  {
    id: "gsc", group: "search", name: "Google Search Console", Icon: Search,
    status: (d) => d.gsc?.is_connected
      ? { state: "connected", detail: d.gsc.google_email ?? undefined }
      : { state: "off" },
    href: (p) => `/${p}/analytics`,
  },
  {
    id: "seoProvider", group: "search", name: "SEO data provider", Icon: Radar,
    status: (d) => d.seo?.connected
      ? { state: "connected", detail: d.seo.source ?? undefined }
      : { state: "off" },
    href: () => `/settings`,
  },
  {
    id: "wordpress", group: "publishing", name: "WordPress", Icon: Globe,
    status: (d) => (d.publishing?.length ?? 0) > 0
      ? { state: "connected", detail: `${d.publishing!.length}` }
      : { state: "off" },
    href: (p) => `/${p}/publishing`,
  },
  {
    id: "shopify", group: "publishing", name: "Shopify", Icon: ShoppingBag,
    status: () => ({ state: "soon" }),
  },
  {
    id: "ai", group: "ai", name: "AI providers", Icon: KeyRound,
    status: (d) => (d.keys?.length ?? 0) > 0
      ? { state: "connected", detail: `${d.keys!.length}` }
      : { state: "off" },
    href: () => `/settings`,
  },
  {
    id: "linkedin", group: "social", name: "LinkedIn", Icon: LinkedInIcon,
    status: (d) => {
      const c = d.social?.find((s) => s.platform === "linkedin");
      return c ? { state: "connected", detail: c.handle ?? undefined } : { state: "off" };
    },
    href: (p) => `/${p}/social`,
  },
  { id: "instagram", group: "social", name: "Instagram", Icon: InstagramIcon, status: () => ({ state: "soon" }) },
  { id: "facebook", group: "social", name: "Facebook", Icon: FacebookIcon, status: () => ({ state: "soon" }) },
  { id: "tiktok", group: "social", name: "TikTok", Icon: TikTokIcon, status: () => ({ state: "soon" }) },
];

function ConnectorCard({ c, data, projectId }: { c: Connector; data: HubData; projectId: string }) {
  const { t } = useTranslation();
  const { state, detail } = c.status(data);
  const Icon = c.Icon;

  const badge =
    state === "connected" ? <Badge tone="success" dot>{t("integrations.connected")}</Badge>
    : state === "soon" ? <Badge tone="info">{t("integrations.soon")}</Badge>
    : <Badge tone="neutral">{t("integrations.notConnected")}</Badge>;

  const detailText =
    state === "connected" && detail
      ? (c.id === "wordpress" || c.id === "ai" ? t("integrations.countConnected", { count: Number(detail) }) : detail)
      : "";

  return (
    <div className="glass flex flex-col gap-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/60 text-foreground">
          <Icon className="h-5 w-5" />
        </span>
        {badge}
      </div>
      <div className="min-h-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{c.name}</p>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t(`integrations.desc.${c.id}`)}</p>
        {detailText && <p className="mt-1 truncate text-[11px] text-primary">{detailText}</p>}
      </div>
      {state === "soon" ? (
        <span className="text-xs font-medium text-muted-foreground/60">{t("integrations.soon")}</span>
      ) : c.href ? (
        <Link
          href={c.href(projectId)}
          className={`group inline-flex items-center gap-1.5 text-xs font-semibold ${state === "connected" ? "text-muted-foreground hover:text-foreground" : "text-primary"}`}
        >
          {state === "connected" ? t("integrations.manage") : t("integrations.connect")}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      ) : null}
    </div>
  );
}

export default function IntegrationsPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { t } = useTranslation();

  const { data: publishing } = useQuery({ queryKey: ["publishing-connections", projectId], queryFn: () => listPublishingConnections(projectId), enabled: !!projectId });
  const { data: gsc } = useQuery({ queryKey: ["gsc-status", projectId], queryFn: () => getGscStatus(projectId), enabled: !!projectId });
  const { data: social } = useQuery({ queryKey: ["social-connections"], queryFn: listSocialConnections });
  const { data: seo } = useQuery({ queryKey: ["seo-provider-status", projectId], queryFn: () => getSeoProviderStatus(projectId), enabled: !!projectId });
  const { data: keys } = useQuery({ queryKey: ["api-keys"], queryFn: listApiKeys });

  const data: HubData = { gsc, seo, publishing, social, keys };

  const connectedCount = CONNECTORS.filter((c) => c.status(data).state === "connected").length;
  const liveCount = CONNECTORS.filter((c) => c.status(data).state !== "soon").length;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <PageHeader
        icon={Plug}
        title={t("integrations.title")}
        description={t("integrations.subtitle")}
        breadcrumbs={[{ label: t("nav.overview"), href: `/${projectId}/overview` }, { label: t("integrations.title") }]}
        actions={
          <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground tabular-nums">
            {t("integrations.connectedOf", { count: connectedCount, total: liveCount })}
          </span>
        }
      />

      {GROUPS.map((g) => {
        const items = CONNECTORS.filter((c) => c.group === g.id);
        if (items.length === 0) return null;
        return (
          <section key={g.id} className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <g.icon className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
              {t(`integrations.groups.${g.id}`)}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((c) => (
                <ConnectorCard key={c.id} c={c} data={data} projectId={projectId} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
