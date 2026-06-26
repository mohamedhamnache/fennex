import React from "react";
import type { JobStatus } from "@fennex/types";

interface AIJobStatusProps {
  status: JobStatus;
  progress?: number;
  label?: string;
}

const statusConfig: Record<JobStatus, { label: string; color: string }> = {
  pending: { label: "Queued", color: "text-muted-foreground" },
  running: { label: "Running", color: "text-blue-500" },
  completed: { label: "Done", color: "text-emerald-500" },
  failed: { label: "Failed", color: "text-red-500" },
};

export function AIJobStatus({ status, progress, label }: AIJobStatusProps) {
  const config = statusConfig[status];
  return (
    <div className="flex items-center gap-2">
      <span className={`text-sm font-medium ${config.color}`}>{label ?? config.label}</span>
      {status === "running" && progress !== undefined && (
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
