"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, SearchCode, FileText, Zap, Share2, ImagePlus, Send,
  Link2, BarChart2, Settings, Mic2, FolderOpen, Sun, Moon, LogOut,
  Search, CornerDownLeft, ArrowUp, ArrowDown,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { authLogout, listProjects } from "@/lib/api";
import { useProjectStore } from "@/lib/store";
import { cn } from "@/lib/cn";

interface Command {
  id: string;
  label: string;
  group: string;
  icon: React.ElementType;
  keywords?: string;
  hint?: string;
  run: () => void;
}

interface CommandPaletteContextValue {
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const Ctx = createContext<CommandPaletteContextValue | null>(null);

const NAV = [
  { href: "overview", tKey: "nav.overview" as const, icon: LayoutDashboard, kw: "home dashboard" },
  { href: "keywords", tKey: "nav.keywords" as const, icon: SearchCode, kw: "research serp" },
  { href: "content", tKey: "nav.planner" as const, icon: FileText, kw: "plan calendar" },
  { href: "articles", tKey: "nav.articles" as const, icon: Zap, kw: "write generate blog" },
  { href: "social", tKey: "nav.social" as const, icon: Share2, kw: "posts twitter linkedin" },
  { href: "images", tKey: "nav.images" as const, icon: ImagePlus, kw: "picture dalle generate" },
  { href: "publishing", tKey: "nav.publishing" as const, icon: Send, kw: "wordpress deploy" },
  { href: "backlinks", tKey: "nav.backlinks" as const, icon: Link2, kw: "links exchange outreach" },
  { href: "analytics", tKey: "nav.analytics" as const, icon: BarChart2, kw: "traffic gsc rankings" },
  { href: "audit", tKey: "nav.audit" as const, icon: SearchCode, kw: "technical crawl issues" },
];

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { currentProjectId } = useProjectStore();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 30_000,
  });

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((o) => !o), []);

  // Reset transient state whenever the palette opens.
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setActive(0);
      // focus after paint
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Global ⌘K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const projectId = currentProjectId ?? projects[0]?.id ?? null;

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];

    if (projectId) {
      for (const n of NAV) {
        cmds.push({
          id: `nav-${n.href}`,
          label: t(n.tKey),
          group: t("commandPalette.groups.navigate"),
          icon: n.icon,
          keywords: n.kw,
          run: () => router.push(`/${projectId}/${n.href}`),
        });
      }
    }

    cmds.push(
      { id: "nav-brand", label: t("nav.brandVoice"), group: t("commandPalette.groups.navigate"), icon: Mic2, keywords: "tone style", run: () => router.push("/brand-voice") },
      { id: "nav-settings", label: t("nav.settings"), group: t("commandPalette.groups.navigate"), icon: Settings, keywords: "account team keys org", run: () => router.push("/settings") },
    );

    for (const p of projects) {
      cmds.push({
        id: `proj-${p.id}`,
        label: p.name,
        group: t("commandPalette.groups.switchProject"),
        icon: FolderOpen,
        keywords: `${p.domain} project`,
        hint: p.domain,
        run: () => {
          useProjectStore.getState().setCurrentProject(p.id);
          router.push(`/${p.id}/overview`);
        },
      });
    }

    cmds.push(
      {
        id: "act-theme",
        label: theme === "dark" ? t("commandPalette.actions.lightMode") : t("commandPalette.actions.darkMode"),
        group: t("commandPalette.groups.actions"),
        icon: theme === "dark" ? Sun : Moon,
        keywords: "theme appearance dark light",
        run: () => setTheme(theme === "dark" ? "light" : "dark"),
      },
      {
        id: "act-logout",
        label: t("commandPalette.actions.signOut"),
        group: t("commandPalette.groups.actions"),
        icon: LogOut,
        keywords: "logout exit",
        run: () => { authLogout(); router.replace("/login"); },
      },
    );

    return cmds;
  }, [t, projectId, projects, router, theme, setTheme]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      `${c.label} ${c.keywords ?? ""} ${c.group}`.toLowerCase().includes(q),
    );
  }, [commands, query]);

  // Keep active index in range as the filtered list changes.
  useEffect(() => { setActive(0); }, [query]);

  const runAt = useCallback(
    (index: number) => {
      const cmd = filtered[index];
      if (!cmd) return;
      close();
      cmd.run();
    },
    [filtered, close],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  // Scroll active item into view.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Group the filtered commands while preserving a flat index for keyboard nav.
  const groups = useMemo(() => {
    const order: string[] = [];
    const map: Record<string, { cmd: Command; index: number }[]> = {};
    filtered.forEach((cmd, index) => {
      if (!map[cmd.group]) { map[cmd.group] = []; order.push(cmd.group); }
      map[cmd.group].push({ cmd, index });
    });
    return order.map((g) => ({ group: g, items: map[g] }));
  }, [filtered]);

  return (
    <Ctx.Provider value={{ open, close, toggle }}>
      {children}
      {isOpen && (
        <div
          className="cmd-overlay fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[12vh]"
          onMouseDown={close}
        >
          <div
            className="cmd-panel animate-scale-in w-full max-w-xl overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Search */}
            <div className="flex items-center gap-3 border-b px-4">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.9} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={t("commandPalette.placeholder")}
                className="w-full bg-transparent py-4 text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
              />
              <kbd className="hidden shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/60 sm:block">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div ref={listRef} className="max-h-[340px] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {t("commandPalette.noResults", { query })}
                </div>
              ) : (
                groups.map(({ group, items }) => (
                  <div key={group} className="mb-1">
                    <p className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                      {group}
                    </p>
                    {items.map(({ cmd, index }) => {
                      const Icon = cmd.icon;
                      const isActive = index === active;
                      return (
                        <button
                          key={cmd.id}
                          data-index={index}
                          onMouseMove={() => setActive(index)}
                          onClick={() => runAt(index)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                            isActive ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted",
                          )}
                        >
                          <Icon
                            className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")}
                            strokeWidth={1.9}
                          />
                          <span className="flex-1 truncate font-medium text-foreground">{cmd.label}</span>
                          {cmd.hint && (
                            <span className="truncate text-xs text-muted-foreground/70">{cmd.hint}</span>
                          )}
                          {isActive && (
                            <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Footer hint */}
            <div className="flex items-center gap-4 border-t px-4 py-2.5 text-[11px] text-muted-foreground/70">
              <span className="flex items-center gap-1"><ArrowUp className="h-3 w-3" /><ArrowDown className="h-3 w-3" /> {t("commandPalette.navigateHint")}</span>
              <span className="flex items-center gap-1"><CornerDownLeft className="h-3 w-3" /> {t("commandPalette.selectHint")}</span>
              <span className="ml-auto flex items-center gap-1">
                <kbd className="rounded border px-1 py-0.5 text-[9px]">⌘</kbd>
                <kbd className="rounded border px-1 py-0.5 text-[9px]">K</kbd>
                {t("commandPalette.toggleHint")}
              </span>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCommandPalette must be used within a CommandPaletteProvider");
  return ctx;
}
