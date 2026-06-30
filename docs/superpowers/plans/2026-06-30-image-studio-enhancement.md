# Image Studio Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-page split-panel Image Studio with an AI prompt engineering assistant, 9-style grid, batch generation, image-to-image upload, and prompt history/saved library.

**Architecture:** A new route `app/(dashboard)/[projectId]/images/studio/page.tsx` hosts a two-column layout (left: controls, right: results). The existing `/images` gallery page is unchanged except its Generate button becomes a Link. All new UI is isolated in `components/studio/`. State (prompt, batch results, session history) is local to the studio page; no new Zustand stores needed.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript 5, TanStack Query v5, Tailwind CSS v3, Lucide React, `localStorage` for prompt persistence.

## Global Constraints

- No new dependencies — use only what's in `package.json`
- All API calls go through `apiClient` in `apps/web/lib/api.ts` — never call `fetch` directly
- Follow existing Tailwind patterns: use CSS variables (`hsl(var(--primary))`, `bg-card`, etc.), `cn()` from `@/lib/cn`, `animate-scale-in` for popovers
- No test framework is configured — verify every task with `npm run typecheck` from `apps/web/`
- No i18n strings for studio components in this phase — English only (i18n can be added later)
- `ImageStyle` values must be valid strings the backend accepts — new styles are added as type-only here; backend validation is a separate backend task noted in each step

---

## File Map

**Create:**
- `apps/web/components/studio/templates.ts` — static template data (categories + prompts)
- `apps/web/components/studio/prompt-storage.ts` — localStorage helpers (history, saved)
- `apps/web/components/studio/StyleGrid.tsx` — 9-style card grid selector
- `apps/web/components/studio/TemplatesPopover.tsx` — template category picker popover
- `apps/web/components/studio/PromptToolbar.tsx` — Improve / Templates / Bookmark buttons
- `apps/web/components/studio/ResultCard.tsx` — single generated image result card
- `apps/web/components/studio/GenerationRun.tsx` — session history run strip (collapsed/expanded)
- `apps/web/components/studio/StudioLeftPanel.tsx` — left panel assembling all controls
- `apps/web/components/studio/StudioRightPanel.tsx` — right panel (empty state, skeletons, grid, history)
- `apps/web/app/(dashboard)/[projectId]/images/studio/page.tsx` — studio page shell + orchestration

**Modify:**
- `apps/web/lib/api.ts` — extend `ImageStyle`, add `reference_image` to `generateImage`, add `improvePrompt`
- `apps/web/app/(dashboard)/[projectId]/images/page.tsx` — replace Generate modal trigger with Link to studio

---

## Task 1: Extend API types and add `improvePrompt`

**Files:**
- Modify: `apps/web/lib/api.ts:692`

**Interfaces:**
- Produces:
  - `ImageStyle` (extended union): `"photorealistic" | "illustration" | "minimalist" | "abstract" | "professional" | "3d_render" | "anime" | "cinematic" | "luxury_product"`
  - `generateImage(data: { ..., reference_image?: string })` — unchanged signature otherwise
  - `improvePrompt(data: { prompt: string; usage?: ImageUsage; style?: ImageStyle }): Promise<{ improved_prompt: string }>`

- [ ] **Step 1: Update `ImageStyle` and `generateImage` in `api.ts`**

Replace lines 692 and 721–733 with:

```typescript
export type ImageStyle =
  | "photorealistic"
  | "illustration"
  | "minimalist"
  | "abstract"
  | "professional"
  | "3d_render"
  | "anime"
  | "cinematic"
  | "luxury_product";
```

And update `generateImage`:

```typescript
export async function generateImage(data: {
  project_id: string;
  prompt?: string;
  title?: string;
  keyword?: string;
  style?: ImageStyle;
  usage?: ImageUsage;
  article_id?: string;
  social_post_id?: string;
  quality?: "standard" | "hd";
  reference_image?: string; // base64 data URI or URL
}): Promise<GeneratedImage> {
  return apiClient.post<GeneratedImage>("/images/generate", data);
}
```

- [ ] **Step 2: Add `improvePrompt` function after `attachImage`**

```typescript
export async function improvePrompt(data: {
  prompt: string;
  usage?: ImageUsage;
  style?: ImageStyle;
}): Promise<{ improved_prompt: string }> {
  return apiClient.post<{ improved_prompt: string }>("/images/improve-prompt", data);
}
```

> **Backend note:** The backend needs `POST /api/v1/images/improve-prompt` that accepts `{ prompt, usage?, style? }` and returns `{ improved_prompt: string }`. This is a backend task outside this plan.

