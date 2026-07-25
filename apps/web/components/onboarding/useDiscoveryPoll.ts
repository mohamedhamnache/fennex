import { useEffect, useState } from "react";
import { getDiscovery, type DiscoveryRun } from "@/lib/api";

/**
 * Polls GET /onboarding/discovery/{runId} every 1500ms until the run reaches
 * a terminal status ("done" or "error"). Pass `runId: null` to keep the hook
 * idle (e.g. before discovery has been started).
 */
export function useDiscoveryPoll(runId: string | null) {
  const [run, setRun] = useState<DiscoveryRun | null>(null);
  const done = run?.status === "done" || run?.status === "error";

  useEffect(() => {
    // Reset state when the run id changes so a stale run from a previous
    // poll doesn't linger while the new one is in flight.
    setRun(null);
  }, [runId]);

  useEffect(() => {
    if (!runId || done) return;
    let active = true;
    const tick = async () => {
      try {
        const r = await getDiscovery(runId);
        if (active) setRun(r);
      } catch {
        /* transient network/API error: keep polling on the next tick */
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [runId, done]);

  return { run, done };
}
