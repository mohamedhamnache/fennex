"use client";

import { useRef, useState, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { TEMPLATE_CATEGORIES } from "./templates";

interface TemplatesPopoverProps {
  onSelect: (prompt: string) => void;
  onClose: () => void;
}

export function TemplatesPopover({ onSelect, onClose }: TemplatesPopoverProps) {
  const [activeCategory, setActiveCategory] = useState(TEMPLATE_CATEGORIES[0].id);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const category = TEMPLATE_CATEGORIES.find((c) => c.id === activeCategory)!;

  return (
    <div
      ref={ref}
      className="absolute left-0 bottom-full mb-2 z-50 w-80 rounded-xl border border-border bg-popover shadow-lg animate-scale-in"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <p className="text-xs font-semibold text-foreground">Industry Templates</p>
        <button
          onClick={onClose}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5 scrollbar-none">
        {TEMPLATE_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              activeCategory === cat.id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Prompts list */}
      <div className="py-1 max-h-48 overflow-y-auto">
        {category.prompts.map((prompt, i) => (
          <button
            key={i}
            onClick={() => { onSelect(prompt); onClose(); }}
            className="w-full px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors line-clamp-2"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
