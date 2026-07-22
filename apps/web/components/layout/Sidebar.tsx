"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import {
  LayoutDashboard, SearchCode, FileText, Zap, Share2, ImagePlus, Send,
  Link2, BarChart2, Settings, LogOut, ChevronDown, Plus, Check, Mic2,
  PanelLeftClose, PanelLeftOpen, Sparkles, CalendarDays, Megaphone, Home,
  TrendingUp, Plug, type LucideIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FennecMark } from "@fennex/ui";
import { authLogout, listProjects } from "@/lib/api";
import { useProjectStore } from "@/lib/store";
import { CreateProjectModal } from "@/components/projects/CreateProjectModal";
import { cn } from "@/lib/cn";

function projectInitials(name?: string) {
  if (!name) return "—";
  return name.split(" ").map((w) => w[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
}

type NavItem = { key: string; href: string; icon: LucideIcon };

// All destinations, defined once. `key` is the i18n suffix (nav.<key>); it
// matches the href slug except for `content`, whose translation key is `planner`.
const NAV_ITEMS: Record<string, NavItem> = {
  overview:   { key: "overview",   href: "overview",   icon: LayoutDashboard },
  calendar:   { key: "calendar",   href: "calendar",   icon: CalendarDays },
  agents:     { key: "agents",     href: "agents",     icon: Sparkles },
  campaigns:  { key: "campaigns",  href: "campaigns",  icon: Megaphone },
  keywords:   { key: "keywords",   href: "keywords",   icon: SearchCode },
  content:    { key: "planner",    href: "content",    icon: FileText },
  articles:   { key: "articles",   href: "articles",   icon: Zap },
  social:     { key: "social",     href: "social",     icon: Share2 },
  images:     { key: "images",     href: "images",     icon: ImagePlus },
  publishing: { key: "publishing", href: "publishing", icon: Send },
  backlinks:  { key: "backlinks",  href: "backlinks",  icon: Link2 },
  analytics:  { key: "analytics",  href: "analytics",  icon: BarChart2 },
  seo:        { key: "seo",        href: "seo",        icon: TrendingUp },
  audit:      { key: "audit",      href: "audit",      icon: SearchCode },
  integrations: { key: "integrations", href: "integrations", icon: Plug },
};

// Persona -> primary tool order (the highlighted "For you" group).
const PERSONA_PRIMARY: Record<string, string[]> = {
  creator:    ["overview", "calendar", "articles", "social", "images", "agents", "campaigns", "analytics", "seo", "integrations"],
  ecommerce:  ["overview", "calendar", "images", "integrations", "analytics", "seo", "agents", "campaigns", "keywords"],
  freelancer: ["overview", "calendar", "agents", "campaigns", "analytics", "seo", "social", "integrations", "backlinks"],
  company:    ["overview", "articles", "seo", "campaigns", "social", "analytics", "agents", "keywords", "integrations"],
};

function personaNav(persona: string): { primary: NavItem[]; more: NavItem[] } {
  const order = PERSONA_PRIMARY[persona] ?? PERSONA_PRIMARY.creator;
  const primaryKeys = new Set(order);
  const primary = order.map((k) => NAV_ITEMS[k]);
  const more = Object.keys(NAV_ITEMS).filter((k) => !primaryKeys.has(k)).map((k) => NAV_ITEMS[k]);
  return { primary, more };
}

/** One rail row — shared by Home, the persona nav, and the footer so the
 *  active/hover/press treatment is identical everywhere. */
function RailLink({
  href, label, icon: Icon, active, expanded, danger = false, onClick,
}: {
  href?: string; label: string; icon: LucideIcon; active?: boolean;
  expanded: boolean; danger?: boolean; onClick?: () => void;
}) {
  const cls = cn(
    "group relative flex w-full items-center rounded-xl text-[13px] font-medium transition-all duration-150 active:scale-[0.98]",
    expanded ? "gap-3 px-2.5 py-2" : "justify-center p-2.5",
    danger
      ? "text-white/45 hover:bg-destructive/15 hover:text-destructive"
      : active
        ? "rail-active text-primary"
        : "text-white/55 hover:bg-white/[0.05] hover:text-white/90",
  );
  const inner = (
    <>
      {active && !danger && (
        <span className="rail-marker absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full" />
      )}
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2.2 : 1.8} />
      {expanded && <span className="truncate">{label}</span>}
    </>
  );
  if (onClick && !href) {
    return <button type="button" onClick={onClick} title={!expanded ? label : undefined} className={cls}>{inner}</button>;
  }
  return (
    <Link href={href ?? "#"} onClick={onClick} title={!expanded ? label : undefined} className={cls}>
      {inner}
    </Link>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const router = useRouter();
  const { currentProjectId, setCurrentProject } = useProjectStore();

  const [pinned, setPinned] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Restore pin preference
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("fennex-rail-pinned");
    if (saved !== null) setPinned(saved === "1");
  }, []);

  function togglePin() {
    setPinned((p) => {
      localStorage.setItem("fennex-rail-pinned", p ? "0" : "1");
      return !p;
    });
  }

  const expanded = pinned || hovered;

  const { data: projects = [], refetch } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 30_000,
  });

  const currentProject = projects.find((p) => p.id === currentProjectId) ?? projects[0] ?? null;

  const persona = currentProject?.persona ?? "creator";
  const { primary, more } = personaNav(persona);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem("fennex-nav-more");
    if (saved !== null) setMoreOpen(saved === "1");
  }, []);
  function toggleMore() {
    setMoreOpen((o) => { localStorage.setItem("fennex-nav-more", o ? "0" : "1"); return !o; });
  }

  function navItemProps(item: NavItem) {
    const href = currentProject ? `/${currentProject.id}/${item.href}` : undefined;
    const active = !!currentProject &&
      (pathname === href || pathname.startsWith(`/${currentProject.id}/${item.href}`));
    return { href, active, label: t(`nav.${item.key}`), icon: item.icon };
  }

  function handleLogout() {
    authLogout();
    router.replace("/login");
  }

  function handleSelectProject(id: string) {
    setCurrentProject(id);
    setDropdownOpen(false);
    router.push(`/${id}/overview`);
  }

  return (
    <>
      <aside
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); setDropdownOpen(false); }}
        className={cn(
          "rail-surface relative z-20 flex h-full shrink-0 flex-col border-r border-white/[0.06] backdrop-blur-xl transition-[width] duration-200 ease-out",
          expanded ? "w-[248px]" : "w-[72px]",
        )}
      >
        {/* Logo + pin */}
        <div className="flex h-[60px] items-center gap-2.5 px-[18px]">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl gradient-brand glow-primary">
            <FennecMark className="h-5 w-5 brightness-0 invert" />
          </div>
          {expanded && (
            <>
              <span className="font-display text-[17px] font-bold tracking-tight text-white">Fennex</span>
              {mounted && (
                <button
                  onClick={togglePin}
                  className="ml-auto rounded-md p-1 text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/70"
                  title={pinned ? "Collapse rail" : "Pin rail open"}
                >
                  {pinned ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                </button>
              )}
            </>
          )}
        </div>
        <div className="rail-divider mx-[18px]" />

        {/* Workspace switcher */}
        <div className="relative px-3 py-3">
          {projects.length === 0 ? (
            <button
              onClick={() => setModalOpen(true)}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl border border-dashed border-white/15 text-white/45 transition-all hover:border-primary/40 hover:text-white/80",
                expanded ? "px-3 py-2.5" : "justify-center p-2.5",
              )}
            >
              <Plus className="h-4 w-4 shrink-0" />
              {expanded && <span className="text-xs">{t("nav.createProject")}</span>}
            </button>
          ) : (
            <>
              <button
                onClick={() => expanded && setDropdownOpen((o) => !o)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] transition-all hover:border-white/15 hover:bg-white/[0.06]",
                  expanded ? "px-2.5 py-2" : "justify-center p-1.5",
                  dropdownOpen && "border-primary/40 bg-white/[0.06]",
                )}
                title={!expanded ? currentProject?.name : undefined}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg gradient-brand text-[11px] font-bold text-white shadow-sm">
                  {projectInitials(currentProject?.name)}
                </span>
                {expanded && (
                  <>
                    <span className="flex min-w-0 flex-1 flex-col items-start leading-tight">
                      <span className="w-full truncate text-left text-[13px] font-semibold text-white/90">
                        {currentProject?.name ?? t("nav.selectProject")}
                      </span>
                      {currentProject && (
                        <span className="truncate text-[10px] font-medium uppercase tracking-wider text-white/35">
                          {persona}
                        </span>
                      )}
                    </span>
                    <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-white/30 transition-transform", dropdownOpen && "rotate-180")} />
                  </>
                )}
              </button>

              {dropdownOpen && expanded && (
                <div className="popover absolute left-3 right-3 top-full z-30 mt-1.5 animate-scale-in p-1.5">
                  <div className="max-h-56 overflow-y-auto">
                    {projects.map((project) => (
                      <button
                        key={project.id}
                        onClick={() => handleSelectProject(project.id)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors",
                          project.id === currentProject?.id ? "bg-primary/15 text-primary" : "text-foreground/70 hover:bg-white/[0.05]",
                        )}
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-[10px] font-bold">
                          {projectInitials(project.name)}
                        </span>
                        <span className="flex-1 truncate">{project.name}</span>
                        {project.id === currentProject?.id && <Check className="h-3.5 w-3.5 shrink-0" />}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1 border-t border-white/[0.06] pt-1">
                    <button
                      onClick={() => { setDropdownOpen(false); setModalOpen(true); }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-primary transition-colors hover:bg-primary/10"
                    >
                      <Plus className="h-3.5 w-3.5" /> {t("nav.newProject")}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 py-1">
          {/* Home — the global dashboard at "/" (distinct from a project's Overview) */}
          <ul className="space-y-0.5">
            <li>
              <RailLink href="/" label={t("nav.home")} icon={Home} active={pathname === "/"} expanded={expanded} />
            </li>
          </ul>

          {/* For you */}
          <div>
            {expanded ? (
              <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/70">{t("nav.forYou")}</p>
            ) : (
              <div className="rail-divider mx-2 mb-1.5" />
            )}
            <ul className="space-y-0.5">
              {primary.map((item) => {
                const p = navItemProps(item);
                return (
                  <li key={item.href} className={!currentProject ? "pointer-events-none opacity-30" : undefined}>
                    <RailLink {...p} expanded={expanded} />
                  </li>
                );
              })}
            </ul>
          </div>

          {/* More tools */}
          <div>
            {expanded && (
              <button
                onClick={toggleMore}
                className="mb-1.5 flex w-full items-center gap-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30 transition-colors hover:text-white/55"
              >
                {t("nav.moreTools")} <ChevronDown className={cn("h-3 w-3 transition-transform", moreOpen && "rotate-180")} />
              </button>
            )}
            {(moreOpen || !expanded) && (
              <ul className="space-y-0.5">
                {more.map((item) => {
                  const p = navItemProps(item);
                  return (
                    <li key={item.href} className={!currentProject ? "pointer-events-none opacity-30" : undefined}>
                      <RailLink {...p} expanded={expanded} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </nav>

        {/* Footer */}
        <div className="rail-divider mx-[18px]" />
        <div className="space-y-0.5 px-3 py-3">
          {[
            { href: "/brand-voice", label: t("nav.brandVoice"), icon: Mic2 },
            { href: "/settings", label: t("nav.settings"), icon: Settings },
          ].map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <RailLink key={item.href} href={item.href} label={item.label} icon={item.icon} active={active} expanded={expanded} />
            );
          })}
          <RailLink label={t("nav.signOut")} icon={LogOut} expanded={expanded} danger onClick={handleLogout} />
        </div>
      </aside>

      <CreateProjectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => { refetch(); setModalOpen(false); }}
      />
    </>
  );
}
