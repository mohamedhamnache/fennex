"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: "12px", fontFamily: "sans-serif" }}>
          <p style={{ fontSize: "14px", fontWeight: 600, color: "#ef4444" }}>Something went wrong</p>
          <p style={{ fontSize: "12px", color: "#6b7280", fontFamily: "monospace", maxWidth: "480px", wordBreak: "break-all", textAlign: "center" }}>{error.message}</p>
          <button type="button" onClick={reset} style={{ fontSize: "12px", color: "#b5522f" }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
