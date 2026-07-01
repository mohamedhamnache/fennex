"use client";

import { useState } from "react";
import { ChevronDown, Crop, RotateCw, ZoomIn, SlidersHorizontal, Sparkles, Layers, Wand2, Eraser, Sun, Maximize2, Smile, PaintBucket, Filter } from "lucide-react";
import { cn } from "@/lib/cn";

interface Tool {
  id: string;
  label: string;
  icon: React.ElementType;
}

interface ToolGroup {
  id: string;
  label: string;
  tools: Tool[];
}

const TOOL_GROUPS: ToolGroup[] = [
  {
    id: "basic",
    label: "Basic",
    tools: [
      { id: "crop",    label: "Crop",    icon: Crop },
      { id: "resize",  label: "Resize",  icon: Maximize2 },
      { id: "rotate",  label: "Rotate",  icon: RotateCw },
      { id: "adjust",  label: "Adjust",  icon: SlidersHorizontal },
      { id: "filter",  label: "Filter",  icon: Filter },
      { id: "denoise", label: "Denoise", icon: Sparkles },
      { id: "sharpen", label: "Sharpen", icon: ZoomIn },
    ],
  },
  {
    id: "ai",
    label: "AI",
    tools: [
      { id: "remove_background",  label: "Remove BG",      icon: Eraser },
      { id: "replace_background", label: "Replace BG",     icon: PaintBucket },
      { id: "remove_object",      label: "Remove Object",  icon: Wand2 },
      { id: "insert_object",      label: "Insert Object",  icon: Layers },
      { id: "generative_fill",    label: "Generative Fill",icon: Sparkles },
      { id: "smart_erase",        label: "Smart Erase",    icon: Eraser },
    ],
  },
  {
    id: "advanced",
    label: "Advanced",
    tools: [
      { id: "generate_shadow", label: "Add Shadow",    icon: Sun },
      { id: "relight",         label: "Relight",       icon: Sun },
      { id: "restore_face",    label: "Restore Face",  icon: Smile },
      { id: "upscale",         label: "Upscale",       icon: Maximize2 },
    ],
  },
];

interface EditToolsSidebarProps {
  selected: string;
  onSelect: (tool: string) => void;
}

export function EditToolsSidebar({ selected, onSelect }: EditToolsSidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  function toggleGroup(id: string) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="flex flex-col py-2">
      {TOOL_GROUPS.map((group) => {
        const isCollapsed = collapsed[group.id] ?? false;
        return (
          <div key={group.id}>
            <button
              type="button"
              onClick={() => toggleGroup(group.id)}
              className="w-full flex items-center justify-between px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              {group.label}
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  isCollapsed && "rotate-180",
                )}
              />
            </button>
            {!isCollapsed && (
              <div className="flex flex-col pb-1">
                {group.tools.map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={() => onSelect(tool.id)}
                      className={cn(
                        "flex items-center gap-2.5 px-4 py-2 text-sm transition-colors text-left",
                        selected === tool.id
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      {tool.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
