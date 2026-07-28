# Billing v2 — Credits, Full-Cost Metering & Plan Reduction

**Date:** 2026-07-27
**Status:** Design approved (pending spec review)
**Supersedes pricing tables in:** `2026-07-25-reseller-billing-architecture.md` (this is the concrete, code-level realization of the "credit" abstraction that spec described)

## Problem

Compute/margin tracking is blind to three real cost sources, and the plan
model does not govern AI or SEO spend:

1. **Image generation** — `image_service.generate_image_dalle` computes a
   `cost_usd` but never records a usage event. Image cost is invisible.
2. **Replicate** — `editing_service` (crop/resize/background-removal/etc.) calls
   Replicate with zero metering.
3. **DataForSEO** — `meter.record_seo` exists, but only some of the ~10 DFS call
   sites route through it; there is no user-facing SEO allowance.

Plans use raw resource caps (articles/images/keywords/seats) and internal
`cost_micros`, but never implemented the **credit** abstraction the reseller
spec defined. Starter is also too generous (3 projects / 3 seats).

## Goals

- Meter image-gen, Replicate, and all DataForSEO usage into the ledger.
- Introduce two user-facing spend meters: **AI credits** and **SEO credits**.
- Reduce plans (Starter → 1 project, 1 seat); hold ~70% margin across tiers.
- Hard-stop every plan at 100% of either bucket; warn at 80%.
- Surface the live balance in the customer app header bar.

## Non-goals (this iteration)

- Pay-as-you-go overage / credit packs (spec §2.9) — deferred; hard-stop only.
- BYOK discounts, annual pricing changes, Stripe price re-provisioning.
- Per-model band multipliers (cheap/standard/premium) — credits are pure
  cost-based here; band routing is a separate concern.

---

## 1. Credit model (cost-based, two buckets)

Money stays in **micro-dollars** (`$1 = 1_000_000`), as today.

- **AI credit:** `AI_CREDIT_MICROS = 10_000` → **1 AI credit ≡ $0.01 of supplier
  cost**. For any AI action, `credits = cost_micros / AI_CREDIT_MICROS`
  (fractional; the running counter stores hundredths as an integer of
  milli-credits — see §3). The AI bucket aggregates `kind ∈ {llm, image, edit}`.
  - Examples: gpt-4o-mini turn (~$0.002) ≈ 0.2 cr · gpt-image-1 medium ($0.06)
    = 6 cr · gpt-image-1 hd ($0.25) = 25 cr · Replicate background-removal
    (~$0.01) = 1 cr.
- **SEO credit:** one **DataForSEO billable task** = 1 SEO credit by default;
  heavier endpoints are weighted by `SEO_CREDIT_WEIGHT` (below). The SEO bucket
  is `kind = seo`. SEO tasks are cheap (~$0.0006–0.003), so SEO credits barely
  affect COGS and can be granted generously.

```python
# app/core/credits.py  (new)
AI_CREDIT_MICROS = 10_000          # $0.01 per AI credit

def ai_credits_from_micros(cost_micros: int) -> int:
    """Milli-credits (credits * 1000), stored as int for exact accumulation."""
    return round(cost_micros * 1000 / AI_CREDIT_MICROS)   # micros/10 -> milli-credits

# 1 SEO credit == 1 standard DFS task; pricier endpoints weighted up.
SEO_CREDIT_WEIGHT: dict[str, int] = {
    "serp": 1,
    "keyword_ideas": 1,
    "keyword_analysis": 1,
    "audit": 5,          # on-page / full-site audit
    "backlinks": 3,
    "rank_check": 1,
}
def seo_credits_for(unit: str, count: int) -> int:
    return count * SEO_CREDIT_WEIGHT.get(unit, 1)
```

**Why milli-credits internally:** a single gpt-4o-mini call is ~0.2 credits;
storing whole credits would round every small call to 0 and never charge. The
running counter is milli-credits (integer); the UI divides by 1000 for display.
Limits in `PLAN_LIMITS` are whole credits; enforcement compares
`used_milli / 1000` against the whole-credit allowance.

---

## 2. Data model

### 2.1 `usage_events.kind`
Extend the allowed values from `{llm, seo}` to `{llm, image, edit, seo}`. Column
is already `String(10)`; no DDL change, just documentation + producers.

### 2.2 `OrgUsage` (new columns)
```python
ai_credits_used:  Mapped[int] = mapped_column(BigInteger, default=0)  # milli-credits
seo_credits_used: Mapped[int] = mapped_column(Integer,    default=0)  # whole credits
```
Incremented inside the same `_bump_org_usage` upsert that already runs per meter
call (so they stay consistent with `cost_micros`).

### 2.3 `PLAN_LIMITS` (new keys)
Add `ai_credits` and `seo_credits` (whole credits) to every tier. See §4.

