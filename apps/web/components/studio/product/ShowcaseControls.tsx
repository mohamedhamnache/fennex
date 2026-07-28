"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, Dices, SlidersHorizontal, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  getUsageSummary,
  type ShowcaseAspectRatio,
  type ShowcaseCamera,
  type ShowcaseLighting,
  type ShowcaseQuality,
} from "@/lib/api";
import { PRODUCT_SHOWCASE_CREDIT_COST } from "@/lib/creditCosts";

// Photographic vocabulary. Values are the wire tokens the backend's
// prompting/vocab.py controlled vocabulary expects; labels are the
// short technical terms photographers already use (softbox, 35mm, top-down),
// kept as plain strings for the same reason the existing scene grid's labels
// are -- see ProductTab.tsx's SCENES array and Task 7 report for the note.
const LIGHTING_OPTIONS: { value: ShowcaseLighting; label: string }[] = [
  { value: "softbox", label: "Softbox" },
  { value: "golden_hour", label: "Golden hour" },
  { value: "hard_sun", label: "Hard sun" },
  { value: "rim", label: "Rim" },
  { value: "diffused_daylight", label: "Diffused daylight" },
  { value: "chiaroscuro", label: "Chiaroscuro" },
  { value: "candlelit", label: "Candlelit" },
];

const CAMERA_OPTIONS: { value: ShowcaseCamera; label: string }[] = [
  { value: "macro", label: "Macro" },
  { value: "35mm", label: "35mm" },
  { value: "50mm", label: "50mm" },
  { value: "85mm", label: "85mm" },
  { value: "tilt_shift", label: "Tilt-shift" },
  { value: "top_down", label: "Top-down" },
  { value: "three_quarter", label: "Three-quarter" },
];

const ASPECT_OPTIONS: { value: ShowcaseAspectRatio; label: string }[] = [
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "3:2", label: "3:2" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
];

export interface ShowcaseAdvancedValues {
  lighting?: ShowcaseLighting;
  camera?: ShowcaseCamera;
  aspect_ratio?: ShowcaseAspectRatio;
  creativity?: number;
  product_preservation?: number;
  prompt?: string;
  negative_prompt?: string;
  seed?: number | null;
  quality?: ShowcaseQuality;
}

const DEFAULT_SLIDER = 50;

interface ShowcaseControlsProps {
  value: ShowcaseAdvancedValues;
  onChange: (value: ShowcaseAdvancedValues) => void;
  isOpen: boolean;
  onToggle: () => void;
}

/**
 * Maps the advanced panel onto request fields, omitting anything the user has
 * not set. Every showcase control is optional server-side, so an untouched
 * panel must produce a payload byte-identical to the pre-controls one --
 * shared by ProductStudio and ProductTab so the two cannot drift.
 */
export function showcaseOverrides(v: ShowcaseAdvancedValues): Record<string, unknown> {
  return {
    ...(v.lighting !== undefined ? { lighting: v.lighting } : {}),
    ...(v.camera !== undefined ? { camera: v.camera } : {}),
    ...(v.aspect_ratio !== undefined ? { aspect_ratio: v.aspect_ratio } : {}),
    ...(v.creativity !== undefined ? { creativity: v.creativity } : {}),
    ...(v.product_preservation !== undefined ? { product_preservation: v.product_preservation } : {}),
    ...(v.prompt?.trim() ? { prompt: v.prompt.trim() } : {}),
    ...(v.negative_prompt?.trim() ? { negative_prompt: v.negative_prompt.trim() } : {}),
    ...(v.seed !== undefined ? { seed: v.seed } : {}),
    ...(v.quality !== undefined ? { quality: v.quality } : {}),
  };
}

