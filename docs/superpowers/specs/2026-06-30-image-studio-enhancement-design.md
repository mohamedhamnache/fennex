# Image Studio Enhancement — Design Spec
**Date:** 2026-06-30
**Scope:** Phase 1 — Enhanced Generation Panel + Prompt Engineering Assistant

---

## 1. Problem & Goal

The current image studio (`/[projectId]/images`) is a basic gallery + modal. The modal has ~8 fields and no creative guidance. Users with little prompting experience get poor results; there is no batch/comparison workflow; the style options are limited to a dropdown of 5.

**Goal:** Transform the studio into a proper split-panel creative workspace with intelligent prompt assistance, so any user can produce high-quality images on the first try.

---

## 2. Scope

This spec covers **two sub-features built together** because they share the same new Studio page:

- **B — Enhanced Generation Panel:** richer controls (negative prompt, 9 styles, batch count, image-to-image upload), better UX (pill toggles, style grid), results panel with side-by-side comparison.
- **A — Prompt Engineering Assistant:** AI prompt improvement via a backend endpoint, industry template library, prompt history (localStorage), saved prompt library (localStorage).

**Out of scope for this phase:** multi-model support, AI editing tools, DAM, team collaboration, analytics/scoring.

---

## 3. Architecture

### 3.1 New Route

```
app/(dashboard)/[projectId]/images/studio/page.tsx   ← new
app/(dashboard)/[projectId]/images/page.tsx          ← unchanged (gallery)
```

The gallery's "Generate" button navigates to `/[projectId]/images/studio` instead of opening a modal. A "← Images" back link in the studio header returns to the gallery.

### 3.2 Page Layout

Full viewport height (minus topbar), two independent scrolling columns:

```
┌─────────────────────────────────────────────────────────────┐
│  ← Images    Image Studio                      [Generate]   │
├─────────────────────┬───────────────────────────────────────┤
│  LEFT PANEL ~380px  │  RIGHT PANEL  flex-1                  │
│  (scrollable)       │  (scrollable)                         │
│                     │                                       │
│  Controls           │  Empty state / results grid           │
└─────────────────────┴───────────────────────────────────────┘
```

### 3.3 Backend Endpoint

One new API endpoint is required:

```
POST /api/improve-prompt
Body: { prompt: string, usage?: ImageUsage, style?: ImageStyle }
Response: { improved_prompt: string }
```

The backend calls an LLM (e.g. Claude) with the user's prompt + context, returns an expanded, detailed prompt. The frontend replaces the textarea content with the result and shows an "↩ Undo" link.

### 3.4 Batch Generation

Client fires N parallel `generateImage` calls (N = 1, 2, or 4). No new backend endpoint needed. Each call returns independently; result cards resolve as they complete.

### 3.5 Image-to-Image

The existing `generateImage` API call gains a `reference_image` field (base64 or URL). The frontend sends the uploaded file as base64. Backend integration with the image generation provider's img2img endpoint is a backend requirement noted here but implemented server-side.

### 3.6 Prompt Persistence

- **History:** Last 10 prompts stored in `localStorage` keyed as `prompt-history-{projectId}`.
- **Saved prompts:** Bookmarked prompts stored in `localStorage` keyed as `prompt-saved-{projectId}`.
- No backend schema changes required.

---

## 4. Left Panel — Controls

### 4.1 Prompt Area

- `<textarea>` (4 rows, resizable)
- Below textarea: `[✨ Improve]` button + `[📋 Templates]` button
- When "Improve" is clicked: button shows spinner, calls `POST /api/improve-prompt`, textarea updates with result, `[↩ Undo]` link appears inline
- `[🔖]` bookmark icon in textarea toolbar saves current prompt to saved list
- Collapsible "Negative prompt" section below (collapsed by default)

### 4.2 Style Grid

9 style cards in a 3-column grid, replacing the current dropdown:

| | | |
|---|---|---|
| Professional | Photorealistic | Illustration |
| Minimalist | Abstract | 3D Render |
| Anime | Cinematic | Luxury Product |

New styles added: `3d_render`, `anime`, `cinematic`, `luxury_product`.
Selected card shows a primary-colored ring. Labels only, no thumbnail images.

### 4.3 Pill Toggles

Replace dropdowns/selects for:
- **Quality:** `[Standard]  [HD]`
- **Batch count:** `[1]  [2]  [4]`
- **Usage:** `[Article Cover]  [Social Post]  [Brand Asset]  [Custom]`

### 4.4 Image-to-Image Upload

Optional section below usage picker:
- Drag-and-drop zone or file picker (PNG/JPG)
- On upload: shows thumbnail preview + `[✕ Remove]`
- Sends file as base64 in the `reference_image` field

### 4.5 Prompt History & Saved Prompts

