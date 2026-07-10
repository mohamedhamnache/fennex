"use client";

import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Sun, Moon, Search, Settings, Mic2, LogOut, ChevronDown } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getMe, authLogout } from "@/lib/api";
import { useCommandPalette } from "@/components/layout/CommandPalette";
import { LanguagePicker } from "@/components/layout/LanguagePicker";
import { AlertsBell } from "@/components/monitoring/AlertsBell";
import { cn } from "@/lib/cn";

function initials(name?: string | null): string {
  if (!name) return "?";
  return name.split(" ").map((n) => n[0]).filter(Boolean).join("").slice(0, 2).toUpperCase() || "?";
}

/** Close a popover when clicking outside its ref. */
function useClickOutside(ref: React.RefObject<HTMLElement>, onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onClose, active]);
}

export function TopBar() {
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const { open: openPalette } = useCommandPalette();
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen);

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: getMe, staleTime: 5 * 60_000 });

  function handleLogout() {
    authLogout();
    router.replace("/login");
  }

  return (
    <header className="relative z-30 flex h-[60px] items-center justify-between border-b border-white/[0.06] bg-background/30 px-5 py-2.5 backdrop-blur-xl">
      {/* Search → command palette */}
      <button
        onClick={openPalette}
        className="group flex w-72 items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:bg-muted"
      >
        <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        <span className="text-sm">{t("topbar.searchPlaceholder")}</span>
        <kbd className="ml-auto rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/60 group-hover:text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      {/* Actions */}
      <div className="flex items-center gap-1">
        {/* Language picker */}
        <LanguagePicker />

        {/* Alerts */}
        <AlertsBell />

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

        {/* User menu */}
        <div className="relative ml-1.5" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className={cn(
              "flex items-center gap-2 rounded-xl border py-1 pl-1 pr-2 transition-all",
              menuOpen
                ? "border-primary/40 bg-white/[0.06]"
                : "border-white/[0.07] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]",
            )}
            aria-label="Account menu"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg gradient-brand text-[11px] font-bold text-white">
              {initials(me?.full_name)}
            </span>
            <span className="hidden min-w-0 flex-col items-start leading-tight sm:flex">
              <span className="max-w-[120px] truncate text-xs font-semibold text-foreground">
                {me?.full_name ?? t("topbar.loading")}
              </span>
              <span className="max-w-[120px] truncate text-[10px] text-muted-foreground">
                {me?.org_name ?? ""}
              </span>
            </span>
            <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", menuOpen && "rotate-180")} />
          </button>
          {menuOpen && (
            <div className="popover animate-scale-in absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden">
              <div className="flex items-center gap-3 border-b px-4 py-3.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl gradient-brand text-sm font-bold text-white glow-primary">
                  {initials(me?.full_name)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{me?.full_name ?? "—"}</p>
                  <p className="truncate text-xs text-muted-foreground">{me?.email ?? ""}</p>
                </div>
              </div>
              <div className="p-1.5">
                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Settings className="h-4 w-4" strokeWidth={1.8} /> {t("nav.settings")}
                </Link>
                <Link
                  href="/brand-voice"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Mic2 className="h-4 w-4" strokeWidth={1.8} /> {t("nav.brandVoice")}
                </Link>
              </div>
              <div className="border-t p-1.5">
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <LogOut className="h-4 w-4" strokeWidth={1.8} /> {t("nav.signOut")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
