# 2026 Template Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seven template families and the 34 templates built on them with families that exercise the renderer's unused vocabulary — blend modes, rotation, real clipping, and a subject cutout — and enforce distinctness so the set cannot silently collapse into repeats again.

**Architecture:** The renderer, rasteriser, and readability/contrast guarantees are unchanged. `families.ts` is rewritten; `text-templates.ts`'s `TEXT_TEMPLATES` is rebuilt on it. Background removal moves to a Replicate model at 10 credits, gated by a consent dialog. Three new mechanical checks run in the sweep.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript 5, Tailwind v3, react-i18next. FastAPI, SQLAlchemy 2 async, Alembic, arq. No test framework in `apps/web`; `pytest` in `apps/api`.

**Spec:** `docs/superpowers/specs/2026-08-02-template-redesign-2026-design.md`

## Global Constraints

- Frontend work is in `apps/web`; the only backend work is Task 1.
- Never hard-code colours in components. Template and family definitions take colours from `resolvePalette` roles, never from literals.
- All user-visible strings go through `t("key")` with translations in `apps/web/public/locales/` — all six locales (ar, de, en, es, fr, pt), with real translations, not English placeholders. The dev sweep route is exempt.
- Use `apiClient` from `lib/api.ts` for API calls; never `fetch` directly.
- Use `cn()` from `lib/cn.ts` for conditional class names.
- No emoji anywhere — code, UI text, comments, template copy, or commit messages.
- No template string may contain "fennex" in any casing.
- Allowed blend modes, exactly: `normal | multiply | screen | overlay | soft-light | darken | lighten`.
- Clips are limited to `{shape:"circle"}`, `{roundedPct}` and `{insetPct}`. Every other `ShapeId` silently degrades to a rounded rect.
- Every new field on template and layer types is optional.
- Fonts load through the `globals.css` Google Fonts `@import`, never `next/font` — its hashed family names break `document.fonts.check` and canvas `ctx.font` lookups.
- Every AI supplier call must be metered and its cost rate seeded in the same change that introduces the model.
- `npm run typecheck` from `apps/web/` must pass with zero errors before any frontend commit. `pytest` must pass for Task 1.
- Commit style: `feat(scope): description` / `fix(scope):` / `refactor(scope):` / `docs:`.

---

## File Structure

**Create:**

| Path | Responsibility |
| --- | --- |
| `apps/api/alembic/versions/<rev>_replicate_rembg_rate.py` | Cost rate for the Replicate background remover |
| `apps/web/components/studio/edit/CutoutConsentDialog.tsx` | The credit-cost consent dialog |

**Modify:**

| Path | Change |
| --- | --- |
| `apps/api/app/services/editing_service.py` | Add `remove_background_cheap`, backed by Replicate |
| `apps/api/app/api/v1/routers/images.py` | Expose the cutout operation |
| `apps/web/components/studio/edit/palette.ts` | Add `mono` font role and the `accentInk` palette role |
| `apps/web/components/studio/edit/families.ts` | Replace all seven families |
| `apps/web/components/studio/edit/text-templates.ts` | Rebuild `TEXT_TEMPLATES`; add `"subject-cutout"` source |
| `apps/web/components/studio/edit/EditControlsPanel.tsx` | Async apply path for cutout templates |
| `apps/web/app/dev/template-sweep/page.tsx` | Three new checks |
| `apps/web/app/globals.css` | Add JetBrains Mono to the font import |

---

## Task 1: Replicate background removal at 10 credits

**Files:**
- Modify: `apps/api/app/services/editing_service.py`
- Create: `apps/api/alembic/versions/<rev>_replicate_rembg_rate.py`
- Test: `apps/api/tests/test_editing_service.py`

**Interfaces:**
- Produces: `async def remove_background_cheap(image_url: str) -> dict` returning `{"ok": True, "image_url": str, "width": int, "height": int}` or `{"ok": False, "error": str}` — the same shape as the existing `remove_background` at `editing_service.py:309`.

The existing `remove_background` calls remove.bg at $0.20, metering to 191 credits. This adds a Replicate path that lands on `MIN_REPLICATE_CREDITS` (10). Verified live on 2026-08-02:

```
model     851-labs/background-remover
version   a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc
official  false  -> community model, per-GPU-second billing
inputs    image, format, reverse, threshold, background_type
```

- [ ] **Step 1: Write the failing test**

