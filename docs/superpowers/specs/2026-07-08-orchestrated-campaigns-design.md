# Orchestrated Multi-Agent Campaigns — Design Spec

Date: 2026-07-08
Feature #2 from `docs/superpowers/plans/2026-07-05-fennex-coherence-and-differentiation.md`.

## Purpose

Turn the Fennex Pack from seven separate tools into one team you brief once. The user states a
goal; an LLM "campaign director" (Sirocco, the Creative Director) designs a plan that assigns work
to the Pack agents; the user reviews/edits the plan; then the orchestrator runs it in the
background, chaining each agent's output into the next, and assembles a coherent campaign package
(research + chosen angle + article + visual + distribution). This is the "team experience" gap in
the coherence roadmap.

## Decisions (locked during brainstorming)

- **LLM director over a fixed action catalog** — the director dynamically picks and orders agent
  actions, but only from a known catalog, so every step is executable.
- **Plan preview -> approve -> execute** — the director drafts the plan; nothing spends tokens or
  creates content until the user approves and hits Run. The plan is editable (remove/reorder steps)
  before running.
- **Sequential execution with context chaining** — steps run in the director's chosen order; each
  step receives the accumulated outputs of prior steps.
- **Background job (arq), single task** (Approach A) — one `run_campaign` worker walks the steps
  in-process; the UI polls, like article generation today.
- **v1 catalog = 6 actions** (Oasis, Zerda, Sable, Dune, Sirocco, Nomad).

## Data model

New models in `app/models/campaign.py` (`Base, TimestampMixin`); Alembic migration. Generic column
types (SQLite test compatibility).

### `campaigns`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID pk | |
| `org_id` | UUID fk organizations | cascade |
| `project_id` | UUID fk projects | cascade |
| `goal` | Text | the user's brief |
| `persona` | str(20) | creator/ecommerce/freelancer (from project) |
| `status` | str(20) | `planned` \| `running` \| `completed` \| `failed` \| `cancelled` (the draft is synchronous, so a campaign is created directly as `planned`) |
| `director_summary` | Text \| null | the director's rationale for the plan |
| `cancel_requested` | bool default false | checked between steps |
| `created_at, updated_at` | TimestampMixin | |

### `campaign_steps`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID pk | |
| `campaign_id` | UUID fk campaigns | cascade |
| `order` | int | execution order (0-based) |
| `agent` | str(20) | oasis \| zerda \| sable \| dune \| sirocco \| nomad |
| `action` | str(40) | catalog key (e.g. `zerda.pick_angle`) |
| `brief` | JSON | action params (topic, competitor_url, prompt hints, ...) |
| `why` | Text \| null | the director's one-line reason for this step |
| `status` | str(20) | `pending` \| `running` \| `completed` \| `failed` \| `skipped` |
| `summary` | Text \| null | human-readable result |
| `artifact_type` | str(20) \| null | article \| image \| social \| report \| analysis |
| `artifact_ids` | JSON \| null | ids of produced entities (article/image/social_post) |
| `structured` | JSON \| null | machine output passed to later steps (e.g. `{topic, keyword}`) |
| `error` | Text \| null | on failure |
| `started_at, finished_at` | str(50) \| null | ISO timestamps |

Index `campaign_steps(campaign_id, order)`.

## Action catalog

`app/services/campaign_catalog.py` — a registry `ACTIONS: dict[str, ActionDef]` where
`ActionDef = {agent, label, description, params_schema, executor}`. Every executor has the signature:

```python
async def executor(campaign, step, context: CampaignContext, db) -> StepResult
```

- `CampaignContext` = `{goal, persona, project_profile, prior: list[{agent, action, summary, structured}]}`.
- `StepResult` = `{summary: str, artifact_type: str | None, artifact_ids: list[str], structured: dict}`.
- Executors reuse existing services (thin adapters). A failing executor raises; the orchestrator
  records the failure and continues.

v1 actions:

| key | agent | executor reuses | output |
|---|---|---|---|
| `oasis.market_report` | Oasis | `oasis_service.generate_market_report` | summary = report markdown (context) |
| `zerda.pick_angle` | Zerda | `analytics_service.get_opportunities` + `get_market_insights` + `call_llm` | picks one focus; `structured = {topic, keyword, rationale}` — the campaign's spine |
| `sable.competitor_scan` | Sable | `competitor_service.analyze(url)` | summary = analysis; `brief.competitor_url` required, else the step is `skipped` |
| `dune.write_article` | Dune | create an `Article` (draft) then run the article-generation core | artifact `article`; topic/keyword from `brief` or the Zerda `structured` angle in context. NOTE: `generate_article_task` is an arq task taking `(ctx, article_id)`; the plan extracts a plain `async generate_article_content(article, brand_voice, profile, db)` core from it and calls that in-process (both the task and this executor use it) |
| `sirocco.generate_visual` | Sirocco | `image_service.generate_image_dalle` -> create `GeneratedImage` | artifact `image`; prompt from `brief` or derived from the angle/article title |
| `nomad.social_posts` | Nomad | `nomad_service.generate_outreach_plan` (saves LinkedIn drafts) | artifact `social`; brief goal derived from the angle |

Context chaining examples: `dune.write_article` reads the Zerda `structured.topic/keyword`;
`sirocco.generate_visual` derives its prompt from the article title / angle; `nomad.social_posts`
references the produced article.

## The director

`app/services/campaign_director.py`:
`async draft_plan(project_id, org_id, goal, persona, db) -> {steps: list[dict], summary: str}`.

- System prompt: `agent_persona("sirocco")` + a rendered catalog (each action key, description, params)
  + `project_profile(project_id, db)`; user prompt: the goal + persona.
