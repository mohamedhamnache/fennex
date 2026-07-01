"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, X, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { getBrandKit, updateBrandKit, uploadBrandLogo } from "@/lib/api";
import type { BrandKit } from "@/lib/api";

export function BrandKitSection() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [initialized, setInitialized] = useState(false);
  const [colors, setColors] = useState<string[]>([]);
  const [primaryFont, setPrimaryFont] = useState("");
  const [secondaryFont, setSecondaryFont] = useState("");
  const [styleRules, setStyleRules] = useState("");
  const [tone, setTone] = useState("");
  const [logoError, setLogoError] = useState<string | null>(null);

  const { data: kit, isLoading } = useQuery<BrandKit>({
    queryKey: ["brand-kit"],
    queryFn: getBrandKit,
  });

  if (kit && !initialized) {
    setColors(kit.colors ?? []);
    setPrimaryFont(kit.primary_font ?? "");
    setSecondaryFont(kit.secondary_font ?? "");
    setStyleRules(kit.style_rules ?? "");
    setTone(kit.tone ?? "");
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      updateBrandKit({
        colors,
        primary_font: primaryFont || undefined,
        secondary_font: secondaryFont || undefined,
        style_rules: styleRules || undefined,
        tone: tone || undefined,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brand-kit"] }),
  });

  const logoMutation = useMutation({
    mutationFn: (file: File) => uploadBrandLogo(file),
    onSuccess: () => {
      setLogoError(null);
      qc.invalidateQueries({ queryKey: ["brand-kit"] });
    },
    onError: (e: Error) => setLogoError(e.message),
  });

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) logoMutation.mutate(file);
    e.target.value = "";
  }

  if (isLoading) {
    return <div className="h-48 rounded-xl bg-card border border-border animate-pulse" />;
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6 flex flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold text-foreground">Brand Kit</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Your brand identity is automatically injected into image prompts when &quot;Use brand kit&quot; is enabled in the studio.
        </p>
      </div>

      {/* Logo */}
      <div>
        <p className="text-xs font-semibold text-foreground mb-2">Logo</p>
        <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.svg" className="hidden" onChange={handleLogoChange} />
        {logoError && (
          <p className="mb-2 text-xs text-destructive">{logoError}</p>
        )}
        {kit?.logo_url ? (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={kit.logo_url}
              alt="Brand logo"
              className="h-16 w-auto rounded-lg border border-border object-contain bg-background p-2"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-2 block text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Replace
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={logoMutation.isPending}
            className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:border-primary transition-colors disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {logoMutation.isPending ? "Uploading…" : "Upload logo (PNG, JPG, SVG — max 5 MB)"}
          </button>
        )}
      </div>

      {/* Colors */}
      <div>
        <p className="text-xs font-semibold text-foreground mb-2">Brand Colors</p>
        <div className="flex flex-wrap gap-2 items-center">
          {colors.map((color, i) => (
            <div key={i} className="relative group">
              <input
                type="color"
                value={color}
                onChange={(e) => setColors((prev) => prev.map((c, j) => (j === i ? e.target.value : c)))}
                className="h-8 w-8 cursor-pointer rounded-md border border-border p-0.5 bg-transparent"
                title={color}
              />
              <button
                onClick={() => setColors((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -top-1 -right-1 hidden group-hover:flex h-4 w-4 rounded-full bg-destructive items-center justify-center"
              >
                <X className="h-2.5 w-2.5 text-white" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setColors((prev) => [...prev, "#000000"])}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Fonts */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-foreground mb-1.5">Primary Font</label>
          <input
            value={primaryFont}
            onChange={(e) => setPrimaryFont(e.target.value)}
            placeholder="e.g. Inter"
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-foreground mb-1.5">Secondary Font</label>
          <input
            value={secondaryFont}
            onChange={(e) => setSecondaryFont(e.target.value)}
            placeholder="e.g. Playfair Display"
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      {/* Style rules */}
      <div>
        <label className="block text-xs font-semibold text-foreground mb-1.5">Style Rules</label>
        <textarea
          value={styleRules}
          onChange={(e) => setStyleRules(e.target.value)}
          rows={3}
          placeholder="e.g. Clean white backgrounds, minimal design, premium feel"
          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
        />
      </div>

      {/* Tone */}
      <div>
        <label className="block text-xs font-semibold text-foreground mb-1.5">Tone / Mood</label>
        <input
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          placeholder="e.g. Premium, confident, understated"
          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {saveMutation.isError && (
        <p className="text-sm text-destructive">Failed to save — please try again.</p>
      )}

      <button
        type="button"
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        className="self-start btn-primary px-4 py-2 text-sm disabled:opacity-50"
      >
        {saveMutation.isPending ? "Saving…" : "Save Brand Kit"}
      </button>
    </div>
  );
}
