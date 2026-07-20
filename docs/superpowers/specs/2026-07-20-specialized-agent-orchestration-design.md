# Specialized Agent Orchestration — Design

**Date:** 2026-07-20
**Status:** Approved design, ready for implementation planning

## Problem

Fennex's "virtual agency" agents (Zerda, Sirocco, Dune, Mirage, Oasis, Sable, Nomad)
feel generic and incoherent. Root causes, confirmed in code:

1. **Deterministic shortcuts bypass the LLM's judgment.** e.g. campaign angle
   selection deterministically grabbed the top Search Console query with no goal
   grounding and no memory of what was already written, so every campaign produced
   an article on the same topic.
2. **Thin handoffs.** `CampaignContext` carried only `goal / persona / project_profile /
   prior[]`; each step saw little of the accumulated work, goal, or brand — so agents
   restart rather than build on each other.
3. **Uneven prompts.** The article writer's prompt is genuinely strong (E-E-A-T,
   semantic SEO, anti-cliché); several other executors used one-line prompts
   (`"Marketing visual for: <topic>"`), which yields generic output.

The article *quality* prompt proves the LLM can produce excellent work — the problem
is **what we hand it** and **how the steps are orchestrated**, not the model.

## Goal

A single reusable **agent core** that makes every agent genuinely specialized, grounds
every prompt in real data, lets agents build on each other, and orchestrates them with a
plan → per-step review → retry loop. All agent surfaces adopt it (phased).

## Decisions (from brainstorming)

- **Scope:** all agent surfaces, via one shared agent core (implementation phased).
- **Orchestration:** director plans, then reviews each artifact against the brief and
  sends the agent back with feedback if weak (bounded retries), then continues.
- **Context:** a shared `Brief` assembled once (common grounding) + per-agent **tools**
  for specialist data on demand.
- **Models:** user-configurable tier (`economy | balanced | max`); the core respects it.
- **Structure:** declarative **Skill** specs + one generic **AgentRunner** (not
  class-based agents, not a scattered prompt library).

## Architecture

New package **`app/services/agents/`**:

```
agents/
  brief.py      Brief dataclass + build_brief(project_id, org_id, goal, persona, db)
  spec.py       Skill dataclass + AgentResult dataclass
  tools.py      tool registry: name -> async (brief, db, **args) -> {ok, data}
  runner.py     AgentRunner.run(skill, brief, inputs, tier) -> AgentResult
  tiers.py      resolve_model(tier, weight, available_providers) -> (provider, model)
  director.py   plan -> execute+review loop -> summary
  skills/       one Skill spec per capability (zerda_pick_angle.py, dune_write_article.py, ...)
  registry.py   SKILLS: dict[str, Skill]  (supersedes campaign_catalog.ACTIONS)
```

The existing `Campaign` / `CampaignStep` DB models and the `/campaigns` UI are
**unchanged**; only the director + executor internals are swapped onto this core.

### Core types

**`Brief`** — assembled once per run, the shared ground truth every skill reads:

```python
@dataclass
class Brief:
    goal: str
    persona: str
    project_id: uuid.UUID
    org_id: uuid.UUID
    locale: str
    project_profile: str                 # existing project_profile()
    brand: dict                          # {voice_prompt, tone, vocabulary[], avoid_words[], kit}
    existing_content: list[str]          # recent article titles — for dedup / "don't repeat"
    artifacts: list[dict]                # grows as skills finish — the handoff chain
```

`build_brief(...)` fetches profile, BrandVoice, BrandKit, and the ~20 most recent
article titles once. `artifacts` starts empty and grows during a run.

**`Skill`** — one declarative spec per capability (agent + capability). This is where
"specialized" lives:

```python
@dataclass
class Skill:
    key: str                             # "zerda.pick_angle"
    agent_id: str                        # "zerda" — pulls persona from app.agents.registry
    weight: str                          # "light" | "heavy"  -> model tier
    tools: list[str]                     # names into the tool registry
    build_prompt: Callable[[Brief, dict, dict], tuple[str, str]]   # (brief, inputs, tool_data) -> (system, user)
    output: str                          # "json" | "markdown" | "text"
    parse: Callable[[str], Any] | None = None    # optional, for json/markdown
    label: str = ""                      # human label (UI)
    description: str = ""                 # for the director's planning
    persist: Callable | None = None      # optional: save artifact (Article, GeneratedImage, SocialPost...) -> AgentResult
```

