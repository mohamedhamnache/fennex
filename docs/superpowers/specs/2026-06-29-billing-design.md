# Fennex Billing System — Design Spec

**Date:** 2026-06-29
**Status:** Approved

## Goal

Implement a full subscription billing system using Stripe Checkout + Customer Portal. Users subscribe to a tier, usage is tracked monthly, limits are enforced with a warn-at-80%/block-at-100% hybrid, and excess data is locked (not deleted) on downgrade.

---

## 1. Plan Tiers & Limits

| Limit | Free | Starter | Pro | Agency |
|-------|------|---------|-----|--------|
| Projects | 1 | 5 | 10 | 100 |
| Articles / month | 4 | 20 | 40 | 400 |
| Image generations / month | 5 | 50 | 150 | unlimited |
| Keywords tracked (total) | 50 | 500 | 2 000 | unlimited |
| Social posts / month | 10 | 50 | 200 | unlimited |
| Team seats | 1 | 3 | 10 | unlimited |
| Brand voices | 1 | 3 | 10 | unlimited |
| Backlink analyses / month | 1 | 5 | 20 | unlimited |
| Content audit runs / month | 1 | 5 | 20 | unlimited |

`-1` in code = unlimited (Agency tier).

### Pricing

| Tier | Monthly | Annual (20% off) |
|------|---------|-----------------|
| Free | $0 | — |
| Starter | $49/mo | $39/mo ($468/yr) |
| Pro | $99/mo | $79/mo ($948/yr) |
| Agency | $249/mo | $199/mo ($2,388/yr) |
| Enterprise | Custom | Custom |

**Trial:** 7 days free on any paid plan. Credit card is collected upfront via Stripe Checkout; the card is not charged until the trial ends. Trial is one-time per org (tracked via `trial_ends_at`) — cannot be restarted.

---

## 2. Architecture

```
Frontend (Next.js)
  ├── Settings › Billing tab     — pricing table, plan card, usage meters
  ├── UsageBanner                — sticky warning when any resource ≥80%
  └── UpgradeModal               — triggered on 429 LIMIT_REACHED

API (FastAPI)
  ├── POST /billing/checkout     — create Stripe Checkout session
  ├── POST /billing/portal       — create Stripe Customer Portal session
  ├── GET  /billing/usage        — current usage + limits for the org
  ├── POST /webhooks/stripe      — subscription lifecycle events
  └── check_usage_limit()        — dependency injected on guarded endpoints

Stripe (hosted, no custom payment UI)
  ├── 4 Products × 2 Prices (monthly + annual)
  ├── Checkout with trial_period_days=7
  └── Customer Portal (upgrade / downgrade / cancel / payment method)

Postgres
  ├── organizations              — plan_tier, stripe_*, trial_ends_at, plan_locked_at (2 new cols)
  ├── org_usage (new)            — monthly counters
  ├── subscription_events (new)  — Stripe webhook audit log
  └── projects, brand_voices, users — locked + locked_reason cols (new)
```

---

## 3. Data Model

### New table: `org_usage`

```sql
CREATE TABLE org_usage (
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    period_start    DATE NOT NULL,
    articles_used   INT NOT NULL DEFAULT 0,
    images_used     INT NOT NULL DEFAULT 0,
    social_used     INT NOT NULL DEFAULT 0,
    keywords_used   INT NOT NULL DEFAULT 0,  -- running total, not monthly
    audits_used     INT NOT NULL DEFAULT 0,
    backlinks_used  INT NOT NULL DEFAULT 0,
    PRIMARY KEY (org_id, period_start)
);
```

`period_start` is the first day of the billing cycle (e.g. `2026-06-01`). `keywords_used` is a running total (capacity limit, not monthly); all others reset each cycle.

### New table: `subscription_events`

```sql
CREATE TABLE subscription_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID REFERENCES organizations(id) ON DELETE SET NULL,
    stripe_event_id VARCHAR(255) UNIQUE NOT NULL,
    event_type      VARCHAR(100) NOT NULL,
    payload         JSONB NOT NULL,
    processed_at    TIMESTAMP NOT NULL DEFAULT now()
);
```

`stripe_event_id` is the idempotency key — duplicate webhook deliveries are silently ignored.

### Additions to `organizations`

```python
trial_ends_at:   Mapped[datetime | None]  # set on trial start, NULL if never trialled
plan_locked_at:  Mapped[datetime | None]  # set when downgrade locks excess data
```

### Additions to `projects`, `brand_voices`, `users`

```python
locked:        Mapped[bool] = False
locked_reason: Mapped[str | None]   # "downgrade" | "payment_failed"
```

