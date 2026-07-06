"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { listTemplates, generateFromTemplate, type StudioTemplate } from "@/lib/api";

const CATEGORY_LABELS: Record<string, string> = {
  blog: "Blog",
  product: "Product",
  social: "Social",
  ad: "Ad",
  email: "Email",
  event: "Event",
};

interface TemplatesTabProps {
  projectId: string;
  useBrandKit: boolean;
  onGenerated: () => void;
}

export function TemplatesTab({ projectId, useBrandKit, onGenerated }: TemplatesTabProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<StudioTemplate | null>(null);
  const [slots, setSlots] = useState<Record<string, string>>({});
  const [activeCategory, setActiveCategory] = useState("blog");
  const qc = useQueryClient();

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["templates"],
    queryFn: listTemplates,
  });

  const categories = [...new Set(templates.map((t) => t.category))];
  const filtered = templates.filter((t) => t.category === activeCategory);

  const mutation = useMutation({
    mutationFn: () => generateFromTemplate(projectId, selectedTemplate!.id, slots, useBrandKit),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["images", projectId] });
      onGenerated();
      setSelectedTemplate(null);
      setSlots({});
    },
  });

  function selectTemplate(t: StudioTemplate) {
    setSelectedTemplate(t);
    setSlots({});
    mutation.reset();
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (selectedTemplate) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <button
          type="button"
          onClick={() => { setSelectedTemplate(null); mutation.reset(); }}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors self-start"
        >
          <ChevronLeft className="h-3 w-3" />
          Back to templates
        </button>

        <div>
          <p className="text-sm font-semibold text-foreground">{selectedTemplate.label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{selectedTemplate.description}</p>
          <p className="text-[10px] text-muted-foreground tabular-nums mt-1">
            {selectedTemplate.width}&times;{selectedTemplate.height}px
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {Object.entries(selectedTemplate.slots).map(([key, description]) => (
            <div key={key}>
              <label className="block text-xs font-semibold text-foreground mb-1 capitalize">
                {key.replace(/_/g, " ")}
              </label>
              <input
                type="text"
                placeholder={description}
                value={slots[key] || ""}
                onChange={(e) => setSlots((prev) => ({ ...prev, [key]: e.target.value }))}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
          className="btn-primary w-full py-2 text-sm disabled:opacity-50 flex items-center justify-center gap-2 mt-1"
        >
          {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {mutation.isPending ? "Generating..." : "Generate from template"}
        </button>

        {mutation.isError && (
          <p className="text-xs text-destructive">
            {mutation.error instanceof Error ? mutation.error.message : "Generation failed"}
          </p>
        )}

        {mutation.isSuccess && (
          <p className="text-xs text-green-600">Image generated. Check the Images tab.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Category pills */}
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
            {CATEGORY_LABELS[cat] || cat}
          </button>
        ))}
      </div>

      {/* Template cards */}
      <div className="flex flex-col gap-2">
        {filtered.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => selectTemplate(t)}
            className="text-left rounded-lg border border-border px-3 py-2.5 hover:border-primary/50 hover:bg-muted/30 transition-colors"
          >
            <p className="text-xs font-semibold text-foreground">{t.label}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t.description}</p>
            <p className="text-[10px] text-muted-foreground tabular-nums mt-1">
              {t.width}&times;{t.height}px
            </p>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground">No templates in this category.</p>
        )}
      </div>
    </div>
  );
}
