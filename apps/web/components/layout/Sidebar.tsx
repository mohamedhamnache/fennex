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
  Mic2,
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
      <aside className="sidebar flex h-full w-56 flex-col">
        {/* Logo */}
        <div className="sidebar-logo-area flex items-center gap-2.5 px-4 py-[14px]">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg gradient-brand shadow-indigo">
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-white" aria-hidden="true">
              <path
                d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-white">Fennex</span>
        </div>

        {/* Project Selector */}
        <div className="relative px-3 py-2.5">
          {projects.length === 0 ? (
            <button
              onClick={() => setModalOpen(true)}
              className="flex w-full items-center gap-2 rounded-lg border border-dashed border-white/15 px-3 py-2 text-xs text-white/40 transition-all hover:border-white/30 hover:text-white/70"
            >
              <Plus className="h-3 w-3 shrink-0" />
              <span>Create project</span>
            </button>
          ) : (
            <div>
              <button
                onClick={() => setDropdownOpen((o) => !o)}
                className="sidebar-project-selector flex w-full items-center gap-2 px-3 py-2 text-xs font-medium"
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                <span className="flex-1 truncate text-left">
                  {currentProject?.name ?? "Select project"}
                </span>
                <ChevronDown
                  className={`h-3 w-3 shrink-0 text-white/30 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              {dropdownOpen && (
                <div className="sidebar-dropdown absolute left-3 right-3 top-full z-30 mt-1">
                  <div className="max-h-48 overflow-y-auto p-1">
                    {projects.map((project) => (
                      <button
                        key={project.id}
                        onClick={() => handleSelectProject(project.id)}
                        className={`sidebar-dropdown-item flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium ${
                          project.id === currentProjectId ? "active" : ""
                        }`}
                      >
                        <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                        <span className="flex-1 truncate">{project.name}</span>
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-white/8 p-1">
                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        setModalOpen(true);
                      }}
                      className="sidebar-dropdown-item flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-indigo-400 hover:text-indigo-300"
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
        <nav className="flex-1 overflow-y-auto px-3 py-1 space-y-4">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="sidebar-group-label mb-1.5 px-2">{group.label}</p>
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
                        className={`sidebar-nav-item flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium ${
                          active ? "active" : ""
                        } ${!currentProject ? "pointer-events-none opacity-30" : ""}`}
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
        <div className="sidebar-footer px-3 py-2 space-y-0.5">
          <Link
            href="/brand-voice"
            className={`sidebar-nav-item flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium ${
              pathname === "/brand-voice" || pathname.startsWith("/brand-voice/") ? "active" : ""
            }`}
          >
            <Mic2 className="h-[15px] w-[15px]" strokeWidth={1.8} />
            Brand Voice
          </Link>
          <Link
            href="/settings"
            className="sidebar-nav-item flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium"
          >
            <Settings className="h-[15px] w-[15px]" strokeWidth={1.8} />
            Settings
          </Link>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium text-white/40 transition-all hover:bg-red-500/10 hover:text-red-400"
          >
            <LogOut className="h-[15px] w-[15px]" strokeWidth={1.8} />
            Sign out
          </button>
        </div>
      </aside>

      <CreateProjectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={handleProjectCreated}
      />
    </>
  );
}
