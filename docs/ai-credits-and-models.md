# AI Credits and Models

How Fennex prices supplier spend, and every model it pays for.

**Source of truth:** `apps/api/app/core/credits.py`, `apps/api/app/services/metering/meter.py`,
and the `cost_rates` table. This document describes them; where they disagree, the code wins.

---

## 1. The money model

Fennex is a reseller. It buys supplier capacity (LLMs, Replicate, DataForSEO) and sells it
as **credits**. Two independent buckets, deliberately not interchangeable:

| bucket | covers | unit of pricing |
| --- | --- | --- |
| **AI credits** | LLM calls, image generation, image edits | real supplier cost |
| **SEO credits** | DataForSEO tasks | one task, weighted per type |

### AI credits

```
1 AI credit = $0.00105 of supplier cost      (CREDIT_MICROS = 1_050 micro-dollars)
```

All money is held in **micro-dollars** (`$1 = 1_000_000`) to avoid float drift.

Credits are **accumulated per operation** into `OrgUsage.ai_credits_used`, not derived from a
summed total at read time. That is not a style choice: pricing floors (below) cannot be
expressed as a function of an accumulated sum.

> **The invariant that protects your margin reporting.**
> `cost_micros` and `ai_cost_micros` always hold the **true, unfloored supplier cost**, because
> COGS and margin dashboards read them. Floors and markups live **only** in the billed counter
> (`ai_credits_used`). A markup must never masquerade as cost.

### Pricing floors

Some operations cost less to serve than they are worth to sell.

| floor | value | applies to |
| --- | --- | --- |
| `MIN_REPLICATE_CREDITS` | **10 credits** | every Replicate prediction that cost money |
| `FEATURE_MIN_CREDITS["improve_prompt"]` | **10 credits** | the Mirage rephrase button |

A run that cost **zero** bills zero — an unpriced model is never silently floored up. The
feature floor is anchored on **tokens**, not cost, so a missing `cost_rates` row (which prices
an LLM call to 0) cannot silently make a floored feature free.

### SEO credits

Counted per DataForSEO task and weighted, because "tasks" is the unit both users and the
supplier bill in.

| unit | credits |
| --- | --- |
| `serp` | 2 |
| `rank_check` | 2 |
| `backlinks` | 5 |
| `audit` | 10 |
| `keyword_ideas` | 15 |
| `keyword_analysis` | 1 |

---

## 2. Plans

| plan | price/mo | AI credits | SEO credits | projects | articles | images |
| --- | --- | --- | --- | --- | --- | --- |
| free | $0 | 200 | 100 | 1 | 4 | 5 |
| starter | $29 | 5,000 | 1,500 | 1 | 25 | 40 |
| pro | $99 | 18,000 | 7,500 | 5 | 120 | 200 |
| agency | $299 | 55,000 | 20,000 | — | — | — |
| scale | $799 | 150,000 | 60,000 | — | — | — |
| enterprise | custom | 500,000 | 250,000 | unlimited | unlimited | unlimited |

At $0.00105 of cost per credit, a Pro plan's 18,000 credits represent about **$18.90 of
supplier cost** against $99 of revenue — before considering that most operations bill above
cost via the floors.

> **Known behaviour, decided deliberately (2026-08-02):** credits reset on the **calendar 1st**,
> not the Stripe anniversary. A mid-month subscriber gets a full allowance immediately. This is
> accepted, not a bug.

---

## 3. Every model, and what it costs

Rates are **micro-dollars per unit** exactly as stored in `cost_rates`.

### Language models

| provider | model | input | output | cache read | cache write |
| --- | --- | --- | --- | --- | --- |
| anthropic | `claude-haiku-4-5-20251001` | 1.0 | 5.0 | 0.1 | 1.25 |
| anthropic | `claude-sonnet-5` | 3.0 | 15.0 | 0.3 | 3.75 |
| anthropic | `claude-opus-5` | 5.0 | 25.0 | 0.5 | 6.25 |
| anthropic | `claude-opus-4-8` | 5.0 | 25.0 | 0.5 | — |
| openai | `gpt-4o-mini` | 0.15 | 0.6 | 0.075 | 0.1875 |
| openai | `gpt-4o` | 2.5 | 10.0 | 1.25 | 3.125 |
| google | `gemini-2.5-flash` | 0.3 | 2.5 | — | — |
| google | `gemini-2.5-flash-lite` | 0.1 | 0.4 | — | — |
| openai | `text-embedding-3-small` | 0.02 | — | — | — |

**Batch pricing** (`batch_*` units) is seeded at **50% off** for the OpenAI and Anthropic models
above. It is modelled as its own unit rather than a multiplier so a discount change stays a data
change.

### Image and edit models (Replicate)

