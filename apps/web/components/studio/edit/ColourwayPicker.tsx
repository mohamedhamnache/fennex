"use client";

/** A row of palette swatches for the template currently on the canvas.
 *
 *  QUICK APPLY IS THE WHOLE POINT. One click re-renders the applied template in
 *  the chosen colours, in place, with no dialog and no confirmation step —
 *  changing a colourway is the same operation as swapping a template (rebuild
 *  the layout, replace the previous layers), so it costs exactly what a swap
 *  costs and nothing else.
 *
 *  A SHORTLIST FIRST, not all thirteen. The list arrives already ordered by
 *  `suggestedColourways`, which puts the colourway the template was designed in
 *  first and then ranks by what suits its ground; showing the first few and
 *  keeping the rest one click away is the difference between a suggestion and a
 *  colour dump. Every compatible colourway is still reachable.
 *
 *  ONLY COMPATIBLE ONES ARRIVE HERE. The caller filters through
 *  `colourwaysForTemplate`, which drops any colourway the layout's register or
 *  the template's GROUND rules out — Sunset and Ember on a gradient ground being
 *  the measured case. Silently offering a broken combination is worse than
 *  offering fewer, so this component never widens the list it is handed.
 *
 *  The swatches paint real palette values, which is why there are hex colours in
 *  a file that otherwise takes its colours from CSS variables: the swatch IS the
 *  data. Every piece of chrome around it — border, ring, text — is a token. */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Colourway } from "./design/colourways";

/** How many suggestions to show before "more". Two rows of the grid below. */
const SHORTLIST = 6;

export interface ColourwayPickerProps {
  /** Compatible colourways, best first. */
  colourways: Colourway[];
  /** The one the applied template is rendered in. */
  currentId: string;
  onPick: (colourwayId: string) => void;
}

/** The stops as hard-edged bands, so the swatch shows what the palette IS
 *  rather than a blur of it, with the accent as a pip over the corner. */
function bands(stops: string[]): string {
  const step = 100 / Math.max(1, stops.length);
  const parts = stops.map(
    (c, i) => `${c} ${(i * step).toFixed(2)}%, ${c} ${((i + 1) * step).toFixed(2)}%`,
  );
  return `linear-gradient(135deg, ${parts.join(", ")})`;
}

export function ColourwayPicker({
  colourways,
  currentId,
  onPick,
}: ColourwayPickerProps) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);

  if (colourways.length < 2) return null;

  const shown = showAll ? colourways : colourways.slice(0, SHORTLIST);
  const rest = colourways.length - shown.length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("imageEdit.templates.palette", "Palette")}
        </span>
        {(rest > 0 || showAll) && (
          <button
            type="button"
            onClick={() => setShowAll((p) => !p)}
            className="text-[10px] font-medium text-primary transition-opacity hover:opacity-80"
          >
            {showAll
              ? t("imageEdit.templates.fewerPalettes", "Show fewer")
              : t("imageEdit.templates.morePalettes", "Show all")}
          </button>
        )}
      </div>

      <div className="grid grid-cols-6 gap-1.5">
        {shown.map((cw) => {
          const current = cw.id === currentId;
          return (
            <button
              key={cw.id}
              type="button"
              title={cw.name}
              aria-label={cw.name}
              aria-pressed={current}
              onClick={() => onPick(cw.id)}
              className={cn(
                "relative aspect-square overflow-hidden rounded-md border transition-all",
                current
                  ? "border-primary ring-2 ring-primary/40"
                  : "border-border hover:border-primary/50",
              )}
              style={{ background: bands(cw.stops) }}
            >
              <span
                aria-hidden
                className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full"
                style={{ background: cw.accent }}
              />
              {current && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                  <Check className="h-3 w-3 text-white" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
