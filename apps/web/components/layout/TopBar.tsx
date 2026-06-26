"use client";

import { useTheme } from "next-themes";
import { Sun, Moon, Bell, Search } from "lucide-react";
import { useState, useEffect } from "react";

export function TopBar() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <header className="flex h-13 items-center justify-between border-b border-border bg-background/80 px-5 py-2.5 backdrop-blur-sm">
      {/* Search */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 text-sm text-muted-foreground w-64 cursor-text">
        <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <span className="text-sm">Search…</span>
        <kbd className="ml-auto rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/60">⌘K</kbd>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        {/* Notifications */}
        <button className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label="Notifications">
          <Bell className="h-4 w-4" strokeWidth={1.8} />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
        </button>

        {/* Theme toggle */}
        {mounted && (
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Toggle theme"
          >
            {theme === "dark"
              ? <Sun className="h-4 w-4" strokeWidth={1.8} />
              : <Moon className="h-4 w-4" strokeWidth={1.8} />}
          </button>
        )}

        {/* Avatar */}
        <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 ring-1 ring-primary/25 text-xs font-semibold text-primary">
          A
        </div>
      </div>
    </header>
  );
}
