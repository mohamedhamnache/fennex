# Image Studio Phase 2 — Brand Kit + AI Editing

## Goal

Add two independent subsystems to the Image Studio: (1) a Brand Kit that stores org-level visual identity and injects it into every generation, and (2) a full AI Editing suite that lets users apply non-destructive edits to any generated image using a mix of specialist services.

## Architecture

Two independent subsystems sharing one backend pattern (non-destructive image records).

### Third-party services

| Service | Purpose | Env var |
|---|---|---|
| Remove.bg | Background removal | `REMOVE_BG_API_KEY` |
| Replicate | All generative AI edits | `REPLICATE_API_KEY` |
| Pillow (built-in) | Basic edits (crop, resize, rotate, filters, etc.) | — |

New env vars added to Railway API + Worker services (and `.env.supabase`).

---

## Subsystem A: Brand Kit

### Database

New table `brand_kits` (one row per org):

```python
class BrandKit(Base):
    __tablename__ = "brand_kits"
    id: UUID PK
    org_id: UUID FK → organizations.id (unique)
    logo_url: str | None        # Supabase Storage path
    colors: JSON                # list[str] hex values, e.g. ["#1A2B3C", "#FF6B35"]
    primary_font: str | None
    secondary_font: str | None
    style_rules: str | None     # freeform, e.g. "Clean white backgrounds, minimal"
    tone: str | None            # e.g. "Premium, confident, understated"
    created_at: datetime
    updated_at: datetime
```

Alembic migration required.

### API (`/api/v1/brand-kit`)

- `GET /brand-kit` — return org's brand kit or empty defaults if none exists yet
- `PUT /brand-kit` — upsert (create or update) all fields
- `POST /brand-kit/logo` — accept multipart file upload, save to Supabase Storage at `brand-kit/{org_id}/logo.{ext}`, update `logo_url`, return updated kit

### Prompt injection

In `app/services/image_service.py`, `build_image_prompt()` gains an optional `brand_kit` parameter. When provided and non-empty:

```
{base_prompt}. Brand palette: {colors joined ", "}. Style: {style_rules}. Tone: {tone}.
```

In `app/api/v1/routers/images.py`, `GenerateImageRequest` gains `use_brand_kit: bool = False`. When true, the endpoint fetches the org's brand kit and passes it to `build_image_prompt()`.

### Frontend

**Settings page** — new `BrandKitSection` component in `apps/web/app/(dashboard)/settings/page.tsx`:
- Logo: drag-and-drop or click upload; accepted formats PNG/JPG/SVG, max 5 MB; shows preview thumbnail when set; X to remove
- Colors: horizontal swatch strip; click `+` to add (native `<input type="color">`); click swatch to remove
- Primary font / Secondary font: text inputs
- Style rules: textarea (3 rows)
- Tone: text input
- Save button → `PUT /brand-kit`; logo upload separate on file change

**Studio toggle** — `StudioLeftPanel` gains a `useBrandKit: boolean` + `onUseBrandKitChange` prop. A small toggle row appears at the bottom of the Prompt section: "Use brand kit" (disabled and greyed if org has no brand kit). When enabled, `use_brand_kit: true` is sent with every generation request.

**API client** (`lib/api.ts`):
```ts
export interface BrandKit {
  logo_url: string | null;
  colors: string[];
  primary_font: string | null;
  secondary_font: string | null;
  style_rules: string | null;
  tone: string | null;
}
export async function getBrandKit(): Promise<BrandKit>
export async function updateBrandKit(data: Partial<BrandKit>): Promise<BrandKit>
export async function uploadBrandLogo(file: File): Promise<BrandKit>
```

---

## Subsystem B: AI Editing

### Database changes

`GeneratedImage` model gains two new nullable columns:
- `source_image_id: UUID | None` — FK to self; set when this image is an edit of another
- `edit_operation: str | None` — which operation produced this image, e.g. `"background_removal"`

Alembic migration required (same migration as Brand Kit or separate — separate preferred).

### Editing service (`app/services/editing_service.py`)

