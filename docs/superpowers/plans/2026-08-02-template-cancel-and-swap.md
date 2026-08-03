# Template Cancel and Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user replace an applied template by picking another, or remove it entirely and get their photo back, without disturbing layers they added themselves.

**Architecture:** `templateToLayers` stamps every layer it creates with an optional `templateKey`. The editor remembers the applied key plus the `hideBaseImage` value from before the template was applied. Applying strips the previous key's layers first; removing strips them and restores the flag.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript 5, Tailwind v3, react-i18next.

**Spec:** `docs/superpowers/specs/2026-08-02-template-cancel-and-swap-design.md`

## Sequencing

The redesign's Task 4 has landed (commit `27e6261`), so this is unblocked. It
restructured the apply path, and this plan is written against the result rather
than against the shape that existed when the spec was approved:

```
applyTemplate(t)                     EditControlsPanel.tsx:510
  -> needsCutout(resolved)?          :466
       yes -> setPendingCutout(...)  -> dialog -> cutoutMutation
                                        onSuccess -> insertTemplateLayers(...)  :536
       no  -> insertTemplateLayers(resolved, subjectImageUrl ?? "", disp)        :524
```

**`insertTemplateLayers` (`:473`) is the single insertion point**, and it is
where this work belongs. Both the direct path and the post-consent path funnel
through it, so putting the swap logic there covers both without touching the
dialog flow. Putting it in `applyTemplate` instead would miss every cutout
template.

## Global Constraints

- All work is in `apps/web`. No backend changes.
- All user-visible strings go through `t("key")` with translations in `apps/web/public/locales/` — all six locales (ar, de, en, es, fr, pt), with real translations, never English placeholders.
- Never hard-code colours in components. Use CSS variables (`hsl(var(--primary))`, `bg-card`).
- Use `cn()` from `lib/cn.ts` for conditional class names.
- No emoji anywhere — code, UI text, comments, or commit messages.
- Every new field on template and layer types is optional, so layers already saved against existing images keep rendering unchanged.
- `npm run typecheck` from `apps/web/` must pass with zero errors before commit.
- Commit style: `feat(scope): description`.

---

## Task 1: Stamp, swap and remove

**Files:**
- Modify: `apps/web/components/studio/edit/EditCanvas.tsx` (layer types)
- Modify: `apps/web/components/studio/edit/text-templates.ts` (`templateToLayers`, around line 514)
- Modify: `apps/web/components/studio/edit/EditControlsPanel.tsx` (`insertTemplateLayers` at :473, and the new remove control)
- Modify: `apps/web/public/locales/*/common.json`

**Interfaces:**
- Produces: `templateKey?: string` on `TextLayer` and `ImageLayer`; `templateToLayers(t, subjectUrl, width, height, templateKey)`.

- [ ] **Step 1: Add the optional field**

In `EditCanvas.tsx`, add to both `TextLayer` and `ImageLayer`:

```ts
  /** Set only on layers created by applying a template, so applying another
   *  template or removing this one can find them again. Absent on layers the
   *  user added, which neither action may touch. */
  templateKey?: string;
```

Optional, so layers saved before this change are unaffected.

**Do not derive this from the existing `tpl-<timestamp>-<i>` layer ids.** Those ids already carry a load-bearing job — layer uniqueness — and inferring a second meaning from a formatted string couples the two silently: a format change would break template removal with no compile-time signal.

- [ ] **Step 2: Stamp the layers**

Give `templateToLayers` a fifth parameter `templateKey: string` and set it on every layer it produces — the background layer, shape layers, image layers and text layers alike. The function already computes `const now = Date.now()` for id uniqueness; the key is a separate value supplied by the caller, not derived from `now`.

- [ ] **Step 3: Track what is applied**

In `EditControlsPanel`, add:

```ts
interface AppliedTemplate {
  key: string;
  /** hideBaseImage as it was BEFORE this template was applied. */
  hideBaseBefore: boolean;
}
```

held as `useState<AppliedTemplate | null>(null)`.

- [ ] **Step 4: Make insertion replace rather than stack**