### 2.4 `cost_rate` (new rows, via seed + migration data)
| provider | unit | model | micro_dollars_per_unit | notes |
|---|---|---|---|---|
| openai | image | gpt-image-1 | (per-call, see below) | image priced from the size/quality the service already resolves |
| replicate | run | `<model-slug>` | e.g. 10_000 ($0.01) | per Replicate model; default fallback row `replicate/run/` |
| dataforseo | audit | "" | actual | for SEO weight >1 endpoints |

Image cost is **not** a single flat rate — `generate_image_dalle` already
computes `cost_usd` from size+quality. `record_image` takes that `cost_usd`
directly (authoritative), so no per-size cost_rate row is needed; the
`openai/image` row exists only as a documented fallback when a caller lacks a
computed cost.

### 2.5 Migration
`alembic revision` (random id): add the two `OrgUsage` columns + the `ai_credits`
/`seo_credits` plan-limit rows are code constants (no DB). Data backfill: see §8.

---

## 3. Metering the three gaps

All three follow the **proven ambient pattern** (`app/core/metering_context.py`):
the org id is already stashed at the auth boundary and at every provider-key
resolution, so the service chokepoint can attribute usage without threading a
`meter` dict through every caller. Recording uses a fresh
`async_session_factory()` session wrapped in `try/except` so metering never
breaks the user action.

### 3.1 `meter.record_image`
```python
async def record_image(db, *, org_id, project_id, model: str,
                       cost_usd: float, feature: str | None = None) -> int:
    cost = round(cost_usd * 1_000_000)
    db.add(UsageEvent(org_id=org_id, project_id=project_id, kind="image",
                      provider="openai", model=model, feature=feature,
                      cost_micros=cost))
    await _bump_org_usage(db, org_id, cost_micros=cost,
                          ai_credits=ai_credits_from_micros(cost))
    await db.commit()
    return cost
```
Called at the end of `image_service.generate_image_dalle` on success, resolving
`org_id` from `get_metering_org()` (best-effort; skip if unset).

### 3.2 `meter.record_replicate`
```python
async def record_replicate(db, *, org_id, project_id, model: str,
                           feature: str | None = None) -> int:
    cost = round(await rate(db, "replicate", "run", model))  # falls back to default row
    db.add(UsageEvent(..., kind="edit", provider="replicate", model=model,
                      feature=feature, cost_micros=cost))
    await _bump_org_usage(db, org_id, cost_micros=cost,
                          ai_credits=ai_credits_from_micros(cost))
    await db.commit()
    return cost
```
Called inside `editing_service._replicate_run` (the single Replicate chokepoint),
org from ambient context.

### 3.3 DataForSEO coverage
Route every DFS call through the provider registry / `serp_service` chokepoint so
each billable task calls `record_seo` (already exists) with the right `unit`.
`record_seo` additionally bumps `seo_credits_used` by `seo_credits_for(unit,
count)`. Audit the ~10 call sites (discovery, oasis, analytics, rank_tracking,
checks, serp, competitors, synthesis) and ensure none bypass it.

### 3.4 `_bump_org_usage` extension
Add `ai_credits` and `seo_credits` to the increment kwargs it already accepts, so
`record_llm` also credits the AI bucket:
`record_llm` → `ai_credits=ai_credits_from_micros(cost)`.

---

## 4. Plan lineup (approved)

| resource | Free | Starter $29 | Pro $99 | Agency $299 | Scale $799 |
|---|---|---|---|---|---|
| projects | 1 | **1** | 5 | 15 | 50 |
| seats | 1 | **1** | 3 | 10 | 25 |
| **ai_credits** / mo | 50 | 800 | 2,700 | 8,500 | 22,000 |
| **seo_credits** / mo | 20 | 300 | 1,500 | 4,000 | 12,000 |
| articles *(fair-use)* | 4 | 25 | 120 | 500 | -1 |
| images *(fair-use)* | 5 | 40 | 200 | 800 | -1 |
| social *(fair-use)* | 10 | 50 | 200 | -1 | -1 |
| keywords *(fair-use)* | 50 | 500 | 2,500 | 10,000 | 40,000 |
| brand_voices | 1 | 3 | 10 | -1 | -1 |
| audits | 1 | 5 | 20 | -1 | -1 |
| backlinks | 1 | 5 | 20 | -1 | -1 |

**Margin check (~70%, COGS = ai_credits × $0.01 + seo_credits × ~$0.002):**
Starter $29 → $8.6 (70%) · Pro $99 → $30 (70%) · Agency $299 → $93 (69%) ·
Scale $799 → $244 (69%). `PLAN_PRICE_USD` is unchanged (0/29/99/299/799).

`-1` = unlimited (fair-use). Credit buckets are never `-1` — they are the
governing meter and must always be finite.

---

## 5. Enforcement (hard-stop, all plans)

