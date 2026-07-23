"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload, X, Plus, Brush, Palette, Type, Quote, Check, type LucideIcon,
} from "lucide-react";
import { getBrandKit, updateBrandKit, uploadBrandLogo } from "@/lib/api";
import type { BrandKit } from "@/lib/api";

/** Small titled card wrapper for each editor block. */
function FieldCard({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-4 backdrop-blur-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <p className="text-sm font-semibold text-foreground">{title}</p>
      </div>
      {children}
    </div>
  );
}

const INPUT_CLS =
  "w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30";

// Curated brand fonts for the typography pickers.
const FONT_OPTIONS = [
  "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Nunito",
  "Raleway", "Work Sans", "DM Sans", "Space Grotesk", "Playfair Display",
  "Merriweather", "Lora", "Fraunces", "Georgia", "Oswald", "Bebas Neue",
];

/** Font dropdown; preserves any custom value already saved on the kit. */
function FontSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const opts = value && !FONT_OPTIONS.includes(value) ? [value, ...FONT_OPTIONS] : FONT_OPTIONS;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT_CLS} style={{ fontFamily: value || undefined }}>
      <option value="">—</option>
      {opts.map((f) => (
        <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
      ))}
    </select>
  );
}

export function BrandKitSection() {
  const { t } = useTranslation();
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

  // Mark the form dirty so the "Saved" pill clears once the user edits again.
  function touch<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); if (saveMutation.isSuccess) saveMutation.reset(); };
  }

  if (isLoading) {
    return <div className="h-64 rounded-2xl border border-border bg-card/40 animate-pulse" />;
  }

  const fontLine = [primaryFont, secondaryFont].filter(Boolean).join("  ·  ");

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Brush className="h-5 w-5" strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground">{t("settings.brandKit.title")}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("settings.brandKit.subtitle")}</p>
        </div>
      </div>

      {/* Live brand preview */}
      <div className="relative overflow-hidden rounded-2xl border border-border p-5">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(600px 200px at 12% -30%, hsl(var(--primary) / 0.16), transparent 60%), radial-gradient(420px 160px at 100% 0%, hsl(var(--primary-accent) / 0.10), transparent 60%)" }}
        />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          {/* Logo */}
          <div className="flex h-24 w-36 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-background p-3">
            {kit?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={kit.logo_url} alt={t("settings.brandKit.logo")} className="h-full w-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-1.5 text-muted-foreground/60">
                <Brush className="h-5 w-5" strokeWidth={1.6} />
                <span className="text-[10px] font-medium">{t("settings.brandKit.noLogo")}</span>
              </div>
            )}
          </div>
          {/* Specimen + palette */}
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-2xl font-semibold text-foreground" style={{ fontFamily: primaryFont || undefined }}>
              {t("settings.brandKit.specimen")}
            </p>
            <p className="mt-0.5 truncate text-sm text-muted-foreground" style={{ fontFamily: secondaryFont || undefined }}>
              {fontLine || t("settings.brandKit.addFonts")}
            </p>
            {colors.length > 0 ? (
              <div className="mt-3 inline-flex h-7 overflow-hidden rounded-lg border border-border shadow-sm">
                {colors.map((c, i) => (
                  <span key={i} className="h-full w-9" style={{ background: c }} title={c} />
                ))}
              </div>
            ) : (
              <div className="mt-3 inline-flex h-7 items-center rounded-lg border border-dashed border-border px-3 text-[11px] font-medium text-muted-foreground">
                {t("settings.brandKit.noColors")}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Logo uploader */}
      <FieldCard icon={Upload} title={t("settings.brandKit.logo")}>
        <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.svg" className="hidden" onChange={handleLogoChange} />
        {logoError && <p className="mb-2 text-xs text-destructive">{logoError}</p>}
        {kit?.logo_url ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={kit.logo_url} alt={t("settings.brandKit.logo")} className="h-14 w-auto rounded-lg border border-border bg-background object-contain p-1.5" />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              {t("settings.brandKit.replace")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={logoMutation.isPending}
            className="group flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-4 py-6 text-center transition-colors hover:border-primary/40 hover:bg-primary/[0.03] disabled:opacity-50"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-105">
              <Upload className="h-4 w-4" />
            </span>
            <span className="text-sm font-medium text-foreground">
              {logoMutation.isPending ? t("settings.brandKit.uploading") : t("settings.brandKit.uploadCta")}
            </span>
            <span className="text-[11px] text-muted-foreground">{t("settings.brandKit.uploadHint")}</span>
          </button>
        )}
      </FieldCard>

      {/* Colors */}
      <FieldCard icon={Palette} title={t("settings.brandKit.colors")}>
        <div className="flex flex-wrap items-start gap-3">
          {colors.map((color, i) => (
            <div key={i} className="group relative">
              <label className="block cursor-pointer">
                <span className="block h-12 w-12 rounded-xl border border-border shadow-sm transition-transform group-hover:scale-105" style={{ background: color }} />
                <input
                  type="color"
                  value={color}
                  onChange={(e) => touch(setColors)(colors.map((c, j) => (j === i ? e.target.value : c)))}
                  className="sr-only"
                />
              </label>
              <p className="mt-1 text-center font-mono text-[10px] uppercase text-muted-foreground">{color}</p>
              <button
                type="button"
                onClick={() => touch(setColors)(colors.filter((_, j) => j !== i))}
                className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-destructive text-white group-hover:flex"
                aria-label={t("settings.brandKit.colors")}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => touch(setColors)([...colors, "#c2603a"])}
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            aria-label={t("settings.brandKit.addColor")}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </FieldCard>

      {/* Typography */}
      <FieldCard icon={Type} title={t("settings.brandKit.typography")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{t("settings.brandKit.primaryFont")}</label>
            <FontSelect value={primaryFont} onChange={touch(setPrimaryFont)} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{t("settings.brandKit.secondaryFont")}</label>
            <FontSelect value={secondaryFont} onChange={touch(setSecondaryFont)} />
          </div>
        </div>
      </FieldCard>

      {/* Voice & style */}
      <FieldCard icon={Quote} title={t("settings.brandKit.voice")}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{t("settings.brandKit.styleRules")}</label>
            <textarea
              value={styleRules}
              onChange={(e) => touch(setStyleRules)(e.target.value)}
              rows={3}
              placeholder={t("settings.brandKit.styleRulesPlaceholder")}
              className={`${INPUT_CLS} resize-none`}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{t("settings.brandKit.tone")}</label>
            <input value={tone} onChange={(e) => touch(setTone)(e.target.value)} placeholder={t("settings.brandKit.tonePlaceholder")} className={INPUT_CLS} />
          </div>
        </div>
      </FieldCard>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
        >
          {saveMutation.isPending ? t("settings.brandKit.saving") : t("settings.brandKit.save")}
        </button>
        {saveMutation.isSuccess && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success animate-fade-in">
            <Check className="h-3.5 w-3.5" /> {t("settings.brandKit.saved")}
          </span>
        )}
        {saveMutation.isError && (
          <span className="text-xs font-medium text-destructive">{t("settings.brandKit.saveError")}</span>
        )}
      </div>
    </div>
  );
}
