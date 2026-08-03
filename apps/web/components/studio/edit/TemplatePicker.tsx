"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { BrandKit } from "@/lib/api";
import {
  TEXT_TEMPLATES, TEMPLATE_CATEGORIES, brandTemplate,
  type TextTemplate, type TemplateCategory, type ResolvedTemplate,
} from "./text-templates";
import { shapeDataUri, backgroundCss } from "./shapes";

export interface TemplatePickerProps {
  onApply: (t: TextTemplate) => void;
  brandKit?: BrandKit | null;
  brandTemplates: boolean;
  onBrandTemplatesChange: (v: boolean) => void;
  brandUsable: boolean;
  subjectImageUrl?: string;
}

export function TemplatePicker({
  onApply,
  brandKit,
  brandTemplates,
  onBrandTemplatesChange,
  brandUsable,
  subjectImageUrl,
}: TemplatePickerProps) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<"all" | TemplateCategory>("all");
  const [query, setQuery] = useState("");

  const shown = TEXT_TEMPLATES.filter((tpl) => {
    if (category !== "all" && tpl.category !== category) return false;
    if (!query.trim()) return true;
    return tpl.name.toLowerCase().includes(query.trim().toLowerCase());
  });

  /** Template (background + layers) with brand colours/fonts applied when the toggle is on. */
  function resolveTemplate(t: TextTemplate): ResolvedTemplate {
    return brandTemplates && brandUsable
      ? brandTemplate(t, brandKit)
      : { background: t.background ?? null, layers: t.layers };
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Drop a pre-styled text composition onto your image. Every layer stays fully editable — move, restyle, or rewrite it.
      </p>

      {/* Persona categories */}
      <div className="flex flex-wrap gap-1.5">
        {TEMPLATE_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategory(c.id)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
              category === c.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("imageEdit.templates.search", "Search templates")}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />

      {/* Brand-aware toggle */}
      {brandUsable && (
        <button
          type="button"
          onClick={() => onBrandTemplatesChange(!brandTemplates)}
          className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-accent"
        >
          <span className="flex-1 text-xs text-foreground">
            Use brand kit <span className="text-muted-foreground">(badges take your colours &amp; fonts)</span>
          </span>
          <span className={cn("relative inline-flex h-4 w-7 items-center rounded-full transition-colors", brandTemplates ? "bg-primary" : "bg-border")}>
            <span className={cn("inline-block h-3 w-3 transform rounded-full bg-white transition-transform", brandTemplates ? "translate-x-3.5" : "translate-x-0.5")} />
          </span>
        </button>
      )}

      <div className="grid grid-cols-2 gap-2">
        {shown.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onApply(t)}
            className="group rounded-xl border border-border overflow-hidden text-left transition-all hover:border-primary/50 hover:shadow-md"
          >
            {/* Live miniature preview — real backgrounds, shapes and text styles.
                Overlay templates use a dark gradient photo stand-in. */}
            {(() => {
              const { background, layers: defs } = resolveTemplate(t);
              return (
                <div
                  className="relative aspect-[4/3] w-full overflow-hidden"
                  style={{ background: background ? backgroundCss(background) : "linear-gradient(135deg, #64748b, #1e293b)" }}
                >
                  {defs.map((def, i) =>
                    def.kind === "shape" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={shapeDataUri(def.shape, def.color, { color2: def.color2, gradient: def.gradient, shadow: def.shadow })}
                        alt=""
                        style={{
                          position: "absolute",
                          left: `${def.xPct}%`,
                          top: `${def.yPct}%`,
                          width: `${def.widthPct}%`,
                          // Panels and bands carry an explicit height; badges
                          // keep their own aspect ratio.
                          height: def.heightPct != null ? `${def.heightPct}%` : undefined,
                          opacity: def.opacity ?? 1,
                          transform: def.rotation ? `rotate(${def.rotation}deg)` : undefined,
                          // A blended field is a wash over the photo; without
                          // this the thumbnail paints it as a flat block and
                          // hides the photograph the template is built on.
                          mixBlendMode: def.blend,
                        }}
                      />
                    ) : def.kind === "image" ? (
                      // Every family places the photo, so with no subject yet
                      // the slot stays empty rather than showing a broken image.
                      // A "subject-cutout" slot previews with the plain subject:
                      // the background-free copy is a paid operation that only
                      // happens once the user has agreed to it on apply.
                      !(typeof def.source === "string" ? subjectImageUrl : def.source.url) ? null : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={typeof def.source === "string" ? (subjectImageUrl ?? "") : def.source.url}
                        alt=""
                        style={{
                          position: "absolute",
                          left: `${def.xPct}%`,
                          top: `${def.yPct}%`,
                          width: `${def.widthPct}%`,
                          height: def.heightPct != null ? `${def.heightPct}%` : undefined,
                          objectFit: def.fit === "contain" ? "contain" : "cover",
                          opacity: def.opacity ?? 1,
                          borderRadius: !def.clip
                            ? undefined
                            : "shape" in def.clip && def.clip.shape === "circle"
                              ? "50%"
                              : "roundedPct" in def.clip
                                ? `${def.clip.roundedPct}%`
                                : "8px",
                          transform: def.rotation ? `rotate(${def.rotation}deg)` : undefined,
                        }}
                      />
                      )
                    ) : (
                      <span
                        key={i}
                        style={{
                          position: "absolute",
                          left: `${def.xPct}%`,
                          top: `${def.yPct}%`,
                          fontSize: Math.max(5, def.fontSize * 0.17),
                          color: def.color,
                          fontFamily: def.fontFamily,
                          fontWeight: def.bold ? "bold" : "normal",
                          fontStyle: def.italic ? "italic" : "normal",
                          letterSpacing: `${(def.letterSpacing ?? 0) * 0.17}px`,
                          WebkitTextStroke: (def.outlineWidth ?? 0) > 0
                            ? `${Math.max(0.5, (def.outlineWidth ?? 0) * 0.17)}px ${def.outlineColor ?? "#000000"}`
                            : undefined,
                          background: def.bgColor || undefined,
                          padding: def.bgColor ? "0.18em 0.3em" : undefined,
                          borderRadius: def.bgColor ? "0.25em" : undefined,
                          textTransform: def.uppercase ? "uppercase" : undefined,
                          opacity: def.opacity ?? 1,
                          textShadow: (def.shadow ?? true) ? "0 1px 2px rgba(0,0,0,0.5)" : undefined,
                          whiteSpace: "nowrap",
                          lineHeight: 1.2,
                        }}
                      >
                        {def.text}
                      </span>
                    ),
                  )}
                </div>
              );
            })()}
            <div className="px-2 py-1.5">
              <span className="text-[11px] font-medium text-foreground group-hover:text-primary transition-colors">
                {t.name}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
