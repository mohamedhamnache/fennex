"use client";

import { useRef, useState, useEffect } from "react";
import { ChevronDown, Upload, X, RotateCcw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import type { ImageStyle, ImageUsage } from "@/lib/api";
import { getBrandKit } from "@/lib/api";
import { StyleGrid } from "./StyleGrid";
import { PromptToolbar } from "./PromptToolbar";
import { SocialTab } from "./SocialTab";
import { addToHistory, getHistory, getSaved, savePrompt, removeSaved } from "./prompt-storage";

const USAGES: { value: ImageUsage; label: string }[] = [
  { value: "article_cover", label: "Article Cover" },
  { value: "social_post",   label: "Social Post" },
  { value: "brand_asset",   label: "Brand Asset" },
  { value: "custom",        label: "Custom" },
];

interface StudioLeftPanelProps {
  projectId: string;
  prompt: string;
  onPromptChange: (p: string) => void;
  negativePrompt: string;
  onNegativePromptChange: (p: string) => void;
  style: ImageStyle;
  onStyleChange: (s: ImageStyle) => void;
  quality: "standard" | "hd";
  onQualityChange: (q: "standard" | "hd") => void;
  batchCount: 1 | 2 | 4;
  onBatchCountChange: (n: 1 | 2 | 4) => void;
  usage: ImageUsage;
  onUsageChange: (u: ImageUsage) => void;
  referenceImage: string | null;
  onReferenceImageChange: (dataUri: string | null) => void;
  useBrandKit: boolean;
  onUseBrandKitChange: (v: boolean) => void;
  onGenerate: () => void;
  generating: boolean;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-foreground mb-2">{children}</p>;
}

function PillGroup<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
            value === o.value
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StudioLeftPanel({
  projectId,
  prompt,
  onPromptChange,
  negativePrompt,
  onNegativePromptChange,
  style,
  onStyleChange,
  quality,
  onQualityChange,
  batchCount,
  onBatchCountChange,
  usage,
  onUsageChange,
  referenceImage,
  onReferenceImageChange,
  useBrandKit,
  onUseBrandKitChange,
  onGenerate,
  generating,
}: StudioLeftPanelProps) {
  const { data: brandKit } = useQuery({
    queryKey: ["brand-kit"],
    queryFn: getBrandKit,
  });
  const hasBrandKit = !!(
    brandKit &&
    ((brandKit.colors?.length ?? 0) > 0 || brandKit.style_rules || brandKit.tone)
  );

  const [activeTab, setActiveTab] = useState<"generate" | "social">("generate");
  const [negExpanded, setNegExpanded] = useState(false);
  const [historyTab, setHistoryTab] = useState<"recent" | "saved">("recent");
  const [history, setHistory] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [undoOriginal, setUndoOriginal] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHistory(getHistory(projectId));
    setSaved(getSaved(projectId));
  }, [projectId]);

  function handleImproved(improved: string, original: string) {
    onPromptChange(improved);
    setUndoOriginal(original);
  }

  function handleUndo() {
    if (undoOriginal !== null) {
      onPromptChange(undoOriginal);
      setUndoOriginal(null);
    }
  }

  function handleSave() {
    if (!prompt.trim()) return;
    savePrompt(projectId, prompt.trim());
    setSaved(getSaved(projectId));
  }

  function handleRemoveSaved(p: string) {
    removeSaved(projectId, p);
    setSaved(getSaved(projectId));
  }

  function handleUseHistory(p: string) {
    onPromptChange(p);
    setUndoOriginal(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onReferenceImageChange(reader.result as string);
    reader.readAsDataURL(file);
  }

  const batchOptions: { value: 1 | 2 | 4; label: string }[] = [
    { value: 1, label: "1" },
    { value: 2, label: "2" },
    { value: 4, label: "4" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab switcher */}
      <div className="flex shrink-0 border-b border-border px-4 pt-3">
        {(["generate", "social"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              "pb-2 px-1 mr-4 text-xs font-semibold border-b-2 transition-colors capitalize",
              activeTab === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab === "social" ? "Social Media" : "Generate"}
          </button>
        ))}
      </div>

      {/* Social tab */}
      {activeTab === "social" && (
        <div className="flex-1 overflow-y-auto">
          <SocialTab
            projectId={projectId}
            subject={prompt}
            useBrandKit={useBrandKit}
            style={style}
            quality={quality}
            onSwitchToGenerate={() => setActiveTab("generate")}
          />
        </div>
      )}

      {/* Generate tab */}
      {activeTab === "generate" && (
      <div className="flex flex-col gap-5 p-4 overflow-y-auto flex-1">

      {/* Prompt */}
      <div>
        <SectionLabel>Prompt</SectionLabel>
        <textarea
          value={prompt}
          onChange={(e) => { onPromptChange(e.target.value); setUndoOriginal(null); }}
          rows={4}
          placeholder="Describe the image you want to generate…"
          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none mb-2"
        />
        {undoOriginal !== null && (
          <button
            type="button"
            onClick={handleUndo}
            className="mb-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="h-3 w-3" /> Undo improvement
          </button>
        )}
        <PromptToolbar
          prompt={prompt}
          usage={usage}
          style={style}
          projectId={projectId}
          onImproved={handleImproved}
          onTemplateSelect={(p) => { onPromptChange(p); setUndoOriginal(null); }}
          onSave={handleSave}
        />
      </div>

      {/* Brand kit toggle */}
      <div className="flex items-center justify-between py-1">
        <span className={cn("text-xs font-medium", hasBrandKit ? "text-foreground" : "text-muted-foreground/60")}>
          Use brand kit
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={useBrandKit}
          disabled={!hasBrandKit}
          onClick={() => onUseBrandKitChange(!useBrandKit)}
          className={cn(
            "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none",
            useBrandKit && hasBrandKit ? "bg-primary" : "bg-border",
            !hasBrandKit && "opacity-40 cursor-not-allowed",
          )}
        >
          <span
            className={cn(
              "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform",
              useBrandKit && hasBrandKit ? "translate-x-4" : "translate-x-0.5",
            )}
          />
        </button>
      </div>

      {/* Negative prompt (collapsible) */}
      <div>
        <button
          type="button"
          onClick={() => setNegExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", negExpanded && "rotate-180")} />
          Negative prompt
        </button>
        {negExpanded && (
          <textarea
            value={negativePrompt}
            onChange={(e) => onNegativePromptChange(e.target.value)}
            rows={2}
            placeholder="blurry, low quality, watermark, text…"
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
          />
        )}
      </div>

      {/* Style grid */}
      <div>
        <SectionLabel>Style</SectionLabel>
        <StyleGrid value={style} onChange={onStyleChange} />
      </div>

      {/* Quality */}
      <div>
        <SectionLabel>Quality</SectionLabel>
        <PillGroup
          options={[
            { value: "standard" as const, label: "Standard" },
            { value: "hd" as const, label: "HD" },
          ]}
          value={quality}
          onChange={onQualityChange}
        />
      </div>

      {/* Batch count */}
      <div>
        <SectionLabel>Variations</SectionLabel>
        <PillGroup options={batchOptions} value={batchCount} onChange={onBatchCountChange} />
      </div>

      {/* Usage */}
      <div>
        <SectionLabel>Usage</SectionLabel>
        <PillGroup options={USAGES} value={usage} onChange={onUsageChange} />
      </div>

      {/* Image-to-image */}
      <div>
        <SectionLabel>Reference image <span className="font-normal text-muted-foreground">(optional)</span></SectionLabel>
        {referenceImage ? (
          <div className="relative w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={referenceImage}
              alt="Reference"
              className="w-full rounded-lg object-cover max-h-40 border border-border"
            />
            <button
              type="button"
              onClick={() => { onReferenceImageChange(null); if (fileRef.current) fileRef.current.value = ""; }}
              className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-lg border-2 border-dashed border-border px-4 py-5 flex flex-col items-center gap-2 text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
          >
            <Upload className="h-5 w-5" />
            <span className="text-xs">Upload PNG or JPG</span>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Prompt History & Saved */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          {(["recent", "saved"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setHistoryTab(tab)}
              className={cn(
                "text-xs font-semibold pb-0.5 border-b-2 transition-colors capitalize",
                historyTab === tab
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab === "recent" ? "Recent" : "Saved"}
            </button>
          ))}
        </div>

        {historyTab === "recent" && (
          history.length === 0 ? (
            <p className="text-xs text-muted-foreground">No recent prompts yet.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {history.map((p, i) => (
                <div key={i} className="flex items-start gap-2 group">
                  <p className="flex-1 text-xs text-muted-foreground line-clamp-2">{p}</p>
                  <button
                    type="button"
                    onClick={() => handleUseHistory(p)}
                    className="shrink-0 text-[10px] text-primary opacity-0 group-hover:opacity-100 transition-opacity font-medium"
                  >
                    Use
                  </button>
                </div>
              ))}
            </div>
          )
        )}

        {historyTab === "saved" && (
          saved.length === 0 ? (
            <p className="text-xs text-muted-foreground">No saved prompts yet. Click 🔖 to save.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {saved.map((p, i) => (
                <div key={i} className="flex items-start gap-2 group">
                  <p className="flex-1 text-xs text-muted-foreground line-clamp-2">{p}</p>
                  <div className="shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => handleUseHistory(p)}
                      className="text-[10px] text-primary font-medium"
                    >
                      Use
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveSaved(p)}
                      className="text-[10px] text-muted-foreground hover:text-destructive"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {/* Generate button */}
      <button
        type="button"
        onClick={onGenerate}
        disabled={generating}
        className="btn-primary w-full py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed sticky bottom-0"
      >
        {generating ? (
          <><span className="animate-spin">⟳</span> Generating…</>
        ) : (
          "Generate"
        )}
      </button>
      </div>
      )}
    </div>
  );
}
