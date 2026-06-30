# Fennex — Codebase Guide

## What this is

Fennex is an AI-powered SEO and content platform. It helps users generate articles, images, social posts, and backlinks, and integrates with WordPress/Shopify for publishing.

## Monorepo layout

```
apps/
  web/        Next.js 14 frontend (App Router, TypeScript)
  api/        FastAPI backend (Python 3.11+, async, SQLAlchemy 2)
  crawler/    Standalone crawler microservice
packages/
  ui/         Shared React component library
  types/      Shared TypeScript types
  config/     Shared TS/ESLint config
services/     (additional microservices, e.g. image-gen planned for Phase 2)
docs/
  superpowers/specs/    Design specs
  superpowers/plans/    Implementation plans
```

## Running locally

```bash
# Start Postgres + Redis, then all apps via Turborepo
make dev

# Or Docker-only (everything containerized)
docker compose up --build
```

- Frontend: http://localhost:3000
- API: http://localhost:8000
- Crawler: http://localhost:8001

## Frontend (`apps/web`)

- **Framework:** Next.js 14 App Router, React 18, TypeScript 5
- **Styling:** Tailwind CSS v3 — use CSS variables (`hsl(var(--primary))`, `bg-card`, etc.), never hard-code colors
- **State:** TanStack Query v5 for server state, Zustand for UI state (`lib/store.ts`)
- **API calls:** Always use `apiClient` from `lib/api.ts` — never call `fetch` directly
- **i18n:** react-i18next; all user-visible strings go through `t("key")`, translations in `public/locales/`
- **Utilities:** `cn()` from `lib/cn.ts` for conditional class names
- **Animations:** `animate-scale-in` for popovers/dropdowns, `animate-fade-in` for page entry
- **Popover styling:** Use `.popover` CSS class for dropdown menus (defined in `app/globals.css`)
- **No test framework** — verify with `npm run typecheck` and visual browser testing

Key commands from `apps/web/`:
```bash
npm run dev        # dev server (turbo)
npm run typecheck  # TypeScript check (use this to verify every change)
npm run lint       # ESLint
npm run build      # production build
```

## Backend (`apps/api`)

- **Framework:** FastAPI, Python 3.11+, async/await throughout
- **ORM:** SQLAlchemy 2 async with asyncpg
- **Migrations:** Alembic (`make db-migrate`)
- **Task queue:** arq (Redis-backed) — background jobs in `app/workers/`
- **AI:** Anthropic Claude (`anthropic` SDK) + OpenAI (`openai` SDK) — both available
- **Auth:** JWT (python-jose), refresh tokens stored in DB
- **Billing:** Stripe

API routes: `apps/api/app/api/v1/`
Models: `apps/api/app/models/`
Services (business logic): `apps/api/app/services/`

Key commands (run from project root):
```bash
make db-migrate    # apply migrations inside the api container
make db-reset      # reset and re-migrate
docker compose logs -f api   # tail API logs
```

## In-progress work

- **Image Studio Phase 1** — split-panel creative studio with prompt assistant, 9-style grid, batch generation, image-to-image. Plan: `docs/superpowers/plans/2026-06-30-image-studio-enhancement.md`. Ready to implement.
- **Language picker UX** — flag emoji display issue to fix + UX improvement pending.

## Key conventions

- Frontend components in `components/<domain>/` — e.g. `components/studio/`, `components/layout/`, `components/ui/`
- New API endpoints follow `apiClient.post<ReturnType>("/path", body)` pattern in `lib/api.ts`
- Backend: new endpoints go in `apps/api/app/api/v1/`, business logic in `apps/api/app/services/`
- Migrations: create with `alembic revision --autogenerate -m "description"` inside the api container
- Commit style: `feat(scope): description` / `fix(scope):` / `chore:` / `docs:`
