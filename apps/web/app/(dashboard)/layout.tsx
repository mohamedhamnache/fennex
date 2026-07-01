"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { CommandPaletteProvider } from "@/components/layout/CommandPalette";
import { AuroraBackground } from "@/components/layout/AuroraBackground";
import { UsageBanner } from "@/components/billing/UsageBanner";
import { UpgradeModal } from "@/components/billing/UpgradeModal";
import { getBillingUsage, isAuthenticated, ApiError } from "@/lib/api";
import { useUsageStore } from "@/lib/billing-store";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isFullScreen = /\/images\/edit\//.test(pathname ?? "");
  const setUsage = useUsageStore((s) => s.setUsage);
  const usage = useUsageStore((s) => s.usage);
  const [upgradeResource, setUpgradeResource] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Global 429 LIMIT_REACHED interception for all mutations
  useEffect(() => {
    queryClient.setDefaultOptions({
      mutations: {
        onError: (err) => {
          if (
            err instanceof ApiError &&
            err.status === 429 &&
            err.detail?.code === "LIMIT_REACHED"
          ) {
            setUpgradeResource(err.detail.resource as string);
          }
        },
      },
    });
  }, [queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll usage every 60 s
  useQuery({
    queryKey: ["billing-usage-global"],
    queryFn: async () => {
      const data = await getBillingUsage();
      setUsage(data);
      return data;
    },
    refetchInterval: 60_000,
    retry: false,
    enabled: typeof window !== "undefined" && isAuthenticated(),
  });

  if (typeof window !== "undefined" && !isAuthenticated()) {
    return null;
  }

  const upgradeInfo =
    upgradeResource && usage
      ? {
          resource: upgradeResource,
          used: usage.usage[upgradeResource]?.used ?? 0,
          limit: usage.usage[upgradeResource]?.limit ?? 0,
          currentTier: usage.plan_tier,
        }
      : null;

  return (
    <CommandPaletteProvider>
      <AuroraBackground />
      <div className="relative z-10 flex h-screen flex-col overflow-hidden">
        {usage && (
          <UsageBanner
            onUpgrade={() => {
              const warnResource =
                Object.entries(usage.usage).find(([, r]) => r.pct >= 0.8)?.[0] ?? null;
              setUpgradeResource(warnResource);
            }}
          />
        )}
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <TopBar />
            <main className={isFullScreen ? "flex-1 overflow-hidden" : "flex-1 overflow-y-auto p-6"}>{children}</main>
          </div>
        </div>
      </div>
      {upgradeInfo && (
        <UpgradeModal
          resource={upgradeInfo.resource}
          used={upgradeInfo.used}
          limit={upgradeInfo.limit}
          currentTier={upgradeInfo.currentTier}
          onClose={() => setUpgradeResource(null)}
        />
      )}
    </CommandPaletteProvider>
  );
}
