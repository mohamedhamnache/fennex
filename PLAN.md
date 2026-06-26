# Fennex — Autonomous AI SEO & Content Growth Platform

## Context

Build a full-featured premium SaaS platform from a greenfield repo (currently only a README). Fennex is an autonomous AI-powered growth platform: SEO research, content generation, brand voice learning, social media automation, image generation, publishing, backlink exchange, and analytics — all driven by multi-LLM orchestration with user-supplied API keys.

**Confirmed decisions**: Full platform scope, Python backend (FastAPI), Turborepo monorepo (Next.js + Python), PostgreSQL + Redis + pgvector, ARQ workers.

---

## Monorepo Structure

```
fennex/
├── turbo.json / package.json / pnpm-workspace.yaml
├── docker-compose.yml
├── Makefile
│
├── apps/
│   ├── web/                    # Next.js 14 (App Router) + TypeScript + TailwindCSS
│   └── api/                    # FastAPI Python backend
│       └── app/
│           ├── main.py
│           ├── core/           # settings, permissions, security
│           ├── api/v1/routers/ # one file per feature area
│           ├── models/         # SQLAlchemy ORM models
│           ├── schemas/        # Pydantic request/response schemas
│           ├── services/       # business logic layer
│           ├── workers/        # ARQ task definitions
│           ├── agents/         # LLM agent workflows + LLM router
│           └── integrations/   # publishing connectors, SEO APIs
│
├── packages/
│   ├── ui/                     # shared React components + design tokens
│   ├── types/                  # shared TypeScript types (from OpenAPI)
│   └── config/                 # shared ESLint/Prettier/TS configs
│
├── services/
│   ├── crawler/                # Playwright web crawler (isolated container)
│   └── image-gen/              # image generation + brand overlay
│
└── infra/
    ├── postgres/init.sql
    └── nginx/
```

**Python shared code**: `packages/py-common/` installed as editable package — shared Pydantic base models, logging config, settings across `apps/api` and `services/`.

---

## Data Models (PostgreSQL + Alembic)

### Core SaaS Layer
- `organizations` — multi-tenancy anchor; plan tier, Stripe IDs
- `users` — org membership, role enum (owner/admin/seo_manager/content_writer/editor/designer/marketing_manager/viewer)
- `api_keys` — per-org LLM provider keys (AES-256 encrypted at rest)
- `projects` — websites; domain, locale, target country, brand_voice_id

### Feature Tables
| Feature | Key Tables |
|---------|-----------|
| Business Analysis | `crawl_jobs`, `crawled_pages`, `seo_audits`, `competitors` |
| SEO Research | `keyword_research_jobs`, `keywords`, `keyword_clusters`, `serp_snapshots` |
| Content Planner | `content_plans`, `content_items` (type, status, scheduled_date) |
| Articles | `articles` (body_html/markdown, seo_score, schema_markup), `article_revisions` |
| Brand Voice | `brand_voices`, `brand_voice_training_sources` |
| Social | `social_posts` (platform enum, post_type, engagement_stats) |
| Images | `generated_images`, `brand_assets` |
| Publishing | `publishing_connections` (encrypted credentials), `publish_jobs` |
| Backlinks | `backlink_profiles`, `backlink_opportunities` |
| Analytics | `analytics_snapshots`, `keyword_rankings`, `alerts` |
| RAG / Embeddings | `document_chunks` with `VECTOR(1536)` (pgvector ivfflat index) |
| Collaboration | `comments` (threaded), `approval_workflows`, `notifications` |
| Cost Tracking | `llm_usage_logs` — every LLM call logged with tokens + cost |

---

## API Architecture (FastAPI)

### Router structure (`apps/api/app/api/v1/routers/`)
`auth`, `organizations`, `users`, `api_keys`, `projects`, `crawl`, `audit`, `competitors`, `keywords`, `content_plans`, `content_items`, `articles`, `brand_voice`, `social`, `images`, `brand_assets`, `publishing`, `backlinks`, `analytics`, `webhooks`

