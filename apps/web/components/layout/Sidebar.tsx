"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
} from "lucide-react";
import { authLogout } from "@/lib/api";
import { useRouter } from "next/navigation";

const navGroups = [
  {
    label: "Research",
    items: [
      { label: "Overview",   href: "/",          icon: LayoutDashboard },
      { label: "Keywords",   href: "/keywords",  icon: SearchCode },
    ],
  },
  {
    label: "Content",
    items: [
      { label: "Planner",    href: "/content",   icon: FileText },
      { label: "Articles",   href: "/articles",  icon: Zap },
      { label: "Social",     href: "/social",    icon: Share2 },
      { label: "Images",     href: "/images",    icon: ImagePlus },
    ],
  },
  {
    label: "Growth",
    items: [
      { label: "Publishing", href: "/publishing",icon: Send },
      { label: "Backlinks",  href: "/backlinks", icon: Link2 },
      { label: "Analytics",  href: "/analytics", icon: BarChart2 },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  function handleLogout() {
    authLogout();
    router.replace("/login");
  }

  return (
    <aside className="flex h-full w-56 flex-col border-r border-border bg-card">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/20 ring-1 ring-primary/25">
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-primary" aria-hidden="true">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-foreground">Fennex</span>
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
                const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                        active
                          ? "nav-active text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      <item.icon className="h-[15px] w-[15px] shrink-0" strokeWidth={active ? 2.2 : 1.8} />
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
  );
}
