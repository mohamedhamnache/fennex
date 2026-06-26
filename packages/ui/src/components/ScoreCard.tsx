import React from "react";

interface ScoreCardProps {
  label: string;
  score: number;
  maxScore?: number;
  color?: "green" | "blue" | "orange" | "purple";
  description?: string;
}

export function ScoreCard({
  label,
  score,
  maxScore = 100,
  color = "blue",
  description,
}: ScoreCardProps) {
  const percentage = (score / maxScore) * 100;

  const colorMap = {
    green: "text-emerald-500",
    blue: "text-blue-500",
    orange: "text-orange-500",
    purple: "text-purple-500",
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className={`text-2xl font-bold ${colorMap[color]}`}>{score}</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full bg-current ${colorMap[color]} transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {description && <p className="mt-2 text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}