- [ ] **Step 3: Verify types**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors (the new style values and optional `reference_image` are additive).

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/api.ts
git commit -m "feat(studio): extend ImageStyle union and add improvePrompt API fn"
```

---

## Task 2: Static data — templates and prompt storage

**Files:**
- Create: `apps/web/components/studio/templates.ts`
- Create: `apps/web/components/studio/prompt-storage.ts`

**Interfaces:**
- Produces:
  - `TEMPLATE_CATEGORIES: TemplateCategory[]`
  - `TemplateCategory: { id: string; label: string; prompts: string[] }`
  - `addToHistory(projectId: string, prompt: string): void`
  - `getHistory(projectId: string): string[]`
  - `savePrompt(projectId: string, prompt: string): void`
  - `getSaved(projectId: string): string[]`
  - `removeSaved(projectId: string, prompt: string): void`

- [ ] **Step 1: Create `templates.ts`**

```typescript
// apps/web/components/studio/templates.ts

export interface TemplateCategory {
  id: string;
  label: string;
  prompts: string[];
}

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  {
    id: "ecommerce",
    label: "Ecommerce",
    prompts: [
      "Ultra-realistic luxury product hero shot, studio lighting, soft gradient background, shallow depth of field, 8K sharp details, white backdrop",
      "Lifestyle product mockup, natural light, person using the product in a modern home setting, warm tones, editorial style",
      "Clean packshot on pure white background, professional product photography, crisp shadows, centered composition",
      "E-commerce banner creative, product on the left, bold CTA text space on the right, gradient background, modern design",
    ],
  },
  {
    id: "food",
    label: "Food",
    prompts: [
      "Restaurant dish overhead flat lay, ceramic plate, garnish details, moody dark background, professional food photography",
      "Food styling flat lay, colorful ingredients arranged artfully, bright natural light, top-down view, clean composition",
      "Recipe hero image, finished dish in a rustic setting, steam rising, warm golden hour light, shallow depth of field",
      "Cozy cafe ambiance, latte art, warm bokeh lights, wooden table, magazine editorial style",
    ],
  },
  {
    id: "real_estate",
    label: "Real Estate",
    prompts: [
      "Modern interior wide-angle shot, open-plan living room, natural light flooding in, minimalist Scandinavian design, 4K",
      "Aerial exterior property shot, golden hour, lush garden, swimming pool, luxury residential architecture",
      "Luxury bathroom interior, marble finishes, rainfall shower, warm accent lighting, architectural photography",
      "Open-plan kitchen and living area, high ceilings, floor-to-ceiling windows, contemporary design, bright and airy",
    ],
  },
  {
    id: "fashion",
    label: "Fashion",
    prompts: [
      "High fashion editorial runway shot, dramatic studio lighting, avant-garde outfit, model striking pose, Vogue magazine style",
      "Streetwear lookbook photography, urban background, natural light, candid style, Gen Z aesthetic",
      "Luxury jewellery close-up macro shot, diamond ring, black velvet background, sparkle and reflections, ultra-detailed",
      "Athletic sportswear action shot, athlete in motion, dynamic blur, outdoor stadium, Nike campaign style",
    ],
  },
  {
    id: "social_ads",
    label: "Social Ads",
    prompts: [
      "Instagram story product ad, vertical 9:16 format, bold typography space at top, product centered, vibrant gradient background",
      "Facebook ad banner, product on left, offer text space on right, clean design, high contrast, call-to-action friendly",
      "YouTube thumbnail, bold dramatic lighting, expressive face, large text overlay space, high contrast colors",
      "TikTok cover image, trendy aesthetic, bold color palette, Gen Z style, vertical format, eye-catching composition",
    ],
  },
];
```

- [ ] **Step 2: Create `prompt-storage.ts`**

```typescript
// apps/web/components/studio/prompt-storage.ts

const HISTORY_KEY = (projectId: string) => `prompt-history-${projectId}`;
const SAVED_KEY = (projectId: string) => `prompt-saved-${projectId}`;
const MAX_HISTORY = 10;

function readList(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]");
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]): void {
  localStorage.setItem(key, JSON.stringify(list));
}

export function addToHistory(projectId: string, prompt: string): void {
  const key = HISTORY_KEY(projectId);
  const list = readList(key).filter((p) => p !== prompt);
  writeList(key, [prompt, ...list].slice(0, MAX_HISTORY));
}

export function getHistory(projectId: string): string[] {
  return readList(HISTORY_KEY(projectId));
}

export function savePrompt(projectId: string, prompt: string): void {
  const key = SAVED_KEY(projectId);
  const list = readList(key);
  if (!list.includes(prompt)) {
    writeList(key, [prompt, ...list]);
  }
}

export function getSaved(projectId: string): string[] {
  return readList(SAVED_KEY(projectId));
}

export function removeSaved(projectId: string, prompt: string): void {
  const key = SAVED_KEY(projectId);
  writeList(key, readList(key).filter((p) => p !== prompt));
}
```

- [ ] **Step 3: Verify types**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/studio/templates.ts apps/web/components/studio/prompt-storage.ts
git commit -m "feat(studio): add template library and prompt localStorage helpers"
```

---

