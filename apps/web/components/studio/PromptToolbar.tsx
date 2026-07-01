"use client";

import { useRef, useState } from "react";
import { Sparkles, LayoutTemplate, Bookmark, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { improvePrompt } from "@/lib/api";
import type { ImageStyle, ImageUsage } from "@/lib/api";
import { TemplatesPopover } from "./TemplatesPopover";

interface PromptToolbarProps {
  prompt: string;
  usage: ImageUsage;
  style: ImageStyle;
  projectId: string;
  onImproved: (improved: string, original: string) => void;
  onTemplateSelect: (prompt: string) => void;
  onSave: () => void;
}

export function PromptToolbar({
  prompt,
  usage,
  style,
  projectId,
  onImproved,
  onTemplateSelect,
  onSave,
}: PromptToolbarProps) {
  const [improving, setImproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const templatesButtonRef = useRef<HTMLButtonElement>(null);

  async function handleImprove() {
    if (!prompt.trim()) return;
    setError(null);
    setImproving(true);
    try {
      const { improved_prompt } = await improvePrompt({ prompt: prompt.trim(), usage, style });
      onImproved(improved_prompt, prompt);
    } catch {
      setError("Couldn't improve prompt — try again");
    } finally {
      setImproving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 relative">
        <button
          type="button"
          onClick={handleImprove}
          disabled={improving || !prompt.trim()}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
            "bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          {improving
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Sparkles className="h-3 w-3" />}
          Improve
        </button>

        <div className="relative">
          <button
            ref={templatesButtonRef}
            type="button"
            onClick={() => setShowTemplates((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <LayoutTemplate className="h-3 w-3" />
            Templates
          </button>
          {showTemplates && (
            <TemplatesPopover
              triggerRef={templatesButtonRef}
              onSelect={onTemplateSelect}
              onClose={() => setShowTemplates(false)}
            />
          )}
        </div>

        <button
          type="button"
          onClick={onSave}
          disabled={!prompt.trim()}
          className="ml-auto flex items-center gap-1 rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Save prompt"
        >
          <Bookmark className="h-3.5 w-3.5" />
        </button>
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
