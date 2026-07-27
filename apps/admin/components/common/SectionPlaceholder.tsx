import { Construction } from "lucide-react";

/** Thin empty state for every nav destination that doesn't have a real page
 * yet — every `(console)` section besides `/overview` in this phase. */
export function SectionPlaceholder({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Construction className="h-5 w-5" aria-hidden="true" />
      </div>
      <h1 className="font-display text-xl font-semibold text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground">Coming in Phase 1b.</p>
    </div>
  );
}
