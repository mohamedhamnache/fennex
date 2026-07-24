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

Currently migrated:

- `zerda.pick_angle`
- `zerda.keyword_targets`

## Remaining phases

| Phase | Work | State |
|---|---|---|
| 1 | Install, BaseEmployee, registry, wrap one, validate | **done** |
| 2 | Zerda | **done** |
| 3–8 | Dune, Mirage, Sirocco, Sable, Oasis, Nomad | not started |
| 9 | Tool execution moved wholesale to the bridge | not started |
| 10 | Legacy orchestration retired | not started |
| 11 | MCP servers | not started |
| 12 | Remove deprecated code | not started |

## Known gaps

- **Streaming is written but unused.** `BaseEmployee.stream()` exists; the chat
  service still streams through the legacy `_speak`. Wiring it is part of
  phase 9.
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