### New env vars / settings

```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_STARTER_MONTHLY
STRIPE_PRICE_STARTER_ANNUAL
STRIPE_PRICE_PRO_MONTHLY
STRIPE_PRICE_PRO_ANNUAL
STRIPE_PRICE_AGENCY_MONTHLY
STRIPE_PRICE_AGENCY_ANNUAL
```

---

## 4. Stripe Integration

### Checkout

```
POST /billing/checkout  { price_id: str, success_url: str, cancel_url: str }
```

1. If org has no `stripe_customer_id`: `stripe.customers.create(email, metadata={org_id})` → save.
2. `stripe.checkout.sessions.create(customer, line_items, mode="subscription", trial_period_days=7 if org has never trialled else 0, success_url, cancel_url)`.
3. Return `{ checkout_url }`. Frontend redirects.

### Customer Portal

```
POST /billing/portal  { return_url: str }
```

1. `stripe.billing_portal.sessions.create(customer=org.stripe_customer_id, return_url)`.
2. Return `{ portal_url }`. Frontend redirects. Portal handles upgrades, downgrades, cancellations, and payment method changes.

### Webhook handler

`POST /webhooks/stripe` — replaces the current stub.

1. Verify `Stripe-Signature` header with `STRIPE_WEBHOOK_SECRET`. Return 400 on failure.
2. Insert into `subscription_events` with `stripe_event_id` as unique key. If conflict → return 200 (idempotent).
3. Dispatch by `event_type`:

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Link `stripe_customer_id` to org if not already set |
| `customer.subscription.created` | Set `plan_tier`; set `trial_ends_at` if `trial_end` present |
| `customer.subscription.updated` | Update `plan_tier`; trigger downgrade handler if tier lowered |
| `customer.subscription.deleted` | Set `plan_tier = FREE`; trigger downgrade handler |
| `invoice.payment_failed` | Set `locked_reason = "payment_failed"` on org; notify user (future) |

---

## 5. Usage Tracking & Limit Enforcement

### Plan limits constant (`app/core/billing.py`)

```python
PLAN_LIMITS: dict[str, dict[str, int]] = {
    "free":    {"projects": 1,   "articles": 4,   "images": 5,   "social": 10,  "keywords": 50,   "seats": 1,  "brand_voices": 1,  "audits": 1,  "backlinks": 1},
    "starter": {"projects": 5,   "articles": 20,  "images": 50,  "social": 50,  "keywords": 500,  "seats": 3,  "brand_voices": 3,  "audits": 5,  "backlinks": 5},
    "pro":     {"projects": 10,  "articles": 40,  "images": 150, "social": 200, "keywords": 2000, "seats": 10, "brand_voices": 10, "audits": 20, "backlinks": 20},
    "agency":  {"projects": 100, "articles": 400, "images": -1,  "social": -1,  "keywords": -1,   "seats": -1, "brand_voices": -1, "audits": -1, "backlinks": -1},
}
```

### Usage increment (called after each successful creation/generation)

```python
async def increment_usage(org_id: UUID, resource: str, db: AsyncSession) -> None:
    period = current_billing_period_start(org_id, db)
    stmt = insert(OrgUsage).values(org_id=org_id, period_start=period, **{f"{resource}_used": 1})
    stmt = stmt.on_conflict_do_update(
        index_elements=["org_id", "period_start"],
        set_={f"{resource}_used": OrgUsage.__table__.c[f"{resource}_used"] + 1}
    )
    await db.execute(stmt)
```

`current_billing_period_start()` returns the 1st of the current calendar month for all orgs (v1 simplification — usage always resets on the 1st regardless of Stripe billing anchor day).

### `check_usage_limit` dependency

```python
async def check_usage_limit(resource: str, org: Org, db: AsyncSession, response: Response):
    limit = PLAN_LIMITS[org.plan_tier][resource]
    if limit == -1:
        return
    used = await get_current_usage(org.id, resource, db)
    pct = used / limit
    if pct >= 1.0:
        raise HTTPException(429, detail={
            "code": "LIMIT_REACHED", "resource": resource, "used": used, "limit": limit
        })
    if pct >= 0.8:
        response.headers["X-Usage-Warning"] = json.dumps({
            "resource": resource, "used": used, "limit": limit, "pct": round(pct, 2)
        })
```

Injected on: `POST /articles/{id}/generate`, `POST /images/generate`, `POST /social-posts`, `POST /keywords/analyze`, `POST /audits`, `POST /backlinks/analyze`, `POST /projects`, `POST /brand-voices`, `POST /team/members`.

