"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  SearchCode,
  FileText,
  Zap,
  Share2,
  ImagePlus,
  Send,
  Link2,
  BarChart2,
  Settings,
  LogOut,
  ChevronDown,
  Plus,
  FolderOpen,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { authLogout, listProjects } from "@/lib/api";
import { useProjectStore } from "@/lib/store";
import { CreateProjectModal } from "@/components/projects/CreateProjectModal";

const navGroups = [
  {
    label: "Research",
    items: [
      { label: "Overview",   href: "overview",    icon: LayoutDashboard },
      { label: "Keywords",   href: "keywords",    icon: SearchCode },
    ],
  },
  {
    label: "Content",
    items: [
      { label: "Planner",    href: "content",     icon: FileText },
      { label: "Articles",   href: "articles",    icon: Zap },
      { label: "Social",     href: "social",      icon: Share2 },
      { label: "Images",     href: "images",      icon: ImagePlus },
    ],
  },
  {
    label: "Growth",
    items: [
      { label: "Publishing", href: "publishing",  icon: Send },
      { label: "Backlinks",  href: "backlinks",   icon: Link2 },
      { label: "Analytics",  href: "analytics",   icon: BarChart2 },
      { label: "Audit",      href: "audit",       icon: SearchCode },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { currentProjectId, setCurrentProject } = useProjectStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

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

  function handleProjectCreated() {
    refetch();
    setModalOpen(false);
  }

  return (
    <>
      <aside className="flex h-full w-56 flex-col border-r border-border bg-card">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/20 ring-1 ring-primary/25">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-primary" aria-hidden="true">
              <path
                d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-foreground">Fennex</span>
        </div>

        {/* Project Selector */}
        <div className="relative px-2 pb-2">
          {projects.length === 0 ? (
            <button
              onClick={() => setModalOpen(true)}
              className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span>Create your first project →</span>
            </button>
          ) : (
            <div>
              <button
                onClick={() => setDropdownOpen((o) => !o)}
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-accent/50 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="flex-1 truncate text-left text-xs">
                  {currentProject?.name ?? "Select project"}
                </span>
                <ChevronDown
                  className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              {dropdownOpen && (
                <div className="absolute left-2 right-2 top-full z-30 mt-1 rounded-xl border border-border bg-card shadow-md">
                  <div className="max-h-48 overflow-y-auto p-1">
                    {projects.map((project) => (
                      <button
                        key={project.id}
                        onClick={() => handleSelectProject(project.id)}
                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${
                          project.id === currentProjectId
                            ? "bg-primary/10 text-primary"
                            : "text-foreground hover:bg-accent"
                        }`}
                      >
                        <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                        <span className="flex-1 truncate">{project.name}</span>
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-border p-1">
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        setModalOpen(true);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                    >
                      <Plus className="h-3.5 w-3.5 shrink-0" />
                      New project
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-5">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const href = currentProject ? `/${currentProject.id}/${item.href}` : "#";
                  const active =
                    !!currentProject &&
                    (pathname === href ||
                      pathname.startsWith(`/${currentProject.id}/${item.href}`));
                  return (
                    <li key={item.href}>
                      <Link
                        href={href}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                          active
                            ? "nav-active text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        } ${!currentProject ? "pointer-events-none opacity-40" : ""}`}
                      >
                        <item.icon
                          className="h-[15px] w-[15px] shrink-0"
                          strokeWidth={active ? 2.2 : 1.8}
                        />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-border p-2 space-y-0.5">
          <Link
            href="/settings"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
          >
            <Settings className="h-[15px] w-[15px]" strokeWidth={1.8} />
            Settings
          </Link>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-red-500/10 hover:text-red-400"
          >
            <LogOut className="h-[15px] w-[15px]" strokeWidth={1.8} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Create Project Modal */}
      <CreateProjectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleProjectCreated}
      />
    </>
  );
}
