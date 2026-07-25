# Fennex Reseller Billing & Subscription Architecture

**Date:** 2026-07-25
**Status:** PROPOSAL — for review before any implementation
**Author:** Principal architect (design only; no code changes made)

## Executive summary

Move AI (LLM) and DataForSEO from **user-supplied keys** to **application-owned
provider accounts**, so Fennex becomes the reseller. Every AI token and SEO call
is billed to Fennex's accounts, so the platform must **meter raw consumption**
and **enforce quotas before cost is incurred** to protect margin. The good news:
~70% of the machinery already exists (`PlanTier`, `PLAN_LIMITS`, `OrgUsage`,
`check_usage_limit()`, the `SEODataProvider` abstraction with an env fallback,
`tiers.py` model routing, Stripe). This spec adds: (1) a platform provider
config layer, (2) raw token/call metering, (3) quota + rate-limit + concurrency
enforcement, (4) overage/add-on billing, and (5) a cost/margin admin dashboard.

**Cost anchors (verified 2026-07-25):** Opus 5/4.8 $5/$25 per 1M in/out;
Sonnet 5 $3/$15; Haiku 4.5 $1/$5; prompt-cache reads ~0.1×. DataForSEO shallow
SERP ~$0.001–0.002/task, keyword-ideas ~$0.01–0.05/call.

---

## 1. Recommended architecture

### 1.1 Principles

- **Providers are platform resources, not tenant resources.** A pluggable
  registry resolves the active LLM/SEO provider from **application config**
  (env / a `provider_accounts` table), never from a tenant key by default.
- **Meter at the choke points.** Every LLM call already funnels through
  `llm_service.call_llm`; every SEO call through the `SEODataProvider`. These
  are the two metering seams — wrap them, don't scatter counters.