```python
async def test_cheap_cutout_uses_replicate_and_meters_it(monkeypatch):
    calls = {}

    async def fake_run(model, input_params, version=None, **kw):
        calls["model"] = model
        calls["version"] = version
        return "https://example.test/cutout.png"

    monkeypatch.setattr(editing_service, "_replicate_run", fake_run)
    monkeypatch.setattr(editing_service, "finalize",
                        _fake_finalize(url="https://cdn.test/c.png", w=800, h=800))

    out = await editing_service.remove_background_cheap("https://cdn.test/in.jpg")

    assert out["ok"] is True
    assert calls["model"] == "851-labs/background-remover"
    assert calls["version"] == (
        "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc"
    )
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/api && pytest tests/test_editing_service.py::test_cheap_cutout_uses_replicate_and_meters_it -v`
Expected: FAIL, `AttributeError: module has no attribute 'remove_background_cheap'`.

- [ ] **Step 3: Implement**

Add beside `remove_background` in `editing_service.py`, following the existing Replicate call pattern in that file (`_run_replicate`, `_upload_result`, `ResolutionPolicy`):

```python
_MODEL_REMBG = "851-labs/background-remover"
_REMBG_VERSION = "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc"


async def remove_background_cheap(image_url: str) -> dict:
    """Cutout via Replicate rather than Remove.bg.

    Remove.bg bills $0.20 per image, which meters to 191 AI credits. This model
    runs a few GPU-seconds and lands on MIN_REPLICATE_CREDITS (10) -- 19x
    cheaper for the customer's allowance and for our margin. Output carries
    alpha, so the policy must ALLOW_CHANGE: the model returns the subject's
    bounding box, not the source frame.
    """
    try:
        out = await _replicate_run(
            _MODEL_REMBG,
            {"image": image_url, "format": "png", "background_type": "rgba"},
            version=_REMBG_VERSION,
        )
        stored = await finalize(out, policy=ResolutionPolicy.ALLOW_CHANGE)
        return {"ok": True, "image_url": stored.url,
                "width": stored.width, "height": stored.height}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}
```

The helper names above are the real ones in this file: `_replicate_run(model, input_params, version=None)` at `editing_service.py:327`, and `finalize(...)` imported from `app.services.image_output` — see `generate_shadow` around `editing_service.py:875-886` for a working call with `ResolutionPolicy.ALLOW_CHANGE`. Read that function before writing yours.

`ALLOW_CHANGE` is required, not incidental: the model returns the subject's bounding box, not the source frame, so asserting PRESERVE would fail every call — the same defect that broke `generate_shadow` until it was corrected.

- [ ] **Step 4: Run the test**

Run: `cd apps/api && pytest tests/test_editing_service.py::test_cheap_cutout_uses_replicate_and_meters_it -v`
Expected: PASS.

- [ ] **Step 5: Seed the cost rate**

Create the migration with a hand-written body and a random revision id — autogenerate emits destructive DROPs in this repo. Follow `n8nanobanana2_instruction_edit_rates.py` for structure.

The model is a community model, so it bills per GPU-second and the generic `('replicate','second')` rate applies. Seed an explicit row anyway so the rate is deliberate rather than inherited:

```python
_MODEL = "851-labs/background-remover"
_MICROS_PER_SECOND = 1_400  # Nvidia A100 80GB, Replicate's published rate


def upgrade() -> None:
    op.execute(
        "INSERT INTO cost_rates (provider, unit, model, effective_from, micro_dollars_per_unit) "
        "VALUES ('replicate', 'second', '%s', '%s', %d) ON CONFLICT DO NOTHING"
        % (_MODEL, _EFFECTIVE_FROM, _MICROS_PER_SECOND)
    )
```

- [ ] **Step 6: Run the full API suite**

Run: `cd apps/api && pytest`
Expected: PASS. Credit weights are asserted as literals across router and worker tests, so a pricing change can break tests far from this file.

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/services/editing_service.py apps/api/alembic/versions apps/api/tests/test_editing_service.py
git commit -m "feat(editing): cutout via Replicate at 10 credits instead of 191"
```

---

## Task 2: The mono role and the accentInk role

**Files:**
- Modify: `apps/web/components/studio/edit/palette.ts`
- Modify: `apps/web/app/globals.css`

**Interfaces:**
- Produces: `FONT_ROLES.mono`; `Palette` gains `accentInk`; `resolvePalette` returns it.

The spec says accent-coloured type should be allowed "on fields that pair with it". The code does not support that as written: `resolvePalette` guarantees 4.5:1 for `ink`/`surface` and `onAccent`/`accent` **only**. Accent-on-surface is precisely the 3.80:1 defect found earlier. So rather than widening the permitted pairings, derive a colour that keeps the guarantee.

- [ ] **Step 1: Add the mono font role**

In `palette.ts`:

```ts
export const FONT_ROLES = {
  impact: "'Anton', sans-serif",
  modern: "'Inter', sans-serif",
  support: "'Source Sans 3', sans-serif",
  mono: "'JetBrains Mono', monospace",
} as const;
```

In `apps/web/app/globals.css`, append `family=JetBrains+Mono:wght@400;500` to the existing Google Fonts `@import` — the same line Anton and Source Sans 3 use. Do not introduce `next/font`.

- [ ] **Step 2: Add accentInk**

```ts
export type PaletteRole = "surface" | "ink" | "accent" | "onAccent" | "accentInk";

