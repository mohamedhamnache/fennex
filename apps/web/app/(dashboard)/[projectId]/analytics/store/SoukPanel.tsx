"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, EyeOff, Flame, Lightbulb, Loader2, Package,
  Tent, Users, Zap,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { delegate } from "@/lib/employees";
import { FENNEX_AGENTS } from "@/lib/agents";

/**
 * Souk, where the numbers are.
 *
 * The dashboard above says what happened. This says what to do about it, which
 * is the only reason a merchant reads a dashboard at all. It runs through the
 * ordinary delegate endpoint rather than a private one, so Souk competes for
 * the work on the same footing as every other employee -- if a request is
 * really an SEO question, the Router hands it to Zerda and this panel shows
 * whose answer it is.
 */

type ActionKey = "growth_audit" | "cro_review" | "retention_plan" | "merchandising";

const ACTIONS: {
  key: ActionKey; label: string; question: string; capability: string; Icon: typeof Tent;
}[] = [
  { key: "growth_audit", label: "What's limiting growth?",
    question: "Audit my store and name the one thing limiting growth right now.",
    capability: "ecommerce.growth_audit", Icon: Flame },
  { key: "cro_review", label: "Where am I losing buyers?",
    question: "Review my buying journey and tell me where it leaks and what to change.",
    capability: "ecommerce.cro_review", Icon: Zap },
  { key: "retention_plan", label: "How do I get repeat orders?",
    question: "Design the lifecycle flows that would raise my repeat purchase rate.",
    capability: "ecommerce.retention_plan", Icon: Users },
  { key: "merchandising", label: "What should I push?",
    question: "What should I push, bundle, reprice or retire?",
    capability: "ecommerce.merchandising", Icon: Package },
];

const SEVERITY = {
  critical: { label: "Critical", cls: "border-destructive/40 bg-destructive/5",
              pill: "bg-destructive/15 text-destructive" },
  important: { label: "Important", cls: "border-amber-500/40 bg-amber-500/5",
               pill: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  optimise: { label: "Optimise", cls: "border-border bg-muted/20",
              pill: "bg-muted text-muted-foreground" },
} as const;

type Structured = Record<string, unknown>;

export function SoukPanel({ projectId }: { projectId: string }) {
  const [active, setActive] = useState<ActionKey | null>(null);

  const run = useMutation({
    mutationFn: async (a: (typeof ACTIONS)[number]) => {
      const report = await delegate({
        goal: a.question, project_id: projectId, persona: "ecommerce",
        capabilities: [a.capability],
      });
      const artifact = report.artifacts?.find(
        (x) => Object.keys((x as { structured?: Structured }).structured ?? {}).length > 0);
      return {
        structured: ((artifact as { structured?: Structured })?.structured ?? {}) as Structured,
        who: (artifact as { employee?: string })?.employee ?? report.team?.[0] ?? "souk",
        error: report.error,
        ok: report.ok,
      };
    },
  });

  const agent = FENNEX_AGENTS.souk;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-green-700 text-white">
            <Tent className="h-4.5 w-4.5" strokeWidth={1.9} />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">{agent.name}</p>
            <p className="text-xs text-muted-foreground">{agent.role}</p>
          </div>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">
        The dashboard says what happened. Ask {agent.name} what to do about it —
        it reads your measured figures only, and tells you what it cannot see
        rather than guessing.
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ACTIONS.map((a) => {
          const busy = run.isPending && active === a.key;
          return (
            <button
              key={a.key}
              onClick={() => { setActive(a.key); run.mutate(a); }}
              disabled={run.isPending}
              className={cn(
                "group flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:cursor-default disabled:opacity-60",
                active === a.key && !run.isPending
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-border hover:border-foreground/20 hover:bg-accent",
              )}
            >
              {busy
                ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-500" />
                : <a.Icon className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" strokeWidth={1.9} />}
              <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{a.label}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          );
        })}
      </div>

      {run.isPending && (
        <p className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading your store…
        </p>
      )}

      {run.isError && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-foreground">
          {agent.name} could not finish. Try again, or check that an AI key is set in Settings.
        </p>
      )}

      {run.isSuccess && !run.data.ok && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-foreground">
          {run.data.error || "No answer came back."}
        </p>
      )}

      {run.isSuccess && run.data.ok && (
        <Result data={run.data.structured} who={run.data.who} />
      )}
    </Card>
  );
}

/**
 * Coerce whatever the model returned into readable text.
 *
 * The prompt asks for strings and the model mostly obliges -- but a live run
 * returned `test_first` as {description, reason} and `cannot_see` as
 * [{step, reason}], which React renders as "[object Object]". A prompt is a
 * request, not a type system, so the boundary has to absorb the difference
 * rather than trust it.
 */
function asText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(" · ");
  if (typeof v === "object") {
    // Join the object's own values: whichever keys the model invented, the
    // sentence it wrote is in there somewhere.
    return Object.values(v as Record<string, unknown>).map(asText).filter(Boolean).join(" — ");
  }
  return "";
}

function asTextList(v: unknown): string[] {
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).map(asText).filter(Boolean);
}

/** One renderer, four shapes. Each action answers a different question, so a
 *  single generic list would flatten away what makes each answer useful. */