Collapsible section at bottom of left panel with two tabs: **Recent** and **Saved**.

- **Recent:** Last 10 prompts used (most recent first), each with a `[↺ Use]` button that restores it to the textarea.
- **Saved:** Bookmarked prompts (from the 🔖 button), each with a `[↺ Use]` and `[✕]` (remove from saved) button.

---

## 5. Left Panel — Prompt Engineering Assistant (Templates)

Clicking `[📋 Templates]` opens a popover above the button:

```
┌─ Industry Templates ──────────────┐
│ [Ecommerce] [Food] [Real Estate]  │
│ [Fashion]   [Social Ads]          │
│                                   │
│  · Product hero shot              │
│  · Lifestyle product mockup       │
│  · Packshot on white background   │
│  · Shopify banner creative        │
└───────────────────────────────────┘
```

- 5 categories, ~4 prompts each = 20 total curated prompts
- Stored as a static constant in the frontend (no backend)
- Selecting a template closes the popover and fills the textarea
- User can then click "Improve" to personalise further

**Template categories and example prompts:**

| Category | Example prompts |
|---|---|
| Ecommerce | Product hero shot, Lifestyle mockup, Packshot on white, Shopify banner |
| Food | Restaurant dish overhead, Food styling flatlay, Recipe hero, Cafe ambiance |
| Real Estate | Modern interior wide angle, Aerial property exterior, Luxury bathroom, Open-plan living |
| Fashion | Editorial runway shot, Streetwear lookbook, Jewellery close-up, Sportswear action |
| Social Ads | Instagram story product, Facebook ad banner, YouTube thumbnail, TikTok cover |

---

## 6. Right Panel — Results

### 6.1 Empty State

Centered placeholder encouraging the user to configure and generate. Includes a "Try a template →" link that opens the Templates popover.

### 6.2 Generating State

N skeleton shimmer cards appear immediately (matching batch count). Cards resolve individually as parallel requests complete — no waiting for all N.

### 6.3 Results Grid

Layout adapts to batch count:
- **1** → single card, larger (max-width ~520px, centered)
- **2** → 2-column grid
- **4** → 2×2 grid

Each result card shows:
- Image (or error state)
- `[↓ Download]` — triggers browser download
- `[🔗 Use]` — opens the existing attach modal
- `[⟳ Regenerate this]` — fires one new `generateImage` with same params, replaces this card only

### 6.4 Session History

Previous generation runs appear below the current batch, separated by a divider line. Each run is collapsed to a strip: prompt text (truncated) + small thumbnails. Expandable. Cleared on page navigation (in-memory only, not persisted).

---

## 7. Gallery Page Changes

The only change to the existing `/images` page:

- "Generate" button → `<Link href={`/${projectId}/images/studio`}>` instead of `onClick={() => setShowGenerateModal(true)}`
- The `GenerateModal` component and its state can be removed from `page.tsx`

---

## 8. Error Handling

- **Improve-prompt failure:** Show inline error below textarea ("Couldn't improve prompt — try again"), keep original text
- **Individual generation failure:** The failed card shows an error state (matching existing `status === "failed"` card UI); other cards in the batch are unaffected
- **Network error:** Toast notification (reuse existing pattern)

---

## 9. New Components

| Component | Location | Purpose |
|---|---|---|
| `StudioPage` | `app/.../images/studio/page.tsx` | Page shell, layout |
| `StudioLeftPanel` | `components/studio/StudioLeftPanel.tsx` | All left panel controls |
| `StyleGrid` | `components/studio/StyleGrid.tsx` | 9-style card selector |
| `PromptToolbar` | `components/studio/PromptToolbar.tsx` | Improve, Templates, Bookmark buttons |
| `TemplatesPopover` | `components/studio/TemplatesPopover.tsx` | Template category picker |
| `StudioRightPanel` | `components/studio/StudioRightPanel.tsx` | Results grid + session history |
| `ResultCard` | `components/studio/ResultCard.tsx` | Single result image card |
| `GenerationRun` | `components/studio/GenerationRun.tsx` | Session history run strip |

Reused from existing codebase: `AttachModal`, `Spinner`, `PageHeader`, `useClickOutside`.

---

## 10. New Styles

New `ImageStyle` values to add to the API types: `3d_render`, `anime`, `cinematic`, `luxury_product`.
These must also be added to the backend's validation and image generation prompt builder.

---

## 11. Success Criteria

- User can open the studio, type "shoe ad", click Improve, and get a detailed expanded prompt in under 3 seconds
- User can select a template and generate without typing anything
- Batch of 4 images resolves cards individually (not all-or-nothing)
- Prompt history persists across page navigations within the session
- Gallery page is unaffected (images still appear there after generation)
- No regression on the attach-to-article / attach-to-social-post workflow
