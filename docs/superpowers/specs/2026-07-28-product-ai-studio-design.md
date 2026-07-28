# Product AI Studio — Design

**Date:** 2026-07-28
**Status:** Design approved (pending spec review)
**Extends:** the existing Image Studio / Mirage. This adds capability to what is
already there; it does not introduce a parallel application.

## Problem

Fennex can already place a product into a scene: `POST /product/product-scene`
runs `black-forest-labs/flux-kontext-pro` through `_replicate_run`, prompted by
`product_service.build_scene_prompt()`, and `ProductTab.tsx` offers 11 scenes.

Three gaps:

1. **Prompting is a monolith.** `build_scene_prompt` concatenates one f-string.
   There is no way to vary lighting, camera, materials or rendering style
   independently, and the same pattern is duplicated in `image_service`
   (`build_image_prompt`, `build_social_prompt`) and across the agent skills.
2. **No 3D.** Nothing converts a product photo into a 3D asset.
3. **Output is not commercial-grade.** The single instruction string cannot
   express the layered direction (role, preservation, optics, materials,
   rendering, brand) that separates a stock composite from an Aesop campaign.

## Goals

- A composable `PromptBuilder` service, used by Product Showcase, Product to 3D
  **and the existing image tools**, with no prompt strings inside React.
- **Product Showcase**: 15 premium environments plus full photographic control.
- **Product to 3D**: Trellis, async, with an in-app viewer and GLB + OBJ export.
- Correct credit metering and cost for every new operation.
- New tools (Product Video, Virtual Try-On, Relighting, Configurator) addable
  without touching the architecture.

## Non-goals

- Replacing the existing 11 scenes (they stay; the 15 are added alongside).
- Exposing provider choice in the UI. Provider stays an implementation detail.
- Training or fine-tuning models.

---

## 1. PromptBuilder

New package `apps/api/app/services/prompting/`.

A prompt is assembled from independent **modules**. Each module is a pure
function of typed inputs returning a fragment (or `None` to omit itself). The
builder orders and joins fragments; it never knows which model consumes them.

```
apps/api/app/services/prompting/
  __init__.py        # public surface: PromptBuilder
  modules.py         # one function per module, pure, individually testable
  vocab.py           # the controlled vocabularies (environments, lighting, ...)
  builder.py         # PromptBuilder: composes modules into a PromptResult
```

```python
@dataclass(frozen=True)
class PromptResult:
    prompt: str
    negative_prompt: str
    system_prompt: str | None      # prepended for the showcase/3D pipelines
    modules_used: tuple[str, ...]  # provenance, persisted for debugging
```

**Modules** (spec order): `role`, `objective`, `product_preservation`,
`composition`, `lighting`, `camera`, `materials`, `environment`,
`rendering_style`, `brand_style`, `quality`, `user_intent`, and
`negative_prompt` (assembled separately into `PromptResult.negative_prompt`).

**Public surface** — three builders, one per pipeline:

```python
class PromptBuilder:
    @staticmethod
    def build_product_showcase(spec: ShowcaseSpec, brand_kit: BrandKit | None) -> PromptResult
    @staticmethod
    def build_product_3d(spec: Product3DSpec) -> PromptResult
    @staticmethod
    def build_image(spec: ImageSpec, brand_kit: BrandKit | None) -> PromptResult   # existing tools
    @staticmethod
    def build_negative_prompt(extra: str | None = None) -> str
```

**User intent is never passed through raw.** `spec.user_prompt` feeds only the
`user_intent` module, which is appended last and clearly delimited, so it
refines rather than overrides the preservation and quality direction.

### System prompts

The two system prompts (commercial photographer, senior 3D artist) live in
`prompting/vocab.py` as module-level constants and are returned via
`PromptResult.system_prompt`. They are verbatim from the brief. They are **never
duplicated in a router, a service or a component**.

### Applying it to the existing image tools

`image_service.build_image_prompt` and `build_social_prompt` are re-implemented
as thin wrappers over `PromptBuilder.build_image(...)`, preserving their current
signatures and observable output shape so existing callers and tests keep
working. `product_service.build_scene_prompt` likewise delegates. This is the
"improve the existing image AI tools with the same flow" requirement; it is a
refactor behind stable seams, not a rewrite.

---

## 2. Product Showcase

Extends the existing `/product/product-scene` path rather than adding a parallel
endpoint.

### Environments

The 15 required environments are added to `PRODUCT_SCENES` with a new
`category: "premium"`: `white_studio` (exists), `luxury_studio`, `bathroom`,
`spa`, `travertine`, `marble` , `limestone`, `botanical`, `mediterranean`,
`luxury_hotel`, `editorial`, `lifestyle`, `minimal`, `scandinavian`,
`dark_luxury`. The existing 11 keep their ids, labels and categories — no
current scene id ever 400s.

### Controls

| Control | Type | Notes |
|---|---|---|
| environment | scene id | the grid above |
| lighting | enum | softbox, golden hour, hard sun, rim, diffused daylight, chiaroscuro, candlelit |
| camera | enum | macro, 35mm, 50mm, 85mm, tilt-shift, top-down, three-quarter |
| aspect_ratio | enum | 1:1, 4:5, 3:2, 16:9, 9:16 |
| creativity | 0-100 | maps to the model's guidance; low = literal |
| product_preservation | 0-100 | strengthens the preservation module and lowers creativity ceiling |
| prompt | free text | user intent only |
| negative_prompt | free text | appended to the built negative |
| seed | int or null | null = random, echoed back for reproducibility |
| quality | enum | draft, high, ultra |

Each enum is a controlled vocabulary in `prompting/vocab.py`, mapping a token to
a prompt fragment. Adding a lighting option is a one-line vocabulary change.