function Result({ data, who }: { data: Structured; who: string }) {
  const findings = data.findings as Finding[] | undefined;
  const leaks = data.leaks as Leak[] | undefined;
  const flows = data.flows as Flow[] | undefined;
  const push = data.push as PushRow[] | undefined;
  const bundles = data.bundles as BundleRow[] | undefined;
  const blind = asTextList(data.blind_spots ?? data.cannot_see);
  const thisWeek = asTextList(data.this_week);
  const testFirst = asText(data.test_first);

  const empty = !findings?.length && !leaks?.length && !flows?.length
    && !push?.length && !bundles?.length;

  return (
    <div className="flex animate-fade-in flex-col gap-4 border-t border-border pt-4">
      {who !== "souk" && (
        <p className="text-[11px] text-muted-foreground">
          Answered by {who} — the Router judged this their specialty.
        </p>
      )}

      {typeof data.situation === "string" && data.situation && (
        <p className="text-sm leading-relaxed text-foreground">{data.situation}</p>
      )}

      {findings?.map((f, i) => {
        const sev = SEVERITY[f.severity as keyof typeof SEVERITY] ?? SEVERITY.optimise;
        return (
          <div key={i} className={cn("flex flex-col gap-2 rounded-xl border p-4", sev.cls)}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", sev.pill)}>
                {sev.label}
              </span>
              {f.effort && (
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                  {f.effort}
                </span>
              )}
              <span className="text-sm font-semibold text-foreground">{asText(f.problem)}</span>
            </div>
            {f.evidence && <Line label="Evidence" value={asText(f.evidence)} />}
            {f.diagnosis && <Line label="Why" value={asText(f.diagnosis)} />}
            {f.action && <Line label="Do this" value={asText(f.action)} strong />}
            {f.impact && <Line label="Moves" value={asText(f.impact)} />}
          </div>
        );
      })}

      {leaks?.map((l, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl border border-border bg-muted/20 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-foreground">
              {l.step}
            </span>
            {l.confidence && (
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                {l.confidence} confidence
              </span>
            )}
            <span className="text-sm font-semibold text-foreground">{asText(l.problem)}</span>
          </div>
          {l.evidence && <Line label="Evidence" value={asText(l.evidence)} />}
          {l.fix && <Line label="Fix" value={asText(l.fix)} strong />}
          {l.impact && <Line label="Moves" value={asText(l.impact)} />}
        </div>
      ))}

      {flows?.map((f, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl border border-border bg-muted/20 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{f.name}</span>
            {f.priority && (
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                (SEVERITY[f.priority as keyof typeof SEVERITY] ?? SEVERITY.optimise).pill)}>
                {f.priority}
              </span>
            )}
          </div>
          <Line label="Trigger" value={[asText(f.trigger), asText(f.timing)].filter(Boolean).join(" · ")} />
          {f.messages?.length > 0 && (
            <ol className="flex flex-col gap-1.5 border-l-2 border-emerald-500/30 pl-3">
              {f.messages.map((m, j) => (
                <li key={j} className="text-xs text-foreground">
                  <span className="font-semibold tabular-nums text-muted-foreground">
                    {m.delay || "immediately"}
                  </span>
                  {" — "}{asText(m.angle)}
                  {m.offer
                    ? <span className="ml-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400">{m.offer}</span>
                    : <span className="ml-1 text-muted-foreground">(no offer)</span>}
                </li>
              ))}
            </ol>
          )}
          {f.metric && <Line label="Measure" value={asText(f.metric)} />}
        </div>
      ))}

      {(push?.length || bundles?.length) ? (
        <div className="flex flex-col gap-3">
          {push?.map((p, i) => (
            <div key={i} className="rounded-xl border border-border bg-muted/20 p-4">
              <p className="text-sm font-semibold text-foreground">Push: {asText(p.product)}</p>
              <Line label="Why" value={asText(p.why)} />
              {p.where && <Line label="Where" value={asText(p.where)} />}
            </div>
          ))}
          {bundles?.map((b, i) => (
            <div key={i} className="rounded-xl border border-border bg-muted/20 p-4">
              <p className="text-sm font-semibold text-foreground">
                Bundle: {asTextList(b.products).join(" + ")}
              </p>
              <Line label="Angle" value={asText(b.angle)} />
              {b.price_logic && <Line label="Pricing" value={asText(b.price_logic)} />}
            </div>
          ))}
        </div>
      ) : null}

      {testFirst && (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          <p className="text-sm text-foreground"><span className="font-semibold">Ship first: </span>{testFirst}</p>
        </div>
      )}

      {thisWeek?.length ? (
        <div className="rounded-xl border border-border p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Zap className="h-3.5 w-3.5" /> This week
          </p>
          <ol className="flex flex-col gap-1.5">
            {thisWeek.map((t, i) => (
              <li key={i} className="flex gap-2 text-sm text-foreground">
                <span className="font-bold tabular-nums text-emerald-500">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {empty && !blind?.length && (
        <p className="text-sm text-muted-foreground">
          Nothing conclusive came back from this run.
        </p>
      )}

      {/* Shown as prominently as the advice. What the agent could not see is
          the reason a recommendation is missing, and hiding it would make the
          answer look more complete than it is. */}
      {blind?.length ? (
        <div className="rounded-xl border border-dashed border-border p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <EyeOff className="h-3.5 w-3.5" /> Could not see
          </p>
          <ul className="flex flex-col gap-1">
            {blind.map((b, i) => (
              <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{b}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className={cn("text-sm leading-relaxed", strong ? "text-foreground" : "text-muted-foreground")}>
      <span className="font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">{label} </span>
      {value}
    </p>
  );
}

interface Finding {
  severity: string; problem: string; evidence?: string; diagnosis?: string;
  action?: string; impact?: string; effort?: string;
}
interface Leak {
  step: string; problem: string; evidence?: string; fix?: string;
  impact?: string; confidence?: string;
}
interface Flow {
  name: string; trigger: string; timing?: string; priority?: string; metric?: string;
  messages: { delay: string; angle: string; offer: string | null }[];
}
interface PushRow { product: string; why: string; where?: string }
interface BundleRow { products: string[]; angle: string; price_logic?: string }