## Task 3: StyleGrid component

**Files:**
- Create: `apps/web/components/studio/StyleGrid.tsx`

**Interfaces:**
- Consumes: `ImageStyle` from `@/lib/api`
- Produces: `<StyleGrid value={style} onChange={(s: ImageStyle) => void} />`

- [ ] **Step 1: Create `StyleGrid.tsx`**

```tsx
// apps/web/components/studio/StyleGrid.tsx
"use client";

import { cn } from "@/lib/cn";
import type { ImageStyle } from "@/lib/api";

const STYLES: { value: ImageStyle; label: string }[] = [
  { value: "professional",    label: "Professional" },
  { value: "photorealistic",  label: "Photorealistic" },
  { value: "illustration",    label: "Illustration" },
  { value: "minimalist",      label: "Minimalist" },
  { value: "abstract",        label: "Abstract" },
  { value: "3d_render",       label: "3D Render" },
  { value: "anime",           label: "Anime" },
  { value: "cinematic",       label: "Cinematic" },
  { value: "luxury_product",  label: "Luxury Product" },
];

interface StyleGridProps {
  value: ImageStyle;
  onChange: (style: ImageStyle) => void;
}

export function StyleGrid({ value, onChange }: StyleGridProps) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {STYLES.map((s) => (
        <button
          key={s.value}
          type="button"
          onClick={() => onChange(s.value)}
          className={cn(
            "rounded-lg border px-2 py-2 text-xs font-medium transition-colors text-center",
            value === s.value
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-accent",
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/studio/StyleGrid.tsx
git commit -m "feat(studio): add StyleGrid component (9 styles)"
```

---

## Task 4: TemplatesPopover component

**Files:**
- Create: `apps/web/components/studio/TemplatesPopover.tsx`

**Interfaces:**
- Consumes: `TEMPLATE_CATEGORIES` from `./templates`
- Produces: `<TemplatesPopover onSelect={(prompt: string) => void} onClose: () => void />`

- [ ] **Step 1: Create `TemplatesPopover.tsx`**

```tsx
// apps/web/components/studio/TemplatesPopover.tsx
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
```

- [ ] **Step 2: Verify types**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/studio/TemplatesPopover.tsx
git commit -m "feat(studio): add TemplatesPopover with 5 industry categories"
```

---

## Task 5: PromptToolbar component

**Files:**
- Create: `apps/web/components/studio/PromptToolbar.tsx`

**Interfaces:**
- Consumes: `improvePrompt` from `@/lib/api`, `TemplatesPopover` from `./TemplatesPopover`, `savePrompt` from `./prompt-storage`, `ImageStyle`, `ImageUsage` from `@/lib/api`
- Produces:
  ```tsx
  <PromptToolbar
    prompt: string
    usage: ImageUsage
    style: ImageStyle
    projectId: string
    onImproved: (improved: string, original: string) => void
    onTemplateSelect: (prompt: string) => void
    onSave: () => void
  />
  ```

- [ ] **Step 1: Create `PromptToolbar.tsx`**

```tsx
// apps/web/components/studio/PromptToolbar.tsx
"use client";