| model | unit | rate | used for |
| --- | --- | --- | --- |
| `google/nano-banana` | image | 39,000 | instruction-based image editing |
| `black-forest-labs/flux-kontext-pro` | run | 40,000 | product scene generation |
| `black-forest-labs/flux-fill-pro` | run | 50,000 | generative fill / inpainting |
| `firtoz/trellis` | run | 35,000 | image to 3D |
| `zsxkib/ic-light` | run | 21,000 | relighting |
| `nightmareai/real-esrgan` | run | 5,000 | upscaling |
| `stability-ai/stable-diffusion-inpainting` | run | 7,000 | inpainting |
| `sczhou/codeformer` | run | 5,000 | face restoration |
| `men1scus/birefnet` | second | 1,400 | background removal, cutouts, **masks** |
| `851-labs/background-remover` | second | 1,400 | fast template cutout |
| `bria/product-shadow` | second | 1,400 | product shadows |
| `tmappdev/lang-segment-anything` | second | 1,400 | prompted segmentation |
| `allenhooo/lama` | second | 225 | inpainting/background fill |
| `lucataco/florence-2-large` | second | 975 | OCR + object detection (Convert to Canvas) |

Image generation uses **OpenAI `gpt-image-1`**, priced from the cost the image service computes
per size/quality rather than from a `cost_rates` row.

### Retired

**remove.bg is gone.** It billed **$0.20 flat (191 credits)** per call and its `size: "auto"`
default silently returned **0.25 megapixel** images. Measured against real images, BiRefNet
produces an equivalent matte (coverage within 0.1 percentage points) at full resolution for
**10 credits** — about 75x cheaper. Its rate row was deleted; historical events keep their
recorded cost because `usage_events` denormalises `cost_micros` per row.

---

## 4. What common operations cost

| operation | credits | why |
| --- | --- | --- |
| Background removal / cutout | **10** | Replicate floor |
| Auto-derived mask (Mirage masked edit) | **10** | Replicate floor |
| Prompt rephrase (Mirage) | **10** | feature floor |
| Reading an image attached to a Mirage message | ~3 | one vision call |
| Instruction edit (nano-banana) | ~34 | 39,000 micro-$ |
| Product scene (flux-kontext-pro) | ~39 | 40,000 micro-$ |
| Image to 3D (trellis) | ~34 | 35,000 micro-$ |
| Convert to Canvas | ~40 | Florence-2 x2 + BiRefNet + LaMa, each at the floor |
| SERP lookup (live, depth 100) | 30 SEO credits | 3 per 10-result page, 10 pages |
| SERP lookup (live, depth 10) | 3 SEO credits | DataForSEO bills per page, not per query |
| Scheduled rank check (standard queue) | 1 SEO credit | ~5 min instead of ~6 s, a third of the cost |
| Souk action (audit, CRO, retention, merchandising) | ~8-25 | agentic: several LLM turns per run |
| Souk store read (`shopify.analytics`) | 0 | our own database, no supplier call |

A masked edit costs the **sum** of its supplier calls — mask derivation *plus* the edit itself.

Souk's actions are **agentic**: the model pulls store figures, reads them, and may go back for a
breakdown before answering, so a run is several LLM turns rather than one. Reading the store
itself is free — those numbers come from our own `store_orders` table, not from a supplier.

---

## 5. How metering actually works

### The chokepoints

Almost nothing meters at the call site. Three chokepoints cover nearly everything:

- **`call_llm` / `call_llm_usage`** — every non-streamed LLM call
- **`stream_llm`** — every streamed LLM call, metered in a `finally`
- **`_replicate_run`** — every Replicate prediction, metered in the success branch

### Ambient attribution

`get_org_llm_keys(org_id, db)` calls `set_metering_org(org_id)`. Every LLM call is preceded by a
key lookup, so `call_llm` can attribute usage without each caller threading a meter through.
The auth dependency sets it per request as well.

> **Trap:** ambient metering **silently no-ops when no org is set**. A path is only really
> metered if it resolved keys through `get_org_llm_keys` or ran under an authenticated request.
> A script calling a service function directly spends money and records nothing.

> **Trap:** `require_credits("ai")` only **checks** a balance. It deducts nothing. Its presence
> on an endpoint is not evidence that the endpoint bills.

### Streamed calls

Usage is collected in a `finally`, not after the loop. The caller is an HTTP response the user
can navigate away from; an abandoned stream still spent tokens, and metering only completed
streams would leave exactly the interrupted ones free.

### The audit that keeps this true

`apps/api/app/core/metering_audit.py` walks the AST of `app/` and reports any function that
reaches a supplier host or SDK call and is not on an allowlist — where each allowlist entry must
state **where** the money is recorded.

It keys on the **outbound call**, not the module: past leaks sat in files whose *other* functions
metered correctly. It logs at startup (an outage is the wrong response to a billing finding) and
**fails in CI** via `tests/test_metering_audit.py`.

**Adding a supplier call without metering it will fail the test suite.** Fix it by metering the
call, or by adding it to `ALLOWLIST` with a note saying where it is recorded.

### Adding or swapping a model

1. Verify the model's real price against the live API — never guess.
2. Seed a `cost_rates` row in a hand-written Alembic migration **in the same commit**.
3. Prefer a `replicate`/`second` row: `record_replicate` takes the per-second branch whenever
   Replicate reports `predict_time`, which makes a per-run row unreachable.
4. Delete rate rows for models no longer used.
5. Run the **full** pytest suite — credit literals are asserted across router and worker tests.

An unrated model prices to **zero** and bills the customer nothing while the supplier bills you.