### Key patterns
- **Async job pattern**: heavy operations (crawl, generate, analyze) return `202 { job_id }` immediately; client polls `GET /jobs/{id}` or subscribes to WebSocket
- **SSE streaming**: article generation streams tokens via `text/event-stream`
- **RBAC dependency**: `require_permission(role, action, resource)` FastAPI dependency on every router
- **Multi-tenant isolation**: base query class injects `org_id` filter from JWT claim automatically

---

## AI Orchestration (`apps/api/app/agents/`)

### LLM Router (`llm_router.py`)
Maps task types to optimal provider + model, with fallback chain based on which org API keys are available:
- Long-form articles → Anthropic Claude (claude-3-5-sonnet)
- Keyword research, social short-form → OpenAI GPT-4o / GPT-4o-mini
- Brand voice cloning, SEO reasoning → Anthropic Claude
- Competitor analysis (large context) → Google Gemini 1.5 Pro
- Image prompts → GPT-4o-mini (cost-efficient)

### Agent Workflows
Each feature is a state-machine agent with clear node/edge transitions:

**Article Agent** (`article_agent.py`): `brief_generator → outline_builder → section_writer (parallel fan-out) → [meta_generator, faq_generator, cta_generator] (parallel) → schema_builder → seo_scorer → assembler`

**SEO Research Agent**: `seed_expander → volume_fetcher (DataForSEO) → intent_classifier → cluster_builder (embeddings + LLM) → prioritizer → serp_analyzer`

**Brand Voice Agent**: `content_extractor → style_analyzer → voice_profiler → prompt_builder → sample_generator`

### RAG Pipeline
- Chunking: `RecursiveCharacterTextSplitter` (512 tokens, 50 overlap)
- Embedding: text-embedding-3-small (or Gemini embedding-001)
- Storage: pgvector in PostgreSQL (avoids separate vector DB)
- Retrieval: cosine similarity top-k=5 → optional reranker → context assembly

---

## Frontend Architecture (Next.js 14 App Router)

### Route Structure
```
app/
├── (auth)/login, register
└── (dashboard)/layout.tsx          ← sidebar shell, project context
    └── [projectId]/
        ├── overview/               ← health scores
        ├── audit/                  ← SEO audit report
        ├── keywords/               ← keyword table + cluster tree
        ├── content/                ← content calendar + kanban
        ├── articles/               ← list + TipTap editor + SEO sidebar
        ├── social/                 ← composer + social calendar
        ├── images/                 ← generation studio
        ├── publishing/             ← connections + jobs
        ├── backlinks/
        └── analytics/
```

### Key components (`packages/ui/src/`)
- `ScoreCard` — animated radial gauge for business/SEO/authority scores
- `AIJobStatus` — job polling with progress indicators
- `GenerationProgress` — streaming token display
- `RichTextEditor` — TipTap with `SEOHighlight`, `InternalLinkSuggestion`, `AIRewriteBlock` extensions
- `SEOSidebar` — live SEO score while editing (debounced, client-side)
- `ContentCalendar` — FullCalendar-based planning view
- `FennecMascot` — animated SVG for empty states + loading

### State Management
- **TanStack Query v5** — all server state; `refetchInterval` for job polling
- **Socket.IO** — real-time article generation streaming
- **Zustand** — sidebar collapse, theme, active project
- **React Hook Form + Zod** — all forms; Zod schemas auto-generated from OpenAPI via `openapi-zod-client`
- **next-themes** — dark/light mode; CSS custom properties for design tokens

---

## Background Workers (ARQ over Redis)

**Why ARQ over Celery**: native asyncio, matches FastAPI's async nature, simpler config.

```
workers/tasks/
├── crawl_tasks.py      # crawl_website, analyze_page_seo
├── audit_tasks.py      # run_seo_audit, score_audit
├── keyword_tasks.py    # run_keyword_research, cluster_keywords, fetch_serp
├── article_tasks.py    # generate_article, regenerate_section
├── voice_tasks.py      # train_brand_voice
├── social_tasks.py     # generate_social_batch, schedule_publish
├── image_tasks.py      # generate_image, resize_for_platform
├── publish_tasks.py    # publish_to_wordpress, publish_to_shopify, etc.
├── analytics_tasks.py  # sync_gsc_data, rank_check
└── backlink_tasks.py   # discover_opportunities, score_domains
```