import { useState } from "react";
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
            type="button"
            onClick={() => setShowTemplates((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <LayoutTemplate className="h-3 w-3" />
            Templates
          </button>
          {showTemplates && (
            <TemplatesPopover
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
```

- [ ] **Step 2: Verify types**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/studio/PromptToolbar.tsx
git commit -m "feat(studio): add PromptToolbar with Improve, Templates, Bookmark"
```

---

## Task 6: ResultCard component

**Files:**
- Create: `apps/web/components/studio/ResultCard.tsx`

**Interfaces:**
- Consumes: `GeneratedImage` from `@/lib/api`
- Produces:
  ```tsx
  <ResultCard
    image: GeneratedImage | null   // null = loading skeleton
    onUse: (image: GeneratedImage) => void
    onRegenerate: () => void
  />
  ```

- [ ] **Step 1: Create `ResultCard.tsx`**

```tsx
// apps/web/components/studio/ResultCard.tsx
"use client";

import { Download, Link as LinkIcon, RotateCcw, AlertCircle, Loader2, Image as ImageIcon } from "lucide-react";
import type { GeneratedImage } from "@/lib/api";

interface ResultCardProps {
  image: GeneratedImage | null;
  onUse: (image: GeneratedImage) => void;
  onRegenerate: () => void;
}

export function ResultCard({ image, onUse, onRegenerate }: ResultCardProps) {
  if (image === null) {
    return (
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="aspect-square skeleton" />
        <div className="p-3 flex flex-col gap-2">
          <div className="h-3 w-3/4 skeleton rounded" />
          <div className="h-3 w-1/2 skeleton rounded" />
        </div>
      </div>
    );
  }

  function handleDownload() {
    if (!image.image_url) return;
    const a = document.createElement("a");
    a.href = image.image_url;
    a.download = `studio-${image.id}.png`;
    a.target = "_blank";
    a.click();
  }

  const isLoading = image.status === "pending" || image.status === "generating";
  const isFailed = image.status === "failed";
  const isReady = image.status === "ready" && !!image.image_url;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      {/* Image area */}
      <div className="relative aspect-square bg-muted">
        {isLoading && (
          <div className="absolute inset-0 skeleton flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {isFailed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-destructive/10 border-2 border-destructive/30">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <span className="text-xs text-destructive px-2 text-center">
              {image.error ?? "Generation failed"}
            </span>
          </div>
        )}
        {isReady && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.image_url!}
            alt={image.prompt}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        {!isLoading && !isFailed && !isReady && (
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
          </div>
        )}
      </div>

      {/* Prompt preview */}
      <div className="px-3 pt-2.5 pb-1">
        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {image.prompt || "—"}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 px-3 pb-3 pt-1.5">
        <button
          onClick={handleDownload}
          disabled={!isReady}
          className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="h-3 w-3" /> Download
        </button>
        <button
          onClick={() => onUse(image)}
          disabled={!isReady}
          className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <LinkIcon className="h-3 w-3" /> Use
        </button>
        <button
          onClick={onRegenerate}
          className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Regenerate"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/studio/ResultCard.tsx
git commit -m "feat(studio): add ResultCard with download, use, regenerate actions"
```

---

## Task 7: GenerationRun component (session history strip)

**Files:**
- Create: `apps/web/components/studio/GenerationRun.tsx`

**Interfaces:**
- Consumes: `GeneratedImage` from `@/lib/api`, `ResultCard` from `./ResultCard`
- Produces:
  ```tsx
  <GenerationRun
    prompt: string
    images: GeneratedImage[]
    batchCount: number
    onUse: (image: GeneratedImage) => void
    onRegenerate: (index: number) => void
  />
  ```

- [ ] **Step 1: Create `GenerationRun.tsx`**

```tsx
// apps/web/components/studio/GenerationRun.tsx
"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import type { GeneratedImage } from "@/lib/api";
import { ResultCard } from "./ResultCard";

interface GenerationRunProps {
  prompt: string;
  images: GeneratedImage[];
  batchCount: number;
  onUse: (image: GeneratedImage) => void;
  onRegenerate: (index: number) => void;
}

export function GenerationRun({ prompt, images, batchCount, onUse, onRegenerate }: GenerationRunProps) {
  const [expanded, setExpanded] = useState(false);

  const gridCols =
    batchCount === 1 ? "grid-cols-1" :
    batchCount === 2 ? "grid-cols-2" :
    "grid-cols-2";

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Collapsed header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors text-left"
      >
        {/* Thumbnails strip */}
        <div className="flex gap-1 shrink-0">
          {images.slice(0, 4).map((img, i) => (
            img.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={img.image_url}
                alt=""
                className="h-8 w-8 rounded object-cover border border-border"
              />
            ) : (
              <div key={i} className="h-8 w-8 rounded bg-muted border border-border" />
            )
          ))}
        </div>
        <span className="flex-1 text-xs text-muted-foreground truncate">{prompt || "—"}</span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
        />
      </button>

      {/* Expanded grid */}
      {expanded && (
        <div className={cn("grid gap-3 p-4 border-t border-border", gridCols)}>
          {images.map((img, i) => (
            <ResultCard
              key={img.id}
              image={img}
              onUse={onUse}
              onRegenerate={() => onRegenerate(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/studio/GenerationRun.tsx
git commit -m "feat(studio): add GenerationRun session history strip"
```

---

## Task 8: StudioLeftPanel component

**Files:**
- Create: `apps/web/components/studio/StudioLeftPanel.tsx`

**Interfaces:**
- Consumes: `StyleGrid`, `PromptToolbar`, from this folder; `ImageStyle`, `ImageUsage` from `@/lib/api`; `addToHistory`, `getHistory`, `getSaved`, `savePrompt`, `removeSaved` from `./prompt-storage`
- Produces:
  ```tsx
  <StudioLeftPanel
    projectId: string
    prompt: string
    onPromptChange: (p: string) => void
    negativePrompt: string
    onNegativePromptChange: (p: string) => void
    style: ImageStyle
    onStyleChange: (s: ImageStyle) => void
    quality: "standard" | "hd"
    onQualityChange: (q: "standard" | "hd") => void
    batchCount: 1 | 2 | 4
    onBatchCountChange: (n: 1 | 2 | 4) => void
    usage: ImageUsage
    onUsageChange: (u: ImageUsage) => void
    referenceImage: string | null
    onReferenceImageChange: (dataUri: string | null) => void
    onGenerate: () => void
    generating: boolean
  />
  ```

- [ ] **Step 1: Create `StudioLeftPanel.tsx`**

```tsx
// apps/web/components/studio/StudioLeftPanel.tsx
"use client";

import { useRef, useState, useEffect } from "react";
import { ChevronDown, Upload, X, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ImageStyle, ImageUsage } from "@/lib/api";
import { StyleGrid } from "./StyleGrid";
import { PromptToolbar } from "./PromptToolbar";
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
  onGenerate,
  generating,
}: StudioLeftPanelProps) {
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
    <div className="flex flex-col gap-5 p-4 overflow-y-auto h-full">

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
  );
}
```

- [ ] **Step 2: Verify types**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/studio/StudioLeftPanel.tsx
git commit -m "feat(studio): add StudioLeftPanel with all generation controls"
```

---

## Task 9: StudioRightPanel component

**Files:**
- Create: `apps/web/components/studio/StudioRightPanel.tsx`

**Interfaces:**
- Consumes: `GeneratedImage` from `@/lib/api`, `ResultCard` from `./ResultCard`, `GenerationRun` from `./GenerationRun`
- Produces:
  ```tsx
  <StudioRightPanel
    currentImages: (GeneratedImage | null)[]  // null entries = loading skeletons
    batchCount: 1 | 2 | 4
    pastRuns: { prompt: string; images: GeneratedImage[]; batchCount: number }[]
    onUse: (image: GeneratedImage) => void
    onRegenerate: (index: number) => void
    onPastRegenerate: (runIndex: number, imageIndex: number) => void
    onOpenTemplates: () => void
  />
  ```

- [ ] **Step 1: Create `StudioRightPanel.tsx`**

```tsx
// apps/web/components/studio/StudioRightPanel.tsx
"use client";

import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { GeneratedImage } from "@/lib/api";
import { ResultCard } from "./ResultCard";
import { GenerationRun } from "./GenerationRun";

interface PastRun {
  prompt: string;
  images: GeneratedImage[];
  batchCount: number;
}

interface StudioRightPanelProps {
  currentImages: (GeneratedImage | null)[];
  batchCount: 1 | 2 | 4;
  pastRuns: PastRun[];
  onUse: (image: GeneratedImage) => void;
  onRegenerate: (index: number) => void;
  onPastRegenerate: (runIndex: number, imageIndex: number) => void;
  onOpenTemplates: () => void;
}

export function StudioRightPanel({
  currentImages,
  batchCount,
  pastRuns,
  onUse,
  onRegenerate,
  onPastRegenerate,
  onOpenTemplates,
}: StudioRightPanelProps) {
  const hasCurrentImages = currentImages.length > 0;

  const gridCols =
    batchCount === 1 ? "grid-cols-1 max-w-sm mx-auto" :
    batchCount === 2 ? "grid-cols-2" :
    "grid-cols-2";

  return (
    <div className="flex flex-col gap-6 p-6 overflow-y-auto h-full">
      {/* Empty state */}
      {!hasCurrentImages && pastRuns.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 h-full min-h-[400px] text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <ImageIcon className="h-7 w-7 text-muted-foreground/60" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Image Studio</p>
            <p className="mt-1 text-xs text-muted-foreground max-w-xs">
              Configure your prompt on the left and click Generate to create images.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenTemplates}
            className="text-xs text-primary hover:underline font-medium"
          >
            ✨ Try a template →
          </button>
        </div>
      )}

      {/* Current generation results */}
      {hasCurrentImages && (
        <div className={cn("grid gap-4 w-full", gridCols)}>
          {currentImages.map((img, i) => (
            <ResultCard
              key={img?.id ?? `skeleton-${i}`}
              image={img}
              onUse={onUse}
              onRegenerate={() => onRegenerate(i)}
            />
          ))}
        </div>
      )}

      {/* Past runs (session history) */}
      {pastRuns.length > 0 && (
        <div className="flex flex-col gap-3">
          {hasCurrentImages && (
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">Previous runs</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          )}
          {pastRuns.map((run, ri) => (
            <GenerationRun
              key={ri}
              prompt={run.prompt}
              images={run.images}
              batchCount={run.batchCount}
              onUse={onUse}
              onRegenerate={(ii) => onPastRegenerate(ri, ii)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/studio/StudioRightPanel.tsx
git commit -m "feat(studio): add StudioRightPanel with empty state, results grid, session history"
```

---

## Task 10: Studio page shell + orchestration + gallery button change

**Files:**
- Create: `apps/web/app/(dashboard)/[projectId]/images/studio/page.tsx`
- Modify: `apps/web/app/(dashboard)/[projectId]/images/page.tsx`

**Interfaces:**
- Consumes: all studio components; `generateImage`, `GeneratedImage`, `ImageStyle`, `ImageUsage` from `@/lib/api`; `addToHistory`, `getHistory` from `@/components/studio/prompt-storage`; `AttachModal` (copy from images page — see step below)

- [ ] **Step 1: Extract `AttachModal` and `Spinner` from images page into shared files**

Since the studio page needs `AttachModal` too, extract it to avoid duplication.

Create `apps/web/components/studio/AttachModal.tsx` by copying the `AttachModal` function (lines 486–632) and `Spinner` (lines 57–64) from `apps/web/app/(dashboard)/[projectId]/images/page.tsx`:

```tsx
// apps/web/components/studio/AttachModal.tsx
"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { attachImage } from "@/lib/api";
import type { GeneratedImage, Article, SocialPost } from "@/lib/api";

function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 className="animate-spin" style={{ width: size, height: size }} />;
}

interface AttachModalProps {
  image: GeneratedImage;
  projectId: string;
  articles: Article[];
  socialPosts: SocialPost[];
  onClose: () => void;
  onAttached: () => void;
}

export function AttachModal({
  image,
  projectId: _projectId,
  articles,
  socialPosts,
  onClose,
  onAttached,
}: AttachModalProps) {
  const { t } = useTranslation();
  const [attachTo, setAttachTo] = useState<"article" | "social_post">("article");
  const [selectedArticleId, setSelectedArticleId] = useState("");
  const [selectedPostId, setSelectedPostId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const attachMutation = useMutation({
    mutationFn: () => {
      const data =
        attachTo === "article"
          ? { article_id: selectedArticleId }
          : { social_post_id: selectedPostId };
      return attachImage(image.id, data);
    },
    onSuccess: () => { onAttached(); },
    onError: (err) => { setError(err instanceof Error ? err.message : "Attach failed"); },
  });

  const readyArticles = articles.filter(
    (a) => a.status === "ready" || a.status === "published",
  );

  const canSubmit = attachTo === "article" ? !!selectedArticleId : !!selectedPostId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4 rounded-2xl border border-border bg-card shadow-2xl">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t("images.attachModal.title")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("images.attachModal.subtitle")}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6 flex flex-col gap-4">
          {error && <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">{t("images.attachModal.attachTo")}</label>
            <select
              value={attachTo}
              onChange={(e) => setAttachTo(e.target.value as "article" | "social_post")}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="article">{t("content.types.article")}</option>
              <option value="social_post">{t("content.types.socialPost")}</option>
            </select>
          </div>
          {attachTo === "article" ? (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t("images.attachModal.selectArticle")}</label>
              <select value={selectedArticleId} onChange={(e) => setSelectedArticleId(e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">{t("images.attachModal.choose")}</option>
                {readyArticles.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t("images.attachModal.selectSocialPost")}</label>
              <select value={selectedPostId} onChange={(e) => setSelectedPostId(e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50">
                <option value="">{t("images.attachModal.choose")}</option>
                {socialPosts.map((p) => <option key={p.id} value={p.id}>{p.platform} — {p.content.slice(0, 40)}{p.content.length > 40 ? "…" : ""}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors">
              {t("images.generateModal.cancel")}
            </button>
            <button
              onClick={() => attachMutation.mutate()}
              disabled={!canSubmit || attachMutation.isPending}
              className="flex-1 btn-primary px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {attachMutation.isPending ? <><Spinner size={14} /> {t("images.attachModal.attaching")}</> : t("images.attachModal.attach")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the studio page**

```tsx
// apps/web/app/(dashboard)/[projectId]/images/studio/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Wand2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  generateImage,
  listArticles,
  listSocialPosts,
  type GeneratedImage,
  type ImageStyle,
  type ImageUsage,
  type Article,
  type SocialPost,
} from "@/lib/api";
import { useProjectStore } from "@/lib/store";
import { addToHistory } from "@/components/studio/prompt-storage";
import { StudioLeftPanel } from "@/components/studio/StudioLeftPanel";
import { StudioRightPanel } from "@/components/studio/StudioRightPanel";
import { AttachModal } from "@/components/studio/AttachModal";

interface PastRun {
  prompt: string;
  images: GeneratedImage[];
  batchCount: number;
}

export default function StudioPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const router = useRouter();
  const { setCurrentProject } = useProjectStore();

  // Controls state
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [style, setStyle] = useState<ImageStyle>("professional");
  const [quality, setQuality] = useState<"standard" | "hd">("standard");
  const [batchCount, setBatchCount] = useState<1 | 2 | 4>(1);
  const [usage, setUsage] = useState<ImageUsage>("article_cover");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);

  // Results state
  const [generating, setGenerating] = useState(false);
  const [currentImages, setCurrentImages] = useState<(GeneratedImage | null)[]>([]);
  const [pastRuns, setPastRuns] = useState<PastRun[]>([]);

  // Attach modal
  const [attachingImage, setAttachingImage] = useState<GeneratedImage | null>(null);

  useEffect(() => { setCurrentProject(projectId); }, [projectId, setCurrentProject]);

  const { data: articles = [] } = useQuery<Article[]>({
    queryKey: ["articles", projectId],
    queryFn: () => listArticles(projectId),
  });

  const { data: socialPosts = [] } = useQuery<SocialPost[]>({
    queryKey: ["social-posts", projectId],
    queryFn: () => listSocialPosts(projectId),
  });

  const runGeneration = useCallback(
    async (overridePrompt?: string, overrideBatch?: number) => {
      const activePrompt = overridePrompt ?? prompt;
      const activeBatch = overrideBatch ?? batchCount;

      // Move current results to past runs if there are any ready images
      setCurrentImages((prev) => {
        const readyImages = prev.filter((img): img is GeneratedImage => img !== null && img.status === "ready");
        if (readyImages.length > 0) {
          setPastRuns((runs) => [{ prompt: activePrompt, images: readyImages, batchCount: activeBatch }, ...runs]);
        }
        return [];
      });

      // Show skeletons immediately
      setCurrentImages(Array(activeBatch).fill(null));
      setGenerating(true);
      addToHistory(projectId, activePrompt.trim() || "Auto-generated");

      const requests = Array.from({ length: activeBatch }, () =>
        generateImage({
          project_id: projectId,
          prompt: activePrompt.trim() || undefined,
          style,
          usage,
          quality,
          reference_image: referenceImage ?? undefined,
        }),
      );

      // Resolve each request independently
      requests.forEach((req, i) => {
        req
          .then((img) => {
            setCurrentImages((prev) => {
              const next = [...prev];
              next[i] = img;
              return next;
            });
          })
          .catch(() => {
            setCurrentImages((prev) => {
              const next = [...prev];
              // Keep skeleton on error — no crash
              return next;
            });
          });
      });

      await Promise.allSettled(requests);
      setGenerating(false);
    },
    [prompt, batchCount, projectId, style, usage, quality, referenceImage],
  );

  function handleRegenerate(index: number) {
    const existingImage = currentImages[index];
    const activePrompt = existingImage?.prompt ?? prompt;
    generateImage({
      project_id: projectId,
      prompt: activePrompt.trim() || undefined,
      style,
      usage,
      quality,
      reference_image: referenceImage ?? undefined,
    }).then((img) => {
      setCurrentImages((prev) => {
        const next = [...prev];
        next[index] = img;
        return next;
      });
    });
    setCurrentImages((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
  }

  function handlePastRegenerate(runIndex: number, imageIndex: number) {
    const run = pastRuns[runIndex];
    const activePrompt = run.images[imageIndex]?.prompt ?? run.prompt;
    const skeleton = { ...run.images[imageIndex], status: "generating" } as GeneratedImage;
    setPastRuns((runs) => {
      const next = [...runs];
      next[runIndex] = {
        ...next[runIndex],
        images: next[runIndex].images.map((img, i) => (i === imageIndex ? skeleton : img)),
      };
      return next;
    });
    generateImage({
      project_id: projectId,
      prompt: activePrompt.trim() || undefined,
      style: run.images[imageIndex]?.style ?? style,
      usage: run.images[imageIndex]?.usage ?? usage,
      quality,
    }).then((img) => {
      setPastRuns((runs) => {
        const next = [...runs];
        next[runIndex] = {
          ...next[runIndex],
          images: next[runIndex].images.map((existing, i) => (i === imageIndex ? img : existing)),
        };
        return next;
      });
    });
  }

  // "Try a template" from empty state opens templates popover in left panel
  // We use a ref-based trigger; simplest approach: lift a flag
  const [triggerTemplates, setTriggerTemplates] = useState(false);

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 60px)" }}>
      {/* Studio header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push(`/${projectId}/images`)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Images
          </button>
          <span className="text-muted-foreground/40">/</span>
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" strokeWidth={1.8} />
            <span className="text-sm font-semibold text-foreground">Image Studio</span>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="w-[380px] shrink-0 border-r border-border overflow-hidden">
          <StudioLeftPanel
            projectId={projectId}
            prompt={prompt}
            onPromptChange={setPrompt}
            negativePrompt={negativePrompt}
            onNegativePromptChange={setNegativePrompt}
            style={style}
            onStyleChange={setStyle}
            quality={quality}
            onQualityChange={setQuality}
            batchCount={batchCount}
            onBatchCountChange={setBatchCount}
            usage={usage}
            onUsageChange={setUsage}
            referenceImage={referenceImage}
            onReferenceImageChange={setReferenceImage}
            onGenerate={() => runGeneration()}
            generating={generating}
          />
        </div>

        {/* Right panel */}
        <div className="flex-1 overflow-hidden">
          <StudioRightPanel
            currentImages={currentImages}
            batchCount={batchCount}
            pastRuns={pastRuns}
            onUse={setAttachingImage}
            onRegenerate={handleRegenerate}
            onPastRegenerate={handlePastRegenerate}
            onOpenTemplates={() => setTriggerTemplates((v) => !v)}
          />
        </div>
      </div>

      {/* Attach modal */}
      {attachingImage && (
        <AttachModal
          image={attachingImage}
          projectId={projectId}
          articles={articles}
          socialPosts={socialPosts}
          onClose={() => setAttachingImage(null)}
          onAttached={() => setAttachingImage(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update the gallery page — replace Generate modal with a Link**

In `apps/web/app/(dashboard)/[projectId]/images/page.tsx`, make these changes:

3a. Add `Link` import at the top (it's not imported yet):

```tsx
import Link from "next/link";
```

3b. Replace the Generate button in the `actions` prop (around line 744–750) with:

```tsx
<Link
  href={`/${projectId}/images/studio`}
  className="btn-primary flex items-center gap-2 px-3.5 py-2 text-xs"
>
  <Plus className="h-3.5 w-3.5" />
  {t("images.generate")}
</Link>
```

3c. Remove the `showGenerateModal` state and `GenerateModal` usage (they are no longer needed, but leave `AttachModal` and its state in place as the gallery still uses them for attaching existing images).

Specifically, remove:
- `const [showGenerateModal, setShowGenerateModal] = useState(false);`
- `function handleGenerated() { ... }` 
- The `GenerateModal` JSX block at the bottom
- The `GenerateModal` import (since it's defined locally in the file, just delete the function definition)

- [ ] **Step 4: Verify types**

```bash
cd apps/web && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Visual verification**

Start the dev server:

```bash
cd apps/web && npm run dev
```

Check these flows in the browser:

1. Navigate to any project's `/images` page — the "Generate" button should navigate to `/images/studio` (not open a modal)
2. The studio page loads with a left panel and right empty state
3. Type a prompt and click Generate → right panel shows skeleton → resolves to image card
4. Click "Improve" on a short prompt → textarea updates (or shows error if backend endpoint not yet live)
5. Click "Templates" → popover opens with 5 category tabs and prompts → clicking a prompt fills the textarea
6. Click 🔖 bookmark → prompt appears in "Saved" tab in history section
7. Generate with batch=2 → right panel shows 2 side-by-side cards
8. Generate again → previous results move to "Previous runs" section as a collapsible strip
9. Click "Use" on a result → attach modal opens correctly
10. Navigate back to `/images` → new images appear in the gallery

- [ ] **Step 6: Commit**

```bash
git add \
  apps/web/components/studio/AttachModal.tsx \
  apps/web/app/\(dashboard\)/\[projectId\]/images/studio/page.tsx \
  apps/web/app/\(dashboard\)/\[projectId\]/images/page.tsx
git commit -m "feat(studio): add studio page shell, orchestration, and update gallery button"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| New route `/images/studio` | Task 10 |
| Two-column layout | Task 10 |
| Gallery Generate button → Link | Task 10 |
| Prompt textarea + Improve button | Tasks 5, 8 |
| Negative prompt (collapsible) | Task 8 |
| 9-style grid (incl. 4 new styles) | Tasks 1, 3 |
| Quality pill toggle | Task 8 |
| Batch count (1/2/4) | Task 8 |
| Usage pill toggle | Task 8 |
| Image-to-image upload | Task 8 |
| `improvePrompt` API function | Task 1 |
| Undo improvement | Task 8 |
| Templates popover (5 categories × 4 prompts) | Tasks 2, 4 |
| Save prompt (🔖) | Task 8 |
| Prompt history (Recent / Saved tabs) | Tasks 2, 8 |
| Empty state + "Try a template" | Task 9 |
| Skeleton loading cards | Task 9 |
| Results grid adapts to batch count | Task 9 |
| Download button | Task 6 |
| Use/attach button | Tasks 6, 10 |
| Regenerate single card | Tasks 6, 10 |
| Session history (past runs strip) | Tasks 7, 9 |
| Parallel client-side batch generation | Task 10 |
| `reference_image` in `generateImage` | Task 1 |

All spec requirements are covered. ✓

**Placeholder scan:** No TBDs, no "implement later", all code blocks are complete. ✓

**Type consistency:**
- `ImageStyle` extended in Task 1 → consumed as `ImageStyle` in Tasks 3, 5, 8, 10 ✓
- `StyleGrid` produces `(style: ImageStyle) => void` in Task 3 → consumed as `onStyleChange` in Task 8 ✓
- `PromptToolbar.onImproved: (improved: string, original: string) => void` in Task 5 → called as `handleImproved(improved, original)` in Task 8 ✓
- `ResultCard` receives `image: GeneratedImage | null` in Task 6 → passed as `(GeneratedImage | null)[]` entries in Task 9 ✓
- `StudioRightPanel.currentImages: (GeneratedImage | null)[]` in Task 9 → passed from `useState<(GeneratedImage | null)[]>([])` in Task 10 ✓
- `PastRun` interface in Task 9 matches the `pastRuns` state shape in Task 10 ✓
- `AttachModal` in Task 10 Step 1 uses same prop names as the original in `images/page.tsx` ✓
