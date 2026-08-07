"use client";

import { useTranslation } from "react-i18next";
import { AlertTriangle, HelpCircle, Info, Check, Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import type { UnavailableMetric, ReadinessItem } from "@/lib/api";

/**
 * The pieces that keep this feature honest on screen.
 *
 * The API is careful to separate measured figures from ones nobody can see, and
 * that separation only survives if the UI renders the second kind differently
 * from the first. A blank that looks like a zero, or an estimate that looks like
 * a measurement, undoes the whole design on the last inch.
 */

/** A figure that was measured. Large, confident, no qualifier. */
export function Metric({ label, value, sub, tone = "default" }: {
  label: string; value: string; sub?: string;
  tone?: "default" | "muted" | "positive";
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-2xl font-semibold tabular-nums",
                       tone === "muted" ? "text-muted-foreground" : "text-foreground")}>
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/**
 * A metric nobody can currently measure.
 *
 * Deliberately NOT rendered as "0" or "--" in a metric slot. It occupies its own
 * visual register -- dashed, muted, with the connector named -- because the
 * failure this feature is built to avoid is a merchant reading an unmeasured
 * ROAS as a measured one and moving budget on it.
 */
export function Unavailable({ metrics, className }: {
  metrics: UnavailableMetric[]; className?: string;
}) {
  const { t } = useTranslation();
  if (!metrics.length) return null;

  // Grouped by connector: five metrics behind one missing integration is one
  // decision to make, not five problems to read.
  const byNeed = new Map<string, string[]>();
  for (const m of metrics) {
    const list = byNeed.get(m.needs) ?? [];
    list.push(m.metric);
    byNeed.set(m.needs, list);
  }

  return (
    <div className={cn("rounded-xl border border-dashed border-border bg-muted/20 p-3", className)}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        <Lock className="h-3 w-3" strokeWidth={2} />
        {t("campaigns.unavailable.title", { defaultValue: "Not measured" })}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {[...byNeed.entries()].map(([needs, names]) => (
          <li key={needs} className="text-[11px] leading-relaxed text-muted-foreground">
            <span className="text-foreground/70">{names.join(", ")}</span>
            {" — "}
            {t("campaigns.unavailable.needs", { defaultValue: "needs {{what}}", what: needs })}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** An estimate, labelled as one, with what it rests on. */
export function Assumption({ claim, restsOn }: { claim: string; restsOn: string }) {
  return (
    <li className="flex items-start gap-2 text-xs leading-relaxed">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
      <span className="text-muted-foreground">
        <span className="text-foreground">{claim}</span>
        {restsOn && <> — {restsOn}</>}
      </span>
    </li>
  );
}

const LEVEL_STYLE: Record<string, { icon: typeof Check; cls: string }> = {
  blocker: { icon: AlertTriangle, cls: "text-destructive" },
  warning: { icon: AlertTriangle, cls: "text-warning" },
  // Its own icon and register: an unperformed check is not a passed one.
  unknown: { icon: HelpCircle, cls: "text-muted-foreground" },
  ok: { icon: Check, cls: "text-success" },
};

export function CheckRow({ item }: { item: ReadinessItem }) {
  const { t } = useTranslation();
  const style = LEVEL_STYLE[item.level] ?? LEVEL_STYLE.unknown;
  const Icon = style.icon;
  // The server sends a code and its parameters; the sentence is built here,
  // in the reader's language. `message`/`fix` are the English fallback, so a
  // code with no translation degrades to readable text rather than a key.
  // A channel's display name arrives in English ("Store", "Landing page"), so
  // it is re-translated here from the key the server sends beside it. Without
  // this the sentence is French and the noun inside it is not.
  const params = { ...item.params };
  if (typeof params.channelKey === "string") {
    params.channel = t(`campaigns.channel.${params.channelKey}`, {
      defaultValue: String(params.channel ?? params.channelKey),
    });
  }
  const message = t(`campaigns.check.${item.code}`, { ...params, defaultValue: item.message });
  const fix = item.fix
    ? t(`campaigns.check.${item.code}Fix`, { ...params, defaultValue: item.fix })
    : "";
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", style.cls)} strokeWidth={2.2} />
      <div className="min-w-0">
        <p className="text-xs leading-relaxed text-foreground">{message}</p>
        {fix && <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{fix}</p>}
      </div>
    </li>
  );
}

/** Money, in the campaign's own currency, with digits that line up in columns. */
export function money(amount: number | null | undefined, currency = "EUR"): string {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency", currency, maximumFractionDigits: amount >= 1000 ? 0 : 2,
  }).format(amount);
}

export function Section({ title, description, action, children, className }: {
  title: string; description?: string; action?: React.ReactNode;
  children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
