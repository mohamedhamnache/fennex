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

**The audit was done, and the preliminary finding was mostly wrong.** Recorded
here because the wrong version was committed and someone will otherwise act on
it.

What the proximity grep claimed, and what was actually true:

- `batch/client.py:31` — **not a bypass.** `run_batched` is called from inside
  `call_llm_usage`, on `call_llm`'s own batch path. Already metered.
- `product.py:143` — **real, and I wrongly dismissed it once.** The first
  correction claimed the file did not exist, because it searched
  `app/services/` and the file is `app/api/v1/routers/product.py`. It is a
  gpt-4o-mini vision call over raw httpx, reaching neither `call_llm`'s
  chokepoint nor `_replicate_run`'s. The endpoint's `require_credits("ai")`
  only CHECKS the balance; it deducts nothing.
- `knowledge_service.py:105` — **real.** OpenAI embeddings, called directly, and
  `text-embedding-3-small` had no `cost_rate` row either, so metering it alone
  would still have priced to zero.

The grep missed the finding that mattered. **`stream_llm` was entirely
unmetered** — no `record_llm`, no usage accumulation — and it is the path taken
by Article Studio generation, Article Studio chat, the writing service and the
employee chat. The busiest LLM surfaces in the product billed the customer
nothing while the supplier billed us.

It was invisible to the grep because it is not a call site that bypasses
`call_llm`; it is a sibling entry point *in the same file*, one that looks
metered by association.

Both are now fixed and pinned by tests, including the case that decides whether
the stream fix is real: an abandoned stream still bills what it consumed, since
metering only complete streams would leave exactly the interrupted ones free.

The durable fix remains the same and is still not built: a startup assertion
that every supplier call path is metered.

Three greps produced three different answers, and each was wrong in a different
direction — a false positive, a false negative from searching the wrong
directory, and a miss on the largest leak of all. The lesson is not "grep more
carefully". It is that the property wanted here — every paid call is metered —
is not something a text search can establish, and it needs an assertion that
fails loudly at startup instead.

The check has to key on the OUTBOUND CALL, not on the module. Every leak found
here was a paid HTTP request to a supplier that no chokepoint saw:
`stream_llm`'s SDK stream, an httpx POST in a router, an SDK embeddings call in
a service.
