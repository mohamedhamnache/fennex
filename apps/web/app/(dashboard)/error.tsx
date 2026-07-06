"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
      <p className="text-sm font-semibold text-destructive">Something went wrong</p>
      <p className="text-xs text-muted-foreground font-mono max-w-md break-all">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="text-xs text-primary hover:underline"
      >
        Try again
      </button>
    </div>
  );
}
