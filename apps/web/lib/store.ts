import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User, Project, Organization } from "@fennex/types";

interface AppState {
  // Auth
  user: User | null;
  organization: Organization | null;
  setUser: (user: User | null) => void;
  setOrganization: (org: Organization | null) => void;

  // UI
  sidebarCollapsed: boolean;
  activeProjectId: string | null;
  toggleSidebar: () => void;
  setActiveProject: (id: string | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      user: null,
      organization: null,
      setUser: (user) => set({ user }),
      setOrganization: (org) => set({ organization: org }),

      sidebarCollapsed: false,
      activeProjectId: null,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setActiveProject: (id) => set({ activeProjectId: id }),
    }),
    { name: "fennex-app-state" },
  ),
);
