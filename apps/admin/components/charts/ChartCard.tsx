import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function ChartCard({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "card-base card-shadow motion-safe:animate-fade-in flex flex-col gap-3 border border-border bg-card p-4",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {hint && <span className="font-mono text-2xs tabular-nums text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