**Scheduled tasks**: daily GSC/rankings sync (06:00 UTC), weekly backlink discovery, every 15min scheduled publish check.

---

## Integration Points

### Crawler Service (`services/crawler/`)
Isolated Playwright container (keeps 300MB+ browser binaries out of main API image). Exposes internal HTTP API; `crawl_tasks.py` calls it. Returns SEO signals (title, meta, h1, links, schema, Core Web Vitals) as NDJSON stream.

### SEO Data APIs (`app/integrations/seo_apis/`)
**DataForSEO** as primary: keyword volumes, SERP data, backlink profiles. All providers implement a common `SEODataProvider` Protocol. Optional Ahrefs for premium accounts. Google Search Console (OAuth2 per project) for real traffic data.

### Publishing Connectors (`app/integrations/publishing/`)
`wordpress.py`, `shopify.py`, `ghost.py`, `notion.py`, `custom_api.py` — all extend abstract `PublishingConnector` base. Each implements `publish(article)`, `test_connection()`, and format conversion to platform-specific schema.

### Social Connectors (`app/integrations/social/`)
LinkedIn API v2, Twitter API v2, Instagram Graph API, Facebook Graph API. Buffer API as scheduling fallback.

### Image Generation (`services/image-gen/`)
Isolated service with DALL-E 3 (primary), Stability AI, Replicate. Post-processor (Pillow) overlays brand logo and color frame. Uploads to S3/Cloudflare R2; returns URLs.

---

## Implementation Order (16 phases)

| Phase | Focus | Goal |
|-------|-------|------|
| 0 | Infrastructure | Turborepo + Docker Compose + FastAPI skeleton + Next.js + CI |
| 1 | Auth + RBAC | Login/register, org management, LLM key management, team invites |
| 2 | Crawl + Audit | Crawler service, SEO audit engine, score gauges in UI |
| 3 | Keyword Research | DataForSEO + embeddings + clustering + intent classification |
| 4 | Content Planner | Content calendar, kanban board, AI-generated plan |
| 5 | Brand Voice | Training pipeline, voice CRUD, style extraction |
| 6 | Article Generation | Full agent pipeline, SSE streaming, TipTap editor, approvals |
| 7 | Publishing | WordPress connector (first), then Ghost/Notion/Shopify |
| 8 | Social Studio | LinkedIn + Twitter (first), social calendar, composer |
| 9 | Image Generation | DALL-E 3, brand overlay, article cover integration |
| 10 | Analytics | GSC OAuth, daily sync, ranking table, traffic charts |
| 11 | Backlinks | Domain scoring, opportunity discovery, spam filter |
| 12 | Billing + Polish | Stripe, plan enforcement, mascot animations, onboarding, E2E tests |

---

## Architecture Decisions

- **pgvector over Pinecone**: keeps stack unified (one DB for relational + vector); handles millions of vectors with ivfflat index; can migrate later
- **Separate crawler service**: isolates Playwright binaries; scales independently during bulk audits
- **TipTap over Slate/Quill**: ProseMirror-based, TypeScript-first, rich extension ecosystem, Yjs-ready for future real-time collaboration
- **DataForSEO**: most comprehensive single API (keywords + SERP + backlinks); pay-per-request fits SaaS usage patterns
- **User-supplied LLM keys**: Fennex doesn't absorb LLM costs; enables multi-provider routing for quality/cost optimization per task type

---

## Verification

End-to-end test path after Phase 6:
1. Register → create org → connect OpenAI + Anthropic keys
2. Create project → trigger crawl → verify audit scores appear
3. Run keyword research on a seed keyword → verify clusters + intent labels
4. Generate article for top keyword → verify SSE streaming + article saved in editor
5. Open TipTap editor → verify SEO sidebar shows live score
6. Approve article → verify approval workflow status update

After Phase 7: publish article to a WordPress test site → verify live URL returned.
After Phase 12: create Stripe test subscription → downgrade → verify plan limits enforced on AI generation call.
