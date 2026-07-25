# Magic Onboarding — Design Spec

**Date:** 2026-07-25
**Status:** Approved design, ready for implementation plan
**Scope:** Phase 1 — "Magic discovery core"

## Goal

Build the best AI onboarding on the market for Fennex. From as little as a single URL,
Fennex should auto-discover everything it can about a business and provision a complete AI
Workspace so every AI Employee (Zerda, Dune, Sirocco, Mirage, Sable, Oasis, Nomad) performs
at expert level from day one. It should feel like hiring an experienced digital agency that
understands the business *before* doing any work.

## Phase 1 scope (this spec)

Screens **1–6, 12–13, and the Final screen** from the product brief:

1. Welcome
2. Business discovery (URL → live AI discovery)
3. Discovery review (edit everything)
4. Goals + success metrics
5. Brand DNA preview
6. Target audience / ICP
12. Workspace summary
13. Create workspace (provisioning) → Final screen with suggested first tasks

**Deferred to phase 2** (defaults applied silently, all editable later in existing settings):
Products editor (Step 4 — discovery still *captures* products, no dedicated editor yet),
Knowledge connectors (Step 7), Integrations/OAuth (Step 8), Employee configuration (Step 9),
Automation (Step 10), Permissions matrix (Step 11).

Phase-1 defaults applied at provisioning: **all 7 employees enabled**, permissions set to
**draft-only / require-approval**, **no integrations connected**.

## Key decisions (settled during brainstorming)

- **Discovery engine:** multi-page crawl + deterministic HTML extractors + one structured LLM
  synthesis call (Approach B). Deterministic extractors give reliable colors/logo/socials;
  the single Claude call gives interpretive fields. Reuses the existing crawler, Sable
  competitor scan, and `_scorecard()`.
- **Execution model:** an **arq background job** writes stage/progress/partial-results to a
  `discovery_runs` row; the frontend **polls** a status endpoint for live progress.
- **Placement:** a new **full-screen `/onboarding` route** (not a modal). It becomes the way
  new workspaces are created; the existing 3-step `CreateProjectModal` is retired.
- **Brand DNA scope:** migrate `BrandKit` / `BrandVoice` to be **per-project** (add
  `project_id`, drop the org-unique constraint). Each workspace gets its own discovered
  Brand DNA. Existing rows backfill to their org's first project.
- **"I don't have a website":** the same synthesis extractor runs on a user-typed business
  description instead of crawled text — still produces Brand DNA, audience, and suggested
  competitors. No deterministic visual extraction on this path.

## Existing building blocks this orchestrates (no employee code changes)

- **Crawler microservice** `services/crawler/app/crawler.py` — single-page crawl returning
  title, meta, canonical, h1/h2, word_count, internal/external links, images_without_alt,
  schema_types, og:title/description/image, viewport, and full text.
- **`competitor_service`** — `_crawl()`, `_scorecard()` (heuristic SEO 0–100), and
  `analyze()` which runs the **Sable** `COMPETITOR_SCAN` skill for gap insights.
- **`BrandKit`** (logo_url, colors, primary/secondary_font, style_rules, tone) and
  **`BrandVoice`** (tone, voice_prompt, vocabulary, avoid_words, training_sources).
- **`ProjectDocument` / `ProjectChunk`** (pgvector 1536) + `knowledge_service` — the
  knowledge base with embeddings.
- **`EmployeeMemory`** (org_id, project_id, employee_id, scope=workspace|project, kind, key,
  content, meta, embedding) — long-term memory every employee reads.
- **`Project`** — already carries `persona`, `persona_data` (JSONB), `description`, `locale`,
  `target_country`, `industry`, `theme`, `autopilot_enabled`.
- **`llm_service`** — Anthropic + OpenAI.

---

## Architecture

### Discovery pipeline (backend)

