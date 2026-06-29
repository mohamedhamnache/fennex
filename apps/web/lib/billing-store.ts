import { create } from "zustand";
import type { BillingUsage } from "./api";

interface UsageState {
  usage: BillingUsage | null;
  setUsage: (u: BillingUsage | null) => void;
  /** Returns true if any resource is ≥80% used. */
  hasWarning: () => boolean;
  /** Returns the first resource that is ≥80%, or null. */
  warnResource: () => string | null;
}

export const useUsageStore = create<UsageState>()((set, get) => ({
  usage: null,
  setUsage: (u) => set({ usage: u }),
  hasWarning: () => {
    const u = get().usage;
    if (!u) return false;
    return Object.values(u.usage).some((r) => r.pct >= 0.8);
  },
  warnResource: () => {
    const u = get().usage;
    if (!u) return null;
    const entry = Object.entries(u.usage).find(([, r]) => r.pct >= 0.8);
    return entry ? entry[0] : null;
  },
}));
