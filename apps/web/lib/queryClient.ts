import { QueryClient } from "@tanstack/react-query";

// Module-level singleton (not per-component useState) so non-component code
// -- notably apiClient's credit-refresh hook -- can invalidate queries too.
// Safe here because this app has no SSR data fetching (no hydration
// boundaries/prefetching), so there is only ever one client per page load.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      retry: 1,
    },
  },
});
