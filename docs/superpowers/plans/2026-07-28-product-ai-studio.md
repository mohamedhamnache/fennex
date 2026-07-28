# Product AI Studio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Image Studio with a composable PromptBuilder, a Product Showcase with 15 premium environments and full photographic control, and an async Product-to-3D pipeline (Trellis) with an in-app viewer and GLB/OBJ export — all metered against AI credits.

**Architecture:** Prompts are assembled from independent, pure modules in a new `app/services/prompting/` package and consumed by three builders. The existing prompt functions become thin wrappers over it, so current callers and tests keep working. Product Showcase extends the existing `/product/product-scene` path; Product-to-3D is a new arq job mirroring `KeywordResearchJob`. Every provider call already flows through `_replicate_run`, which meters into `usage_events`/`ai_cost_micros`/`ai_credits_used`.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, arq, pytest (host in-memory SQLite), Replicate (`flux-kontext-pro`, Trellis), `trimesh`, Next.js 14 + TanStack Query + Tailwind, `@react-three/fiber` + `@react-three/drei`.

**Spec:** `docs/superpowers/specs/2026-07-28-product-ai-studio-design.md`

## Global Constraints

- **Never use emoji** in code, UI text, comments, or commit messages.
- **Do not duplicate existing components or services.** Extend `product_service`, `image_service`, `editing_service`, `ProductTab`, the existing upload/history/folder/publish components. New files only where nothing equivalent exists.
- **No prompt strings in React components, routers, or providers.** Every prompt fragment lives in `app/services/prompting/vocab.py` and is assembled by `PromptBuilder`.
- **Provider is never exposed in the UI.** Showcase always uses `black-forest-labs/flux-kontext-pro`; 3D always uses Trellis.
- Money is micro-dollars. Credits: AI credits are the `OrgUsage.ai_credits_used` counter; Replicate operations carry the `MIN_REPLICATE_CREDITS = 10` floor via `replicate_operation_credits`. `cost_micros`/`ai_cost_micros` always hold TRUE unfloored supplier cost.
- **New cost rates are inserted as NEW versioned rows** (`effective_from`), never `UPDATE`. See `w3repricing7`.
- **Any new SQLAlchemy enum MUST use `values_callable=lambda x: [e.value for e in x]`**, as `GeneratedImage` does. Without it SQLAlchemy persists member NAMES while migrations create VALUES — the defect fixed by `x2planlabels3`.
- Alembic: head is `y5kontextrate9`. New revisions use a **random** id chained on the current head. Hand-write migration bodies; `--autogenerate` emits destructive DROPs in this repo. Verify `alembic heads` shows exactly ONE head. Never edit a migration before downgrading past it.
- Tests: host in-memory SQLite, `asyncio_mode="auto"` (NO `@pytest.mark.asyncio` unless the file you edit already uses it), each file owns its engine + autouse `setup_db`. Router tests use httpx `ASGITransport` + `app.dependency_overrides[get_db]`.
- Known pre-existing failures (NOT regressions): `test_edit_model.py` x1, `test_strands_runtime.py` x9 — **10 total**. Run the FULL suite; credit and prompt constants are asserted as literals across many files.
- Frontend: CSS-variable tokens only (no hex/rgb), Lucide icons, all strings via `t()` with keys in EVERY locale under `apps/web/public/locales/`, `apiClient` (never raw `fetch`), TanStack Query.
- Commit style `feat(scope): …` / `fix(scope):`; every commit ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: PromptBuilder core

**Files:**
- Create: `apps/api/app/services/prompting/__init__.py`, `vocab.py`, `modules.py`, `builder.py`
- Test: `apps/api/tests/test_prompt_modules.py`, `apps/api/tests/test_prompt_builder.py`