### Frontend response to usage signals

- **`X-Usage-Warning` header** on any API response → global `useUsageStore` Zustand atom updated → `UsageBanner` renders above `<main>`.
- **`429 LIMIT_REACHED`** → `UpgradeModal` shown instead of error toast. Modal shows which limit was hit, next tier comparison, and "Upgrade now →" CTA.

### `GET /billing/usage` response

```typescript
interface BillingUsage {
  plan_tier: string;
  trial_ends_at: string | null;
  period_start: string;
  usage: Record<string, { used: number; limit: number; pct: number }>;
}
```

---

## 6. Downgrade & Lock Logic

Triggered by `customer.subscription.updated` (lower tier) or `customer.subscription.deleted` (→ Free).

```python
async def handle_downgrade(org: Organization, new_tier: str, db: AsyncSession) -> None:
    limits = PLAN_LIMITS[new_tier]

    # Projects — oldest kept, newest locked (ordered by created_at asc; slice keeps first N)
    if limits["projects"] != -1:
        projects = await get_org_projects_ordered(org.id, db)  # ORDER BY created_at ASC
        for p in projects[limits["projects"]:]:
            p.locked = True
            p.locked_reason = "downgrade"

    # Brand voices — oldest kept, newest locked
    if limits["brand_voices"] != -1:
        voices = await get_org_brand_voices_ordered(org.id, db)  # ORDER BY created_at ASC
        for v in voices[limits["brand_voices"]:]:
            v.locked = True
            v.locked_reason = "downgrade"

    # Team seats — owner always first (never locked), then oldest members kept, newest locked
    if limits["seats"] != -1:
        members = await get_org_members_ordered(org.id, db)  # owner first, then ORDER BY joined_at ASC
        for m in members[limits["seats"]:]:
            m.locked = True
            m.locked_reason = "downgrade"

    org.plan_locked_at = datetime.utcnow()
    await db.commit()
```

**Locked resource behaviour:**
- Locked projects/brand voices: read-only in UI, show lock badge, cannot generate content.
- Locked team members: cannot log in; see "Your seat has been removed, contact your admin."
- Locks are **automatically lifted** when the org upgrades back above the threshold (handled in `customer.subscription.updated` when new tier ≥ old tier).

---

## 7. Frontend — Billing Settings Tab

### Panel 1: Current plan card
- Tier name, monthly/annual price, next billing date (from Stripe).
- Trial countdown badge if `trial_ends_at` is in the future: "Trial ends in N days."
- "Manage plan →" button → `POST /billing/portal` → redirect.

### Panel 2: Usage meters
- One `<ProgressBar>` per resource.
- Colour: default → amber at ≥80% → red at 100%.
- Label: "38 / 40 articles this month".
- Data from `GET /billing/usage`, refetched every 60s.

### Panel 3: Pricing table
- Four tier cards with feature list, price, and CTA.
- Monthly / Annual toggle at top; annual shows "Save 20%".
- CTA states: "Current plan" (disabled) | "Upgrade →" (→ Checkout) | "Downgrade" (→ Portal).

### Global `UsageBanner`
Rendered in `app/(dashboard)/layout.tsx` above `<main>`. Reads from `useUsageStore`.
```
"You've used 38/40 articles this month — upgrade to Pro to keep writing."  [Upgrade →]
```
Dismissable per session; reappears after page reload.

### `UpgradeModal`
Full-screen overlay triggered on 429 response. Shows:
- Which limit was hit and current usage.
- Next tier name, price, and key limit increase.
- "Upgrade now →" (→ Checkout) and "Maybe later" (dismiss).

---

## 8. Testing

**API:**
- Unit: `check_usage_limit` — 0%, 79%, 80%, 100%, unlimited (-1).
- Unit: `handle_downgrade` — projects locked in correct order; owner seat preserved.
- Unit: webhook handler — idempotency (duplicate event → 200, no double-write).
- Integration: full Checkout → webhook → `plan_tier` update flow using Stripe test mode + `stripe trigger`.

**Frontend:**
- `UsageBanner` renders at ≥80%, hides at <80%.
- `UpgradeModal` renders on 429, dismiss works.
- Billing tab: pricing table renders correct CTA per tier state.

---

## Non-Goals (this phase)

- Metered / overage billing (pay per article beyond limit).
- Invoice PDF download in-app (Stripe portal handles this).
- Enterprise custom contracts (manual Stripe setup for now).
- Email notifications for payment failure (stub only).
- Usage analytics dashboard (aggregate spend / usage history).