/** The accent, darkened or lightened until it clears 4.5:1 on `surface`.
 *  Accent-on-surface is NOT a pair resolvePalette can promise -- in the default
 *  ecommerce palette raw accent on surface measures 3.80:1 -- so a family that
 *  wants coloured type takes this instead of `accent`. It keeps the accent's
 *  hue, which is what carries brand recognition, and moves only its lightness. */
function accentInkFor(accent: string, surface: string): string {
  if (contrastRatio(accent, surface) >= MIN_CONTRAST) return accent;
  const towardLight = relativeLuminance(surface) < 0.5;
  for (let step = 1; step <= 20; step++) {
    const candidate = towardLight
      ? mixHex(accent, "#ffffff", step / 20)
      : shadeHex(accent, 1 - step / 20);
    if (contrastRatio(candidate, surface) >= MIN_CONTRAST) return candidate;
  }
  return bestTextOn(surface);
}
```

`mixHex(a, b, t)` does not exist yet; add it next to `compositeOver`, which already does the same arithmetic against a background. Have `resolvePalette` populate `accentInk` in both the default and brand branches.

- [ ] **Step 3: Verify by execution**

Transpile `palette.ts` with the repo's tsc and run under Node. For all four category defaults and at least three brand kits including `["#0ea5e9","#22c55e"]`, assert `contrastRatio(accentInk, surface) >= 4.5`. Print the values.

Expected: every pair clears 4.5:1, and `accentInk` differs from `accent` only where raw accent failed.

- [ ] **Step 4: Typecheck and commit**

```bash
cd apps/web && npm run typecheck
git add apps/web/components/studio/edit/palette.ts apps/web/app/globals.css
git commit -m "feat(editor): add the mono font role and a contrast-safe accentInk"
```

---

## Task 3: The seven new families

**Files:**
- Modify: `apps/web/components/studio/edit/families.ts`
- Modify: `apps/web/components/studio/edit/text-templates.ts` (add the cutout source)

**Interfaces:**
- Consumes: `FONT_ROLES.mono`, `Palette.accentInk` from Task 2.
- Produces: `typeWrap`, `duotoneWash`, `offsetStack`, `ruleGrid`, `hardEdge`, `priceSlab`, `negativeSpace`, each `(p: Palette, copy: FamilyCopy, variant?: <family-specific>) => TemplateLayerDef[]`; `FAMILIES` and `FamilyId` updated; `cutout(spec?: PhotoSpec)`.

Keep everything that makes the module safe: `panel()` stays the only text-producing function, `MIN_FIELD_OPACITY` stays, `analyzeText`/`assertTemplatesReadable` stay, `TYPE_STEPS` stays the only source of sizes.

- [ ] **Step 1: Add the cutout source**

In `text-templates.ts`, widen `TemplateImageDef.source`:

```ts
  source: "subject" | "subject-cutout" | { url: string };
```

In `families.ts`, beside `photo()`:

```ts
/** The edited photo with its background removed. Costs credits to produce, so
 *  a template using this triggers a consent dialog before it applies. */