One async function per operation. Each accepts an image URL (or bytes) and operation-specific params; returns `{"ok": True, "image_url": str}` or `{"ok": False, "error": str}`.

#### Basic operations (Pillow, synchronous)

Download image → apply transform → upload result to Supabase Storage → return URL.

| Function | Params |
|---|---|
| `crop_image(url, x, y, w, h)` | pixels |
| `resize_image(url, width, height, keep_aspect)` | pixels + bool |
| `rotate_image(url, angle, fill_color)` | 0–360, hex |
| `adjust_image(url, brightness, contrast)` | -100 → +100 each |
| `apply_filter(url, filter_name)` | "warm"\|"cool"\|"grayscale"\|"sepia"\|"vivid" |
| `denoise_image(url, strength)` | 0.0–1.0 |
| `sharpen_image(url, strength)` | 0.0–1.0 |

#### Remove.bg

```python
async def remove_background(image_url: str) -> dict:
    # POST to api.remove.bg/v1.0/removebg with image_url
    # Returns PNG with transparent background
    # Upload result to Supabase Storage, return URL
```

#### Replicate (asynchronous)

All Replicate calls use the predictions API: `POST /v1/predictions` → poll `GET /v1/predictions/{id}` every 3 seconds until `status == "succeeded"` or `"failed"`. Max poll time: 5 minutes, then mark as failed.

> **Note:** Replicate model slugs below are examples verified against the Replicate model hub as of 2026-07. Implementer must confirm the exact version slug (`model/name:version-hash`) at implementation time before hardcoding.

| Function | Replicate model | Key params |
|---|---|---|
| `replace_background(url, mask_url, prompt)` | `black-forest-labs/flux-fill-pro` | prompt |
| `remove_object(url, mask_url)` | `zylim0702/remove-object` (lama-cleaner) | mask |
| `insert_object(url, mask_url, prompt)` | `stability-ai/stable-diffusion-inpainting` | prompt, mask |
| `generative_fill(url, mask_url, prompt)` | `black-forest-labs/flux-fill-pro` | prompt, mask |
| `smart_erase(url, mask_url)` | `zylim0702/remove-object` | mask |
| `generate_shadow(url, direction)` | `fal-ai/shadow-generation` via Replicate | direction |
| `generate_reflection(url, intensity)` | `reflection-gen` or img2img | intensity |
| `relight_image(url, direction, intensity)` | `zsxkib/ic-light` | light direction |
| `restore_face(url, fidelity)` | `sczhou/codeformer` | fidelity 0–1 |
| `retouch_skin(url, strength)` | `nightmareai/real-esrgan` or beauty model | strength |
| `upscale_image(url, scale)` | `nightmareai/real-esrgan` | scale 2 or 4 |

### Editing API router (`app/api/v1/routers/editing.py`)

```
POST /images/{image_id}/edit
```

Request body:
```python
class EditImageRequest(BaseModel):
    operation: str          # e.g. "background_removal", "upscale"
    params: dict = {}       # operation-specific: {"scale": 2}, {"prompt": "..."}, etc.
    mask_base64: str | None # PNG mask painted by user, base64-encoded
```

Response: `ImageOut` — a **new** `GeneratedImage` record with `source_image_id` set to the input image's ID.

The endpoint:
1. Fetches source image (must belong to org)
2. Checks `operation` against an allowlist
3. If mask provided: decodes base64, uploads mask to Supabase Storage as temp file
4. Calls the appropriate `editing_service` function
5. Creates a new `GeneratedImage` with `source_image_id`, `edit_operation`, saves result URL
6. Returns the new image record

### Edit page (`apps/web/app/(dashboard)/[projectId]/images/edit/[imageId]/page.tsx`)

