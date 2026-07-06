"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  createABTest,
  listTrends,
  generateFromTrend,
  analyzeCompetitor,
  type Trend,
  type GeneratedImage,
} from "@/lib/api";

const TREND_CATEGORY_LABELS: Record<string, string> = {
  design: "Design",
  aesthetic: "Aesthetic",
  art: "Art",
  "3d": "3D",
  photography: "Photography",
};

type Section = "ab" | "trends" | "competitor";

interface PremiumTabProps {
  projectId: string;
  useBrandKit: boolean;
  onGenerated: () => void;
}

// ── A/B Test section ──────────────────────────────────────────────────────────

function ABTestSection({
  projectId,
  useBrandKit,
  onGenerated,
}: PremiumTabProps) {
  const [concept, setConcept] = useState("");
  const [count, setCount] = useState(4);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => createABTest(projectId, concept, count, useBrandKit),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["images", projectId] });
      onGenerated();
      setConcept("");
    },
  });

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="text-xs font-semibold text-foreground mb-0.5">A/B Creative Testing</p>
        <p className="text-[10px] text-muted-foreground">
          Generate multiple creative variants of the same concept — each with a different visual angle.
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-foreground mb-1">Concept</label>
        <textarea
          rows={3}
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          placeholder="e.g. Summer sale for sneakers targeting Gen Z"
          className="w-full resize-none rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-foreground mb-2">
          Variants: <span className="text-primary">{count}</span>
        </label>
        <input
          type="range"
          min={2}
          max={10}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
          <span>2</span>
          <span>10</span>
        </div>
      </div>

      <button
        type="button"
        disabled={!concept.trim() || mutation.isPending}
        onClick={() => mutation.mutate()}
        className="btn-primary w-full py-2 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {mutation.isPending ? `Generating ${count} variants...` : `Generate ${count} variants`}
      </button>

      {mutation.isError && (
        <p className="text-xs text-destructive">
          {mutation.error instanceof Error ? mutation.error.message : "Failed"}
        </p>
      )}
      {mutation.isSuccess && (
        <p className="text-xs text-green-600">
          {mutation.data.variants.length} variants generated. Check the Images tab.
        </p>
      )}
    </div>
  );
}

// ── Trends section ────────────────────────────────────────────────────────────

function TrendsSection({ projectId, useBrandKit, onGenerated }: PremiumTabProps) {
  const [selectedTrend, setSelectedTrend] = useState<Trend | null>(null);
  const [subject, setSubject] = useState("");
  const [activeCategory, setActiveCategory] = useState("design");
  const qc = useQueryClient();

  const { data: trends = [], isLoading } = useQuery({
    queryKey: ["trends"],
    queryFn: listTrends,
  });

  const categories = [...new Set(trends.map((t) => t.category))];
  const filtered = trends.filter((t) => t.category === activeCategory);

  const mutation = useMutation({
    mutationFn: () =>
      generateFromTrend(projectId, selectedTrend!.id, subject, useBrandKit),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["images", projectId] });
      onGenerated();
      setSelectedTrend(null);
      setSubject("");
    },
  });

  if (selectedTrend) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <button
          type="button"
          onClick={() => { setSelectedTrend(null); mutation.reset(); }}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors self-start"
        >
          <ChevronLeft className="h-3 w-3" />
          Back
        </button>

        <div>
          <p className="text-sm font-semibold text-foreground">{selectedTrend.label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{selectedTrend.description}</p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-foreground mb-1">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. luxury skincare product, startup landing hero"
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <button
          type="button"
          disabled={!subject.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
          className="btn-primary w-full py-2 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {mutation.isPending ? "Generating..." : "Generate"}
        </button>

        {mutation.isError && (
          <p className="text-xs text-destructive">
            {mutation.error instanceof Error ? mutation.error.message : "Failed"}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="flex gap-1 flex-wrap">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[10px] font-medium capitalize transition-colors",
                  activeCategory === cat
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {TREND_CATEGORY_LABELS[cat] || cat}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTrend(t)}
                className="text-left rounded-lg border border-border px-3 py-2.5 hover:border-primary/50 hover:bg-muted/30 transition-colors"
              >
                <p className="text-xs font-semibold text-foreground">{t.label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{t.description}</p>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Competitor section ────────────────────────────────────────────────────────

function CompetitorSection({ projectId, useBrandKit, onGenerated }: PremiumTabProps) {
  const [url, setUrl] = useState("");
  const [focus, setFocus] = useState("");
  const [result, setResult] = useState<{ analysis: string; image: GeneratedImage } | null>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => analyzeCompetitor(projectId, url, focus, useBrandKit),
    onSuccess: (data) => {
      setResult({ analysis: data.analysis, image: data.improved_image });
      qc.invalidateQueries({ queryKey: ["images", projectId] });
      onGenerated();
    },
  });

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="text-xs font-semibold text-foreground mb-0.5">Competitor Analysis</p>
        <p className="text-[10px] text-muted-foreground">
          Paste a competitor ad URL. The AI analyses it and generates an improved version for you.
        </p>
      </div>

      <div>
        <label className="block text-xs font-semibold text-foreground mb-1">Competitor image URL</label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/their-ad.jpg"
          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-foreground mb-1">
          Improvement focus <span className="text-muted-foreground font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder="e.g. More emotional, stronger CTA, better color contrast"
          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <button
        type="button"
        disabled={!url.trim() || mutation.isPending}
        onClick={() => { setResult(null); mutation.mutate(); }}
        className="btn-primary w-full py-2 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {mutation.isPending ? "Analyzing..." : "Analyze and generate"}
      </button>

      {mutation.isError && (
        <p className="text-xs text-destructive">
          {mutation.error instanceof Error ? mutation.error.message : "Failed"}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3 bg-muted/20">
          <p className="text-[10px] font-semibold text-foreground uppercase tracking-wide">Analysis</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{result.analysis}</p>
          {result.image.image_url && (
            <img
              src={result.image.image_url}
              alt="Improved version"
              className="w-full rounded-lg object-contain bg-black/5 mt-1"
            />
          )}
          <p className="text-[10px] text-green-600">Improved image saved to your library.</p>
        </div>
      )}
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export function PremiumTab(props: PremiumTabProps) {
  const [section, setSection] = useState<Section>("ab");

  const SECTIONS: { id: Section; label: string }[] = [
    { id: "ab", label: "A/B Test" },
    { id: "trends", label: "Trends" },
    { id: "competitor", label: "Competitor" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex shrink-0 border-b border-border px-4 pt-3">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={cn(
              "pb-2 px-1 mr-3 text-xs font-semibold border-b-2 transition-colors shrink-0",
              section === s.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {section === "ab" && <ABTestSection {...props} />}
        {section === "trends" && <TrendsSection {...props} />}
        {section === "competitor" && <CompetitorSection {...props} />}
      </div>
    </div>
  );
}