**Interfaces:**
- Produces: `PromptBuilder.build_product_showcase(spec, brand_kit) -> PromptResult`, `.build_product_3d(spec) -> PromptResult`, `.build_image(spec, brand_kit) -> PromptResult`, `.build_negative_prompt(extra=None) -> str`; dataclasses `ShowcaseSpec`, `Product3DSpec`, `ImageSpec`, `PromptResult`; the vocabularies.
- Consumes: nothing. This package must NOT import routers, models, or services — it is pure so every module is testable in isolation.

**Vocabularies** (`vocab.py`) — token -> fragment maps, plus the two verbatim system prompts:
`LIGHTING` (softbox, golden_hour, hard_sun, rim, diffused_daylight, chiaroscuro, candlelit), `CAMERA` (macro, 35mm, 50mm, 85mm, tilt_shift, top_down, three_quarter), `ASPECT_RATIOS` (1:1, 4:5, 3:2, 16:9, 9:16), `QUALITY` (draft, high, ultra), `TEXTURE_RESOLUTION` (2K, 4K, 8K), `NEGATIVE_TERMS` (the 11 required exclusions: blur, noise, duplicate products, wrong labels, cropped products, deformed packaging, incorrect reflections, bad shadows, low resolution, text artefacts, watermarks), `SHOWCASE_SYSTEM_PROMPT`, `PRODUCT_3D_SYSTEM_PROMPT` (both verbatim from the spec).

- [ ] **Step 1: Write the failing module tests**

```python
# apps/api/tests/test_prompt_modules.py
from app.services.prompting import modules, vocab


def test_each_module_returns_none_when_it_has_nothing_to_say():
    """A module that contributes nothing must omit itself, not emit an empty
    fragment that leaves double separators in the final prompt."""
    assert modules.user_intent("") is None
    assert modules.user_intent("   ") is None
    assert modules.brand_style(None) is None


def test_lighting_module_uses_the_vocabulary_fragment():
    frag = modules.lighting("golden_hour")
    assert frag is not None
    assert vocab.LIGHTING["golden_hour"] in frag


def test_unknown_vocabulary_token_is_rejected_not_silently_dropped():
    import pytest
    with pytest.raises(KeyError):
        modules.lighting("disco_ball")


def test_preservation_strength_scales_the_fragment():
    weak = modules.product_preservation(20)
    strong = modules.product_preservation(100)
    assert weak != strong
    # the non-negotiable identity clause is present at every strength
    for frag in (weak, strong):
        for term in ("geometry", "proportions", "label", "logo", "colours"):
            assert term in frag.lower()
```

- [ ] **Step 2: Run to verify RED**

Run: `cd apps/api && python -m pytest tests/test_prompt_modules.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.prompting'`

- [ ] **Step 3: Write the failing builder tests**

```python
# apps/api/tests/test_prompt_builder.py
from app.services.prompting import PromptBuilder, ShowcaseSpec, Product3DSpec, vocab


def _spec(**kw):
    base = dict(scene_id="luxury_studio", lighting="softbox", camera="85mm",
                aspect_ratio="1:1", creativity=40, product_preservation=90,
                user_prompt="", negative_prompt="", seed=None, quality="high",
                product_description="")
    base.update(kw)
    return ShowcaseSpec(**base)


def test_showcase_carries_the_verbatim_system_prompt():
    r = PromptBuilder.build_product_showcase(_spec(), None)
    assert r.system_prompt == vocab.SHOWCASE_SYSTEM_PROMPT
    assert "award-winning luxury commercial product photographer" in r.system_prompt


def test_user_intent_is_appended_last_and_never_replaces_direction():
    r = PromptBuilder.build_product_showcase(
        _spec(user_prompt="Luxury bathroom with warm sunlight."), None)
    assert "Luxury bathroom with warm sunlight." in r.prompt
    # it lands after the preservation direction, so it refines rather than overrides
    assert r.prompt.index("Luxury bathroom") > r.prompt.lower().index("geometry")


def test_negative_prompt_covers_every_required_exclusion():
    neg = PromptBuilder.build_negative_prompt()
    for term in vocab.NEGATIVE_TERMS:
        assert term.lower() in neg.lower()
    assert len(vocab.NEGATIVE_TERMS) >= 11


def test_user_negative_is_appended_not_substituted():
    neg = PromptBuilder.build_negative_prompt("extra thing")
    assert "extra thing" in neg
    assert vocab.NEGATIVE_TERMS[0].lower() in neg.lower()


def test_modules_used_records_provenance():
    r = PromptBuilder.build_product_showcase(_spec(user_prompt="warm light"), None)
    assert "product_preservation" in r.modules_used
    assert "user_intent" in r.modules_used
    # a module with nothing to say is not recorded
    r2 = PromptBuilder.build_product_showcase(_spec(user_prompt=""), None)
    assert "user_intent" not in r2.modules_used


def test_product_3d_carries_its_own_system_prompt_and_no_photography_direction():
    r = PromptBuilder.build_product_3d(
        Product3DSpec(quality="high", texture_resolution="4K", product_description=""))
    assert r.system_prompt == vocab.PRODUCT_3D_SYSTEM_PROMPT
    assert "senior 3D artist" in r.system_prompt
    assert "watertight" in r.system_prompt.lower()
```

