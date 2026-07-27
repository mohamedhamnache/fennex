"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { FennecMark } from "@fennex/ui";
import { cn } from "@/lib/cn";
import { NAV_GROUPS, type NavItem } from "@/lib/nav";

const STORAGE_KEY = "fennex-admin-rail-collapsed";

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * `showLabel` is the *desired* desktop state (the user hasn't collapsed the
 * rail). Labels are always hidden below the `lg` breakpoint via CSS — not a
 * JS media-query check — so there's no hydration mismatch and the rail never
 * overflows a narrow viewport regardless of the persisted preference.
 */
function NavRow({ item, showLabel, active }: { item: NavItem; showLabel: boolean; active: boolean }) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        title={item.label}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex min-h-[40px] w-full cursor-pointer items-center justify-center gap-2.5 rounded-lg p-2.5 text-sm font-medium",
          "transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          showLabel && "lg:justify-start lg:px-2.5 lg:py-2",
          active ? "rail-active text-primary" : "text-white/55 hover:bg-white/[0.05] hover:text-white/90",
        )}
      >
        {active && <span className="rail-marker absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full" />}
        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
        <span className={cn("hidden min-w-0 truncate", showLabel && "lg:inline")}>{item.label}</span>
      </Link>
    </li>
  );
}

export function NavRail() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) setCollapsed(saved === "1");
  }, []);

  function toggle() {
    setCollapsed((c) => {
      localStorage.setItem(STORAGE_KEY, c ? "0" : "1");
      return !c;
    });
  }

  const showLabel = !collapsed;

  return (
    <aside
      className={cn(
        "rail-surface relative z-20 flex h-full shrink-0 flex-col overflow-hidden border-r border-white/[0.06]",
        "motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out",
        collapsed ? "w-16" : "w-16 lg:w-60",
      )}
    >
      <div className="flex h-14 items-center gap-2.5 px-3.5">
        <div className="gradient-brand glow-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
          <FennecMark className="h-5 w-5 brightness-0 invert" />
        </div>
        <span className={cn("hidden truncate font-display text-[15px] font-bold tracking-tight text-white", showLabel && "lg:inline")}>
          Fennex Admin
        </span>
        {mounted && (
          <button
            type="button"
            onClick={toggle}
            className={cn(
              "hidden shrink-0 cursor-pointer rounded-md p-1.5 text-white/35 transition-colors duration-150 lg:inline-flex",
              "hover:bg-white/[0.06] hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              showLabel && "ml-auto",
            )}
            title={collapsed ? "Expand rail" : "Collapse rail"}
            aria-label={collapsed ? "Expand rail" : "Collapse rail"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        )}
      </div>
      <div className="rail-divider mx-3.5" />

      <nav className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-2.5 py-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className={cn("mb-1 hidden truncate px-2.5 text-[10px] font-semibold uppercase tracking-[0.13em] text-white/30", showLabel && "lg:block")}>
              {group.label}
            </p>
            <div className={cn("rail-divider mx-1.5 mb-1.5", showLabel && "lg:hidden")} />
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <NavRow
                  key={item.href}
                  item={item}
                  showLabel={showLabel}
                  active={isActive(pathname, item.href)}
                />
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