```
POST /api/v1/onboarding/discovery  { url } | { description }
  └─ enqueue arq job ─────────────────────────────────────────┐
                                                               ▼
  workers/tasks/discovery.py  ──►  services/discovery_service.py
      stage: crawling                                          │
        services/discovery/crawl_map.py                        │
          homepage → follow nav + /sitemap.xml, cap ~8 pages   │
      stage: extracting (deterministic, no LLM)                │
        services/discovery/extractors.py                       │
          logo (link rel=icon / og:image), colors (theme-color │
          + inline/CSS + og), fonts (font-family), socials      │
          (<a> to ig/li/fb/x/yt/pin/tiktok), JSON-LD Org/Product│
          → name/products/contact, language (lang/hreflang)     │
      stage: understanding (one structured Claude call)         │
        services/discovery/synthesis.py                         │
          industry, mission, vision, values, tone, brand        │
          personality, audience/ICP(s), value props, suggested  │
          goals, do/don't words, CTA style, reading level       │
      stage: competitors → competitor_service (Sable) [budgeted]│
      stage: seo → competitor_service._scorecard()              │
      writes result JSONB + progress/stage to discovery_runs ◄──┘

GET   /api/v1/onboarding/discovery/{run_id}   → status/stage/progress/partial result (poll)
PATCH /api/v1/onboarding/discovery/{run_id}   → user edits to the result JSON
POST  /api/v1/onboarding/provision            → WorkspaceProvisioningService (below)
```

The synthesis call returns a **schema-validated JSON contract**; malformed output falls back
to empty-editable fields rather than failing the job.

### Provisioning (on "Create workspace")

A single `WorkspaceProvisioningService.provision(run_id)` writes the confirmed profile into
the exact stores employees already query. Idempotent (upsert) and transactional (rolls back
on failure so we never leave a half-built workspace):

1. **Project** — create/update: name, domain, locale, target_country, industry, description,
   persona, theme (seeded from discovered brand colors), `persona_data` (socials, timezone,
   CMS, nav, goals, success_metrics).
2. **Brand DNA** — write per-project `BrandKit` (logo, colors, fonts, style_rules, tone) +
   `BrandVoice` (tone, voice_prompt, vocabulary, avoid_words).
3. **Knowledge base** — write the discovered business profile (what they do, products,
   audience, value props) as a `ProjectDocument`, chunk + embed via `knowledge_service`, so
   any employee can semantically retrieve "what does this company do?" Captured products live
   here in phase 1 (no products editor yet — data is not lost).
4. **Workspace + employee memory** — seed `EmployeeMemory`: `scope="workspace"` shared facts
   (mission, audience, tone, do/don't words, goals) + targeted `scope="project"` seeds
   (Sable ← competitor list; Zerda ← SEO scorecard + suggested keywords).
5. **Goals** — persisted on the project (`persona_data.goals` + `success_metrics`) so Overview
   missions and autopilot can read them.

Principle: discovery writes into `BrandKit`, `BrandVoice`, `ProjectDocument`/`ProjectChunk`
embeddings, and `EmployeeMemory` — the stores employees already read. **No employee code
changes** are required for them to be expert on day one.

### Data model changes

- **New table `discovery_runs`:** `id, org_id, project_id (nullable until provisioned),
  input_url, input_description, status (queued|running|done|error), stage (label),
  progress (0–100), result (JSONB), error, created_at, updated_at`. Persisted so a page
  refresh resumes the review from the stored result.
- **Migrations to existing tables:** `brand_kits` and `brand_voices` gain `project_id` (FK),
  drop the org-unique constraint, add per-project uniqueness; existing rows backfill to their
  org's first project.
- No other structural changes — `projects.persona_data` (JSONB) absorbs the loosely-typed
  discovered odds-and-ends.

---

## Screens & flow (frontend)

Full-screen `/onboarding` route: progress rail on the left, one objective per screen. Every
screen after discovery is editable; every step after Goals is skippable.

1. **Welcome** — "Welcome to Fennex. Let's build your AI company." Est. 3–5 min. `Start`.
2. **Business discovery** — one input: website URL (with "I don't have a website" →
   description textarea). Submit kicks off the arq job and transitions to a **live progress**
   view driven by real job stages (*Analyzing website → Reading pages → Detecting CMS →
   Understanding products → Finding competitors → Extracting Brand DNA → Analyzing SEO →
   Building profile*). Partial results animate in as they land.
3. **Discovery review** — the payoff. Discovered fields grouped in cards (Business, Brand DNA,
   Products, Audience, Competitors, SEO); each field inline-editable, each marked
   "AI-discovered" vs "you edited". A confirmation of what Fennex already figured out.
4. **Goals** — multi-select goal chips + success-metric chips, pre-highlighted from
   persona/discovery.
5. **Brand DNA preview** — a rendered Brand DNA card (voice, tone, color swatches, do/don't
   words, CTA style, reading level, emoji policy). Editable.
6. **Audience / ICP** — one or more auto-generated ICP cards (age, profession, pains, goals,
   budget, buying behavior). Add/edit/remove.
12. **Workspace summary** — everything on one page + a note that all 7 employees start enabled
    in draft-only mode. Edit links jump back to the relevant screen.
13. **Create workspace** — provisioning progress, then **Final screen**: "Your AI company is
    ready" + the employee roster + suggested first tasks (Write my first article / Analyze
    competitors / Generate Instagram posts / Build an SEO roadmap) deep-linking into existing
    tools.