- [ ] **Step 4: Implement the package**

`vocab.py` holds the maps and both system prompts verbatim. `modules.py` implements one pure function per module, each returning `str | None`, raising `KeyError` for an unknown token. `builder.py` defines the spec dataclasses, `PromptResult`, and `PromptBuilder`, which calls the modules in spec order, drops `None`s, joins with `". "`, and records `modules_used`.

- [ ] **Step 5: Run both test files to GREEN**

Run: `cd apps/api && python -m pytest tests/test_prompt_modules.py tests/test_prompt_builder.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/services/prompting apps/api/tests/test_prompt_modules.py apps/api/tests/test_prompt_builder.py
git commit -m "feat(prompting): composable PromptBuilder with pure prompt modules"
```

---

### Task 2: Adopt PromptBuilder in the existing tools

**Files:**
- Modify: `apps/api/app/services/product_service.py` (`build_scene_prompt`), `apps/api/app/services/image_service.py` (`build_image_prompt`, `build_social_prompt`)
- Test: extend the existing tests for those functions

**Interfaces:**
- Consumes: `PromptBuilder` (Task 1). Produces: unchanged public signatures.

**This is the "improve the existing image tools with the same flow" requirement.** All three functions keep their exact signatures and remain the public seam; internally each builds a spec and delegates to `PromptBuilder`. Existing callers (`routers/product.py`, `routers/images.py`, the agent skills) are NOT changed in this task.

- [ ] **Step 1: Pin current behaviour first**

Before changing anything, find every existing test covering these three functions and run them. If a function has no test, write a characterisation test that captures its CURRENT output for a representative input, and commit that first. You cannot safely refactor what nothing pins.

- [ ] **Step 2: Delegate, keeping signatures**

Re-implement each body to construct the matching spec and return `PromptBuilder.build_*(...).prompt`. The preservation, quality and photography direction now come from the shared modules.

- [ ] **Step 3: Verify no caller broke**