- **Enforce before spend, reconcile after.** A pre-flight quota check gates the
  request (fast, approximate); a post-flight meter records actual usage (exact,
  from the provider's `usage` object). Margin is protected by the pre-flight
  *hard cap*; accuracy comes from the post-flight reconcile.
- **Everything is a workspace-scoped tenant of an org.** Org = billing account;
  project/workspace = usage sub-scope. Quotas live at the org level.
- **BYOK is a margin lever, not the default.** Top tiers may attach their own
  provider keys ("bring your own key") → their AI/SEO spend is on them, and we
  discount the subscription. Reuses the existing `api_keys` table, repurposed as
  an *optional override*.

### 1.2 Component map (all additive; reuses existing seams)

```
                         ┌─────────────────────────────────────────────┐
   Request →  FastAPI ──▶│ QuotaGuard dependency (pre-flight)           │
                         │  - resolves org plan + live counters (Redis) │
                         │  - hard cap? -> 429 LIMIT_REACHED             │
                         │  - soft cap? -> proceed + X-Usage-Warning     │
                         │  - rate limit / concurrency -> 429 / queue    │
                         └───────────────┬─────────────────────────────┘
                                         ▼
   ┌─────────────────────────  ProviderRegistry  ───────────────────────────┐
   │  resolve_llm(org)  -> (provider, model, key)   # platform key by default │
   │  resolve_seo(org)  -> SEODataProvider          # platform DataForSEO     │
   │  BYOK override when org has an active api_key of that provider           │
   └───────────────┬───────────────────────────────┬─────────────────────────┘
                   ▼                                ▼
        llm_service.call_llm (metered)     SEODataProvider.serp/keywords (metered)
                   │                                │
                   ▼                                ▼
        UsageMeter.record(tokens, model, cost)  UsageMeter.record(calls, unit, cost)
                   │
                   ▼
     Redis live counters (real-time quota)  +  usage_events (durable ledger, async flush)
                   │
                   ▼
     Rollups -> org_usage_period (billing) -> Stripe metered/overage -> admin cost dashboard
```

### 1.3 Provider abstraction (pluggable)

- **`ProviderRegistry`** (`services/providers/registry.py`): the single place
  that answers "which LLM/SEO provider + credentials for this org, this request".
  - LLM: returns `(provider, model, api_key)` — today `tiers.resolve_model` +
    `get_org_llm_keys`; change the key source to **platform config first**, org
    key only as BYOK override.
  - SEO: returns a `SEODataProvider` — today `get_seo_provider_for_org` already
    falls back to `settings.DATAFORSEO_*`; flip precedence so **platform is
    default** and org key is the override.
  - New providers (Gemini, Bedrock, a second SEO vendor) register here behind
    the existing `SEODataProvider` Protocol / `llm_service` provider switch — no
    call-site changes.
- **`provider_accounts` table** (below) lets ops rotate keys, run A/B or
  fail-over between provider accounts, and shard load without a redeploy — env
  vars remain the bootstrap default.

### 1.4 Metering (the core new capability)

- **`UsageMeter`** (`services/metering/meter.py`): one method per resource,
  called *inside* the two seams:
  - `record_llm(org_id, project_id, model, input_tokens, output_tokens, cache_read, cache_write, feature)`
  - `record_seo(org_id, project_id, unit, count, feature)` where `unit ∈
    {serp, keyword_ideas, backlinks, rank_check, ...}`
  - It (a) increments **Redis live counters** for real-time quota, (b) appends a
    row to an in-memory buffer flushed asynchronously to `usage_events`, and (c)
    computes **estimated cost** from a `cost_rates` table so margins are visible
    per org in real time.
- LLM `usage` comes from the SDK response (`input_tokens`, `output_tokens`,
  `cache_read_input_tokens`, `cache_creation_input_tokens`) — exact, not
  estimated. SEO cost is per-unit from `cost_rates`.

### 1.5 Enforcement (`QuotaGuard`)

Generalizes today's `check_usage_limit(resource)` into a dependency that checks
**four dimensions** against the plan, reading live Redis counters:

1. **Monthly quota** (tokens, SEO calls, feature counts) — hard or soft.
2. **Rate limit** (requests/min) — token bucket in Redis.
3. **Concurrency** (max simultaneous background jobs) — Redis semaphore keyed on
   org; arq jobs acquire/release.
4. **Capability gates** (premium models, premium SEO features) — boolean per
   plan.

Fail-open is never acceptable for the hard cap: if Redis is unavailable, fall
back to the Postgres counter (slower but correct) rather than skipping the check.

---

## 2. Database schema (plans, quotas, provider config, usage)

New/changed tables. Types are Postgres. `-1` means unlimited. Existing tables
(`organizations`, `org_usage`, `api_keys`, `subscription_events`) are extended,
not replaced.

```sql
-- 2.1 Plan catalog — moves PLAN_LIMITS out of code into data (editable, versioned)
CREATE TABLE plans (
  id              TEXT PRIMARY KEY,            -- 'free','starter','pro','agency','scale'
  name            TEXT NOT NULL,
  price_month_cents  INT NOT NULL,
  price_year_cents   INT NOT NULL,
  stripe_price_month TEXT, stripe_price_year TEXT,
  is_public       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 2.2 Per-plan limits — one row per (plan, resource). Superset of today's dict.
CREATE TABLE plan_limits (
  plan_id     TEXT REFERENCES plans(id) ON DELETE CASCADE,
  resource    TEXT NOT NULL,   -- 'ai_input_tokens','ai_output_tokens','ai_requests',
                               -- 'seo_serp','seo_keyword_analyses','dataforseo_calls',
                               -- 'projects','seats','storage_mb','articles','images',...
  limit_value BIGINT NOT NULL, -- -1 = unlimited
  enforcement TEXT NOT NULL DEFAULT 'hard',  -- 'hard' | 'soft'
  overage_cents_per_unit INT,  -- NULL = no overage allowed (hard stop)
  PRIMARY KEY (plan_id, resource)
);

-- 2.3 Capability flags — premium models / features per plan
CREATE TABLE plan_capabilities (
  plan_id    TEXT REFERENCES plans(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,   -- 'premium_models','premium_seo','api_access',
                              -- 'byok','autopilot','white_label',...
  enabled    BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (plan_id, capability)
);

-- 2.4 Rate / concurrency knobs per plan
CREATE TABLE plan_runtime_limits (
  plan_id           TEXT PRIMARY KEY REFERENCES plans(id) ON DELETE CASCADE,
  requests_per_min  INT NOT NULL DEFAULT 60,
  max_concurrent_jobs INT NOT NULL DEFAULT 2,
  max_model_tier    TEXT NOT NULL DEFAULT 'economy'  -- economy|balanced|max
);

-- 2.5 Application-level provider accounts (the reseller credentials)
CREATE TABLE provider_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          TEXT NOT NULL,      -- 'llm' | 'seo'
  provider      TEXT NOT NULL,      -- 'anthropic','openai','google','dataforseo',...
  label         TEXT NOT NULL,
  encrypted_credentials TEXT NOT NULL,  -- reuse core.security.encrypt_value
  is_active     BOOLEAN NOT NULL DEFAULT true,
  weight        INT NOT NULL DEFAULT 100,   -- load-balancing / failover ordering
  monthly_budget_cents INT,               -- optional circuit-breaker per account
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 2.6 Per-unit cost rates (for real-time margin computation + overage pricing)
CREATE TABLE cost_rates (
  provider   TEXT NOT NULL,
  unit       TEXT NOT NULL,   -- 'input_token','output_token','cache_read_token',
                              -- 'serp','keyword_ideas','backlinks',...
  model      TEXT,            -- for LLM units; NULL for SEO
  cost_micros BIGINT NOT NULL, -- cost in millionths of a dollar per unit
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, unit, model, effective_from)
);

-- 2.7 Durable usage ledger (append-only; source of truth for reconciliation/audit)
CREATE TABLE usage_events (
  id          BIGSERIAL PRIMARY KEY,
  org_id      UUID NOT NULL,
  project_id  UUID,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind        TEXT NOT NULL,      -- 'llm' | 'seo'
  provider    TEXT NOT NULL,
  model       TEXT,
  feature     TEXT,               -- 'article','discovery','competitor_scan',...
  input_tokens  BIGINT DEFAULT 0,
  output_tokens BIGINT DEFAULT 0,
  cache_read_tokens BIGINT DEFAULT 0,
  seo_unit    TEXT,
  seo_count   INT DEFAULT 0,
  cost_micros BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX ix_usage_events_org_ts ON usage_events (org_id, ts);

-- 2.8 Per-period rollup (extends today's org_usage with raw-resource columns)
ALTER TABLE org_usage
  ADD COLUMN ai_input_tokens   BIGINT DEFAULT 0,
  ADD COLUMN ai_output_tokens  BIGINT DEFAULT 0,
  ADD COLUMN ai_requests       BIGINT DEFAULT 0,
  ADD COLUMN seo_serp          BIGINT DEFAULT 0,
  ADD COLUMN seo_keyword_analyses BIGINT DEFAULT 0,
  ADD COLUMN dataforseo_calls  BIGINT DEFAULT 0,
  ADD COLUMN storage_mb        BIGINT DEFAULT 0,
  ADD COLUMN cost_micros       BIGINT DEFAULT 0,   -- our COGS this period
  ADD COLUMN overage_cents     BIGINT DEFAULT 0;

-- 2.9 Pay-as-you-go add-ons (credit packs / bolt-ons)
CREATE TABLE org_addons (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id    UUID NOT NULL,
  resource  TEXT NOT NULL,      -- which quota it tops up
  amount    BIGINT NOT NULL,    -- units added
  remaining BIGINT NOT NULL,
  stripe_invoice_id TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- organizations: trial window, byok flag, soft-suspend for overage/non-payment
ALTER TABLE organizations
  ADD COLUMN byok_enabled  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN trial_ends_at TIMESTAMPTZ,          -- set to now()+7d on signup; NULL once converted
  ADD COLUMN billing_state TEXT NOT NULL DEFAULT 'trialing';
  -- billing_state: trialing | active | trial_expired | past_due | suspended
  -- New orgs start 'trialing' on a time-boxed, quota-limited trial plan (no
  -- permanent free tier). On day 7 without a paid subscription -> 'trial_expired'
  -- (read-only: dashboards + edit stay, generation/publishing blocked).
```

**Live counters (Redis, not Postgres):** `usage:{org}:{period}:{resource}` integer
keys (INCRBY), `rl:{org}` token bucket, `conc:{org}` semaphore. Postgres
`org_usage` is the durable rollup written on flush; Redis is the hot path.

---

## 3. Billing strategy (maximize profitability)

### 3.1 Margin math (the core constraint)

**Target: minimum 400% markup** — the resale price is **≥ 5× the underlying
COGS**. Concretely:
- At **expected (P50) utilization**, an org's included-quota COGS must be
  **≤ 20% of its plan price** (≥ 400% markup).
- At **worst-case (100%) utilization**, COGS must stay **≤ ~40% of price**
  (≥ 150% markup floor) — guaranteed by the raw hard caps.
- **Overage and add-ons priced at ≥ 5× underlying cost** (≥ 400% markup on
  every incremental unit too).

Hitting 400% at these quota sizes is **only possible with the §3.4 cost-first
LLM routing** (default to Haiku/Sonnet, Opus off by default), aggressive prompt
caching (reads ~0.1×), the Batch API (−50%) for non-interactive work, and
**tight SEO-call quotas** (keyword-ideas at $0.01–0.05 is the single biggest
margin risk — cap it hard and meter it). Every plan number in §5 is sized
against these levers and **must be re-validated against real `cost_rates`**
before launch.

Cost anchors → representative per-action COGS:
- Article (Opus, ~8K in + 4K out, partial cache): **~$0.10–0.14**
- Article (Sonnet): **~$0.03–0.05**
- Social caption (Haiku): **~$0.007**
- Discovery run (crawl free + 1 Opus synthesis ~16K/3K + Sable + 3 SERP): **~$0.16 + ~$0.006 SEO ≈ $0.17**
- SERP analysis (shallow): **~$0.001–0.002**
- Keyword analysis (DataForSEO ideas): **~$0.01–0.05**

**The output-token trap:** Opus output at $25/1M dominates cost. Margin defense
= route most volume to Haiku/Sonnet via `max_model_tier`, reserve Opus for paid
tiers, and meter **output tokens** tightly (separate quota from input).

### 3.2 Pricing model

Charge in **friendly units** (articles, images, keyword/SERP analyses) for the
UX, but back every plan with **raw token/call hard caps** as the margin backstop
(so a user can't burn $500 of Opus inside a "40 articles" plan by generating
40 novels). Two-layer quota: friendly counter for the user, raw ceiling for us.

Three revenue levers stack:
1. **Subscription** (the base): predictable MRR, generous-but-bounded quotas.
2. **Overage**: soft-limit resources bill per-unit at 3–5× cost once quota is hit
   (opt-in; default is hard stop to prevent bill shock).
3. **Pay-as-you-go add-ons**: prepaid credit packs (e.g. "+2,000 SERP analyses
   $19", "+10 premium articles $9") — high margin, no commitment.

**BYOK discount** (top tiers): org attaches its own Anthropic/DataForSEO key →
we waive the AI/SEO COGS and discount ~30–40%. Converts our most expensive users
into pure-software margin.

### 3.3 Cost management controls

- **Hard vs soft:** capacity + core AI = hard (429 at 100%); premium extras =
  soft with overage. Per-resource in `plan_limits.enforcement`.
- **Real-time budget circuit-breakers:** `provider_accounts.monthly_budget_cents`
  and per-org `cost_micros` ceiling — if an org's COGS crosses its plan price
  (a loss), auto-throttle to the cheap model tier and alert ops.
- **Alerts:** 80% / 95% / 100% quota events emit `X-Usage-Warning` headers +
  in-app + email (reuse `digest_service`/`email_service`).
- **Admin cost dashboard:** per-org and per-app COGS (from `usage_events` /
  `cost_micros`), gross margin, top spenders, provider spend vs
  `provider_accounts.monthly_budget`, and a "loss-making orgs" list.

---

### 3.4 LLM selection strategy (cost-first routing) — the margin linchpin

**Principle: never pick a model; pick the cheapest model that clears the task's
quality bar, and escalate only on proven need.** Opus is *off by default*.
This is what makes 400% markup possible.

**3.4.1 Model ladder (cheapest first).**

| Tier | Model (Anthropic / OpenAI alt) | Cost in/out /1M | Use for |
|------|-------------------------------|-----------------|---------|
| **cheap**    | Haiku 4.5 / gpt-4o-mini | $1 / $5   | classification, extraction, tagging, meta descriptions, alt-text, short social captions, keyword clustering, JSON/structured parsing, title/slug generation, simple rewrites, moderation |
| **standard** | Sonnet 5 / gpt-4o       | $3 / $15  | **the default workhorse** — article drafts, brand-voice writing, discovery synthesis, competitor gap analysis, ICP/audience generation, most agent reasoning |
| **premium**  | Opus 5                  | $5 / $25  | reserved: only hard long-form editorial polish or complex multi-step strategy, **Pro+ only, behind an explicit toggle, at a credit multiplier** — and even then try Sonnet first |

Change `services/agents/tiers.py`: today `balanced`/`max` route "heavy" work to
**Opus**. Re-map so the default heavy tier is **Sonnet (standard)**; Opus is a
separate `premium` grade selected *only* when (a) the plan allows it, (b) the
feature is flagged `needs_premium`, and (c) the user opted in. Trial/Starter cap
at **standard**; Haiku is the floor for anything light.

**3.4.2 Route by task, not by user request.** A `model_policy` map
(feature → required tier) lives in config, so promoting/demoting a feature's
model is a data change, not a redeploy. Default every new feature to **cheap**
and only bump it after evals show the cheap model misses.

**3.4.3 Cost-cutting techniques (stacked).**
1. **Right-size per task** (the ladder above) — the single biggest lever;
   most Fennex features (meta, captions, tags, clustering, extraction) belong on
   Haiku, not Sonnet or Opus.
2. **Cascade with a validator.** Cheap model drafts → a fast programmatic/LLM
   quality check → escalate to standard *only* on failure. You pay premium on
   the ~10% that needs it, not the 90% the cheap model nails.
3. **Prompt caching.** Cache the stable prefix (system prompt, Brand DNA,
   few-shots, style rules) so repeated generations read at ~0.1×. Fennex's
   per-project Brand DNA is a perfect cache key.
4. **Cap output tokens per feature.** Output is 5× the input price — tight
   `max_tokens` per task and streaming; a "meta description" never needs 4K
   tokens.
5. **Batch API (−50%)** for everything non-interactive: monitoring, digests,
   bulk keyword/content jobs, competitor re-scans, backlink discovery.
6. **Retrieval, not big context.** Inject only the relevant knowledge-base
   chunks (embeddings already exist) instead of dumping large context — fewer
   input tokens per call.
7. **Deterministic-first.** Do with code/heuristics what doesn't need an LLM
   (the color/competitor extractors are the model here) before spending a call.
8. **Provider-cheapest routing.** The registry can pick the cheaper of two
   equivalent models per tier (e.g., gpt-4o-mini vs Haiku) from `cost_rates`.
9. **Per-org COGS circuit-breaker.** If an org nears loss, force the whole org
   to the cheap tier and alert ops.

**3.4.4 How the user experiences it.** Users never choose a model — they pick a
*quality intent* at most ("fast draft" vs "best quality"), which maps to a tier
and a **credit multiplier** (cheap = 1×, standard = 3×, premium = 8×). The
multiplier makes premium self-financing: a user who wants Opus spends
proportionally more credits, so our markup holds regardless of their choice.

## 4. Quota enforcement strategy

- **Pre-flight (`QuotaGuard` dependency):** before an AI/SEO action runs, read
  the live Redis counter; hard cap reached → `429 {code:"LIMIT_REACHED"}`; soft
  cap with overage → proceed and mark billable; 80%+ → warning header.
  Rate-limit and concurrency checked here too.
- **Reservation for background jobs:** long arq jobs (article gen, discovery)
  **reserve** an estimated token budget on enqueue (optimistic decrement), then
  **reconcile** to actual on completion — prevents 50 queued jobs from blowing
  the cap before any records land.
- **Post-flight (`UsageMeter`):** exact usage from the provider response is the
  source of truth; Redis counters are corrected to match on reconcile.
- **Concurrency:** Redis semaphore per org sized by `max_concurrent_jobs`; arq
  workers `acquire`/`release`; excess jobs queue rather than run.
- **Graceful failure:** Redis down → fall back to Postgres `org_usage` counters
  (correctness over speed); never fail-open on a hard cap.
- **Period reset:** monthly (calendar or per-org anniversary via
  `current_billing_period_start`); add-on packs carry their own `remaining`.
- **Trial:** `billing_state='trialing'` orgs use fixed **whole-trial** quota
  buckets (no monthly reset) resolved from a `trial` pseudo-plan in the catalog.
  `QuotaGuard` additionally checks `now() < trial_ends_at`; past it, every
  metered action returns `402 TRIAL_EXPIRED` and the org flips to
  `trial_expired` (read-only). A daily cron (`expire_trials`) flips state and
  fires the day-5/day-7 conversion emails; converting to a paid plan clears the
  trial state and starts monthly periods.

---

## 5. Revised billing plans (the concrete deliverable)

Prices illustrative (USD/mo, annual ≈ 10×). "AI credits" = a normalized unit
that abstracts model cost: **1 credit ≈ 1 Sonnet-equivalent request**; premium
(Opus) requests cost more credits, cheap (Haiku) fewer — this hides model
economics from users while protecting margin. Raw token ceilings back each tier.

There is **no permanent free tier**. New signups get a **7-day free trial**
(time-boxed, quota-limited) that then must convert to a paid plan. The trial is a
*state on the org* (`billing_state='trialing'`, `trial_ends_at`), not a separate
priced plan — it grants a small, fixed quota bucket. **No card required at
signup** (per current decision); because there's no card gate, guard against
trial-farming: **one trial per verified email + signup fingerprint** (IP /
device / disposable-email blocklist), and keep the trial quota small so abuse is
cheap. A card requirement can be switched on later (a config flag on the trial
flow) without schema changes.

| Resource / capability      | **Trial (7 days)** | Starter $29 | Pro $99      | Agency $299   | Scale $799 |
|----------------------------|--------------------|-------------|--------------|---------------|------------|
| Access window              | 7 days, then convert | ongoing   | ongoing      | ongoing       | ongoing    |
| Projects / workspaces      | 1                  | 3           | 10           | 50            | 200        |
| Seats                      | 1                  | 3           | 10           | 25            | 75         |
| **AI credits (trial total)** | 100 (whole trial) | 1,500 / mo | 6,000 / mo   | 20,000 / mo   | 60,000 / mo|
| Raw AI output-token cap    | 80K (trial total)  | 1.5M / mo   | 6M / mo      | 20M / mo      | 60M / mo   |
| Default model              | Haiku/Sonnet       | Haiku/Sonnet| Haiku/Sonnet | Haiku/Sonnet  | Haiku/Sonnet |
| Premium (Opus) — opt-in, 8× credits | ❌        | ❌          | ✅ (toggle)  | ✅ (toggle)   | ✅ (toggle) |
| Model tier ceiling         | standard           | standard    | premium      | premium       | premium    |
| **SERP analyses**          | 25 (trial total)   | 300 / mo    | 1,500 / mo   | 6,000 / mo    | 20,000 / mo|
| **Keyword analyses**       | 50 (trial total)   | 500 / mo    | 2,500 / mo   | 10,000 / mo   | 40,000 / mo|
| DataForSEO calls (hard)    | 100 (trial total)  | 1,000 / mo  | 5,000 / mo   | 20,000 / mo   | 75,000 / mo|
| Articles                   | 3 (trial total)    | 25 / mo     | 120 / mo     | 500 / mo      | unlimited* |
| Images                     | 5 (trial total)    | 60 / mo     | 300 / mo     | 1,500 / mo    | unlimited* |
| Storage                    | 1 GB               | 5 GB        | 25 GB        | 100 GB        | 500 GB     |
| Rate limit (req/min)       | 30                 | 60          | 120          | 300           | 600        |
| Max concurrent jobs        | 1                  | 2           | 5            | 15            | 40         |
| Publishing (WP/Shopify)    | draft only         | ✅          | ✅           | ✅            | ✅         |
| Premium SEO (rank, backlinks, competitor monitor) | ❌ | partial | ✅ | ✅ | ✅ |
| Overage billing            | ❌ (hard stop)     | opt-in      | opt-in       | ✅            | ✅         |
| Pay-as-you-go add-ons      | ❌                 | ✅          | ✅           | ✅            | ✅         |
| BYOK (own AI/SEO keys)     | ❌                 | ❌          | ❌           | ✅ (-30%)     | ✅ (-40%)  |
| Credit multiplier by model | cheap 1× · standard 3× · premium 8× (all tiers) |||||
| API access / white-label   | ❌                 | ❌          | API          | API+WL        | API+WL     |

`*` "unlimited" is fair-use: still bounded by the raw token/call hard caps to
prevent abuse.

**Trial mechanics.** Trial quotas are **totals for the whole 7 days**, not
monthly — a single Redis counter bucket keyed to the org with no period reset.
The trial deliberately lets a user reach the "magic" moments (onboarding
discovery, a few articles, a competitor scan) so the product sells itself, then
caps hard. On expiry the org moves to `trial_expired`: **read-only** — they keep
their workspace, discovered Brand DNA, and dashboards (so nothing is lost and
re-engagement email works), but generation/publishing/SEO calls return
`402 TRIAL_EXPIRED` until they pick a plan. Hard-stop only (no overage on trial)
to cap our acquisition COGS at a known ceiling (~$0.60–1.00 COGS per trial at
full utilization — cheap CAC).

**Illustrative margin check (Pro, $99):** 6,000 credits ≈ mixed Haiku/Sonnet/Opus.
If ~70% Sonnet ($0.04), 20% Haiku ($0.007), 10% Opus ($0.12) → blended ≈ $0.04 →
6,000 × $0.04 ≈ **$24 AI COGS** + SEO (1,500 SERP × $0.0015 + 2,500 kw × $0.02 ≈
$52) → **~$76 COGS worst-case at full utilization**. Because typical utilization
is 20–40%, realized COGS ≈ $20–30 → **~70–80% margin**. *The keyword-analysis
line is the margin risk* — cap it hard and price add-ons above cost. (These are
planning figures; validate `cost_rates` against real invoices before launch.)

**Overage price examples (≥ 5× cost = ≥ 400% markup):** standard article $0.25;
100 SERP $0.75; 100 keyword analyses $10; 1M Opus output tokens $125. Add-on
packs: "+2,000 SERP $19", "+1,000 keyword analyses $49", "+10M Sonnet output
tokens $99". Overage is **opt-in on Pro/Agency/Scale** (default hard-stop);
trial and Starter hard-stop only.

---

## 6. Implementation roadmap (phased, each shippable)

**Phase 0 — Platform providers (unblocks reseller model).** Flip
`get_seo_provider_for_org` and `get_org_llm_keys` to **platform-first** via
`ProviderRegistry`; add `provider_accounts` + admin CRUD; keep env fallback.
Users stop needing their own keys. *(No metering yet — just the key flip.)*

**Phase 1 — Metering + cost-first routing.** `UsageMeter` + `usage_events` +
`cost_rates`; wrap `call_llm` and the `SEODataProvider`; extend `org_usage` with
raw columns; nightly rollup. **In the same phase, land the §3.4 routing** — it's
the margin linchpin and independent of billing: re-map `tiers.py` (heavy →
Sonnet, Opus behind a `premium` grade), add the `model_policy` feature→tier map
defaulting new features to `cheap`, turn on prompt caching for stable prefixes
(Brand DNA/system prompts), and move non-interactive jobs to the Batch API.
*(Observe-only on billing: dashboards light up, no enforcement change — but COGS
drops immediately.)*

**Phase 2 — Plan catalog in DB.** Move `PLAN_LIMITS` → `plans`/`plan_limits`/
`plan_capabilities`/`plan_runtime_limits`; `check_usage_limit` reads DB+Redis.
Seed with the table in §5.

**Phase 3 — QuotaGuard v2.** Real-time Redis counters, token/call quotas,
rate-limit + concurrency, capability gates, job reservation/reconcile. Hard-cap
enforcement on AI + SEO.

**Phase 4 — Billing, trial & overage.** Stripe checkout for the 5 paid plans;
**7-day trial**: set `trial_ends_at` on signup, `expire_trials` daily cron,
trial→paid conversion clearing trial state, day-5/day-7 emails, `402
TRIAL_EXPIRED` gating; Stripe metered prices for overage; add-on packs +
`org_addons`; billing-state suspension; BYOK discount flow.

**Phase 5 — Cost/margin admin dashboard + alerts.** Per-org/app COGS, margin,
budget circuit-breakers, loss-making-org list, 80/95/100% alerts.

**Phase 6 — Pluggable-provider hardening.** Add a second LLM provider (Gemini/
Bedrock) and a fail-over SEO provider behind the registry; load-balancing via
`provider_accounts.weight`; per-account budget breakers.

---

## 7. Best practices for a scalable AI/SEO reseller platform

- **Meter at one seam per resource.** Never sprinkle counters across routers —
  wrap `call_llm` and the provider Protocol once. Every new feature is metered
  for free.
- **Store raw units, derive money.** Persist tokens/calls in `usage_events`;
  compute cost from a versioned `cost_rates` table so provider price changes
  don't require reprocessing history.
- **Enforce on the hot path in Redis, reconcile in Postgres.** Sub-millisecond
  quota checks; durable ledger for billing/audit; never block a request on a
  synchronous Postgres write.
- **Reserve-then-reconcile for async jobs** so queued work can't outrun the cap.
- **Route to the cheapest capable model** (`max_model_tier` + `tiers.py`);
  premium models are a paid capability, not a default. Exploit prompt caching
  (reads ~0.1×) — cache system prompts/brand DNA aggressively.
- **Separate input and output token quotas** — output is 5× the price; that's
  where margin leaks.
- **Default to hard caps; make overage opt-in.** Prevents bill shock and support
  load; overage is a revenue feature, not a surprise.
- **Circuit-break on loss.** If an org's COGS exceeds its MRR, auto-throttle to
  cheap models and flag it — one abusive org shouldn't erase a cohort's margin.
- **BYOK for whales.** Let the highest-usage tenants bring their own keys at a
  discount — converts your worst-margin accounts into pure software margin.
- **Provider abstraction from day one.** One vendor outage or price hike
  shouldn't be an outage for you — the registry + `provider_accounts` enable
  fail-over and multi-vendor without redeploys.
- **Idempotent, append-only ledger.** `usage_events` is never mutated;
  corrections are compensating rows — clean audit trail for disputes and taxes.
- **Encrypt all provider credentials** with the existing `core.security`
  helpers; platform keys never reach the client or logs.

---

## Decisions (locked 2026-07-25)

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Margin target | **Min 400% markup** — price ≥ 5× COGS; included quota ≤ 20% of price at P50 util, ≤ 40% worst-case; overage/add-ons ≥ 5× cost. Drives the cost-first LLM routing (§3.4) and tight SEO quotas. |
| 2 | Overage default | **Opt-in** on Pro/Agency/Scale (default hard-stop); trial + Starter hard-stop only. |
| 3 | BYOK | **Yes on Agency** (−30%); also offered on Scale (−40%). Not on trial/Starter/Pro. |
| 4 | Trial | **7 days, no card** for now (config flag to require a card later). One trial per verified email + fingerprint; small quota to make abuse cheap. |
| 5 | LLM selection | **Cost-first routing (§3.4):** default Haiku/Sonnet, **Opus off by default**, premium opt-in only on Pro+ at an 8× credit multiplier. Re-map `tiers.py` so "heavy" = Sonnet, not Opus. |

### Still open (lower priority)

- **Metering granularity** — recommend **credits** in the UI (with the model
  multiplier) + raw token/call hard caps as the backstop; raw tokens stay
  internal.
- **Existing tenant keys** — migrate current `api_keys` orgs to the platform
  provider automatically; retain their key only if they later opt into BYOK
  (Agency+).
- **Exact prices/quotas** — §5 numbers are illustrative and must be tuned against
  real `cost_rates` (esp. the keyword-analysis line) before launch.
```