const selectClass =
  "w-full rounded-lg border border-border bg-input px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ShowcaseControls({ value, onChange, isOpen, onToggle }: ShowcaseControlsProps) {
  const { t } = useTranslation();

  const { data: usage } = useQuery({
    queryKey: ["usage-summary"],
    queryFn: getUsageSummary,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  function patch(next: Partial<ShowcaseAdvancedValues>) {
    onChange({ ...value, ...next });
  }

  function randomizeSeed() {
    patch({ seed: Math.floor(Math.random() * 2_147_483_647) });
  }

  const remaining = usage?.credits_remaining;
  const insufficient = typeof remaining === "number" && remaining < PRODUCT_SHOWCASE_CREDIT_COST;

  return (
    <div className="flex flex-col gap-3">
      {/* Credit cost -- always visible, before the user commits to a run */}
      <div
        className={cn(
          "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs",
          insufficient ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-muted/30 text-muted-foreground",
        )}
      >
        <span className="flex items-center gap-1.5 font-medium">
          <Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
          <span className="font-mono tabular-nums">
            {t("productTab.showcase.cost", { count: PRODUCT_SHOWCASE_CREDIT_COST, defaultValue: "{{count}} credits per run" })}
          </span>
        </span>
        {typeof remaining === "number" && (
          <span className="font-mono tabular-nums">
            {t("productTab.showcase.remaining", { count: remaining, defaultValue: "{{count}} remaining" })}
          </span>
        )}
      </div>
      {insufficient && (
        <p className="-mt-1.5 text-[11px] text-destructive">
          {t("productTab.showcase.insufficientCredits", { defaultValue: "Not enough credits for this run" })}
        </p>
      )}

      {/* Disclosure */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.9} />
        {t("productTab.showcase.advanced", { defaultValue: "Advanced controls" })}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="flex flex-col gap-3 animate-fade-in">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("productTab.showcase.lighting", { defaultValue: "Lighting" })}
              </label>
              <select
                value={value.lighting ?? ""}
                onChange={(e) => patch({ lighting: (e.target.value || undefined) as ShowcaseLighting | undefined })}
                className={selectClass}
              >
                <option value="">{t("productTab.showcase.auto", { defaultValue: "Auto" })}</option>
                {LIGHTING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("productTab.showcase.camera", { defaultValue: "Camera" })}
              </label>
              <select
                value={value.camera ?? ""}
                onChange={(e) => patch({ camera: (e.target.value || undefined) as ShowcaseCamera | undefined })}
                className={selectClass}
              >
                <option value="">{t("productTab.showcase.auto", { defaultValue: "Auto" })}</option>
                {CAMERA_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("productTab.showcase.aspectRatio", { defaultValue: "Aspect ratio" })}
              </label>
              <select
                value={value.aspect_ratio ?? ""}
                onChange={(e) => patch({ aspect_ratio: (e.target.value || undefined) as ShowcaseAspectRatio | undefined })}
                className={selectClass}
              >
                <option value="">{t("productTab.showcase.auto", { defaultValue: "Auto" })}</option>
                {ASPECT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("productTab.showcase.quality", { defaultValue: "Quality" })}
              </label>
              <select
                value={value.quality ?? ""}
                onChange={(e) => patch({ quality: (e.target.value || undefined) as ShowcaseQuality | undefined })}
                className={selectClass}
              >
                <option value="">{t("productTab.showcase.auto", { defaultValue: "Auto" })}</option>
                <option value="draft">{t("productTab.showcase.qualityDraft", { defaultValue: "Draft" })}</option>
                <option value="high">{t("productTab.showcase.qualityHigh", { defaultValue: "High" })}</option>
                <option value="ultra">{t("productTab.showcase.qualityUltra", { defaultValue: "Ultra" })}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>{t("productTab.showcase.creativity", { defaultValue: "Creativity" })}</span>
              <span className="font-mono tabular-nums normal-case text-foreground">
                {value.creativity ?? t("productTab.showcase.auto", { defaultValue: "Auto" })}
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={value.creativity ?? DEFAULT_SLIDER}
              onChange={(e) => patch({ creativity: Number(e.target.value) })}
              className="w-full accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>{t("productTab.showcase.preservation", { defaultValue: "Product preservation" })}</span>
              <span className="font-mono tabular-nums normal-case text-foreground">
                {value.product_preservation ?? t("productTab.showcase.auto", { defaultValue: "Auto" })}
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={value.product_preservation ?? DEFAULT_SLIDER}
              onChange={(e) => patch({ product_preservation: Number(e.target.value) })}
              className="w-full accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("productTab.showcase.prompt", { defaultValue: "Prompt" })}
            </label>
            <textarea
              value={value.prompt ?? ""}
              onChange={(e) => patch({ prompt: e.target.value })}
              rows={2}
              placeholder={t("productTab.showcase.promptPlaceholder", { defaultValue: "Describe the shot you want…" }) ?? undefined}
              className="w-full resize-none rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("productTab.showcase.negativePrompt", { defaultValue: "Negative prompt" })}
            </label>
            <textarea
              value={value.negative_prompt ?? ""}
              onChange={(e) => patch({ negative_prompt: e.target.value })}
              rows={2}
              placeholder={t("productTab.showcase.negativePromptPlaceholder", { defaultValue: "blurry, low quality, watermark, text…" }) ?? undefined}
              className="w-full resize-none rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("productTab.showcase.seed", { defaultValue: "Seed" })}
            </label>
            <div className="flex gap-1.5">
              <input
                type="number"
                inputMode="numeric"
                value={value.seed ?? ""}
                onChange={(e) => patch({ seed: e.target.value === "" ? undefined : Number(e.target.value) })}
                placeholder={t("productTab.showcase.seedPlaceholder", { defaultValue: "Random" }) ?? undefined}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm font-mono tabular-nums text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="button"
                onClick={randomizeSeed}
                aria-label={t("productTab.showcase.randomizeSeed", { defaultValue: "Randomize seed" }) ?? undefined}
                title={t("productTab.showcase.randomizeSeed", { defaultValue: "Randomize seed" }) ?? undefined}
                className="flex shrink-0 items-center justify-center rounded-lg border border-border px-2.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Dices className="h-4 w-4" strokeWidth={1.9} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
