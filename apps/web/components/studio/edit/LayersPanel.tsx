"use client";

import { Eye, EyeOff, Box, Type, ChevronUp, ChevronDown, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Layer, TextLayer, ImageLayer } from "./EditCanvas";

export interface LayersPanelProps {
  layers: Layer[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string) => void;
  onMoveLayerUp: (id: string) => void;
  onMoveLayerDown: (id: string) => void;
  onRemoveLayer: (id: string) => void;
  onToggleLayerVisible: (id: string) => void;
}

export function LayersPanel({
  layers,
  selectedLayerId,
  onSelectLayer,
  onMoveLayerUp,
  onMoveLayerDown,
  onRemoveLayer,
  onToggleLayerVisible,
}: LayersPanelProps) {
  return (
    <>
      {/* Layer list */}
      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Layers ({layers.length})</p>
      {[...layers].reverse().map((layer, displayIdx) => {
        const arrayIdx = layers.length - 1 - displayIdx;
        const isSelected = selectedLayerId === layer.id;
        return (
          <div
            key={layer.id}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-2 py-1.5 cursor-pointer transition-colors",
              isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-accent/50",
            )}
            onClick={() => onSelectLayer(layer.id)}
          >
            <button type="button"
              onClick={(e) => { e.stopPropagation(); onToggleLayerVisible(layer.id); }}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
              {layer.visible !== false ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 opacity-40" />}
            </button>
            <div className="h-7 w-7 flex items-center justify-center rounded bg-muted shrink-0 border border-border overflow-hidden">
              {layer.type === "image"
                ? <Box className="h-3.5 w-3.5 text-muted-foreground" />
                : <Type className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
            <span className="flex-1 text-xs text-foreground truncate"
              style={layer.type === "text" ? {
                fontFamily: (layer as TextLayer).fontFamily,
                fontWeight: (layer as TextLayer).bold ? "bold" : "normal",
                fontStyle: (layer as TextLayer).italic ? "italic" : "normal",
                color: (layer as TextLayer).color,
              } : undefined}>
              {layer.type === "text" ? (layer as TextLayer).text || "Empty text" : (layer as ImageLayer).name}
            </span>
            <div className="flex flex-col shrink-0">
              <button type="button"
                onClick={(e) => { e.stopPropagation(); onMoveLayerUp(layer.id); }}
                disabled={arrayIdx === layers.length - 1}
                className="text-muted-foreground hover:text-foreground disabled:opacity-25 transition-colors">
                <ChevronUp className="h-3 w-3" />
              </button>
              <button type="button"
                onClick={(e) => { e.stopPropagation(); onMoveLayerDown(layer.id); }}
                disabled={arrayIdx === 0}
                className="text-muted-foreground hover:text-foreground disabled:opacity-25 transition-colors">
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
            <button type="button"
              onClick={(e) => { e.stopPropagation(); onRemoveLayer(layer.id); }}
              className="shrink-0 text-muted-foreground hover:text-destructive transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </>
  );
}
