import React from "react";

interface MetricCardProps {
  label: string;
  value: string | number;
  change?: number;
  icon?: React.ReactNode;
}

export function MetricCard({ label, value, change, icon }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </div>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
      {change !== undefined && (
        <p className={`mt-2 text-xs ${change >= 0 ? "text-emerald-500" : "text-red-500"}`}>
          {change >= 0 ? "+" : ""}
          {change}% from last month
        </p>
      )}
    </div>
  );
}