All of this goes in `insertTemplateLayers` (`EditControlsPanel.tsx:473`), **not**
in `applyTemplate`. Both the direct path (`:524`) and the post-consent cutout
path (`:536`) call it, so this is the only place that covers both.

Generate a key (`crypto.randomUUID()`), pass it to `templateToLayers`, then:

1. Keep the existing empty-list guard exactly as it is — `if (newLayers.length === 0) return;`. A subject-only template with no subject URL must still change nothing.
2. Drop every existing layer whose `templateKey` equals the currently applied key.
3. Append the new layers to what remains, replacing the current
   `onSetLayers([...layers, ...newLayers])`.
4. Record the new `AppliedTemplate`, **carrying `hideBaseBefore` forward from the previous record when one exists**.
5. Leave the selection line, `onRequestTool?.("text")` and the `placesSubject` /
   `onHideBaseImage?.(true)` call untouched.

Point 4 is the subtle one, and the spec's verification case 4 exists for it. If
template A hides the photo and B replaces A, the value to restore on a later
removal is what was true before **A** — not the `true` that A set. Capturing the
current flag on every insertion would make removal after a swap leave a blank
canvas.

Note the ordering consequence of doing this inside `insertTemplateLayers`: for a
cutout template, the previous template's layers are stripped only **after** the
cutout resolves. A cancelled or failed consent dialog therefore leaves the
existing template intact, which is the correct behaviour — nothing is spent and
nothing is lost.

- [ ] **Step 5: Add the remove control**

Shown only when `appliedTemplate` is non-null. It removes every layer carrying the applied key, calls `onHideBaseImage(appliedTemplate.hideBaseBefore)`, and clears the record. Layers without a `templateKey` keep their positions and order.

Label via `t("imageEdit.templates.remove", ...)`. Add the key to all six locale files with real translations — read the neighbouring `imageEdit` entries in each locale for register; the existing `imageEdit.burnFailed` entries are a good quality reference.

- [ ] **Step 6: Typecheck**

Run from `apps/web/`:

```bash
npm run typecheck
```

Expected: PASS, zero errors.

- [ ] **Step 7: Browser verification**

`npm run dev`, open an image in the editor, and check all seven cases:

1. Apply a template, then a different one. Only the second is present.
2. Apply a template, add your own text layer, then swap. Your layer survives at its position; the first template's layers are gone.
3. Apply a subject-placing template, then remove it. The photo reappears.
4. Apply a subject-placing template, swap to another subject-placing one, then remove. The photo still reappears.
5. With no template applied, the remove control is not shown.
6. Apply a cutout template, then apply a second template and CANCEL its consent dialog. The first template stays fully intact and no credits are spent.
7. Open an image whose layers were saved before this change, apply a template, and confirm no pre-existing layer is removed and nothing errors.

Case 4 is the one that fails if `hideBaseBefore` is captured per-apply rather than carried forward. Do not skip it.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/studio/edit apps/web/public/locales
git commit -m "feat(editor): swap or remove an applied template"
```

---

## Self-Review Notes

**Spec coverage.** The `templateKey` mechanism, the `AppliedTemplate` record, replace-on-apply, the remove control, and the untouched-user-layers guarantee are all Step 1 through Step 5. The spec's decision that text edits are discarded on swap needs no code — it is what replace-on-apply does by default, and the spec records the reasoning rather than requiring a confirmation path.

**Why one task.** The pieces are not independently testable: stamping without the swap logic changes nothing observable, and the swap logic cannot work without the stamp. A reviewer could not meaningfully accept one and reject the other, which is the test for drawing a task boundary.

**Written against the landed code, not the code the spec assumed.** The redesign's
Task 4 (`27e6261`) split the apply path into `applyTemplate` plus
`insertTemplateLayers`, with a consent-gated async branch between them. Step 4
targets `insertTemplateLayers` because it is the single point both branches pass
through; an earlier draft of this plan targeted `applyTemplate`, which would have
silently skipped every cutout template.

**One case the spec's verification list does not cover**, added here because the
async path created it: apply a cutout template, then apply a second template and
cancel its consent dialog. The first template must remain fully intact — no
layers stripped, no credits spent. Add it to the browser checks in Step 7.
