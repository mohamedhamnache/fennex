"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";

/**
 * A chart an agent asked for, inside a chat message.
 *
 * Agents emit a fenced ```chart block holding a small JSON spec. Keeping the
 * spec tiny is deliberate: an agent that can only choose a shape, a title and
 * a series cannot invent an axis, mislabel a unit, or bury a number in a
 * decoration. Anything it cannot express here it has to write in words, which
 * is the safer failure.
 *
 * Every chart also prints its values, because a bar the reader cannot measure
 * is a picture rather than a figure -- and because colour alone must never be
 * the only carrier of meaning.
 */

const Recharts = dynamic(() => import("./ChatChartImpl"), {
  ssr: false,
  loading: () => <div className="h-[160px] animate-pulse rounded-lg bg-muted/30" />,
});

export interface ChartSpec {
  type: "bar" | "line" | "area" | "donut";
  title?: string;
  unit?: "currency" | "percent" | "number";
  currency?: string;
  data: { label: string; value: number }[];
  note?: string;
}

/** Parse and sanity-check a spec. A malformed one renders as nothing rather
 *  than throwing inside a chat message and taking the conversation with it. */
export function parseChartSpec(raw: string): ChartSpec | null {
  try {
    const spec = JSON.parse(raw) as ChartSpec;
    if (!Array.isArray(spec.data) || spec.data.length === 0) return null;
    const data = spec.data
      .filter((d) => d && typeof d.label === "string" && Number.isFinite(Number(d.value)))
      .map((d) => ({ label: String(d.label).slice(0, 60), value: Number(d.value) }))
      .slice(0, 12);
    if (!data.length) return null;
    const type = (["bar", "line", "area", "donut"] as const).includes(spec.type) ? spec.type : "bar";
    return { ...spec, type, data };
  } catch {
    return null;
  }
}

export function ChatChart({ spec }: { spec: ChartSpec }) {
  const fmt = useMemo(() => {
    if (spec.unit === "currency") {
      return (n: number) => new Intl.NumberFormat(undefined, {
        style: "currency", currency: spec.currency || "USD",
        notation: n >= 10000 ? "compact" : "standard", maximumFractionDigits: 0,
      }).format(n);
    }
    if (spec.unit === "percent") return (n: number) => `${n.toFixed(n >= 10 ? 0 : 1)}%`;
    return (n: number) => new Intl.NumberFormat().format(n);
  }, [spec.unit, spec.currency]);

  return (
    <figure className="my-3 rounded-xl border border-border bg-muted/20 p-3">
      {spec.title && (
        <figcaption className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {spec.title}
        </figcaption>
      )}
      <Recharts spec={spec} fmt={fmt} />
      {spec.note && (
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{spec.note}</p>
      )}
    </figure>
  );
}
