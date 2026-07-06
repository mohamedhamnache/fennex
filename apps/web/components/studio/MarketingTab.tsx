"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { generateMarketingBanners, type GeneratedImage } from "@/lib/api";
import { RefreshCw, CheckCircle2, XCircle, Download } from "lucide-react";

const FORMATS = [
  { id: "hero_banner",          label: "Hero Banner",    size: "1920x600" },
  { id: "promo_ad_square",      label: "Promo Ad",       size: "1080x1080" },
  { id: "sale_poster",          label: "Sale Poster",    size: "800x1200" },
  { id: "email_header",         label: "Email Header",   size: "600x200" },
  { id: "display_ad_rectangle", label: "Display Ad",     size: "728x90" },
  { id: "story_ad",             label: "Story Ad",       size: "1080x1920" },
];

interface MarketingTabProps {
  projectId: string;
  useBrandKit: boolean;
}

export function MarketingTab({ projectId, useBrandKit }: MarketingTabProps) {
  const [product, setProduct] = useState("");
  const [offer, setOffer] = useState("");
  const [cta, setCta] = useState("Shop Now");
  const [selectedFormats, setSelectedFormats] = useState<string[]>(["hero_banner", "promo_ad_square"]);
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const qc = useQueryClient();

  function toggleFormat(id: string) {
    setSelectedFormats((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const mutation = useMutation({
    mutationFn: () =>
      generateMarketingBanners({
        project_id: projectId,
        product: product.trim(),
        offer: offer.trim(),
        cta: cta.trim(),
        format_ids: selectedFormats,
        use_brand_kit: useBrandKit,
      }),
    onSuccess: (data) => {
      setResults(data);
      qc.invalidateQueries({ queryKey: ["images", projectId] });
    },
  });

  const canGenerate = product.trim().length > 0 && selectedFormats.length > 0 && !mutation.isPending;

  function handleReset() {
    setResults([]);
    mutation.reset();
  }

  const count = selectedFormats.length;

  return (
    <div className="flex flex-col gap-4 p-4">
      {results.length === 0 ? (
        <>
          {/* Inputs */}
          {[
            { label: "Product", value: product, setter: setProduct, placeholder: "Nike Air Max 90" },
            { label: "Offer / Headline", value: offer, setter: setOffer, placeholder: "30% Off Summer Sale" },
            { label: "Call to Action", value: cta, setter: setCta, placeholder: "Shop Now" },
          ].map(({ label, value, setter, placeholder }) => (
            <div key={label}>
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                {label}
              </label>
              <input
                type="text"
                value={value}
                onChange={(e) => setter(e.target.value)}
                placeholder={placeholder}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          ))}

          {/* Format selector */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Formats ({count} selected)
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {FORMATS.map((fmt) => (
                <button
                  key={fmt.id}
                  type="button"
                  onClick={() => toggleFormat(fmt.id)}
                  className={cn(
                    "rounded-lg border px-2.5 py-2 text-left transition-colors",
                    selectedFormats.includes(fmt.id)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <p className="text-xs font-medium">{fmt.label}</p>
                  <p className="text-[10px] tabular-nums text-muted-foreground">{fmt.size}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Generate */}
          <button
            type="button"
            disabled={!canGenerate}
            onClick={() => mutation.mutate()}
            className={cn(
              "w-full rounded-lg py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-colors",
              canGenerate
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
          >
            {mutation.isPending ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Generating {count} banner{count !== 1 ? "s" : ""}...
              </>
            ) : (
              `Generate ${count} banner${count !== 1 ? "s" : ""}`
            )}
          </button>

          {mutation.isError && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{(mutation.error as Error).message ?? "Generation failed"}</span>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {results.length} banner{results.length !== 1 ? "s" : ""} generated
          </p>
          <div className="flex flex-col gap-3">
            {results.map((img) => {
              const fmt = FORMATS.find((f) => f.id === (img as GeneratedImage & { banner_format?: string }).banner_format);
              return (
                <div key={img.id} className="rounded-lg border border-border overflow-hidden">
                  {img.status === "ready" && img.image_url ? (
                    <>
                      <div className="bg-muted aspect-video">
                        <img src={img.image_url} alt={fmt?.label ?? "Banner"} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex items-center justify-between px-3 py-2">
                        <div>
                          <p className="text-xs font-medium">{fmt?.label}</p>
                          <p className="text-[10px] text-muted-foreground tabular-nums">{fmt?.size}</p>
                        </div>
                        <a
                          href={img.image_url}
                          download
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </a>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 p-3 text-xs text-destructive">
                      <XCircle className="h-4 w-4 shrink-0" />
                      <span>{img.error ?? "Failed"}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="w-full rounded-lg border border-border py-2 text-xs font-medium hover:bg-accent transition-colors"
          >
            Generate Again
          </button>
        </>
      )}
    </div>
  );
}
