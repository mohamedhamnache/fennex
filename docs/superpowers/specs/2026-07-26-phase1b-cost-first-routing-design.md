# Phase 1b — Cost-first LLM routing

**Date:** 2026-07-26
**Status:** APPROVED — ready for an implementation plan
**Parent spec:** `docs/superpowers/specs/2026-07-25-reseller-billing-architecture.md` §3.4
**Depends on:** Phase 0 (`provider_accounts`, `ProviderRegistry`) and Phase 1a
(`cost_rates`, `usage_events`, `UsageMeter`), both merged to `main`.

## 1. Why

Phase 1a made COGS *visible*. Phase 1b makes it *small*. Today
`services/agents/tiers.py` prefers Anthropic and routes every `heavy` skill on
the `balanced` and `max` tiers to Opus — the single largest cost leak, and a
direct contradiction of the locked decisions "OpenAI primary" and "don't use
expensive LLMs". Min 400% margin is not reachable while that stands.

This phase lands the whole of parent-spec §3.4: band-based routing over a
`model_catalog`, a feature→band policy map, premium behind an explicit
entitlement, plus the stacked cost-cutting techniques — output caps, prompt
caching, cheap-first cascade, and the Batch API.

Everything here is COGS-side. No quota enforcement and no plan/pricing change:
those are Phases 2–4.

## 2. Decisions locked during design

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scope | All of §3.4 — routing *and* caching, caps, cascade, batch. |
| 2 | Premium opt-in signal | New `organizations.premium_models_enabled` flag, independent of `agent_tier`. |
| 3 | Batch API coverage | All non-interactive workers, with the scheduled-vs-user-triggered split in §9. |
| 4 | Cascade validator | Programmatic only — no LLM judge. |
| 5 | Premium primary model | `anthropic:claude-opus-5`. OpenAI's flagship reasoning model is added as a catalog row once its ID and price are confirmed (§3). |

## 3. Component A — `model_catalog`

Per parent spec §3.4.1, unchanged:

```sql
CREATE TABLE model_catalog (
  band      TEXT NOT NULL,          -- 'cheap' | 'standard' | 'premium'
  provider  TEXT NOT NULL,          -- 'openai' | 'anthropic' | 'google'
  model     TEXT NOT NULL,
  priority  INT  NOT NULL,          -- 1 = primary, higher = fallback order
  supports  JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (band, provider, model)
);
```

Seed:

| band | priority 1 | priority 2 |
|---|---|---|
| `cheap` | `openai:gpt-4o-mini` | `anthropic:claude-haiku-4-5-20251001` |
| `standard` | `openai:gpt-4o` | `anthropic:claude-sonnet-5` |
| `premium` | `anthropic:claude-opus-5` | — |

`supports` carries `{json_output, vision, tools}` per row so the resolver can
skip a model that cannot serve the request.

**Every catalogued model must have `cost_rates` rows.** The Phase 1a review
caught models silently pricing to $0; the seed migration therefore also inserts
rates for the two newly catalogued Anthropic models: `claude-sonnet-5` $3/$15
per 1M (cache read 0.3), `claude-opus-5` $5/$25 per 1M (cache read 0.5). A
catalog row without a matching rate is a billing bug, and §11 adds a test that
asserts the invariant.

Premium is deliberately Anthropic-only at launch: there is no verified OpenAI
flagship-reasoning model ID or price to seed, and guessing one reintroduces the
$0-pricing bug. Premium is off by default and pro+ only, so the blast radius is
small. Adding OpenAI premium later is one catalog row plus one rate row — no
code change.

## 4. Component B — the resolver (`services/providers/catalog.py`)

```python
resolve_band(band: str, available: list[str], needs: dict | None = None) -> tuple[str, str]
```

