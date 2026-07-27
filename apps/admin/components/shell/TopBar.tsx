"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Sun, Moon, ChevronDown, LogOut, ShieldCheck } from "lucide-react";
import { apiClient } from "@/lib/api";
import { useAdminStore } from "@/store";
import { cn } from "@/lib/cn";

interface TopBarProps {
  onOpenPalette: () => void;
}

function initialsFor(name: string, email: string) {
  const source = name?.trim() || email;
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "A";
}

export function TopBar({ onOpenPalette }: TopBarProps) {
  const router = useRouter();
  const admin = useAdminStore((s) => s.admin);
  const theme = useAdminStore((s) => s.theme);
  const toggleTheme = useAdminStore((s) => s.toggleTheme);
  const clear = useAdminStore((s) => s.clear);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  async function handleLogout() {
    setMenuOpen(false);
    try {
      await apiClient.post("/admin/auth/logout", {});
    } catch {
      // Session may already be invalid server-side — clear locally regardless.
    } finally {
      clear();
      router.push("/login");
    }
  }

  return (
    <header className="app-header flex h-14 shrink-0 items-center gap-3 px-4">
      <button
        type="button"
        onClick={onOpenPalette}
        className={cn(
          "flex min-h-[36px] w-full max-w-xs cursor-pointer items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 text-sm text-muted-foreground",
          "transition-colors duration-150 hover:border-primary/30 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 truncate text-left">Search...</span>
        <kbd className="hidden shrink-0 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-2xs text-muted-foreground/80 sm:inline">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label="Toggle theme"
          className={cn(
            "flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150",
            "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </button>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={cn(
              "flex min-h-[36px] cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-medium text-foreground transition-colors duration-150",
              "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              menuOpen && "bg-accent",
            )}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-2xs font-bold text-primary">
              {admin ? initialsFor(admin.name, admin.email) : "..."}
            </span>
            <span className="hidden max-w-[10rem] truncate lg:inline">{admin?.email ?? "Loading..."}</span>
            <ChevronDown className={cn("hidden h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 lg:inline", menuOpen && "rotate-180")} />
          </button>

          {menuOpen && (
            <div className="popover absolute right-0 top-full z-30 mt-2 w-64 motion-safe:animate-scale-in p-1.5">
              <div className="border-b border-border px-2.5 py-2">
                <p className="truncate text-sm font-medium text-foreground">{admin?.name || admin?.email}</p>
                <p className="truncate text-xs text-muted-foreground">{admin?.email}</p>
                {admin?.roles && admin.roles.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {admin.roles.map((role) => (
                      <span key={role} className="badge bg-primary/10 text-primary">
                        <ShieldCheck className="h-3 w-3" />
                        {role}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-1.5 flex min-h-[40px] w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-destructive transition-colors duration-150 hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
