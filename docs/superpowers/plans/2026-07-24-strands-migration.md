# Strands migration

Migrating the Fennex AI runtime to the AWS Strands Agents SDK, without moving
the architecture.

## The rule this migration is built on

> Strands is the runtime. It is never the centre.

```
Fennex
  |- Router               custom, never imports strands
  |- Employee Registry    custom
  |- Brand DNA / Memory   custom
  |- Employees            declarative contracts
  `- runtime/             the ONLY strands-aware package
```

`app/employees/runtime/` is the sole place that imports `strands`. A test
(`test_only_the_runtime_package_imports_strands`) walks every file under
`app/employees/` and fails if the import leaks. If Strands is ever replaced,
one package changes.

## Why this is worth doing

The legacy execution path is single-shot:

```
run_tools(skill.tools)   # fixed list, declared in code -- the model never chooses
→ call_llm(system, user) # one call, no tool schemas sent to the API
→ parse → persist
```

The model could not decide it needed data and go and get it. Under Strands it
can. Zerda, on the pilot run, autonomously called three tools
(`gsc_opportunities`, `our_demand`, `market_insights`), read what came back and
grounded its angle in it — 6.4s, 4,821 tokens, 0 retries.

## What Phase 1 delivered

| Piece | File | What it does |
|---|---|---|
| Model provider | `runtime/models.py` | tier + weight → a concrete model. Employees stay provider-blind. Anthropic, OpenAI, Bedrock; adding Gemini is one function. |
| Tool bridge | `runtime/toolbridge.py` | Fennex toolbelt → Strands tools, gated by `allowed_tools` **and** permissions |
| Telemetry | `runtime/telemetry.py` | provider, model, latency, tokens, tool calls, failures, retries |
| BaseEmployee | `runtime/base.py` | wraps a Strands Agent: instructions, Brand DNA, memory, retry-with-reflection, persist |

### `allowed_tools` became real

It used to be advertising. The legacy runner ran `skill.tools` and never
consulted the employee's declaration, so an employee could declare no tools and
its skill would still call them. Under the agentic runtime the declaration is
the ceiling: a tool the employee did not declare is never handed to the model,
and one whose permission was not granted is withheld before construction.

### A concurrency bug found in the pilot

The first Zerda run logged:

```
InvalidRequestError: This session is provisioning a new connection;
concurrent operations are not permitted
```

Strands calls tools **concurrently**; the bridge was handing them all one
`AsyncSession`. It succeeded by luck. Each tool call now opens its own session,
with a lock-guarded fallback. Same class of bug as the orchestrator's parallel
layers — worth remembering that anything the model can run in parallel needs
its own session.

## Migration is per action, not per employee

`Action.agentic = True` opts one action onto the runtime. Everything else runs
the proven legacy path untouched, so a regression is contained to one action.

All seven employees, all 14 actions, run on the runtime:

| Employee | Actions | Tools it can now reach for itself |
|---|---|---|
| Zerda | `pick_angle`, `keyword_targets` | GSC opportunities, market insights, tracked keywords, our demand |
| Sable | `competitor_scan` | crawl competitor, our demand, market insights |
| Oasis | `market_report`, `define_icp` | market data, insights, GSC, products |
| Dune | `write_article`, `regenerate_article`, `product_copy` | article context, SEO grounding, store products |

| Mirage | `product_shot`, `editorial_image` | store products |
| Sirocco | `multi_network_social`, `generate_visual` | none yet -- MCP route to LinkedIn |
| Nomad | `outreach_plan`, `testimonial_content` | none yet -- MCP route to LinkedIn, Email |

An earlier revision of this plan held Sirocco, Nomad and Mirage back on the
argument that an agentic loop with no tools is cost without benefit. That was a
cost/benefit judgement standing in for a stated requirement, and it was wrong.
An agent with no tools simply generates -- exactly what those employees did
before -- and unification has value the argument ignored: one execution path,
telemetry everywhere, MCP-ready the moment endpoints land, and, decisively, the
legacy path can never be retired while anyone still lives on it.

The real concern was narrower and testable: those actions persist artifacts.
Each was verified end to end.

### Two things the migration itself taught

**Inherit the skill's prompts, do not replace them.** The first cut wrote a
generic instruction block and dropped the skill's system prompt. `pick_angle`
promptly returned French prose where the caller expected JSON, because the
output contract lives in that prompt. `BaseEmployee` now inherits both the
system and user prompts from the bound skill and layers tool discipline on top.

**Append settled context, do not let the skill's prompt replace it.** A skill
builds its prompt from the goal and may ignore `inputs` entirely, which
silently dropped the title and keyword the conversation had already agreed.
The settled block is now appended to whatever the skill produced.

## Remaining phases

| Phase | Work | State |
|---|---|---|
| 1 | Install, BaseEmployee, registry, wrap one, validate | **done** |
| 2 | Zerda | **done** |
| 3–8 | Dune, Mirage, Sirocco, Sable, Oasis, Nomad | **done** |
| 9 | Chat streams from the runtime; tool use is visible | **done** |
| 10 | Legacy orchestration retired | unblocked -- nobody left on it |
| 11 | MCP servers | **done** (no endpoints configured yet) |
| 12 | Remove deprecated code | unblocked -- see note below |

## MCP

An employee declares an MCP server in `connected_apps` exactly as it declares a
native tool, and the runtime attaches whatever that server exposes. Servers are
configured per deployment via `MCP_<APP>_URL`; declaring one costs nothing until
an endpoint exists.

The same two gates apply as for native tools: the employee must have declared
the app, and the run must hold the permission. A server that will not start is
skipped with a warning -- a broken integration must never cost the user their
answer.

This is what unblocks the toolless employees. Nomad routes to LinkedIn and
Email, Sirocco to LinkedIn; once those endpoints are configured, both become
worth migrating.

Nothing leaks upward: the registry and router know an employee "uses linkedin",
not that LinkedIn happens to arrive over MCP.

### Repeated tool calls

A reasoning model will ask the same read-only tool over and over -- one
observed turn called `gsc_opportunities` eleven times. Results are now cached
per run and per argument, which took that turn from 14 calls to 4. Writes are
never cached.

## Known gaps

- **Streaming now comes from the runtime for migrated actions.** A migrated
  employee streams through `BaseEmployee.stream()`, so the user sees "Zerda is
  checking Market Insights" while it works. Unmigrated actions still stream
  through the legacy path, and both share the same persistence and memory
  write afterwards.
- **`current_tool_use` repeats on every chunk.** It is present on each chunk
  of a tool call rather than once per call -- the first wiring emitted 48
  frames for 3 actual lookups. The stream now emits only on change. Worth
  remembering when reading any other field off a streamed event.
- **The SDK's result and event shapes are not a stable contract.** `_text_of`,
  `_delta_of` and `_tool_of` read defensively and degrade to empty rather than
  raising mid-turn. These are the most likely thing to break on an SDK upgrade
  and the first place to look.
- **`knowledge_sources` is still declarative.** Nothing reads it. Real
  retrieval is a separate piece of work, not part of this migration.
- **Only OpenAI is configured in this environment**, so the Anthropic and
  Bedrock paths are constructed and unit-tested but have not run a live turn.
- **Per-action persist reuses the skill catalog.** Agentic output is parsed by
  the skill's own parser before its `persist` hook runs. For actions whose
  skills expect strict JSON this may need a structured-output model instead —
  worth checking per action during phases 3–8.