Returns `(provider, model)`: among active rows for `band` whose provider has a
usable key and whose `supports` covers `needs`, take the lowest `priority`; on
a priority tie, take the cheaper model by `cost_rates` (parent spec §3.4.3
technique #8). If the band has no usable row, fall back one band down
(`premium`→`standard`→`cheap`) rather than raising — a missing premium key must
never fail a request.

**Reads a process-local snapshot, not the DB, on the hot path.** The table is
tiny and changes rarely. A module-level snapshot is warmed at startup, refreshed
on a TTL, and invalidated by the admin CRUD writes in §7. This is what keeps
`resolve_model()` synchronous: all ~12 existing call sites keep their current
signature, and none of the sync callers (`employees/runtime/models.for_action`,
`is_allowed`) need to become async. If the snapshot is empty (fresh DB, failed
refresh), the resolver falls back to a hardcoded copy of the §3 seed so routing
degrades to the right models instead of failing.

## 5. Component C — the policy map (`services/agents/policy.py`)

One in-code table driving band choice, output caps and cascade opt-in, so the
three levers can't disagree:

```python
@dataclass(frozen=True)
class FeaturePolicy:
    band: str                    # 'cheap' | 'standard' | 'premium'
    max_output_tokens: int
    needs_premium: bool = False  # may escalate to premium when entitled
    cascade: bool = False        # cheap-first with validator (§8)

FEATURE_POLICY: dict[str, FeaturePolicy] = {...}
DEFAULT_POLICY = FeaturePolicy(band="cheap", max_output_tokens=1024)
```

Per parent spec §3.4.2, an unlisted feature defaults to `cheap` — new features
start cheap and are promoted only on evidence. Features are keyed by the same
`feature` string Phase 1a already passes to the meter, so policy and usage
reporting share one vocabulary and a per-feature cost report maps 1:1 onto a
policy row.

Initial assignments follow the §3.4.1 band table: meta descriptions, alt text,
titles/slugs, tags, keyword clustering, JSON extraction and classification on
`cheap`; article drafts, brand-voice writing, discovery synthesis, competitor
gap analysis and agent reasoning on `standard`; long-form editorial polish is
the only `needs_premium` entry.

## 6. Component D — `tiers.py` re-map

`resolve_model(tier, weight, available)` keeps its signature and returns a
concrete `(provider, model)`, but resolves through a band:

| agent_tier | light | heavy |
|---|---|---|
| `economy` | cheap | cheap |
| `balanced` | cheap | standard |
| `max` | standard | standard |

Premium is **not** reachable from `agent_tier` alone — only through the §7
entitlement check on a `needs_premium` feature. This is the change that stops
Opus-by-default.

`app/employees/runtime/models.py` holds a second hardcoded `CATALOGUE` used by
`is_allowed()` and `for_action()`. It is repointed at the same resolver so the
employee runtime and the agent runner cannot drift to different models.

## 7. Component E — premium entitlement

New column `organizations.premium_models_enabled BOOLEAN NOT NULL DEFAULT false`.

```python
def max_band(org) -> str
```

returns `premium` only when **all** hold: plan is `pro`/`agency`/`enterprise`,
`premium_models_enabled` is true, and the resolved feature is `needs_premium`.
Free, starter and in-trial orgs cap at `standard` regardless of flags. The cap
is applied after band resolution, so a policy asking for premium on a starter
org silently gets standard.

Surfaced on the existing org settings endpoint and as a Settings toggle,
disabled with a reason when the plan is below pro. Admin CRUD for
`model_catalog` follows the Phase 0 staff-only pattern and invalidates the §4
snapshot on write.

## 8. Components F–H — caps, caching, cascade

**Output caps.** `call_llm` applies `FEATURE_POLICY[feature].max_output_tokens`
when the caller passes no explicit `max_tokens`. Output costs ~5× input, so this
is the cheapest lever available. Implementation includes an audit of the 32
`call_llm(` sites for oversized literals.

**Prompt caching.** Anthropic: mark the system prefix with `cache_control:
ephemeral` when it clears the minimum cacheable length. OpenAI: caching is
automatic above its prefix threshold, so the work is *prompt restructuring* —
stable content (system rules, Brand DNA, style guide, few-shots) first,
variable content last. `cache_read_tokens` is already metered and priced by
Phase 1a, so the saving shows up in `usage_events` with no metering change.

**Cascade.** `call_llm_cascade()` runs the policy band, validates
programmatically, and escalates exactly one band with one retry on failure.
Validation is objective only — output parses as JSON when JSON was requested,
required keys present, length within bounds, response not truncated. No LLM
judge: cheap models fail on format, not on taste, and a judge costs a call per
generation. Enabled per feature via `FeaturePolicy.cascade`. Both attempts are
metered separately, so the ledger shows the true cost of a cascade.

## 9. Component I — Batch API (`services/batch/`)

A submit/poll client, an arq reconciler job that collects completed batches, and
a `batch=True` path on the callers.

**Coverage.** Digest and monitoring go to batch unconditionally — nothing waits
on them. Competitor re-scans, bulk keyword jobs, backlink discovery and autopilot
go to batch **when scheduled by cron**, and stay on the sync path **when a user
triggers the same job by hand**. The reason: OpenAI batch settles anywhere up to
24h, so a user who clicks "run" and gets a job that finishes tomorrow is a
regression the 50% saving doesn't pay for. The split is one flag on the task
signature, and scheduled runs are the large majority of that volume.

**Metering.** Batch is 50% off, which is a *rate*, not a multiplier to hardcode
in the meter. New `cost_rates` units `batch_input_token` / `batch_output_token`
(and `batch_cache_read_token`) at 0.5× the interactive rate, seeded for every
catalogued model. `record_llm` selects the batch units when the call came from
the batch path, preserving the versioned-rate design so a future batch discount
change is a data change.

## 10. Data flow

```
feature name ─▶ FEATURE_POLICY ─▶ band ─┐
org (plan, premium flag) ─▶ max_band ───┼─▶ capped band
agent_tier + weight ─▶ tiers.py ────────┘        │
                                                 ▼
                       catalog snapshot ─▶ resolve_band(band, available, needs)
                                                 │
                                                 ▼
                                   (provider, model) ─▶ call_llm
                                                 │       ├─ output cap from policy
                                                 │       ├─ cached prefix
                                                 │       └─ meter → usage_events
                                                 ▼
                                   cascade? validate ─▶ escalate one band, retry once
```

## 11. Testing

No frontend test framework exists; the API has pytest. Verification is:

- Resolver: band → expected `(provider, model)`; provider missing → falls back
  to priority 2; `needs` unmet → skips the row; equal priority → cheaper model
  wins; empty snapshot → hardcoded seed.
- Entitlement: the matrix of plan × flag × `needs_premium`, asserting starter
  and in-trial orgs never reach premium.
- Invariant test: **every active `model_catalog` row has `cost_rates` rows for
  input, output and cache-read units** (interactive and batch). This is the
  regression guard for the Phase 1a $0-pricing bug.
- Cascade: malformed JSON escalates once and only once; valid output does not
  escalate; both attempts appear in `usage_events`.
- Batch: rate selection uses the `batch_*` units; the reconciler is idempotent
  on repeated polls.
- Routing regression: `balanced` + `heavy` resolves to `openai:gpt-4o`, never
  to an Opus model.
- `npm run typecheck` for the Settings toggle.

## 12. Migrations

Chain continues from head `h3w4x5y6z7a8`:

1. `model_catalog` table + band seed + `cost_rates` for `claude-sonnet-5` and
   `claude-opus-5`.
2. `organizations.premium_models_enabled`.
3. `batch_*` `cost_rates` units for every catalogued model.

## 13. Out of scope

Quota enforcement and hard caps (Phase 3), plan catalog in DB (Phase 2), Stripe
and overage (Phase 4), the margin dashboard (Phase 5), additional suppliers
(Phase 6), retrieval-instead-of-big-context and deterministic-first (§3.4.3
techniques #6 and #7 — they are per-feature rewrites, not routing work), and
the credit multiplier from §3.4.4, which belongs with pricing in Phase 4.
