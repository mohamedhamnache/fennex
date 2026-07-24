# Fennex AI Employee Framework

Fennex is not a chatbot. It is a company of AI employees. The user talks to one
interface; the Orchestrator assembles the right specialists behind it.

## Architecture

```
                        Fennex AI
                            |
        +-------------------+-------------------+
        |                   |                   |
   Orchestrator      Employee Registry     Shared Memory
   (the CEO)         (source of truth)     (institutional knowledge)
        |                   |                   |
        |            roster/*.py           employee_memories
        |         (auto-discovered)        + pluggable vector backend
        |                   |
        +---------> Employees <-------- Brand DNA (injected, never asked for)
                        |
                   Tool Layer  (permission-gated)
                        |
   WordPress | Shopify | WooCommerce | Meta | Pinterest | LinkedIn | Email | GSC
```

### Module map (`apps/api/app/employees/`)

| Module | Responsibility |
|---|---|
| `capabilities.py` | The taxonomy of work that exists. 68 canonical slugs across 8 domains. |
| `spec.py` | The `Employee` contract + `Action` + lifecycle. |
| `registry.py` | Who is employed. Auto-discovery, versioning, capability index. |
| `roster/` | The employees themselves — one file each. |
| `brand_dna.py` | Company identity, assembled once, injected everywhere. |
| `memory.py` | Institutional knowledge, scoped. |
| `toolbelt.py` | The software employees operate, permission-gated. |
| `context.py` | The workspace handed to an employee (`WorkContext`, `Task`). |
| `orchestrator.py` | The CEO: intent → plan → team → execute → log. |

## The employee contract

```
Employee
  |- Prompt          system_prompt + personality + goals
  |- Knowledge       knowledge_sources
  |- Connected Apps  connected_apps
  |- Memory          memory_scope
  |- Tools           allowed_tools (gated by permissions)
  `- Actions         actions -- the assignable units of work
```

Plus a uniform lifecycle, so the Orchestrator can drive an employee that does
not exist yet:

- `planner()` — choose the action that answers this task
- `execute()` — do the work
- `evaluate()` — grade it before it leaves the department
- `learn()` — write what was learned into shared memory
- `health_check()` — can this employee work right now?

Every hook has a real default implementation. A new employee that declares only
data (identity, capabilities, actions) is fully operational.

## Never hardcoded

`registry.py` imports every module under `roster/` and registers whatever
exposes `EMPLOYEE` (or `EMPLOYEES`). **Adding a file hires an employee; deleting
one fires them. Nothing else in the codebase changes.** A broken employee module
is logged and skipped — one bad hire never takes the company down.

Runtime installation (`registry.register`), removal (`unregister`), status
changes (`set_status`) and multiple concurrent versions are supported;
`get(id)` resolves the highest live version.

## Selection is by capability, never by name

The Orchestrator never mentions an employee. It resolves
`capability -> (employee, action)` through the registry index, ranked by:

1. an employee with an action actually *bound* to the capability beats one that
   merely declares it,
2. active beats beta,
3. the narrower specialist beats the generalist.

This is what lets the roster reach hundreds without touching orchestration.
`find_for_goals()` does greedy set-cover to assemble the smallest viable team.

## Execution

1. **Understand** — the goal becomes a list of required capabilities (LLM, with
   a deterministic per-persona fallback when no key is configured).
2. **Plan** — capabilities become a DAG of tasks. Research and intelligence
   establish ground truth and are unchained so they start concurrently.
3. **Assemble** — the team falls out of capability resolution.
4. **Inject** — Brand DNA and recalled memory are prepended to every prompt by
   `WorkContext.system_preamble()`, identically for every employee.
5. **Authorize** — an action runs only if the employee holds the permission, the
   org granted it, and any required human approval is present.
6. **Execute** — layer by layer, parallel within a layer, bounded by a
   semaphore. Parallel tasks each get their own `AsyncSession`.
7. **Evaluate and retry** — failed review feeds the reviewer's feedback back to
   the employee, up to `MAX_RETRIES`.
8. **Learn and log** — outcomes go to memory; every step is in the execution log.

## Brand DNA

Assembled from the existing `BrandVoice` / `BrandKit` / `Project` records, so
there is no new data entry. Rendered two ways from one source: voice rails for
writers, palette and negative prompts for image employees — the brand cannot
drift between departments. The injected block opens with:

> BRAND DNA — this is settled context. Never ask the user for it.

## Memory

Scope is a property of the memory, set when written, and decides who may read
it: `self` (author only), `department`, `project`, `org` (everyone).

An employee's own `memory_scope` says what it *writes* at; it never restricts
what it may *read*. Oasis writes research at org scope (company-wide truth)
while still reading project knowledge; nobody reads Dune's private notes.

Re-writing the same `key` reinforces the existing row rather than duplicating
it, and recalled memories gain a hit count — knowledge that keeps proving useful
outranks stale knowledge.

Retrieval is pluggable via `set_backend()`. The default `KeywordBackend` ranks
on keyword overlap, weight and recency with no extra infrastructure; a vector
backend drops into the same interface using the `embedding` column.

## Interoperability

The framework wraps the existing `services/agents` engine rather than replacing
it. `WorkContext` deliberately exposes the same attribute surface as the legacy
`Brief` (`goal`, `locale`, `brand`, `project_profile`, `artifacts`, …), so every
existing skill and data tool runs against it unmodified. `Action.skill_key`
binds an action to a skill in the existing catalog.

## API

`/api/v1/employees` — registry, `/capabilities`, `/tools`, `/health`,
`/{id}`, `POST /plan` (preview team + DAG without spending), `POST /delegate`
(run), and `/memory` read/write/forget.

The frontend client is `apps/web/lib/employees.ts`. It types and fetches the
registry; it hardcodes no employee.

## Current state

7 employees, 7 departments, 13 actions, 64 capabilities covered.

| Employee | Department | Role |
|---|---|---|
| Zerda | Strategy | SEO & Market Strategist |
| Dune | Content | Content Writer |
| Sirocco | Marketing | Creative Director |
| Mirage | Creative Studio | Image Artisan |
| Sable | Intelligence | Competitor Scout |
| Oasis | Research | Market Researcher |
| Nomad | Growth | Outreach Agent |

## Known gaps

These are deliberately visible rather than papered over.

- **Declared-but-unbacked capabilities.** Employees declare the full
  responsibility list from the product spec, but only 13 actions are bound so
  far — e.g. Mirage declares `image.upscale` with no action behind it.
  `health_check()` reports these per employee (`unbacked_capabilities`), and
  `resolve_action()` will not route work to an unbacked capability. This is the
  build backlog.
- **No operations employee.** `publish.*` and `analytics.measure` capabilities
  exist in the taxonomy and the publish tools are wired, but no employee claims
  them, so a plan needing them logs `plan.unstaffed` and skips the step. Atlas
  (Analytics) is the natural next hire.
- **Legacy roster mirror.** `apps/web/lib/agents.ts` still hardcodes the seven
  agents for existing dashboard pages. `lib/employees.ts` is the registry-backed
  replacement; migrating those pages is follow-up work.
- **Social publish** routes through a calendar entry, so it needs an
  `entry_id` — it is not yet callable straight from an orchestrated run.
