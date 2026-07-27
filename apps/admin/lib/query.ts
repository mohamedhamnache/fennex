import { QueryClient } from "@tanstack/react-query";

/**
 * Shared TanStack Query configuration for the admin console. Exposed as a
 * factory (not a module-level singleton) so `app/providers.tsx` can create
 * exactly one instance per client via `useState`, per the Next.js App
 * Router guidance for avoiding cross-request cache leakage during SSR.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        retry: 1,
      },
    },
  });
}
