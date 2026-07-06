"use client";

import { cn } from "@/lib/cn";

interface ScoreBadgeProps {
  score: number | null | undefined;
  className?: string;
}

export function ScoreBadge({ score, className }: ScoreBadgeProps) {
  if (score == null) return null;
  const color =
    score >= 80 ? "bg-green-500" : score >= 60 ? "bg-yellow-500" : "bg-red-500";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full text-[10px] font-bold text-white tabular-nums w-6 h-6",
        color,
        className,
      )}
    >
      {Math.round(score)}
    </span>
  );
}