Each `build_prompt` is a real, first-class prompt: agent persona (from the registry) +
the relevant Brief fields + tool data + the specific task and its rubric. No one-liners.

**`AgentResult`**:

```python
@dataclass
class AgentResult:
    ok: bool
    summary: str                         # compact handoff line, e.g. "Article: <title> targeting <kw>"
    content: Any = None                  # parsed output (dict / markdown / text)
    artifact_type: str | None = None     # "article" | "image" | "social" | "report" | "research" | "analysis"
    artifact_ids: list[str] = field(default_factory=list)
    structured: dict = field(default_factory=dict)
    error: str | None = None
```

### Tools

A name → async function registry. Each tool: `(brief, db, **args) -> {ok, data}`.

| Tool | Returns |
|---|---|
| `gsc_opportunities` | striking-distance + CTR-win queries |
| `market_insights` | topic clusters + content ideas |
| `market_data` | overview + clusters + opportunities + health (for the report) |
| `tracked_keywords` | SEO-hub tracked keywords + positions |
| `crawl_competitor(url)` | scorecard + outline + insights (competitor_service) |
| `our_demand` | the project's own demand, for gap comparison |
| `store_products` / `store_product(id)` | synced StoreProduct catalog / one product |

Common grounding (goal, brand, profile, existing content, prior artifacts) is in the
Brief; tools add *specialist* data only. Tools tolerate missing data (`ok=False` →
skill degrades gracefully).

### AgentRunner

`AgentRunner.run(skill, brief, inputs, tier) -> AgentResult`:

1. `provider, model = resolve_model(tier, skill.weight, available_providers)`.
2. Run `skill.tools` → `tool_data` (a dict keyed by tool name); a failed tool contributes
   `{ok: False}` and is tolerated.
3. `system, user = skill.build_prompt(brief, inputs, tool_data)`.
4. `raw = call_llm(provider, model, key, system, user, locale=brief.locale, max_tokens=...)`.
5. Parse/validate per `skill.output` (`skill.parse`); on malformed output, **one repair
   retry** (re-ask with a "return valid <format>" nudge), then a safe fallback.
6. If `skill.persist`, save the artifact (Article / GeneratedImage / SocialPost / …) and
   set `artifact_ids`.
7. Return `AgentResult`.

`generate_visual` and `product_shot` are two-step *inside* their skill: the LLM
art-directs a detailed image prompt (subject, composition, lighting, mood, palette,
style, hard no-text/no-logo rule) → the image model renders it.

### Skill registry (core capabilities)

| Skill | Agent | Tools | Output | Weight |
|---|---|---|---|---|
| `pick_angle` | Zerda | gsc_opportunities, market_insights (+brief.existing_content) | json {topic,keyword,intent,rationale} | light |
| `keyword_targets` | Zerda | tracked_keywords, gsc_opportunities | json {primary, secondary[]} | light |
| `market_report` | Oasis | market_data | markdown | heavy |
| `define_icp` | Oasis | market_insights (+profile) | json {segments[]} | light |
| `competitor_scan` | Sable | crawl_competitor, our_demand | json {scorecard, gaps, insights} | heavy |
| `write_article` | Dune | keyword_targets(prior), brand, existing_content | markdown + meta | heavy |
| `product_copy` | Dune | store_product | json {title, description_html, meta} | light |
| `multi_network_social` | Sirocco | brief (angle, brand) | json {variants[]} | light |
| `generate_visual` | Sirocco | brief → 2-step (LLM art-directs → image model) | image | heavy |
| `product_shot` | Mirage | store_product, scene | image | heavy |
| `outreach_plan` | Nomad | profile, icp(prior) | json {posts[],messages[],tips[]} | heavy |
| `testimonial_content` | Nomad | profile | json {pieces[]} | light |

## Orchestration (director)

Three phases; replaces `campaign_director.draft_plan` + the run loop in
`campaign_tasks.py`.

