"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { NAV_GROUPS } from "@/lib/nav";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** cmdk-powered destination switcher. Opens on the TopBar's search trigger
 * or `Cmd/Ctrl+K` anywhere in the console; arrow keys + Enter navigate. */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      loop
      overlayClassName="cmd-overlay fixed inset-0 z-50 motion-safe:animate-fade-in"
      contentClassName="fixed left-1/2 top-[16%] z-50 w-full max-w-lg -translate-x-1/2 px-4"
      className="cmd-panel w-full overflow-hidden motion-safe:animate-scale-in"
    >
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Command.Input
          autoFocus
          placeholder="Search sections..."
          className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />
        <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-2xs text-muted-foreground sm:inline">
          Esc
        </kbd>
      </div>
      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
          No matching sections.
        </Command.Empty>
        {NAV_GROUPS.map((group) => (
          <Command.Group
            key={group.label}
            heading={group.label}
            className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground/70"
          >
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <Command.Item
                  key={item.href}
                  value={`${group.label} ${item.label}`}
                  onSelect={() => go(item.href)}
                  className="flex min-h-[40px] cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground/80 transition-colors duration-150 data-[selected=true]:bg-primary/10 data-[selected=true]:text-primary"
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </Command.Item>
              );
            })}
          </Command.Group>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}
