# Cancel or Swap an Applied Template

**Date:** 2026-08-02
**Status:** Approved
**Scope:** `apps/web` — the image editor's template application path.

## Problem

Applying a template is currently one-way.

`applyTemplate` (`EditControlsPanel.tsx:461`) appends its layers:

```ts
onSetLayers([...layers, ...newLayers]);
```

So picking a second template stacks it on top of the first rather than replacing
it, and the result is two compositions overlaid. There is no way to remove a
template once applied short of deleting each of its layers by hand.

It also sets `onHideBaseImage?.(true)` when the template places the subject
photo, and never restores it. Removing the layers by hand therefore leaves the
photo hidden with nothing in its place — a blank canvas.

The editor's existing undo does not help: `historyIdx` walks **saved image
versions**, while layers are unsaved editor state. Undo cannot reach them.

## Goals

- Picking a different template replaces the current one.
- A single control removes the applied template and restores the photo.
- Layers the user added themselves are never touched by either action.

## Non-goals

- Layer-level undo/redo. That is a larger feature and is not required here.
- Preserving text edits across a swap. See the decision below.

---

## Design

### Identifying a template's layers

`templateToLayers` stamps every layer it creates with an optional
`templateKey: string`, unique per application. `TextLayer` and `ImageLayer` each
gain:

```ts
  /** Set only on layers created by applying a template, so applying another
   *  template or removing this one can find them again. Absent on layers the
   *  user added. */
  templateKey?: string;
```

Optional, so layers already saved against existing images are unaffected.

**Why not reuse the existing `tpl-<timestamp>-<i>` id prefix.** Those ids already
carry a load-bearing job — layer uniqueness — and inferring a second meaning from
a formatted string couples the two silently. A rename or format change would
break template removal with no compile-time signal.

### Editor state

The editor holds one additional value:

```ts
interface AppliedTemplate {
  key: string;
  /** hideBaseImage as it was before this template was applied. */
  hideBaseBefore: boolean;
}
```

`null` when no template is applied.

### Applying a template

1. Build the new layers, as today.
2. If `newLayers.length === 0`, return without changes — the existing guard.
3. Drop every layer whose `templateKey` matches the currently applied template.
4. Append the new layers.
5. Record the new `AppliedTemplate`, preserving `hideBaseBefore` from the
   *previous* record when one exists, so a swap does not capture the hidden
   state a prior template caused.
6. Select the first foreground layer and switch to the text tool, as today.
7. Hide the base image if the template places the subject, as today.

Step 5 is the subtle one. If template A hides the photo and B replaces it, the
value to restore on a later removal is what was true before A — not the `true`
that A set.

### Removing a template

A control removes every layer carrying the applied key, restores
`hideBaseImage` to `hideBaseBefore`, and clears the record. Layers without a
`templateKey` remain untouched, in their existing order.

It appears only when a template is applied.

### Text edits are discarded on swap

Picking a different template replaces the current one immediately, discarding
any copy typed into it. This matches how design tools behave: choosing a new
layout means starting that layout fresh, and the alternatives are worse —
confirming on every swap requires storing each layer's authored copy and
interrupts the common case, while merging edited layers into a new composition
drops them at the old layout's coordinates, where they will usually look wrong.

Removal is a single click, so the cost of an unwanted swap is low.

---

## Verification

`apps/web` has no test framework; verification is `npm run typecheck` plus
browser checking. The behaviours to confirm:

1. Apply a template, then apply a different one. Only the second is present.
2. Apply a template, add your own text layer, then swap. Your layer survives at
   its position; the first template's layers are gone.
3. Apply a subject-placing template, then remove it. The photo reappears.
4. Apply a subject-placing template, swap to another subject-placing one, then
   remove. The photo still reappears — this is the `hideBaseBefore` case.
5. Remove with no template applied. The control is not shown.
6. Apply a template to an image whose layers were saved before this change.
   Nothing errors and no pre-existing layer is removed.
