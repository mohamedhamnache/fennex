# Fennex — Feature Reference

An AI-powered SEO and content platform: research, write, illustrate, publish, and track.

**Scope note.** This documents what exists in the codebase. Where a feature has a known
limitation, it is stated rather than omitted.

---

## Architecture at a glance

| service | stack | port | role |
| --- | --- | --- | --- |
| `web` | Next.js 14 (App Router), React 18, TS | 3000 | customer application |
| `admin` | Next.js 14 | 3000 | internal staff console |
| `api` | FastAPI, Python 3.11, SQLAlchemy 2 async | 8000 | all business logic |
| `worker` | arq (Redis-backed) | — | background jobs |
| `crawler` | standalone service | 8001 | site crawling |
| `postgres` | **pgvector/pgvector:pg16** | 5432 | data + embeddings |
| `redis` | redis 7 | 6379 | job queue, cache |

**Postgres must have the `pgvector` extension.** Knowledge-base search stores embeddings
(`text-embedding-3-small`) as vectors. A managed Postgres without pgvector will not work.

---

## 1. Projects and onboarding

- Multi-project workspaces scoped to an organisation
- Discovery-first `/onboarding` flow
- Brand kits (colours, fonts, logo) that feed image templates and generation
- Brand voice profiles used by the writing services

## 2. SEO research

| feature | notes |
| --- | --- |
| Keyword research | DataForSEO-backed; ideas, volumes, clustering |
| Rank tracking | scheduled rank checks per keyword |
| SERP analysis | live SERP retrieval |
| Site audit | crawl-driven technical audit |
| Backlink analysis | referring domains, profile metrics |
| Competitor analysis | competitor discovery and comparison |
| Trends | topic and demand signals |
| SEO hub / scoring | consolidated scoring and recommendations |

All of these spend **SEO credits**, a bucket separate from AI credits.

## 3. Content

- **Article Studio** — streamed long-form generation with a live editor
- **Dune chat** — an in-document assistant that can apply structured edits
- Content plans and calendar, content items, saved documents
- A/B testing of variants
- Publishing to WordPress, Shopify, WooCommerce
- Social posts and scheduling
- Knowledge base with vector retrieval over uploaded documents

## 4. Image generation and editing

### Generation
- Text-to-image via OpenAI `gpt-image-1`, with usage/style presets
- Campaign planning: a coordinated set of 3–5 assets sharing one visual voice
- Image Studio: split-panel creative studio, prompt assistant, style grid, batch generation

### The editor
Basic tools (crop, resize, rotate, adjust, filter, denoise, sharpen) plus AI operations:

| operation | model |
| --- | --- |
| Remove background | BiRefNet |
| Replace background | inpainting |
| Remove object / smart erase | LaMa + segmentation |
| Insert object / generative fill | flux-fill-pro |
| Upscale | real-esrgan |
| Restore face | codeformer |
| Relight | ic-light |
| Add shadow | bria/product-shadow |
| Convert to canvas | Florence-2 (OCR + detection) + BiRefNet + LaMa |

**Masking.** Region operations need a mask. If the user has not painted one, a mask is derived
automatically — prompted segmentation when a target is named, otherwise a BiRefNet cutout. The
user confirms the highlighted region before a paid edit runs on it.

**Mirage chat.** Natural-language editing that plans one or more operations from a sentence.
- Chat history is keyed on `conversationId`, **not** `imageId` — every successful edit creates a
  new version, so keying on `imageId` would wipe the conversation after each edit.
- A mask-confirmation round trip carries a `resume_token` so a stopped chain is never re-planned
  or re-billed for steps already applied.
- **Prompt rephrase** rewrites a rough instruction into an operation-aware, high-value one.
- **Image attachment** (paste, drag-drop, or picker) is interpreted as either an *insert* or a
  *reference*; the chosen reading is stated and correctable for free.

### Templates
- 34 templates across ecommerce / social / blog / promo
- Colourway picker and one-click palette swap
- Composition is **resolution independent** — every layer field, including type metrics, is a
  percentage of the canvas
- **Burn at a chosen resolution**: match source, 2x, or a platform frame

**Known gap:** custom burn width exists in logic (`customBurnSize`) but is not exposed in the UI.

**Known risk:** the blog category (8 of 34) is the only one designed without a reference image
behind it.

### Layer selection
Clicks resolve to the layer actually **painted** under the cursor, using alpha probes weighted by
layer opacity — not the topmost bounding rectangle. This matters because Convert to Canvas
produces full-canvas layers positioned only by transparency, and templates add full-canvas
decoration on top.

## 5. AI agents

A named roster of specialised agents (Zerda, Sirocco, Dune, Mirage, Sable, Oasis, Nomad) wired to
the tools above, with orchestration, telemetry, and an employee-chat surface.

## 6. Billing and usage

- Stripe subscriptions across five paid tiers
- Two credit buckets with per-operation metering — see
  [AI Credits and Models](./ai-credits-and-models.md)
- Plan limits on projects, articles, images, social posts, keywords, seats, audits, backlinks
- Usage dashboards; an internal admin console with org/user administration, audit log, and
  MRR/COGS reporting

## 7. Integrations

WordPress, Shopify, WooCommerce, Google (OAuth), LinkedIn, SendGrid, Stripe, DataForSEO,
Replicate, OpenAI, Anthropic, Google AI.

## 8. Platform behaviours worth knowing

- **i18n** — six locales (ar, de, en, es, fr, pt); all user-visible strings go through `t()`
- **Metering audit** — a startup + CI assertion that every paid supplier call is accounted for
- **Image dimensions** are measured from the stored bytes at write time, never taken from the
  request; a chokepoint on the model enforces this
- **Resolution policies** — an operation declares whether output size must be preserved, may
  change, or should warn; a silent resolution change is treated as a defect