### UI direction (from ui-ux-pro-max)

Respect Fennex's **existing** design system — Tailwind CSS variables (`hsl(var(--primary))`,
`bg-card`), the per-project accent themes, `.popover`, `animate-scale-in`/`animate-fade-in`,
`cn()`, and all strings through `t()`. Do **not** hard-code colors or introduce a new palette
or font stack. Apply these ui-ux-pro-max *principles* on top:

- **Pattern:** Funnel / progressive disclosure — only essential info per step, a mini-CTA per
  step, one main CTA at the end.
- **Style:** Flat, clean, icon-led. Icons via **Lucide** (never emoji — matches the standing
  no-emoji rule; the brief's employee emoji become tasteful icons in code/UI).
- **Progress & loading:** always show "Step X of Y" + a progress bar; **skeleton screens** /
  `animate-pulse` for any async wait > 300ms; the discovery view shows live stage labels, not
  a frozen spinner.
- **Motion:** stagger the discovery-review cards in on load (existing CSS animations;
  `back.out`-style easing, ~300–450ms). Keep transitions 150–300ms. Respect
  `prefers-reduced-motion`.
- **Quality bar:** `cursor-pointer` on clickables, visible focus states for keyboard nav,
  text contrast ≥ 4.5:1 in light and dark, responsive at 375 / 768 / 1024 / 1440,
  `font-display: swap`.

### Module breakdown

**Backend**
- `models/discovery.py` — `DiscoveryRun`.
- `services/discovery/crawl_map.py` — multi-page fetch (nav + sitemap, cap ~8).
- `services/discovery/extractors.py` — deterministic HTML extractors.
- `services/discovery/synthesis.py` — the structured Claude call + schema.
- `services/discovery_service.py` — orchestrates the run, writes progress; reuses
  `competitor_service` + `_scorecard`.
- `services/workspace_provisioning_service.py` — the 5-store writer.
- `workers/tasks/discovery.py` — the arq job.
- `api/v1/routers/onboarding.py` — start / poll / patch / provision.
- Alembic migration — `discovery_runs` + brand per-project changes.

**Frontend**
- `app/(dashboard)/onboarding/` — route + layout with the progress rail.
- `components/onboarding/` — one component per screen (Welcome, Discovery, DiscoveryReview,
  Goals, BrandDnaPreview, Audience, Summary, Provisioning, Done) + a `useDiscoveryPoll` hook.
- `lib/api.ts` — `startDiscovery`, `getDiscovery`, `patchDiscovery`, `provisionWorkspace`.
- Retire `CreateProjectModal`; route all "New workspace" buttons to `/onboarding`.

---

## Error handling & graceful degradation

Discovery must never dead-end the user.

- **Crawl fails / unreachable / bot-blocked** → job finishes `status=done` with a partial
  result; review shows what we got and lets the user fill the rest. Never a hard error screen.
- **LLM synthesis fails/times out** → deterministic fields (colors, logo, socials, JSON-LD
  products) still populate; interpretive fields fall back to empty-editable. Job never fails
  wholesale.
- **Spend ceiling** → discovery respects the existing hard spend ceilings; one synthesis call
  + one Sable scan are budgeted; if the ceiling is hit the job returns partial.
- **Sitemap/nav empty** → crawl homepage only; still works.
- **Provisioning** → idempotent upsert + transactional rollback; retry never duplicates or
  leaves a half-built workspace.
- **Abandon/resume** → `discovery_runs` persists; refreshing resumes review from the stored
  result.

## Testing

Backend uses pytest; frontend verifies with `npm run typecheck` + visual browser testing (no
frontend test framework, per CLAUDE.md).

- Unit tests for each deterministic extractor (colors, logo, socials, JSON-LD org/product,
  language) against saved HTML fixtures.
- Synthesis JSON-contract test: schema-validate LLM output; malformed → safe fallback.
- `WorkspaceProvisioningService` writes all five stores and is idempotent on re-run.
- Discovery job stage/progress transitions (queued → running → done/error).

## Out of scope (Phase 2+)

Products editor, Knowledge connectors (WordPress/Shopify/Drive/Notion/Dropbox/GitHub/file
upload), Integrations & OAuth, Employee configuration screen, Automation scheduling,
Permissions matrix editor, multi-language onboarding UI beyond existing locales.