**1. Plan** (light tier). Reads the Brief; plans an ordered `steps[] = {skill_key, why,
inputs}` from the registry — goal-first, seeded by the persona-recommended shape, and it
may adapt (add `competitor_scan`, skip a step). **Guardrail** (kept from today): a plan
must contain a *create* step and a *distribute* step, else fall back to the persona flow.

**2. Execute + review loop** (per step):

```
run skill via AgentRunner -> AgentResult
  -> append compact handoff to brief.artifacts    # later agents build on it
  -> REVIEW (hybrid):
       - deterministic checks where they exist (compute_seo_score, char limits, keyword present)
       - one light-tier LLM judgment: on-goal? on-angle? specific & grounded (not generic)?
  -> pass?  yes -> next step
     no & retries<2 -> re-run skill with feedback injected into inputs
     no & retries=2 -> accept best attempt, flag it, continue
```

Feedback is appended to the skill's `inputs`; the skill's `build_prompt` renders a
`PREVIOUS ATTEMPT — FIX THIS: …` block. Reviews are stored in `CampaignStep.structured`
(JSON — no schema change), so the UI can show "revised 1×, score 82".

**3. Final.** Director writes the campaign summary; optionally proposes follow-up angles
(which feed the dedup list next time).

**Handoffs:** each `AgentResult` adds a *compact* line (summary + ids) to
`brief.artifacts`, not the full artifact — so Dune sees Zerda's angle, Sirocco's social
sees Dune's article title, without context bloat.

**Failures:** a skill that throws → step `failed`, loop continues (as today). Review runs
only on successful artifacts. Retries bounded (max 2/step) so cost is predictable even on
`max` tier.

## Model tiers

- Org setting **`agent_tier`** = `economy | balanced | max` (default `balanced`), stored
  on `Organization` (migration), exposed in Settings → Organization.
- `resolve_model(tier, weight, available_providers)`:
  - *economy*: light + heavy → cheap (Haiku / GPT-4o-mini)
  - *balanced*: light → cheap, heavy → premium (Opus / GPT-4o)
  - *max*: light + heavy → premium
- Director planning + all reviews are `light`. Respects `get_org_llm_keys` (maps to the
  providers the org actually has).

## Phased migration

- **Phase 1 — Core + campaigns.** Build `brief / spec / tools / runner / tiers / director`
  and migrate the campaign director + executors onto it. Biggest value; `/campaigns` UI
  and DB models unchanged.
- **Phase 2 — Standalone skills.** Repoint product-copy, ICP, testimonials, outreach,
  multi-network social, competitor scan, and article generation to `runner.run(skill)`;
  endpoints become thin wrappers over the same specialized prompts + grounding.
- **Phase 3 (optional).** Interactive copilots (analytics Q&A, article-studio chat) adopt
  the runner where it fits.

Each phase is independently shippable and leaves the app working.

## Error handling

- No AI key → clear error (as today).
- Tool failure → skill runs without that tool's data (degraded) or the step skips
  (competitor scan with no URL).
- Malformed LLM output → one repair retry in the runner, then a per-skill safe fallback.
- Provider unreachable → existing provider-preference fallback (try the next provider).

## Testing

`apps/api` has no established pytest suite, and per project convention there is no
frontend test framework. This design deliberately isolates the risky logic into **pure,
LLM-free functions** so they can be unit-tested cheaply:

- **pytest for pure units:** every `skill.build_prompt` (Brief + inputs → deterministic
  string — assert it includes goal, brand, dedup list, and feedback when present), the
  output parsers, `resolve_model` (tier × weight × providers), and the director's
  plan-guard (create+distribute enforcement / fallback).
- **Manual golden runs:** run a campaign for each persona (creator / ecommerce /
  freelancer / company) with an AI key and eyeball the artifacts — distinct topics,
  on-brief copy, sharper visuals.

LLM-dependent behaviour is verified by golden runs, not mocked.

## Non-goals

- No change to `Campaign` / `CampaignStep` schemas or the `/campaigns` UI in Phase 1
  (reviews ride in `CampaignStep.structured`).
- No fully-dynamic re-planning loop (rejected for unpredictable cost/latency).
- No change to the image *model* itself — quality gains come from the art-directed prompt.
- No new agents; this sharpens the existing seven.
