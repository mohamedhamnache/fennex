# Template Design Freedom

**Date:** 2026-08-04
**Status:** Approved
**Scope:** `apps/web` — the composition families and the type system they draw from.

## Problem

The 34-template set was rejected on sight for the second time: the type is too
big and the compositions are not creative.

The cause is not the families. It is three rules I imposed to make bad design
impossible, which also make good design impossible.

**There are exactly four type sizes in the entire system.** Every one of the 34
templates draws from them:

| step | size | width per line | cap height |
| --- | --- | --- | --- |
| display | 112px | 14.0% | 10.2% |
| headline | 80px | 10.0% | 7.3% |
| subhead | 34px | 4.2% | 3.1% |
| support | 16px | 2.0% | 1.5% |

Across all seven families there are 24 text runs total.

The three rules, and what each cost:

1. **A mandated 5:1 headline-to-support ratio.** With support at a readable
   16px, headline is forced to 80px. The rule guarantees hierarchy and fixes the
   absolute size at "loud". Editorial work typically sets a headline at 4-6% of
   canvas width; this system cannot go below 10%.
2. **`TYPE_STEPS` as the only legal source of sizes** — "no family invents a
   pixel size". Nothing can be quieter, set at an intermediate size, or scaled to
   its own composition.
3. **`panel()` as the only text producer**, so every run sits on an opaque field.
   This is why every composition is a box with text in it: type can never sit
   over a chosen region of a photograph, which is most of what design does.

A template that must stay legible over *any* photograph can only ever use opaque
boxes. A designer picks a photograph that suits the layout. The system was built
for the first case and the product needs the second.

## Goals

- Type sized to its composition, quieter by default, loud only by choice.
- Compositions that are not all boxes.
- Keep the guarantees that are about correctness rather than taste.

## Non-goals

- Changing the renderer, the export path, or the enforcement gates for
  distinctness, brand neutrality and capability coverage.
- Rebuilding all 34 templates before the direction is judged. See Validation.

---

## 1. Type becomes continuous

`TYPE_STEPS` stops being a fixed four-rung ladder. A family sets sizes as
percentages of canvas width appropriate to its own composition.

The 5:1 ratio rule is removed. Hierarchy comes from contrast between elements —
size, weight, colour, spacing — not from a fixed multiple that also dictates
absolute scale.

Most templates should become quieter. One or two should stay loud deliberately,
so that loudness reads as a decision rather than as the system's only setting.

**Weight and tracking become expressive.** Inter is loaded at 400-800 and every
template currently uses a single weight. Real weight jumps replace some size
jumps. Negative tracking on display type, positive on small uppercase labels.

## 2. Type may sit on the photograph

Not anywhere — in a region the template owns and has prepared: a corner it has
bled, an edge it has darkened with its own gradient, a band it controls.

The difference from today is that the darkening becomes part of the composition
rather than an opaque safety box behind every run.

`panel()` remains available and remains the way to put type on a field. It stops
being the only way to produce text.

## 3. The contrast check becomes a warning

It still measures, still runs in the sweep, still reports. It stops being a hard
gate that forces a box.

**The other gates stay hard**: distinctness (34 templates must be 34
arrangements), brand neutrality (no "fennex" in any string), and capability
coverage (every family must use blend, rotation, a real clip, or a cutout).
Those are correctness, not taste.

**Consequence, accepted deliberately:** some templates will look wrong on some
photographs. That is the trade. The sweep will begin showing amber rows that are
not defects, so warnings must stay visually distinguishable from failures or the
sweep loses its value as a signal.

---

## Validation — six before thirty-four

The previous two attempts built the full set and then asked for judgement, so
"I don't like it" meant discarding everything.

This time: **build six templates spanning the range** — two quiet, two mid, two
loud — and get them judged before scaling. If the direction is wrong, an hour is
lost rather than a night.

The six must differ in more than palette and copy. They exist to answer one
question: does this system produce work worth looking at?

Only after the six are approved does the set scale back to ~34, at which point
the existing distinctness, brand-neutrality and capability gates apply as before.

## Verification

Unchanged where it concerns correctness:

- `npm run typecheck` from `apps/web`, zero errors.
- The three hard gates still pass.
- The export path is untouched, and the non-1:1 sweep case still passes — that
  case exists because two Criticals shipped through a 1:1-only sweep.

Changed:

- Contrast is reported, not enforced. A run below 4.5:1 produces a warning row
  naming the template, the run and the ratio.
- The sweep must render the six at a size a human can judge composition from,
  not only thumbnails.

What only a human can settle: whether the six are any good.
