"use client";

import { useEffect, useState, type ReactNode } from "react";
import { NavRail } from "./NavRail";
import { TopBar } from "./TopBar";
import { CommandPalette } from "./CommandPalette";
import { useAdminStore } from "@/store";

/**
 * Composes the console frame: the collapsible NavRail, the TopBar, and the
 * page `children` in a scrollable content column. Also owns the
 * CommandPalette's open state (so both the TopBar's search trigger and the
 * global ⌘K listener drive the same dialog) and syncs the persisted Zustand
 * `theme` onto `<html>` the same way `apps/web` does via `next-themes`
 * (`attribute="class"`) — the admin console doesn't pull in that dependency,
 * so this effect is the equivalent: toggle the `dark` class directly.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const theme = useAdminStore((s) => s.theme);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenPalette={() => setPaletteOpen(true)} />
        <main className="flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