export function cutout(spec: PhotoSpec = {}): TemplateLayerDef {
  return { ...photo(spec), source: "subject-cutout" } as TemplateLayerDef;
}
```

- [ ] **Step 2: Allow accent type on a line**

`panel()` currently sets colour at `families.ts:237`:

```ts
color: line.emphasis ? p.onAccent : field.role === "accent" ? p.onAccent : p.ink,
```

Add an `accent?: boolean` option to `PanelLine` and extend that expression so an accent line on a `surface` field takes `p.accentInk`, while `emphasis` (the pill) keeps `p.onAccent` on `p.accent`. An accent line on an `accent` field must remain `p.onAccent` — accentInk is derived against surface, not against accent.

- [ ] **Step 3: Write the seven families**

Each must set at least one of `blend`, `rotation`, a non-rounded-rect clip, or a cutout source — Task 6 enforces this. Compose only `panel()`, `photo()` and `cutout()`.

- `typeWrap(p, copy, variant?: "left" | "right")` — a `surface` full-bleed field; headline at `TYPE_STEPS.display` with negative letter-spacing running edge to edge; then `cutout()` in `opts.above` so the subject paints over the type; a mono support line low.
- `duotoneWash(p, copy, variant?: "multiply" | "screen")` — `photo()` full bleed, then an `accent` full-bleed field carrying `blend: variant`, then type. This is the family that finally uses blend modes.
- `offsetStack(p, copy, variant?: "tight" | "wide")` — two `photo()` plates at `rotation: -3` and `rotation: 2`, overlapping, with a small `surface` field carrying a mono caption in the overlap.
- `ruleGrid(p, copy, variant?: "left" | "right")` — thin `rect` fields as hairline rules; a mono label at `rotation: -90` down one edge; `photo()` in a tall inset column.
- `hardEdge(p, copy, variant?: "top" | "bottom")` — `rect` fields only, no gradient, no shadow, uppercase `impact` type, a thick contrasting `rect` keyline butted against the photo edge.
- `priceSlab(p, copy, variant?: "corner" | "centre")` — `photo()`, then an oversized `display`-step numeral from `copy.subhead` overlapping it on a small `accent` field, mono microcopy beneath.
- `negativeSpace(p, copy, variant?: "high" | "low")` — a large `surface` field with type occupying under a third of it, and `photo()` reduced to a small plate with `clip: { roundedPct: 2 }`.

Fill `FamilyCopy` from the caller; do not invent copy here.

- [ ] **Step 4: Update FAMILIES and delete the old seven**

Replace the map's members with the new names and remove `scrimStack`, `framedInset`, `splitBlock`, `editorialBand`, `priceCorner`, `posterStack`, `bento`. Grep to confirm nothing references them.

- [ ] **Step 5: Verify by execution**

Transpile and run under Node. For each family, across all four category palettes: `analyzeText` reports zero unbacked runs, the authoring guard emits zero warnings, and `worstCaseContrast` for every run is at or above 4.5:1.

- [ ] **Step 6: Typecheck and commit**

```bash
cd apps/web && npm run typecheck
git add apps/web/components/studio/edit/families.ts apps/web/components/studio/edit/text-templates.ts
git commit -m "feat(editor): seven families built on blend, rotation, clipping and cutout"
```

---

## Task 4: Cutout consent

**Files:**
- Create: `apps/web/components/studio/edit/CutoutConsentDialog.tsx`
- Modify: `apps/web/components/studio/edit/EditControlsPanel.tsx`
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/public/locales/*/common.json`

**Interfaces:**
- Consumes: `remove_background_cheap` from Task 1; `cutout()` from Task 3.
- Produces: `<CutoutConsentDialog open credits onConfirm onCancel />`.

`applyTemplate` is synchronous today. A template carrying a `"subject-cutout"` layer needs a paid API round trip first, so this path becomes async and gated.

- [ ] **Step 1: Add the API client method**

In `lib/api.ts`, following the existing image-operation methods:

```ts
export async function removeBackgroundCheap(imageId: string) {
  return apiClient.post<{ image_url: string; width: number; height: number }>(
    `/images/${imageId}/cutout`, {},
  );
}
```

- [ ] **Step 2: Build the dialog**

A small modal stating the operation and the exact credit cost, with confirm and cancel. All strings through `t()`. Add `imageEdit.cutout.title`, `imageEdit.cutout.body`, `imageEdit.cutout.confirm`, `imageEdit.cutout.cancel` to **all six** locale files with real translations — read the neighbouring `imageEdit` entries in each locale for register, and follow the quality of the existing `imageEdit.burnFailed` entries.

The body must interpolate the credit count rather than hard-coding it, so a reprice does not leave the dialog lying.

- [ ] **Step 3: Gate the apply path**

In `applyTemplate`, before building layers, detect whether the resolved template contains an image def with `source === "subject-cutout"`. If it does: open the dialog; on cancel, apply nothing and leave the editor untouched; on confirm, call `removeBackgroundCheap`, and pass the returned URL into `templateToLayers` as the cutout source. Invalidate the credit meter query afterwards so the balance updates immediately — every credit-consuming call in this app does.

On API failure, surface the error and apply nothing. A half-applied template is worse than none.

