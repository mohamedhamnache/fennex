"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import {
  LayoutDashboard, SearchCode, FileText, Zap, Share2, ImagePlus, Send,
  Link2, BarChart2, Settings, LogOut, ChevronDown, Plus, Check, Mic2,
  PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { authLogout, listProjects } from "@/lib/api";
import { useProjectStore } from "@/lib/store";
import { CreateProjectModal } from "@/components/projects/CreateProjectModal";
import { cn } from "@/lib/cn";

const navGroups = [
  {
    label: "Research",
    items: [
      { label: "Overview", href: "overview", icon: LayoutDashboard },
      { label: "Keywords", href: "keywords", icon: SearchCode },
    ],
  },
  {
    label: "Create",
    items: [
      { label: "Planner", href: "content", icon: FileText },
      { label: "Articles", href: "articles", icon: Zap },
      { label: "Social", href: "social", icon: Share2 },
      { label: "Images", href: "images", icon: ImagePlus },
    ],
  },
  {
    label: "Grow",
    items: [
      { label: "Publishing", href: "publishing", icon: Send },
      { label: "Backlinks", href: "backlinks", icon: Link2 },
      { label: "Analytics", href: "analytics", icon: BarChart2 },
      { label: "Audit", href: "audit", icon: SearchCode },
    ],
  },
];

function projectInitials(name?: string) {
  if (!name) return "—";
  return name.split(" ").map((w) => w[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
}

export function Sidebar() {
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
          "relative z-20 flex h-full shrink-0 flex-col border-r border-white/[0.06] bg-[hsl(224_56%_4%/0.7)] backdrop-blur-xl transition-[width] duration-200 ease-out",
          expanded ? "w-[244px]" : "w-[72px]",
        )}
      >
        {/* Logo + pin */}
        <div className="flex h-[60px] items-center gap-2.5 border-b border-white/[0.06] px-[18px]">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl gradient-brand glow-primary">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-white" aria-hidden="true">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          {expanded && (
            <>
              <span className="font-display text-[16px] font-bold tracking-tight text-white">Fennex</span>
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

        {/* Workspace switcher */}
        <div className="relative px-3 py-3">
          {projects.length === 0 ? (
            <button
              onClick={() => setModalOpen(true)}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl border border-dashed border-white/15 text-white/45 transition-all hover:border-white/30 hover:text-white/70",
                expanded ? "px-3 py-2" : "justify-center p-2.5",
              )}
            >
              <Plus className="h-4 w-4 shrink-0" />
              {expanded && <span className="text-xs">Create project</span>}
            </button>
          ) : (
            <>
              <button
                onClick={() => expanded && setDropdownOpen((o) => !o)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] transition-all hover:bg-white/[0.06]",
                  expanded ? "px-2.5 py-2" : "justify-center p-1.5",
                )}
                title={!expanded ? currentProject?.name : undefined}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg gradient-brand text-[11px] font-bold text-white">
                  {projectInitials(currentProject?.name)}
                </span>
                {expanded && (
                  <>
                    <span className="flex-1 truncate text-left text-[13px] font-medium text-white/85">
                      {currentProject?.name ?? "Select project"}
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
                      <Plus className="h-3.5 w-3.5" /> New project
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 py-1">
          {navGroups.map((group) => (
            <div key={group.label}>
              {expanded ? (
                <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25">{group.label}</p>
              ) : (
                <div className="mx-2 mb-1.5 h-px bg-white/[0.06]" />
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const href = currentProject ? `/${currentProject.id}/${item.href}` : "#";
                  const active = !!currentProject &&
                    (pathname === href || pathname.startsWith(`/${currentProject.id}/${item.href}`));
                  return (
                    <li key={item.href}>
                      <Link
                        href={href}
                        title={!expanded ? item.label : undefined}
                        className={cn(
                          "group relative flex items-center rounded-xl text-[13px] font-medium transition-all",
                          expanded ? "gap-3 px-2.5 py-2" : "justify-center p-2.5",
                          active
                            ? "bg-primary/15 text-primary"
                            : "text-white/55 hover:bg-white/[0.05] hover:text-white/90",
                          !currentProject && "pointer-events-none opacity-30",
                        )}
                      >
                        {active && (
                          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
                        )}
                        <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2.2 : 1.8} />
                        {expanded && <span className="truncate">{item.label}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="space-y-0.5 border-t border-white/[0.06] px-3 py-3">
          {[
            { href: "/brand-voice", label: "Brand Voice", icon: Mic2 },
            { href: "/settings", label: "Settings", icon: Settings },
          ].map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={!expanded ? item.label : undefined}
                className={cn(
                  "flex items-center rounded-xl text-[13px] font-medium transition-all",
                  expanded ? "gap-3 px-2.5 py-2" : "justify-center p-2.5",
                  active ? "bg-primary/15 text-primary" : "text-white/55 hover:bg-white/[0.05] hover:text-white/90",
                )}
              >
                <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
                {expanded && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
          <button
            onClick={handleLogout}
            title={!expanded ? "Sign out" : undefined}
            className={cn(
              "flex w-full items-center rounded-xl text-[13px] font-medium text-white/45 transition-all hover:bg-destructive/15 hover:text-destructive",
              expanded ? "gap-3 px-2.5 py-2" : "justify-center p-2.5",
            )}
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
            {expanded && <span className="truncate">Sign out</span>}
          </button>
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