Run: `cd apps/api && python -m pytest -q` (FULL suite). Expected: 10 known failures only. Any characterisation test whose text legitimately changed must be updated with the reason stated in the report — but a change in the *observable behaviour* of an existing endpoint is a defect, not an update.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(prompting): route existing image and scene prompts through PromptBuilder"
```

---

### Task 3: Product Showcase — environments and controls

**Files:**
- Modify: `apps/api/app/services/product_service.py` (add 15 premium scenes), `apps/api/app/api/v1/routers/product.py` (extend `ProductSceneRequest` + endpoint)
- Test: `apps/api/tests/test_product_showcase.py`

**Interfaces:**
- Consumes: `PromptBuilder.build_product_showcase` (Task 1).
- Produces: `POST /product/product-scene` accepting the new optional controls.

**Backward compatibility is mandatory:** every new request field is OPTIONAL with a sensible default, so the existing `ProductTab` keeps working unchanged. The existing 11 scene ids keep working.

- [ ] **Step 1: Write failing tests**

Assert: all 15 premium scene ids exist in `PRODUCT_SCENES` with `category == "premium"`; all 11 original ids still resolve; a request with ONLY the old fields still succeeds (defaults applied); a request with lighting/camera/aspect/seed/quality produces a prompt containing those fragments; an unknown lighting token returns 422 (not 500); `seed` is echoed back in the response.

- [ ] **Step 2: RED**, then add the scenes and extend the schema, then GREEN.

The endpoint passes `aspect_ratio` through to the Replicate input (it currently hardcodes `"1:1"`), maps `creativity`/`product_preservation` onto the model's guidance knobs, and forwards `seed` when provided.

- [ ] **Step 3: Full suite + commit**

```bash
git commit -m "feat(studio): premium environments and photographic controls for Product Showcase"
```

---

### Task 4: Product3DJob model, endpoints, and migration

**Files:**
- Create: `apps/api/app/models/product3d.py`, `apps/api/alembic/versions/<random_id>_product3d_jobs.py`
- Modify: `apps/api/app/api/v1/routers/product.py` (enqueue + status endpoints)
- Test: `apps/api/tests/test_product3d_api.py`

**Interfaces:**
- Produces: `Product3DJob` model; `POST /product/to-3d -> {job_id}`; `GET /product/to-3d/{job_id} -> {status, formats, error}`.

**Enum warning:** declare `Product3DStatus` and `ModelFormat` with `values_callable=lambda x: [e.value for e in x]`. Mirror `GeneratedImage`.

`ModelFormat` includes only `GLB` and `OBJ`. Requesting anything else is a 422 at the schema boundary.

- [ ] **Step 1: Write failing router tests** — enqueue returns 202 + a job id and creates a `pending` row; status returns the row; another org's job returns 404 (tenant isolation); no token returns 401; `require_credits("ai")` guards the enqueue endpoint.
- [ ] **Step 2: RED**, implement model + schema + endpoints, GREEN.
- [ ] **Step 3: Migration** — hand-written, random revision id, `down_revision = "y5kontextrate9"` (verify with `alembic heads` first). Apply, then confirm exactly ONE head.
- [ ] **Step 4: Full suite + commit**

```bash
git commit -m "feat(studio): Product-to-3D job model and endpoints"
```

---

### Task 5: Trellis worker and cost rate

**Files:**
- Create: `apps/api/app/services/product3d/__init__.py`, `generate.py`; `apps/api/app/workers/tasks/product3d_tasks.py`
- Modify: `apps/api/app/workers/worker.py` (register the job), `apps/api/alembic/versions/<random_id>_trellis_rate.py`
- Test: `apps/api/tests/test_product3d_worker.py`

**Interfaces:**
- Consumes: `PromptBuilder.build_product_3d` (Task 1), `Product3DJob` (Task 4), `editing_service._replicate_run` (existing chokepoint — reuse it, do NOT write a second Replicate client).
- Produces: `run_product_3d(ctx, job_id)`.

**Resolve the exact Trellis model slug on Replicate first and record it in the report.** Seed its rate as a NEW versioned row; state clearly in the migration docstring that the value is an unconfirmed placeholder pending real pricing, as `w3repricing7` does.

- [ ] **Step 1: Write failing worker tests** — with a stubbed `_replicate_run`: success marks the job `completed` and stores the GLB url; a provider failure marks it `failed`, records the error, and **bills nothing**; the job meters exactly one Replicate call (not one per requested format).
- [ ] **Step 2: RED**, implement, GREEN.
- [ ] **Step 3: Migration for the Trellis rate** (random id, chained on the Task-4 head, single head verified).
- [ ] **Step 4: Full suite + commit**

```bash
git commit -m "feat(studio): Trellis worker for Product-to-3D"
```

---

### Task 6: OBJ conversion

**Files:**
- Create: `apps/api/app/services/product3d/convert.py`
- Modify: `apps/api/pyproject.toml` (add `trimesh`), the worker to run conversions
- Test: `apps/api/tests/test_product3d_convert.py`

**Interfaces:**
- Produces: `async def convert(glb_bytes: bytes, target: ModelFormat) -> bytes`, `def supported_formats() -> set[ModelFormat]`.

- [ ] **Step 1: Write failing tests** — GLB passes through byte-identical; OBJ conversion of a minimal generated mesh produces bytes that `trimesh` can re-load as a mesh with faces; an unsupported format raises; `supported_formats()` reports what actually works at runtime (capability probe, so a missing optional dependency degrades to "not offered" rather than a 500).
- [ ] **Step 2: RED**, implement with `trimesh`, GREEN. OBJ is multi-file (`.obj` + `.mtl` + textures) — return a zip and name the stored object accordingly.
- [ ] **Step 3:** Wire into the worker so each requested format is converted, uploaded via `app/core/storage.upload_bytes`, and recorded on the job. A per-format failure records that format as failed but must NOT fail the whole job.
- [ ] **Step 4: Rebuild the api image** (`docker compose build api`) since a dependency changed, then full suite + commit.

```bash
git commit -m "feat(studio): OBJ export for Product-to-3D"
```

---

### Task 7: Product Showcase UI

**Files:**
- Modify: `apps/web/components/studio/ProductTab.tsx` (extend with the control panel; do NOT create a second product tab), `apps/web/lib/api.ts` (types + call)
- Create: `apps/web/components/studio/product/ShowcaseControls.tsx` only if `ProductTab` would otherwise exceed a readable size
- Modify: every locale file under `apps/web/public/locales/`

**Interfaces:** consumes the Task-3 endpoint contract.

- [ ] **Step 1:** Add the premium environments to the existing scene grid as a new category, keeping the existing ones.
- [ ] **Step 2:** Add the controls (lighting, camera, aspect, creativity, preservation, prompt, negative, seed, quality). Every control is optional and defaulted, so the tab behaves exactly as today until the user changes something.
- [ ] **Step 3:** Show the credit cost of a run before the user commits to it, reading the existing usage source used by `CreditMeter` — do not invent a second source of truth.
- [ ] **Step 4:** `cd apps/web && npm run typecheck && npm run build`, then commit.

---

### Task 8: Product-to-3D UI and viewer

**Files:**
- Create: `apps/web/components/studio/product3d/Product3DTab.tsx`, `ModelViewer.tsx`
- Modify: the studio page to mount the new tab beside `ProductTab`; `apps/web/package.json` (`@react-three/fiber`, `@react-three/drei`, `three`); locales

**Interfaces:** consumes the Task-4 endpoints.

- [ ] **Step 1:** Tab with upload (reuse the existing upload component), quality, texture resolution, format multi-select (GLB, OBJ), submit -> job id.
- [ ] **Step 2:** Poll status with TanStack Query until terminal; show progress and honest failure text.
- [ ] **Step 3:** `ModelViewer` with `@react-three/fiber` + `@react-three/drei`: orbit, auto-rotate, zoom, lighting presets, wireframe toggle, material preview, download, fullscreen. **Dynamically import it** (`next/dynamic`, `ssr: false`) so three.js never loads on other routes — verify the studio route's bundle does not grow for users who never open the 3D tab.
- [ ] **Step 4:** `npm run typecheck && npm run build`, confirm the 3D chunk is separate, commit.

---

## Execution Notes

**Ordering:** Task 1 gates everything. Tasks 2-6 are backend and sequential (4 -> 5 -> 6 especially). Tasks 7 and 8 are frontend and can run in an isolated worktree against the documented contracts once Tasks 3 and 4 are committed.

**Migrations run in the main worktree** (the api container mounts it).

**After all tasks:** run the full suite, confirm a single alembic head, rebuild the api image (Task 6 adds a dependency), and restart.

**Outstanding for the product owner:** the Trellis rate is a placeholder until real per-run pricing is confirmed, exactly as the Replicate rates are.