- [ ] **Step 4: Typecheck and verify in the browser**

```bash
cd apps/web && npm run typecheck
```

Then with `npm run dev`: apply a cutout template and cancel — nothing changes. Apply and confirm — the subject appears cut out, and the credit balance drops by the stated amount. Apply a non-cutout template — no dialog appears.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/studio/edit apps/web/lib/api.ts apps/web/public/locales
git commit -m "feat(editor): gate cutout templates behind a credit-cost dialog"
```

---

## Task 5: The 34 templates

**Files:**
- Modify: `apps/web/components/studio/edit/text-templates.ts`

- [ ] **Step 1: Build the set**

34 entries across the four categories, using the seven families and their variants. Distribution is a judgement call within these bounds: every family appears in at least two categories, no category has fewer than 7 or more than 10, and **every one of the 34 must be geometrically distinct** — Task 6 enforces this, and the previous set failed it with seven identical pairs.

Copy must be specific, plausible marketing text in visibly different voices, and must not contain "fennex" in any casing.

- [ ] **Step 2: Verify by execution**

Run the checks from Task 3 Step 5 across all 34, plus the three new checks from Task 6.

- [ ] **Step 3: Typecheck and commit**

```bash
cd apps/web && npm run typecheck
git add apps/web/components/studio/edit/text-templates.ts
git commit -m "feat(editor): rebuild the 34 templates on the 2026 families"
```

---

## Task 6: The three new sweep checks

**Files:**
- Modify: `apps/web/app/dev/template-sweep/page.tsx`
- Modify: `apps/web/components/studio/edit/text-templates.ts`

**Interfaces:**
- Produces: `templateFingerprint(t: TextTemplate): string`.

- [ ] **Step 1: Distinctness**

```ts
/** A template's geometry with its words removed. Two templates that differ only
 *  in copy produce the same fingerprint -- which is how the previous set came
 *  to ship seven visually identical pairs while appearing to have 34 entries. */
export function templateFingerprint(t: TextTemplate): string {
  const layers = t.layers.map((l) =>
    l.kind === "text" ? { ...l, text: "" } : l,
  );
  return JSON.stringify({ background: t.background ?? null, layers });
}
```

The sweep computes fingerprints for all templates and FAILS, naming both ids, on any collision.

- [ ] **Step 2: Brand neutrality**

Every string in every template is scanned case-insensitively for "fennex". Any hit FAILS, naming the template and the string.

- [ ] **Step 3: Capability coverage**

Each family's output must set at least one of: a `blend` on any layer, a non-zero `rotation`, a clip that is not `{roundedPct}`, or an image def with `source === "subject-cutout"`. A family setting none FAILS, named.

- [ ] **Step 4: Run the sweep and do the visual pass**

`npm run dev`, open `/dev/template-sweep`. All three checks green, every existing check green, and then look at the 34: does the set read as varied, is the type genuinely large, does the duotone read as a wash rather than a tint, does the cutout matte hold up where type passes behind the subject.

**If the cutout matte shows halos on hair, stop and report it.** The spec's escape hatch is to fall back to remove.bg at 191 credits, and that is a decision for the human, not a silent switch.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/dev/template-sweep/page.tsx apps/web/components/studio/edit/text-templates.ts
git commit -m "feat(dev): sweep checks for distinctness, brand neutrality and capability use"
```

---

## Self-Review Notes

**Spec coverage.** Problem statement (repeats, unused capabilities, Fennex copy) maps to Tasks 3, 5, 6. Section 1's seven families is Task 3; the mono role and accent-type change are Task 2; brand-neutral copy is Task 5 and enforced in Task 6. Section 2's cutout is Tasks 1 and 4, including the supplier switch, the seeded rate, and consent. Section 3's three new checks are Task 6; the existing checks are carried through Tasks 3 and 5.

**One spec claim the code would not support, corrected here.** The spec says accent type becomes legal "on fields whose role pairs with accent". No such guaranteed pair exists — `resolvePalette` promises only `ink`/`surface` and `onAccent`/`accent`, and raw accent on surface is the 3.80:1 defect found during the previous families work. Task 2 therefore derives `accentInk` — the accent shifted in lightness until it clears 4.5:1 on surface, keeping its hue. This delivers the spec's intent (colour in the typography) without weakening the guarantee.

**Deliberately not in this plan.** Switching the existing Remove BG tool to the Replicate model. It is the same 19x saving on every removal customers already make, and the spec names it, but it is a separate user-facing change with its own quality risk and should not ride along with a template redesign.
