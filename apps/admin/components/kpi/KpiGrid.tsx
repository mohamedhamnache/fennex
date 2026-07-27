import {
  Banknote,
  Building2,
  Cpu,
  FileText,
  Gauge,
  Hash,
  TrendingDown,
  Users,
} from "lucide-react";
import { StatCard } from "./StatCard";
import { compactNumber, money, moneyUsd, pct } from "@/lib/format";
import type { OverviewKpis } from "@/lib/overview-types";

/**
 * The nine KPI tiles for `/overview`, in priority order (revenue/cost first,
 * then platform reach, then AI usage). Responsive: 1 col mobile -> 2 col
 * (sm) -> 4 col (xl), per the dense-dashboard direction in
 * `design-system/fennex-admin/MASTER.md`.
 */
export function KpiGrid({ kpis }: { kpis: OverviewKpis }) {
  const totalTokens = kpis.ai_input_tokens + kpis.ai_output_tokens;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="MRR"
        value={moneyUsd(kpis.mrr_usd)}
        icon={Banknote}
        hint="monthly recurring revenue"
      />
      <StatCard
        label="Monthly cost"
        value={money(kpis.cost_micros)}
        icon={TrendingDown}
        hint="AI + infra spend"
      />
      <StatCard
        label="Gross margin"
        value={pct(kpis.margin_pct)}
        icon={Gauge}
        hint={kpis.margin_pct === null ? "no MRR yet" : "this range"}
      />
      <StatCard label="Active orgs" value={compactNumber(kpis.active_orgs)} icon={Building2} hint="with usage this range" />
      <StatCard label="Total orgs" value={compactNumber(kpis.total_orgs)} icon={Building2} />
      <StatCard label="Total users" value={compactNumber(kpis.total_users)} icon={Users} />
      <StatCard label="AI requests" value={compactNumber(kpis.ai_requests)} icon={Cpu} />
      <StatCard
        label="AI tokens"
        value={compactNumber(totalTokens)}
        icon={Hash}
        hint={`${compactNumber(kpis.ai_input_tokens)} in / ${compactNumber(kpis.ai_output_tokens)} out`}
      />
      <StatCard label="SEO items" value={compactNumber(kpis.seo_count)} icon={FileText} />
    </div>
  );
}