New dependency in `app/core/billing.py`, same shape as `check_usage_limit`:

```python
def require_credits(bucket: Literal["ai", "seo"]):
    async def _dep(response, current_user, db):
        used, limit = await current_credits(db, org_id, bucket)   # used in whole credits
        if limit != -1 and used >= limit:
            raise HTTPException(429, detail={"error": "credit_limit_reached",
                                             "bucket": bucket, "used": used, "limit": limit})
        if limit and used / limit >= 0.8:
            response.headers["X-Usage-Warning"] = json.dumps({"bucket": bucket, ...})
    return _dep
```

- `require_credits("ai")` guards AI-consuming endpoints (article gen, image gen,
  image editing, chat/agents).
- `require_credits("seo")` guards SEO endpoints (SERP, keyword research, audits,
  rank tracking, backlinks).
- Pre-check semantics match today's model: a request may start if the bucket is
  below 100%; it can push slightly over, then the next request blocks. Acceptable
  for hard-stop; exact per-request reservation is out of scope.

---

## 6. Header balance (customer app, `apps/web`) — new

### 6.1 Endpoint
Extend the existing usage summary (`GET /api/v1/billing/usage` or equivalent) to
include:
```json
"ai_credits":  { "used": 620, "limit": 800 },
"seo_credits": { "used": 90,  "limit": 300 }
```
(`used` in whole credits — milli-credits / 1000, rounded.)

### 6.2 UI
A compact **CreditMeter** widget in the app header (`components/layout/`):
- Two small meters: `AI 620/800` and `SEO 90/300`, each a slim progress bar.
- Neutral < 80%, amber ≥ 80%, red ≥ 100%. Tooltip shows remaining + reset date.
- Click → billing/usage page.
- Built with **ui-ux-pro-max** guidance, CSS-variable tokens only (no hard-coded
  colors), all strings via `t()`, data via `apiClient` + TanStack Query (short
  `staleTime`, refetch on window focus so it feels live).
- Responsive: collapses to a single "620 AI · 90 SEO" chip on narrow headers.

---

## 7. Admin & analytics

The admin billing/analytics cluster already aggregates `cost_micros` and
`usage_daily`; image/replicate/DFS now flow in automatically once metered. Add:
- `ai_credits` / `seo_credits` (used vs. limit) columns to the admin org usage /
  org-detail view.
- The provider/model analytics will now show `openai:gpt-image-1` and
  `replicate:*` rows for free (no new endpoint).

---

## 8. Migration & backfill

1. Alembic migration (random revision id, chained on current head): add
   `OrgUsage.ai_credits_used` (BigInteger) and `OrgUsage.seo_credits_used`
   (Integer), default 0.
2. **Backfill** current-period balances so meters are correct on deploy: for the
   current billing period, per org, sum `usage_events` into the two counters —
   `ai_credits_used = Σ ai_credits_from_micros(cost_micros)` over
   `kind ∈ {llm,image,edit}`; `seo_credits_used = Σ seo_credits_for(seo_unit,
   seo_count)` over `kind = seo`. Runnable as a one-off script / data migration.
3. Seed `cost_rate` rows for `replicate/run/*` and the `openai/image` fallback.

---

## 9. Testing

- **Unit:** `ai_credits_from_micros` / `seo_credits_for` conversions; margin table
  invariant (each tier's COGS ≤ 30% of price).
- **Metering:** `record_image` / `record_replicate` write a `usage_event` with the
  right `kind` + `cost_micros` and bump `ai_credits_used` (ambient-context test,
  same harness as `test_metering_wired.py`).
- **DFS coverage:** each DFS chokepoint records an `seo` event + bumps
  `seo_credits_used`.
- **Enforcement:** `require_credits` returns 429 at ≥100% for a Free/Starter org;
  sets `X-Usage-Warning` at ≥80%; allows below.
- **Backfill:** given seeded `usage_events`, the backfill produces the expected
  per-org counters.
- **Endpoint:** usage summary returns both buckets with correct used/limit.
- **Frontend:** admin + web typecheck/build; CreditMeter renders loading/empty/
  over-limit states.

Test conventions: host in-memory SQLite, `asyncio_mode="auto"`, per-file engine +
autouse `setup_db`, as in existing `apps/api/tests`.

---

## 10. Rollout order (informs the plan)

1. `credits.py` constants + conversions (pure, tested first).
2. `OrgUsage` columns + migration + `_bump_org_usage` extension.
3. `record_image`, `record_replicate`; wire into image + editing services.
4. DFS chokepoint coverage + `record_seo` SEO-credit bump.
5. `PLAN_LIMITS` restructure + `require_credits` enforcement.
6. Backfill script + `cost_rate` seed.
7. Usage-summary endpoint fields.
8. `apps/web` CreditMeter header widget.
9. Admin org-usage credit columns.
