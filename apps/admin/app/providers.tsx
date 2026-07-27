"use client";

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { makeQueryClient } from "@/lib/query";

/**
 * App-wide providers for the admin console. Currently just TanStack Query
 * (created once per client via `useState`, mirroring `apps/web`'s
 * `QueryProvider`). `apps/web` also wires a `ThemeProvider` and
 * `I18nProvider` here; the admin console defers those — theme is a plain
 * Zustand flag on `useAdminStore` for now (Task 9 wires it into the DOM via
 * the TopBar), and this task's UI (the login form) uses plain English
 * strings rather than standing up react-i18next resources, per the Task 8
 * brief's "else plain strings are acceptable" allowance.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => makeQueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