- Uses `llm_service.call_llm` (org key). Expects JSON: `{summary, steps: [{agent, action, brief, why}]}`.
- **Sanitize:** drop steps whose `action` is not in the catalog; coerce/validate `brief` against the
  action's params schema (unknown keys dropped); cap at 8 steps; if 0 valid steps, use a fallback
  plan `[zerda.pick_angle, dune.write_article]`. On unparseable output, retry once, then fallback.
- The API layer persists the result as a `Campaign(status=planned)` + ordered `CampaignStep(pending)`.

## Orchestrator worker

`app/workers/tasks/campaign_tasks.py::run_campaign(ctx, campaign_id)` (arq):
1. Load campaign + steps (ordered); set `status=running`.
2. Build initial `context` (goal, persona, `project_profile`, empty `prior`).
3. For each step in order: if `campaign.cancel_requested` -> stop. Set step `running`; look up
   `ACTIONS[step.action].executor`; `await` it; on success record `summary/artifact_type/artifact_ids/
   structured`, `status=completed`, and append to `context.prior`; on exception set `status=failed`,
   `error` (truncated), and continue. Actions that self-detect missing input (Sable without a url)
   set `status=skipped`.
4. Final status: `completed` if any step completed, else `failed`.
Registered in `app/workers/worker.py` `functions` (no cron — enqueued on demand).

## API — `app/api/v1/routers/campaigns.py` at `/campaigns`

- `POST /campaigns?project_id=` `{goal}` -> runs `draft_plan` (in-request; one LLM call), persists
  `Campaign(planned)` + steps, returns the serialized campaign + steps.
- `GET /campaigns?project_id=` -> list (most recent first).
- `GET /campaigns/{id}` -> campaign + steps + resolved artifacts (poll target).
- `PATCH /campaigns/{id}/plan` `{step_ids: [ordered]}` -> reorder + drop steps (only while `planned`;
  ids not listed are deleted; order set by list position).
- `POST /campaigns/{id}/run` -> only from `planned`; enqueue `run_campaign`, set `running`.
- `POST /campaigns/{id}/cancel` -> set `cancel_requested`.
All `CurrentUser`/`DB`, org-scoped via `current_user.org_id`. Registered in `router.py` at `/campaigns`.

## Frontend

- `apps/web/lib/api.ts`: `Campaign`, `CampaignStep` types + `createCampaign(projectId, goal)`,
  `listCampaigns(projectId)`, `getCampaign(id)`, `updateCampaignPlan(id, stepIds)`, `runCampaign(id)`,
  `cancelCampaign(id)`.
- Page `apps/web/app/(dashboard)/[projectId]/campaigns/page.tsx`: list of campaigns + "New campaign".
- New-campaign flow (`CampaignComposer`): goal textarea -> `createCampaign` -> **editable plan**
  (step cards: agent icon + label, action, `why`, brief; remove + reorder) -> **Run**.
- Running/done (`CampaignRun`): poll `getCampaign`; a step **timeline** (pending/running/done/failed/
  skipped) with per-step summary; on completion a **package** section linking each artifact
  (report markdown viewer, article link, image thumbnails, social drafts link).
- Sidebar: add a `campaigns` entry to `NAV_ITEMS` + each persona's `PERSONA_PRIMARY`; `nav.campaigns` key.
- Full i18n (a `campaigns` block in `en/common.json`); NO EMOJI; Tailwind CSS variables only.

## Error handling

- No LLM key at draft -> 400. Director unparseable -> one retry -> fallback plan.
- Step failure -> recorded on the step, campaign continues; the package shows partial results and the
  failed step's error.
- `sable.competitor_scan` without `competitor_url` -> `skipped` with a note.
- Cancel -> orchestrator stops before the next step; already-completed artifacts remain.
- Article/image executors create their entity first, so a mid-generation failure leaves a visible
  failed artifact rather than an orphan.

## Testing

Backend (pytest, SQLite harness mirroring `tests/test_recommendations.py`; tables: organizations,
users, projects, articles, generated_images, social_posts, campaigns, campaign_steps):
- `draft_plan` (mock `call_llm`): valid JSON -> steps parsed in order; unknown action dropped;
  >8 capped; unparseable -> fallback plan.
- Each executor with its underlying service mocked: returns `StepResult` with the right
  `artifact_type` + a created artifact id; `sable` without url -> skipped signal.
- `run_campaign` (mock executors): status transitions, `context.prior` grows across steps, a failing
  step is recorded and the run continues, `cancel_requested` stops before the next step, final status.
- Endpoints: create (persists plan), list, get (with artifacts), plan-edit reorder/drop (planned only),
  run (enqueues; rejected unless planned), cancel; all org-scoped.

Frontend: `npm run typecheck`; visual check of composer -> plan edit -> run -> progress -> package.

## Phasing (one spec, phased plan)

- **Phase 1:** models + migration, `campaign_catalog` framework + `campaign_director` + `run_campaign`
  orchestrator + the two context executors (`zerda.pick_angle`, `oasis.market_report`) + API + a
  minimal composer/run UI. Ships a runnable campaign producing research + a chosen angle.
- **Phase 2:** the artifact executors (`dune.write_article`, `sirocco.generate_visual`,
  `nomad.social_posts`, `sable.competitor_scan`) + the package view + sidebar/i18n polish.

## Reused infrastructure

- `oasis_service`, `analytics_service` (`get_opportunities`/`get_market_insights`), `competitor_service`,
  article-generation core (`article_tasks`), `image_service.generate_image_dalle`, `nomad_service`.
- `llm_service.call_llm`, `get_org_llm_keys`, `agent_persona`, `project_profile`.
- arq worker (`app/workers/worker.py`); `CurrentUser`/`DB`; TanStack Query; sidebar `NAV_ITEMS`/
  `personaNav`; i18n.