**Model:** always `black-forest-labs/flux-kontext-pro`. Not user-selectable.

---

## 3. Product to 3D

### Execution

Multi-minute, so asynchronous, mirroring `KeywordResearchJob`:

- New model `Product3DJob` (`apps/api/app/models/product3d.py`): org_id,
  project_id, source_image_url, status, quality, texture_resolution,
  requested_formats, output urls (per format), error, timestamps.
- `POST /product/to-3d` validates + enqueues, returns `job_id`.
- arq worker `run_product_3d` executes Trellis, then conversions, then uploads.
- `GET /product/to-3d/{job_id}` returns status and, when complete, the asset urls.

**Status enum** must be declared with `values_callable=lambda x: [e.value for e
in x]`, as `GeneratedImage` does. Without it SQLAlchemy persists member NAMES
while migrations create VALUES — the exact defect fixed by `x2planlabels3`.

**Model:** always Trellis on Replicate. Not user-selectable.

### Options

- quality: draft / high / ultra
- texture_resolution: 2K / 4K / 8K
- formats: **GLB and OBJ** (multi-select)

### Format conversion

Trellis emits **GLB only**. OBJ is produced by a converter in
`apps/api/app/services/product3d/convert.py`, behind one interface so the
backing tool can change and further formats can be added later:

```python
async def convert(glb_bytes: bytes, target: ModelFormat) -> bytes
```

- **GLB** — Trellis output, passed through unchanged.
- **OBJ** — `trimesh` (pure Python, ships in the api image; exports the mesh
  plus its `.mtl` and texture maps as a zip, since OBJ is multi-file).

**FBX and USDZ are deliberately out of scope for this iteration.** FBX is
proprietary and assimp's exporter loses PBR fidelity in some material setups;
USDZ is sensitive to texture packing. Both materially grow the api image. The
`ModelFormat` enum and the `convert()` interface are shaped so either can be
added later without touching callers, the job model or the UI wiring — but they
are not offered in the UI now, rather than shipping a format that might return a
broken asset.

Conversion is gated by a capability probe: if a requested format cannot be
produced, the job records the failure for that format and still returns the
formats that succeeded, rather than failing the whole job.

Conversions are metered (they consume compute) but are not separate Replicate
calls, so they carry no supplier cost — only GLB generation does.

### Viewer

`apps/web/components/studio/product3d/ModelViewer.tsx` using
`@react-three/fiber` + `@react-three/drei`, dynamically imported so the 3D
bundle never loads on other routes. Orbit, auto-rotate, zoom, lighting presets
(studio/warm/neutral/dark via drei `Environment`), wireframe toggle, material
preview, download, fullscreen.

---

## 4. Credits and compute

Both tools consume AI credits through the existing path: `require_credits("ai")`
on the endpoint, and `_replicate_run` already meters every Replicate prediction
into `usage_events` + `ai_cost_micros` + `ai_credits_used`.

Two cost rates are missing and **must** be seeded, or these tools bill at the
generic `replicate/run` default:

| provider | unit | model | micro-$ | basis |
|---|---|---|---|---|
| replicate | run | `black-forest-labs/flux-kontext-pro` | 40_000 | $0.04/image, Replicate's published FLUX Kontext pro price |
| replicate | run | Trellis (exact slug resolved at implementation) | 100_000 | $0.10/run placeholder — per-second GPU model, must be reconciled |

`flux-kontext-pro` was seeded by migration `y5kontextrate9` (2026-07-28): it now
bills 39 credits at $0.04 instead of 10 at the $0.01 default. Trellis remains
outstanding and must be seeded with its task.

**`flux-kontext-pro` is live today and has no rate**, so it currently bills at
the `$0.01` default — a 4x under-charge on every existing product-scene call.
Seeding it is a correction to current behaviour, not only new-feature work.

Rates are seeded as **new versioned rows** (`effective_from`), never `UPDATE` —
see `w3repricing7`.

The Replicate 10-credit floor (`replicate_operation_credits`) applies to both.
A 3D job that fails before Trellis returns must not bill.

---

## 5. Frontend

- New tools live as tabs inside the existing Image Studio route
  (`apps/web/app/(dashboard)/[projectId]/images/studio/`), beside the existing
  `ProductTab`. No new page, no new navigation entry.
- Reuse the existing upload, history, folder and publish components. New
  components only where none exists: the control panel, the 3D viewer, the
  format picker.
- Design system: CSS-variable tokens only, Lucide icons, no emoji, all strings
  via `t()` with keys added to every locale, `apiClient` + TanStack Query.

## 6. Testing

- **Modules**: each prompt module tested in isolation — given inputs, contains
  the expected fragment and omits itself when not applicable.
- **Builder**: showcase and 3D prompts contain the verbatim system prompt, the
  preservation clause, and the user's intent *last*; the negative prompt covers
  all 11 required exclusions.
- **Regression**: `build_image_prompt` / `build_social_prompt` /
  `build_scene_prompt` produce equivalent output after delegating to
  PromptBuilder (their existing tests must stay green).
- **3D job**: enqueue → status transitions → asset urls; a Trellis failure marks
  the job failed, bills nothing, and surfaces the error.
- **Conversion**: GLB passes through unchanged; OBJ round-trips to a loadable
  mesh with its material file. An unsupported format is rejected at the schema
  boundary, not attempted.
- **Credits**: a showcase run bills the Kontext rate; a 3D run bills the Trellis
  rate; both respect the floor; a failed run bills nothing.

## 7. Extensibility

A new tool = a new spec dataclass + a builder method + (if a new provider call)
a service function. The modules, vocabularies, job pattern, metering and viewer
are shared. Product Video, Virtual Try-On, Relighting and Configurator each fit
this shape without architectural change.
