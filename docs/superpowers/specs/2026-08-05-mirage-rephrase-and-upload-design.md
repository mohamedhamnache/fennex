# Mirage Chat: Prompt Rephrase and Image Upload

**Date:** 2026-08-05
**Status:** Approved
**Scope:** `apps/web` chat panel, `apps/api` ai-command path.

## What exists already

Checked before speccing, because a sibling feature in this batch turned out to
be fully built and I had it listed as outstanding.

- **`improve_prompt`** already exists (`apps/api/app/api/v1/routers/images.py:189`)
  and calls `call_llm`, so it is metered through the ambient path. It is not
  wired into Mirage.
- **`insert_object`** is already an ai-command operation
  (`ai_command.py:40`), so inserting an uploaded image has a path to reuse.
- **`PromptToolbar`** exists in the studio as prior art for a rephrase control.

So neither feature is built from nothing. Rephrase is mostly wiring; upload
needs a new input and an intent decision.

## 1. Prompt rephrase

The user types a rough instruction in Mirage, presses a rephrase control, and
the input is replaced by an improved version before sending.

- Calls the existing `improve_prompt`.
- **Metered.** It routes through `call_llm`, so ambient metering already
  attributes it to the org. Nothing new is required for correctness, but the
  cost must be *visible*: the control states what it costs before it spends.
- The original text must be recoverable in one action. A rephrase that loses
  what the user actually meant, with no undo, is worse than no rephrase.
- Rephrasing is never automatic. It is a button, not a side effect of typing.

## 2. Image upload

The user attaches an image to a chat message. **What happens to it is decided by
what they ask** — the instruction classifies the intent:

- **Insert** — "add this logo to the bottle". The uploaded image becomes an
  element in the composition, via the existing insert path, landing as a layer
  the user can then move and resize.
- **Reference** — "make the background look like this". A vision model reads the
  uploaded image to guide the edit; the image itself never appears in the
  result.

**The classification will sometimes be wrong, and the failure is asymmetric.**
Treating a reference as an insert puts an unwanted image into the picture;
treating an insert as a reference silently drops the element the user asked for.
So the chosen interpretation must be *stated in the reply* ("Added your image" /
"Used your image as a reference"), and correcting it must not require
re-uploading or re-paying.

### Cost

Both paths spend, and they spend differently:

- **Insert** goes through the existing edit path and is metered there.
- **Reference** adds a vision call on every message that carries an image, which
  is the more expensive turn.

Both must be metered and both must be visible before they spend. The product
owner is a reseller whose first objective is margin; a chat that quietly bills
per attachment is the thing to avoid.

## Constraints

- All user-visible strings through `t()`, real translations in all six locales
  (ar, de, en, es, fr, pt).
- Chat history must survive both features. It is keyed on `conversationId`, not
  `imageId`, precisely because every successful edit creates a new version — a
  regression here wipes the conversation.
- The mask-confirmation round trip and its `resume_token` must keep working. It
  exists so a multi-step chain is not re-planned and re-billed.
- No emoji. `npm run typecheck` zero errors. `pytest` for any API change.

## Verification

- Rephrase: the control states its cost, the original is recoverable, and the
  call is attributed to the org.
- Upload insert: the image lands as a layer; the reply says it was inserted.
- Upload reference: the image does not appear in the result; the reply says it
  was used as a reference.
- A wrong classification can be corrected without re-uploading or re-paying.
- Attaching an image does not break history, mask confirmation, or resume.
- Credit balance moves by the stated amount on each path and not otherwise.

What only a human can settle: whether the classification is right often enough
to be useful, and whether the rephrase actually improves prompts rather than
merely lengthening them.

## Out of scope, recorded here so it is not lost

An audit found four call sites that bypass the `call_llm` chokepoint and are
therefore invisible to ambient metering. Three appear unmetered:
`knowledge_service.py:105`, `batch/client.py:31`, `product.py:143`. The fourth,
`image_service.py:162`, is metered.

That finding is preliminary — established by proximity grep, which has already
produced one false result in this area. It needs its own audit, and the durable
fix is a startup assertion that every supplier call path is metered, rather than
periodic greps.