Full-page editor, accessed via "Edit" button added to `ResultCard`.

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│  ← Back to Studio    [source prompt truncated]       │
├──────────┬──────────────────────────┬───────────────┤
│  Tools   │                          │  Controls     │
│ sidebar  │   Canvas                 │  panel        │
│          │                          │               │
│ Basic ▾  │  <img> + <canvas> overlay│  (per-op      │
│ AI    ▾  │  for mask painting       │  inputs +     │
│ Advanced▾│                          │  Apply btn)   │
│          │                          │               │
│          │  [Version strip below]   │               │
└──────────┴──────────────────────────┴───────────────┘
```

**Components:**

- `EditToolsSidebar` — three collapsible groups (Basic, AI, Advanced); clicking a tool sets `activeOperation`
- `EditCanvas` — renders `<img>` at natural aspect ratio inside a fixed container; overlays a `<canvas>` for mask painting when the active operation requires a mask; exposes `getMaskBase64()` method via `useImperativeHandle`. Must be implemented with `forwardRef` so the parent page can call `canvasRef.current.getMaskBase64()`.
- `MaskBrush` — mouse/touch event handlers on the canvas; brush size slider in controls panel; Clear Mask button
- `EditControlsPanel` — renders the right panel dynamically based on `activeOperation`: sliders, prompt inputs, scale selectors, Apply button
- `VersionStrip` — horizontal scrollable strip below canvas showing the edit chain (`source_image_id` chain): original + all derived edits; clicking a version updates the canvas in-place (the page URL does not change; only the displayed image and `activeImageId` state update)

**Operation → mask required mapping:**

| Requires mask | Does not require mask |
|---|---|
| Background replacement, Object removal, Object insertion, Generative fill, Smart eraser | Background removal, Shadow, Reflection, Relighting, Face restoration, Skin retouch, Upscaling, all Basic ops |

**Apply flow:**
1. User clicks Apply in controls panel
2. If mask required: `EditCanvas.getMaskBase64()` called
3. `POST /images/{id}/edit` with operation + params + optional mask
4. Canvas shows spinner overlay
5. Poll `GET /images/{newId}` every 2s until `status === "ready"` or `"failed"`
6. On ready: canvas updates to new image; version strip appends the new version
7. On failed: inline error below Apply button

**ResultCard update** — adds "Edit" button (PencilLine icon) alongside existing Download/Use/Regenerate. Links to `/[projectId]/images/edit/[imageId]`.

**API client additions:**
```ts
export async function editImage(
  imageId: string,
  operation: string,
  params: Record<string, unknown>,
  maskBase64?: string
): Promise<GeneratedImage>
```

---

## File Map

### New files
- `apps/api/app/models/brand_kit.py`
- `apps/api/app/services/editing_service.py`
- `apps/api/app/api/v1/routers/brand_kit.py`
- `apps/api/app/api/v1/routers/editing.py`
- `apps/api/alembic/versions/<hash>_brand_kit.py`
- `apps/api/alembic/versions/<hash>_image_edit_columns.py`
- `apps/web/components/settings/BrandKitSection.tsx`
- `apps/web/app/(dashboard)/[projectId]/images/edit/[imageId]/page.tsx`
- `apps/web/components/studio/edit/EditToolsSidebar.tsx`
- `apps/web/components/studio/edit/EditCanvas.tsx`
- `apps/web/components/studio/edit/EditControlsPanel.tsx`
- `apps/web/components/studio/edit/VersionStrip.tsx`

### Modified files
- `apps/api/app/models/image.py` — add `source_image_id`, `edit_operation`
- `apps/api/app/models/__init__.py` — register BrandKit
- `apps/api/app/services/image_service.py` — brand kit injection in `build_image_prompt()`
- `apps/api/app/api/v1/routers/images.py` — `use_brand_kit` param + brand kit fetch
- `apps/api/app/api/v1/router.py` — register brand_kit + editing routers
- `apps/web/lib/api.ts` — `getBrandKit`, `updateBrandKit`, `uploadBrandLogo`, `editImage`
- `apps/web/app/(dashboard)/settings/page.tsx` — add `BrandKitSection`
- `apps/web/components/studio/StudioLeftPanel.tsx` — add `useBrandKit` toggle
- `apps/web/components/studio/ResultCard.tsx` — add Edit button

---

## Future (not in this phase)
- Custom fine-tuned models trained on brand assets
- Skin retouching with dedicated beauty model (placeholder with Real-ESRGAN until a better model is identified)
- Reflection generation (placeholder with img2img until a dedicated Replicate model is confirmed)
