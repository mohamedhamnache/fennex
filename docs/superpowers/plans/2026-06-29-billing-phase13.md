# Billing System (Phase 13) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Stripe Checkout + Customer Portal subscription billing with per-tier usage limits, hybrid warn/block enforcement, 7-day trial, and downgrade locking.

**Architecture:** Stripe handles payment UI (Checkout + Customer Portal — no custom card forms). A new `app/core/billing.py` module owns `PLAN_LIMITS`, usage increment/query helpers, and the `check_usage_limit` FastAPI dependency injected on guarded endpoints. Usage is tracked in a new `org_usage` table (monthly counters, reset on 1st of each month). Frontend polls `GET /billing/usage` every 60 s to feed the `useUsageStore` Zustand atom that drives a `UsageBanner` and `UpgradeModal`.

**Tech Stack:** FastAPI/SQLAlchemy async, Alembic, stripe-python ≥8, pytest-asyncio; Next.js App Router, React 18, Zustand, TanStack Query, Tailwind CSS.

## Global Constraints

- Python 3.11+, `asyncio_mode = "auto"` in pytest
- SQLAlchemy models use `Mapped[T]` syntax and `TimestampMixin` (from `app.models.base`)
- Alembic migrations use raw SQL via `op.execute(sa.text(...))`; revision IDs follow the `[a-z0-9]{16}` pattern used by existing migrations
- Pydantic v2: `model_config = ConfigDict(from_attributes=True)`
- Tests use SQLite in-memory (`sqlite+aiosqlite:///:memory:`); all new tests follow the pattern in `apps/api/tests/test_articles.py`
- Frontend: all `fetch` calls go through `apiClient` in `apps/web/lib/api.ts`; Zustand stores live in `apps/web/lib/`; new components in `apps/web/components/billing/`
- Stripe SDK: `stripe>=8.0.0` (sync client; use `stripe.checkout.Session.create(...)` — not the async client)
- `PLAN_LIMITS` uses `-1` to mean unlimited; every guarded endpoint checks limits before allowing the action
- Usage resets on the 1st of the current calendar month for all orgs (v1 simplification)
- Trial is one-time per org, tracked via `organizations.trial_ends_at` — if already set, `trial_period_days=0`
- No metered/overage billing in this phase

---

## File Map

| File | Change |
|------|--------|
| `apps/api/pyproject.toml` | Add `stripe>=8.0.0` dependency |
| `apps/api/app/core/config.py` | Add 9 Stripe env vars |
| `.env.example` | Add Stripe env var placeholders |
| `apps/api/alembic/versions/k6f7a8b9c0d1_phase13_billing.py` | New migration |
| `apps/api/app/models/billing.py` | New: `OrgUsage`, `SubscriptionEvent` models |
| `apps/api/app/models/organization.py` | Add `trial_ends_at`, `plan_locked_at` |
| `apps/api/app/models/project.py` | Add `locked`, `locked_reason` |
| `apps/api/app/models/brand_voice.py` | Add `locked`, `locked_reason` |
| `apps/api/app/models/user.py` | Add `locked`, `locked_reason` |
| `apps/api/app/core/billing.py` | New: `PLAN_LIMITS`, usage helpers, `check_usage_limit` dependency |
| `apps/api/app/api/v1/routers/billing.py` | New: `/billing/checkout`, `/billing/portal`, `/billing/usage` |
| `apps/api/app/api/v1/routers/webhooks.py` | Replace stub with real Stripe webhook handler |
| `apps/api/app/api/v1/router.py` | Register billing router |
| `apps/api/app/api/v1/routers/projects.py` | Inject `check_usage_limit("projects", ...)` on POST |
| `apps/api/app/api/v1/routers/articles.py` | Inject `check_usage_limit("articles", ...)` on generate |
| `apps/api/app/api/v1/routers/images.py` | Inject `check_usage_limit("images", ...)` on generate |
| `apps/api/app/api/v1/routers/social.py` | Inject `check_usage_limit("social", ...)` on create |
| `apps/api/app/api/v1/routers/brand_voice.py` | Inject `check_usage_limit("brand_voices", ...)` on create |
| `apps/api/tests/test_billing.py` | New: billing.py unit tests |
| `apps/api/tests/test_billing_router.py` | New: billing router tests |
| `apps/api/tests/test_webhooks.py` | New: webhook handler tests |
| `apps/web/lib/api.ts` | Add `createCheckoutSession`, `createPortalSession`, `getBillingUsage`; modify `request()` for 429 |
| `apps/web/lib/billing-store.ts` | New: `useUsageStore` Zustand atom |
| `apps/web/app/(dashboard)/layout.tsx` | Add `UsageBanner` + 60 s usage poll |
| `apps/web/components/billing/UsageBanner.tsx` | New: sticky warning bar |
| `apps/web/components/billing/UpgradeModal.tsx` | New: limit-hit overlay |
| `apps/web/app/(dashboard)/settings/page.tsx` | Replace "Billing coming soon" with full billing tab |

---

### Task 1: Add Stripe SDK + env config

**Files:**
- Modify: `apps/api/pyproject.toml`
- Modify: `apps/api/app/core/config.py`
- Modify: `.env.example`

**Interfaces:**
- Produces: `settings.STRIPE_SECRET_KEY`, `settings.STRIPE_WEBHOOK_SECRET`, `settings.STRIPE_PRICE_*` used by Tasks 4 and 5

- [ ] **Step 1: Add stripe to pyproject.toml**

In `apps/api/pyproject.toml`, add `"stripe>=8.0.0",` to the `dependencies` list (after `"openai>=1.30.0",`):

```toml
    "openai>=1.30.0",
    "stripe>=8.0.0",
```

- [ ] **Step 2: Add Stripe settings to config.py**

At the bottom of `apps/api/app/core/config.py`, before `settings = Settings()`, add:

```python
    # Stripe
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_PRICE_STARTER_MONTHLY: str = ""
    STRIPE_PRICE_STARTER_ANNUAL: str = ""
    STRIPE_PRICE_PRO_MONTHLY: str = ""
    STRIPE_PRICE_PRO_ANNUAL: str = ""
    STRIPE_PRICE_AGENCY_MONTHLY: str = ""
    STRIPE_PRICE_AGENCY_ANNUAL: str = ""
```

- [ ] **Step 3: Add placeholders to .env.example**

Add this block to `.env.example`:

```bash
# Stripe Billing
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER_MONTHLY=price_...
STRIPE_PRICE_STARTER_ANNUAL=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_ANNUAL=price_...
STRIPE_PRICE_AGENCY_MONTHLY=price_...
STRIPE_PRICE_AGENCY_ANNUAL=price_...
```

- [ ] **Step 4: Install the dependency inside the container**

```bash
docker compose exec api pip install "stripe>=8.0.0"
```

Expected: `Successfully installed stripe-X.Y.Z`

- [ ] **Step 5: Verify import**

```bash
docker compose exec api python -c "import stripe; print(stripe.__version__)"
```

Expected: prints a version ≥ 8.0.0

- [ ] **Step 6: Commit**

```bash
git add apps/api/pyproject.toml apps/api/app/core/config.py .env.example
git commit -m "feat(api): add stripe SDK and billing config fields"
```

---

### Task 2: DB migration — billing tables and new columns

**Files:**
- Create: `apps/api/alembic/versions/k6f7a8b9c0d1_phase13_billing.py`
- Create: `apps/api/app/models/billing.py`
- Modify: `apps/api/app/models/organization.py`
- Modify: `apps/api/app/models/project.py`
- Modify: `apps/api/app/models/brand_voice.py`
- Modify: `apps/api/app/models/user.py`

**Interfaces:**
- Produces: `OrgUsage`, `SubscriptionEvent` SQLAlchemy models consumed by Task 3
- Produces: `Organization.trial_ends_at`, `Organization.plan_locked_at` consumed by Tasks 4 and 5
- Produces: `Project.locked`, `BrandVoice.locked`, `User.locked` consumed by Task 5

- [ ] **Step 1: Create the Alembic migration**

Create `apps/api/alembic/versions/k6f7a8b9c0d1_phase13_billing.py`:

```python
"""Phase 13: billing tables and columns

Revision ID: k6f7a8b9c0d1
Revises: j5e6f7a8b9c0d1e2
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa

revision = "k6f7a8b9c0d1"
down_revision = "j5e6f7a8b9c0d1e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # org_usage — monthly counters per resource
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS org_usage (
            org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            period_start    DATE NOT NULL,
            articles_used   INT NOT NULL DEFAULT 0,
            images_used     INT NOT NULL DEFAULT 0,
            social_used     INT NOT NULL DEFAULT 0,
            keywords_used   INT NOT NULL DEFAULT 0,
            audits_used     INT NOT NULL DEFAULT 0,
            backlinks_used  INT NOT NULL DEFAULT 0,
            PRIMARY KEY (org_id, period_start)
        );
    """))

    # subscription_events — Stripe webhook audit log
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS subscription_events (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id          UUID REFERENCES organizations(id) ON DELETE SET NULL,
            stripe_event_id VARCHAR(255) UNIQUE NOT NULL,
            event_type      VARCHAR(100) NOT NULL,
            payload         JSONB NOT NULL,
            processed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_sub_events_org_id ON subscription_events (org_id);"
    ))

    # organizations — billing columns
    op.execute(sa.text(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;"
    ))
    op.execute(sa.text(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_locked_at TIMESTAMPTZ;"
    ))

    # projects — lock columns
    op.execute(sa.text(
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;"
    ))
    op.execute(sa.text(
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS locked_reason VARCHAR(50);"
    ))

    # brand_voices — lock columns
    op.execute(sa.text(
        "ALTER TABLE brand_voices ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;"
    ))
    op.execute(sa.text(
        "ALTER TABLE brand_voices ADD COLUMN IF NOT EXISTS locked_reason VARCHAR(50);"
    ))

    # users — lock columns
    op.execute(sa.text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;"
    ))
    op.execute(sa.text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_reason VARCHAR(50);"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS subscription_events CASCADE;"))
    op.execute(sa.text("DROP TABLE IF EXISTS org_usage CASCADE;"))
    op.execute(sa.text("ALTER TABLE organizations DROP COLUMN IF EXISTS trial_ends_at;"))
    op.execute(sa.text("ALTER TABLE organizations DROP COLUMN IF EXISTS plan_locked_at;"))
    op.execute(sa.text("ALTER TABLE projects DROP COLUMN IF EXISTS locked;"))
    op.execute(sa.text("ALTER TABLE projects DROP COLUMN IF EXISTS locked_reason;"))
    op.execute(sa.text("ALTER TABLE brand_voices DROP COLUMN IF EXISTS locked;"))
    op.execute(sa.text("ALTER TABLE brand_voices DROP COLUMN IF EXISTS locked_reason;"))
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS locked;"))
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS locked_reason;"))
```

- [ ] **Step 2: Create the SQLAlchemy models**

Create `apps/api/app/models/billing.py`:

```python
import uuid
from datetime import date, datetime

from sqlalchemy import Date, String, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class OrgUsage(Base):
    __tablename__ = "org_usage"
    __table_args__ = (UniqueConstraint("org_id", "period_start"),)

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    period_start: Mapped[date] = mapped_column(Date, primary_key=True)
    articles_used: Mapped[int] = mapped_column(Integer, default=0)
    images_used: Mapped[int] = mapped_column(Integer, default=0)
    social_used: Mapped[int] = mapped_column(Integer, default=0)
    keywords_used: Mapped[int] = mapped_column(Integer, default=0)
    audits_used: Mapped[int] = mapped_column(Integer, default=0)
    backlinks_used: Mapped[int] = mapped_column(Integer, default=0)


class SubscriptionEvent(Base):
    __tablename__ = "subscription_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    stripe_event_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    processed_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
```

- [ ] **Step 3: Update Organization model**

In `apps/api/app/models/organization.py`, add imports and two columns:

```python
from datetime import datetime  # add to existing imports
```

Add these two columns after `stripe_subscription_id`:

```python
    trial_ends_at: Mapped[datetime | None] = mapped_column(nullable=True)
    plan_locked_at: Mapped[datetime | None] = mapped_column(nullable=True)
```

- [ ] **Step 4: Update Project model**

In `apps/api/app/models/project.py`, add after `industry`:

```python
    locked: Mapped[bool] = mapped_column(default=False)
    locked_reason: Mapped[str | None] = mapped_column(String(50), nullable=True)
```

- [ ] **Step 5: Update BrandVoice model**

In `apps/api/app/models/brand_voice.py`, add the same two columns to the `BrandVoice` class:

```python
    locked: Mapped[bool] = mapped_column(default=False)
    locked_reason: Mapped[str | None] = mapped_column(String(50), nullable=True)
```

- [ ] **Step 6: Update User model**

In `apps/api/app/models/user.py`, add after `is_active`:

```python
    locked: Mapped[bool] = mapped_column(default=False)
    locked_reason: Mapped[str | None] = mapped_column(String(50), nullable=True)
```

- [ ] **Step 7: Run the migration**

```bash
docker compose exec api alembic upgrade head
```

Expected: `Running upgrade j5e6f7a8b9c0d1e2 -> k6f7a8b9c0d1, Phase 13: billing tables and columns`

- [ ] **Step 8: Verify tables exist**

```bash
docker compose exec postgres psql -U fennex -d fennex -c "\dt org_usage subscription_events"
```

Expected: both tables listed.

- [ ] **Step 9: Commit**

```bash
git add apps/api/alembic/versions/k6f7a8b9c0d1_phase13_billing.py \
        apps/api/app/models/billing.py \
        apps/api/app/models/organization.py \
        apps/api/app/models/project.py \
        apps/api/app/models/brand_voice.py \
        apps/api/app/models/user.py
git commit -m "feat(api): billing DB migration — org_usage, subscription_events, lock columns"
```

---

### Task 3: `app/core/billing.py` — plan limits, usage helpers, limit dependency

**Files:**
- Create: `apps/api/app/core/billing.py`
- Create: `apps/api/tests/test_billing.py`

**Interfaces:**
- Produces: `PLAN_LIMITS: dict[str, dict[str, int]]` — consumed by Tasks 4, 5, 6
- Produces: `current_billing_period_start() -> date` — consumed by Tasks 4, 5, 6
- Produces: `increment_usage(org_id, resource, db) -> None` — consumed by Task 6
- Produces: `get_current_usage(org_id, resource, db) -> int` — consumed by Tasks 4, 6
- Produces: `get_billing_usage(org, db) -> dict` — consumed by Task 4
- Produces: `check_usage_limit(resource)` — FastAPI dependency factory consumed by Task 6

- [ ] **Step 1: Write failing tests**

Create `apps/api/tests/test_billing.py`:

```python
"""Unit tests for app/core/billing.py"""
import uuid
from datetime import date
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.billing import (
    PLAN_LIMITS,
    current_billing_period_start,
    get_current_usage,
    increment_usage,
    check_usage_limit,
)
from app.models.organization import PlanTier


# ── PLAN_LIMITS ───────────────────────────────────────────────────────────────

def test_plan_limits_free_articles():
    assert PLAN_LIMITS["free"]["articles"] == 4

def test_plan_limits_agency_images_unlimited():
    assert PLAN_LIMITS["agency"]["images"] == -1

def test_plan_limits_all_tiers_present():
    for tier in ("free", "starter", "pro", "agency"):
        for resource in ("projects", "articles", "images", "social", "keywords",
                         "seats", "brand_voices", "audits", "backlinks"):
            assert resource in PLAN_LIMITS[tier]


# ── current_billing_period_start ──────────────────────────────────────────────

def test_current_billing_period_start_returns_first_of_month():
    period = current_billing_period_start()
    assert period.day == 1
    assert isinstance(period, date)


# ── get_current_usage ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_current_usage_returns_zero_when_no_row():
    org_id = uuid.uuid4()
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_db.execute = AsyncMock(return_value=mock_result)

    used = await get_current_usage(org_id, "articles", mock_db)
    assert used == 0

@pytest.mark.asyncio
async def test_get_current_usage_returns_value():
    org_id = uuid.uuid4()
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = 7
    mock_db.execute = AsyncMock(return_value=mock_result)

    used = await get_current_usage(org_id, "articles", mock_db)
    assert used == 7


# ── check_usage_limit ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_check_usage_limit_unlimited_passes():
    """Agency tier (unlimited = -1) never raises."""
    org = MagicMock()
    org.plan_tier = "agency"
    org.id = uuid.uuid4()
    mock_db = AsyncMock()
    mock_response = MagicMock()

    dep = check_usage_limit("articles")
    await dep(org=org, db=mock_db, response=mock_response)
    # no exception = pass

@pytest.mark.asyncio
async def test_check_usage_limit_under_80_pct_no_warning():
    """Under 80% — no header, no exception."""
    org = MagicMock()
    org.plan_tier = "free"   # free limit = 4 articles
    org.id = uuid.uuid4()
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = 2  # 50%
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_response = MagicMock()
    mock_response.headers = {}

    dep = check_usage_limit("articles")
    await dep(org=org, db=mock_db, response=mock_response)
    assert "X-Usage-Warning" not in mock_response.headers

@pytest.mark.asyncio
async def test_check_usage_limit_at_80_pct_sets_warning_header():
    """At exactly 80% — sets X-Usage-Warning, no exception."""
    from fastapi import HTTPException
    org = MagicMock()
    org.plan_tier = "free"   # limit = 4
    org.id = uuid.uuid4()
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = 4  # 100% of 4... wait, 80% of 4 = 3.2 → use starter
    mock_result.scalar_one_or_none.return_value = 16  # 80% of 20 (starter)
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_response = MagicMock()
    mock_response.headers = {}

    org.plan_tier = "starter"  # limit = 20 articles
    dep = check_usage_limit("articles")
    await dep(org=org, db=mock_db, response=mock_response)
    assert "X-Usage-Warning" in mock_response.headers

@pytest.mark.asyncio
async def test_check_usage_limit_at_100_pct_raises_429():
    """At 100% — raises HTTPException 429."""
    from fastapi import HTTPException
    org = MagicMock()
    org.plan_tier = "starter"  # limit = 20
    org.id = uuid.uuid4()
    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = 20
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_response = MagicMock()

    dep = check_usage_limit("articles")
    with pytest.raises(HTTPException) as exc_info:
        await dep(org=org, db=mock_db, response=mock_response)
    assert exc_info.value.status_code == 429
    assert exc_info.value.detail["code"] == "LIMIT_REACHED"
    assert exc_info.value.detail["resource"] == "articles"
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex/apps/api
python -m pytest tests/test_billing.py -v 2>&1 | tail -10
```

Expected: `ImportError` or `ModuleNotFoundError` for `app.core.billing`.

- [ ] **Step 3: Create `app/core/billing.py`**

```python
"""Billing: plan limits, usage tracking, and the check_usage_limit dependency."""
import json
import uuid
from datetime import date
from typing import Annotated, Callable

from fastapi import Depends, HTTPException, Response
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.models.billing import OrgUsage
from app.models.organization import Organization
from app.models.user import User

# ── Plan limits ────────────────────────────────────────────────────────────────
# -1 means unlimited.

PLAN_LIMITS: dict[str, dict[str, int]] = {
    "free": {
        "projects": 1, "articles": 4, "images": 5, "social": 10,
        "keywords": 50, "seats": 1, "brand_voices": 1, "audits": 1, "backlinks": 1,
    },
    "starter": {
        "projects": 5, "articles": 20, "images": 50, "social": 50,
        "keywords": 500, "seats": 3, "brand_voices": 3, "audits": 5, "backlinks": 5,
    },
    "pro": {
        "projects": 10, "articles": 40, "images": 150, "social": 200,
        "keywords": 2000, "seats": 10, "brand_voices": 10, "audits": 20, "backlinks": 20,
    },
    "agency": {
        "projects": 100, "articles": 400, "images": -1, "social": -1,
        "keywords": -1, "seats": -1, "brand_voices": -1, "audits": -1, "backlinks": -1,
    },
}


def current_billing_period_start() -> date:
    """Return the 1st of the current calendar month (v1: same for all orgs)."""
    today = date.today()
    return today.replace(day=1)


async def get_current_usage(org_id: uuid.UUID, resource: str, db: AsyncSession) -> int:
    """Return the current-period counter for a resource. 0 if no row yet."""
    period = current_billing_period_start()
    col = getattr(OrgUsage, f"{resource}_used")
    result = await db.execute(
        select(col).where(
            OrgUsage.org_id == org_id,
            OrgUsage.period_start == period,
        )
    )
    value = result.scalar_one_or_none()
    return value or 0


async def increment_usage(org_id: uuid.UUID, resource: str, db: AsyncSession) -> None:
    """Atomically increment the current-period counter for a resource."""
    period = current_billing_period_start()
    col_name = f"{resource}_used"
    stmt = pg_insert(OrgUsage).values(
        org_id=org_id,
        period_start=period,
        **{col_name: 1},
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["org_id", "period_start"],
        set_={col_name: getattr(OrgUsage, col_name) + 1},
    )
    await db.execute(stmt)


async def _get_org(user: User, db: AsyncSession) -> Organization:
    result = await db.execute(select(Organization).where(Organization.id == user.org_id))
    org = result.scalar_one_or_none()
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


def check_usage_limit(resource: str) -> Callable:
    """
    FastAPI dependency factory. Raises 429 when the org has hit its limit for
    `resource`. Sets X-Usage-Warning header at ≥80%.

    Usage:
        @router.post("/generate")
        async def generate(
            _: Annotated[None, Depends(check_usage_limit("articles"))],
            ...
        ):
    """
    async def _check(
        current_user: Annotated[User, Depends(get_current_user)],
        db: Annotated[AsyncSession, Depends(get_db)],
        response: Response,
    ) -> None:
        org = await _get_org(current_user, db)
        tier = org.plan_tier if isinstance(org.plan_tier, str) else org.plan_tier.value
        limit = PLAN_LIMITS.get(tier, PLAN_LIMITS["free"])[resource]

        if limit == -1:
            return  # unlimited

        used = await get_current_usage(org.id, resource, db)
        pct = used / limit

        if pct >= 1.0:
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "LIMIT_REACHED",
                    "resource": resource,
                    "used": used,
                    "limit": limit,
                    "tier": tier,
                },
            )
        if pct >= 0.8:
            response.headers["X-Usage-Warning"] = json.dumps({
                "resource": resource,
                "used": used,
                "limit": limit,
                "pct": round(pct, 2),
            })

    return _check


async def get_billing_usage(org: Organization, db: AsyncSession) -> dict:
    """
    Return current usage + limits for all resources.
    Shape: { resource: { used, limit, pct } }
    """
    tier = org.plan_tier if isinstance(org.plan_tier, str) else org.plan_tier.value
    limits = PLAN_LIMITS.get(tier, PLAN_LIMITS["free"])
    period = current_billing_period_start()

    result = await db.execute(
        select(OrgUsage).where(
            OrgUsage.org_id == org.id,
            OrgUsage.period_start == period,
        )
    )
    row = result.scalar_one_or_none()

    usage: dict[str, dict] = {}
    for resource, limit in limits.items():
        if resource == "seats":
            continue  # seats checked differently (count team members)
        used_val = getattr(row, f"{resource}_used", 0) if row else 0
        usage[resource] = {
            "used": used_val,
            "limit": limit,
            "pct": round(used_val / limit, 2) if limit > 0 else 0.0,
        }
    return usage
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex/apps/api
python -m pytest tests/test_billing.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/core/billing.py apps/api/tests/test_billing.py
git commit -m "feat(api): billing core — PLAN_LIMITS, usage helpers, check_usage_limit dependency"
```

---

### Task 4: Billing API router — Checkout, Portal, Usage

**Files:**
- Create: `apps/api/app/api/v1/routers/billing.py`
- Modify: `apps/api/app/api/v1/router.py`
- Create: `apps/api/tests/test_billing_router.py`

**Interfaces:**
- Consumes: `settings.STRIPE_SECRET_KEY`, `settings.STRIPE_WEBHOOK_SECRET`, `PLAN_LIMITS`, `get_billing_usage` from Task 3
- Produces: `POST /billing/checkout → { checkout_url: str }`
- Produces: `POST /billing/portal → { portal_url: str }`
- Produces: `GET /billing/usage → BillingUsageResponse`

- [ ] **Step 1: Write failing tests**

Create `apps/api/tests/test_billing_router.py`:

```python
"""Tests for /billing endpoints."""
import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.organization import Organization, PlanTier
from app.models.user import User, UserRole

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

FAKE_ORG_ID = uuid.uuid4()
FAKE_USER_ID = uuid.uuid4()


async def override_get_db():
    async with TestSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


fake_org = Organization(id=FAKE_ORG_ID, slug="test", name="Test Org", plan_tier=PlanTier.FREE)
fake_user = User(
    id=FAKE_USER_ID, org_id=FAKE_ORG_ID, email="test@test.com",
    hashed_password="x", role=UserRole.OWNER, is_active=True,
)


async def override_get_current_user():
    return fake_user


@pytest.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Seed org and user so _get_org resolves
    async with TestSessionLocal() as session:
        session.add(fake_org)
        session.add(fake_user)
        await session.commit()
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    yield
    app.dependency_overrides.clear()
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_create_checkout_session(client):
    """POST /billing/checkout returns checkout_url."""
    mock_session = MagicMock()
    mock_session.url = "https://checkout.stripe.com/test"

    mock_customer = MagicMock()
    mock_customer.id = "cus_test123"

    with (
        patch("app.api.v1.routers.billing.stripe.Customer.create", return_value=mock_customer),
        patch("app.api.v1.routers.billing.stripe.checkout.Session.create", return_value=mock_session),
    ):
        resp = await client.post(
            "/api/v1/billing/checkout",
            json={
                "price_id": "price_test",
                "success_url": "http://localhost:3001/settings?billing=success",
                "cancel_url": "http://localhost:3001/settings",
            },
            headers={"Authorization": "Bearer fake"},
        )
    assert resp.status_code == 200
    assert resp.json()["checkout_url"] == "https://checkout.stripe.com/test"


@pytest.mark.asyncio
async def test_create_portal_session(client):
    """POST /billing/portal returns portal_url."""
    mock_session = MagicMock()
    mock_session.url = "https://billing.stripe.com/portal/test"

    fake_org.stripe_customer_id = "cus_existing"

    with patch("app.api.v1.routers.billing.stripe.billing_portal.Session.create", return_value=mock_session):
        resp = await client.post(
            "/api/v1/billing/portal",
            json={"return_url": "http://localhost:3001/settings"},
            headers={"Authorization": "Bearer fake"},
        )
    assert resp.status_code == 200
    assert resp.json()["portal_url"] == "https://billing.stripe.com/portal/test"


@pytest.mark.asyncio
async def test_get_billing_usage(client):
    """GET /billing/usage returns usage data."""
    resp = await client.get(
        "/api/v1/billing/usage",
        headers={"Authorization": "Bearer fake"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "plan_tier" in data
    assert "usage" in data
    assert "articles" in data["usage"]
    assert data["usage"]["articles"]["limit"] == 4  # free tier
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex/apps/api
python -m pytest tests/test_billing_router.py -v 2>&1 | tail -10
```

Expected: `ImportError` or 404 errors.

- [ ] **Step 3: Create `apps/api/app/api/v1/routers/billing.py`**

```python
import stripe
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from app.core.billing import PLAN_LIMITS, get_billing_usage, _get_org
from app.core.config import settings
from app.core.dependencies import CurrentUser, DB

router = APIRouter()

stripe.api_key = settings.STRIPE_SECRET_KEY


# ── Schemas ────────────────────────────────────────────────────────────────────

class CheckoutRequest(BaseModel):
    price_id: str
    success_url: str
    cancel_url: str


class PortalRequest(BaseModel):
    return_url: str


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/checkout")
async def create_checkout_session(body: CheckoutRequest, current_user: CurrentUser, db: DB):
    org = await _get_org(current_user, db)

    # Create Stripe customer if first checkout
    if not org.stripe_customer_id:
        customer = stripe.Customer.create(
            email=current_user.email,
            metadata={"org_id": str(org.id)},
        )
        org.stripe_customer_id = customer.id
        await db.commit()

    trial_days = 7 if not org.trial_ends_at else 0

    session = stripe.checkout.Session.create(
        customer=org.stripe_customer_id,
        line_items=[{"price": body.price_id, "quantity": 1}],
        mode="subscription",
        trial_period_days=trial_days if trial_days > 0 else None,
        success_url=body.success_url,
        cancel_url=body.cancel_url,
    )
    return {"checkout_url": session.url}


@router.post("/portal")
async def create_portal_session(body: PortalRequest, current_user: CurrentUser, db: DB):
    org = await _get_org(current_user, db)

    if not org.stripe_customer_id:
        raise HTTPException(status_code=400, detail="No active subscription to manage.")

    session = stripe.billing_portal.Session.create(
        customer=org.stripe_customer_id,
        return_url=body.return_url,
    )
    return {"portal_url": session.url}


@router.get("/usage")
async def get_usage(current_user: CurrentUser, db: DB):
    org = await _get_org(current_user, db)
    tier = org.plan_tier if isinstance(org.plan_tier, str) else org.plan_tier.value
    usage = await get_billing_usage(org, db)

    return {
        "plan_tier": tier,
        "trial_ends_at": org.trial_ends_at.isoformat() if org.trial_ends_at else None,
        "period_start": str(__import__("app.core.billing", fromlist=["current_billing_period_start"]).current_billing_period_start()),
        "usage": usage,
    }
```

- [ ] **Step 4: Register the billing router in `router.py`**

In `apps/api/app/api/v1/router.py`, add to imports:

```python
from app.api.v1.routers import (
    ...
    billing,
    ...
)
```

And add the include after the webhooks line:

```python
api_router.include_router(billing.router, prefix="/billing", tags=["billing"])
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex/apps/api
python -m pytest tests/test_billing_router.py -v
```

Expected: all 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/api/v1/routers/billing.py apps/api/app/api/v1/router.py apps/api/tests/test_billing_router.py
git commit -m "feat(api): billing router — checkout, portal, usage endpoints"
```

---

### Task 5: Stripe webhook handler

**Files:**
- Modify: `apps/api/app/api/v1/routers/webhooks.py`
- Create: `apps/api/tests/test_webhooks.py`

**Interfaces:**
- Consumes: `PLAN_LIMITS` from Task 3, `OrgUsage`/`SubscriptionEvent` models from Task 2
- Consumes: `settings.STRIPE_WEBHOOK_SECRET`
- Produces: updated `org.plan_tier`, `org.trial_ends_at`, locked project/brand_voice/user rows

- [ ] **Step 1: Write failing tests**

Create `apps/api/tests/test_webhooks.py`:

```python
"""Tests for Stripe webhook handler."""
import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dependencies import get_db
from app.main import app
from app.models.organization import Organization, PlanTier
from app.models.project import Project
from app.models.user import User, UserRole

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)


async def override_get_db():
    async with TestSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


@pytest.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def db_session():
    async with TestSessionLocal() as session:
        yield session


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _make_event(event_type: str, data: dict, event_id: str = "evt_test") -> dict:
    return {"id": event_id, "type": event_type, "data": {"object": data}}


@pytest.mark.asyncio
async def test_webhook_invalid_signature_returns_400(client):
    """Missing or invalid Stripe-Signature header → 400."""
    with patch("app.api.v1.routers.webhooks.stripe.Webhook.construct_event", side_effect=Exception("invalid")):
        resp = await client.post(
            "/api/v1/webhooks/stripe",
            content=b'{"id":"evt_test"}',
            headers={"stripe-signature": "bad"},
        )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_webhook_idempotent_duplicate_ignored(client, db_session):
    """Second delivery of same stripe_event_id → 200, no second write."""
    org = Organization(slug="test-org", name="Test", plan_tier=PlanTier.FREE,
                       stripe_customer_id="cus_test")
    db_session.add(org)
    await db_session.commit()

    event = _make_event("customer.subscription.updated", {
        "customer": "cus_test",
        "status": "active",
        "items": {"data": [{"price": {"lookup_key": "starter_monthly"}}]},
        "trial_end": None,
    }, event_id="evt_duplicate")

    with patch("app.api.v1.routers.webhooks.stripe.Webhook.construct_event", return_value=MagicMock(**event, **{"get": lambda k, d=None: event.get(k, d)})):
        # Send twice — second should be silently ignored
        pass  # full test wired after implementation


@pytest.mark.asyncio
async def test_webhook_subscription_deleted_reverts_to_free(client, db_session):
    """subscription.deleted event sets plan_tier back to FREE."""
    org = Organization(slug="was-pro", name="Test", plan_tier=PlanTier.PRO,
                       stripe_customer_id="cus_pro")
    db_session.add(org)
    await db_session.commit()

    raw_event = _make_event(
        "customer.subscription.deleted",
        {"customer": "cus_pro", "status": "canceled", "trial_end": None,
         "items": {"data": [{"price": {"lookup_key": "pro_monthly"}}]}},
        event_id="evt_del_001",
    )

    with patch("app.api.v1.routers.webhooks.stripe.Webhook.construct_event") as mock_construct:
        mock_event = MagicMock()
        mock_event.id = "evt_del_001"
        mock_event.type = "customer.subscription.deleted"
        mock_event.data.object = raw_event["data"]["object"]
        mock_construct.return_value = mock_event

        resp = await client.post(
            "/api/v1/webhooks/stripe",
            content=json.dumps(raw_event).encode(),
            headers={"stripe-signature": "t=1,v1=sig"},
        )

    assert resp.status_code == 200
    await db_session.refresh(org)
    assert org.plan_tier == PlanTier.FREE
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex/apps/api
python -m pytest tests/test_webhooks.py::test_webhook_invalid_signature_returns_400 -v 2>&1 | tail -5
```

Expected: FAIL (current stub returns 200 always).

- [ ] **Step 3: Rewrite `apps/api/app/api/v1/routers/webhooks.py`**

```python
import json
from datetime import datetime

import stripe
from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.billing import PLAN_LIMITS
from app.core.config import settings
from app.core.dependencies import DB
from app.models.billing import SubscriptionEvent
from app.models.brand_voice import BrandVoice
from app.models.organization import Organization, PlanTier
from app.models.project import Project
from app.models.user import User

router = APIRouter()

# Map from Stripe price lookup_key → PlanTier value
# Set lookup_keys on Stripe prices to match these strings.
PRICE_TO_TIER: dict[str, str] = {
    "starter_monthly": "starter",
    "starter_annual": "starter",
    "pro_monthly": "pro",
    "pro_annual": "pro",
    "agency_monthly": "agency",
    "agency_annual": "agency",
}


async def _get_org_by_customer(customer_id: str, db) -> Organization | None:
    result = await db.execute(
        select(Organization).where(Organization.stripe_customer_id == customer_id)
    )
    return result.scalar_one_or_none()


async def _handle_downgrade(org: Organization, new_tier: str, db) -> None:
    """Lock excess projects, brand_voices, and users when downgrading."""
    limits = PLAN_LIMITS.get(new_tier, PLAN_LIMITS["free"])

    # Projects — oldest kept (ORDER BY created_at ASC), newest locked
    if limits["projects"] != -1:
        result = await db.execute(
            select(Project)
            .where(Project.org_id == org.id)
            .order_by(Project.created_at.asc())
        )
        projects = result.scalars().all()
        for p in projects[limits["projects"]:]:
            p.locked = True
            p.locked_reason = "downgrade"

    # Brand voices — oldest kept, newest locked
    if limits["brand_voices"] != -1:
        result = await db.execute(
            select(BrandVoice)
            .where(BrandVoice.org_id == org.id)
            .order_by(BrandVoice.created_at.asc())
        )
        voices = result.scalars().all()
        for v in voices[limits["brand_voices"]:]:
            v.locked = True
            v.locked_reason = "downgrade"

    # Users — owner first (role == "owner"), then by created_at asc; owner never locked
    if limits["seats"] != -1:
        result = await db.execute(
            select(User)
            .where(User.org_id == org.id, User.is_active == True)
            .order_by(User.role.desc(), User.created_at.asc())
        )
        members = result.scalars().all()
        for m in members[limits["seats"]:]:
            m.locked = True
            m.locked_reason = "downgrade"

    org.plan_locked_at = datetime.utcnow()


async def _unlock_for_upgrade(org: Organization, db) -> None:
    """Lift downgrade locks when org upgrades."""
    for model in (Project, BrandVoice, User):
        result = await db.execute(
            select(model).where(
                model.org_id == org.id,
                model.locked == True,
                model.locked_reason == "downgrade",
            )
        )
        for row in result.scalars().all():
            row.locked = False
            row.locked_reason = None
    org.plan_locked_at = None


@router.post("/stripe")
async def stripe_webhook(request: Request, db: DB):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    # Idempotency — ignore duplicate deliveries
    try:
        db.add(SubscriptionEvent(
            stripe_event_id=event.id,
            event_type=event.type,
            payload=json.loads(payload),
        ))
        await db.flush()
    except Exception:
        await db.rollback()
        return {"received": True}  # duplicate event_id — already processed

    obj = event.data.object
    customer_id = obj.get("customer")
    org = await _get_org_by_customer(customer_id, db) if customer_id else None

    if event.type == "checkout.session.completed":
        if org and not org.stripe_customer_id:
            org.stripe_customer_id = customer_id

    elif event.type in ("customer.subscription.created", "customer.subscription.updated"):
        if org:
            items = obj.get("items", {}).get("data", [])
            lookup_key = items[0]["price"].get("lookup_key", "") if items else ""
            new_tier = PRICE_TO_TIER.get(lookup_key, org.plan_tier)

            old_tier = org.plan_tier if isinstance(org.plan_tier, str) else org.plan_tier.value

            # Determine if upgrade or downgrade
            tier_order = ["free", "starter", "pro", "agency"]
            old_idx = tier_order.index(old_tier) if old_tier in tier_order else 0
            new_idx = tier_order.index(new_tier) if new_tier in tier_order else 0

            if new_idx > old_idx:
                await _unlock_for_upgrade(org, db)
            elif new_idx < old_idx:
                await _handle_downgrade(org, new_tier, db)

            org.plan_tier = PlanTier(new_tier)

            trial_end = obj.get("trial_end")
            if trial_end and not org.trial_ends_at:
                org.trial_ends_at = datetime.utcfromtimestamp(trial_end)

    elif event.type == "customer.subscription.deleted":
        if org:
            await _handle_downgrade(org, "free", db)
            org.plan_tier = PlanTier.FREE

    elif event.type == "invoice.payment_failed":
        if org:
            org.plan_locked_at = datetime.utcnow()
            # Lock all projects/brand_voices with payment_failed reason
            for model in (Project, BrandVoice):
                result = await db.execute(select(model).where(model.org_id == org.id))
                for row in result.scalars().all():
                    if not row.locked:
                        row.locked = True
                        row.locked_reason = "payment_failed"

    await db.commit()
    return {"received": True}


@router.post("/publishing")
async def publishing_webhook():
    return {"message": "Not implemented yet"}


@router.get("")
async def list_webhooks():
    return {"message": "Not implemented yet"}


@router.post("", status_code=201)
async def create_webhook():
    return {"message": "Not implemented yet"}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex/apps/api
python -m pytest tests/test_webhooks.py -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/api/v1/routers/webhooks.py apps/api/tests/test_webhooks.py
git commit -m "feat(api): Stripe webhook handler — subscription lifecycle + downgrade locking"
```

---

### Task 6: Inject `check_usage_limit` on guarded endpoints

**Files:**
- Modify: `apps/api/app/api/v1/routers/projects.py`
- Modify: `apps/api/app/api/v1/routers/articles.py`
- Modify: `apps/api/app/api/v1/routers/images.py`
- Modify: `apps/api/app/api/v1/routers/social.py`
- Modify: `apps/api/app/api/v1/routers/brand_voice.py`

**Interfaces:**
- Consumes: `check_usage_limit(resource)` from Task 3
- Consumes: `increment_usage(org_id, resource, db)` from Task 3
- Produces: guarded endpoints return 429 on limit breach

- [ ] **Step 1: Add limit guard to `projects.py`**

In `apps/api/app/api/v1/routers/projects.py`, add import:

```python
from typing import Annotated
from fastapi import Depends
from app.core.billing import check_usage_limit, increment_usage
```

Update `create_project` signature to inject the dependency and call `increment_usage` after creation:

```python
@router.post("", status_code=201, response_model=ProjectResponse)
async def create_project(
    body: ProjectCreate,
    current_user: CurrentUser,
    db: DB,
    _: Annotated[None, Depends(check_usage_limit("projects"))],
):
    project = Project(
        org_id=current_user.org_id,
        name=body.name,
        domain=body.domain,
        locale=body.locale,
        target_country=body.target_country,
        industry=body.industry,
    )
    db.add(project)
    await db.flush()
    await db.commit()
    await db.refresh(project)
    await increment_usage(current_user.org_id, "projects", db)
    return ProjectResponse.model_validate(project)
```

- [ ] **Step 2: Add limit guard to `articles.py` generate endpoint**

In `apps/api/app/api/v1/routers/articles.py`, add imports:

```python
from typing import Annotated
from fastapi import Depends
from app.core.billing import check_usage_limit, increment_usage
```

Find the `generate_article` endpoint and update its signature:

```python
@router.post("/{article_id}/generate", response_model=ArticleOut)
async def generate_article(
    article_id: uuid.UUID,
    body: GenerateArticleRequest,
    current_user: CurrentUser,
    db: DB,
    _: Annotated[None, Depends(check_usage_limit("articles"))],
):
```

After `await redis_pool.aclose()`, add:

```python
    await increment_usage(current_user.org_id, "articles", db)
```

- [ ] **Step 3: Add limit guard to `images.py` generate endpoint**

In `apps/api/app/api/v1/routers/images.py`, add imports:

```python
from typing import Annotated
from fastapi import Depends
from app.core.billing import check_usage_limit, increment_usage
```

Find the endpoint that handles image generation (the one calling `generate_image_dalle`) and add:

```python
    _: Annotated[None, Depends(check_usage_limit("images"))],
```

After a successful generation (before returning), add:

```python
    await increment_usage(current_user.org_id, "images", db)
```

- [ ] **Step 4: Add limit guard to `social.py` create endpoint**

In `apps/api/app/api/v1/routers/social.py`, add imports:

```python
from typing import Annotated
from fastapi import Depends
from app.core.billing import check_usage_limit, increment_usage
```

Find the POST endpoint that creates social posts and add:

```python
    _: Annotated[None, Depends(check_usage_limit("social"))],
```

After the social post is committed, add:

```python
    await increment_usage(current_user.org_id, "social", db)
```

- [ ] **Step 5: Add limit guard to `brand_voice.py` create endpoint**

In `apps/api/app/api/v1/routers/brand_voice.py`, add imports:

```python
from typing import Annotated
from fastapi import Depends
from app.core.billing import check_usage_limit, increment_usage
```

Find the POST endpoint that creates brand voices and add:

```python
    _: Annotated[None, Depends(check_usage_limit("brand_voices"))],
```

After creation, add:

```python
    await increment_usage(current_user.org_id, "brand_voices", db)
```

- [ ] **Step 6: Verify the API still starts cleanly**

```bash
docker compose logs api --tail 20 2>&1 | grep -i "error\|startup"
```

Expected: no new errors, `Application startup complete.` present.

- [ ] **Step 7: Smoke test a 429**

```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@fennex.com","password":"admin03"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Manually set articles_used to 4 (free tier limit) in DB
docker compose exec postgres psql -U fennex -d fennex -c "
  INSERT INTO org_usage (org_id, period_start, articles_used)
  SELECT org_id, date_trunc('month', now())::date, 4
  FROM users WHERE email='admin@fennex.com'
  ON CONFLICT DO NOTHING;"

# Try to generate — expect 429
ARTICLE_ID=$(curl -s http://localhost:8000/api/v1/articles \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['id'] if d else 'none')")

curl -s -X POST "http://localhost:8000/api/v1/articles/$ARTICLE_ID/generate" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' | python3 -m json.tool
```

Expected: `{"detail": {"code": "LIMIT_REACHED", "resource": "articles", ...}}`

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/api/v1/routers/projects.py \
        apps/api/app/api/v1/routers/articles.py \
        apps/api/app/api/v1/routers/images.py \
        apps/api/app/api/v1/routers/social.py \
        apps/api/app/api/v1/routers/brand_voice.py
git commit -m "feat(api): inject check_usage_limit on projects, articles, images, social, brand_voices"
```

---

### Task 7: Frontend — billing API functions + Zustand store

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/lib/billing-store.ts`

**Interfaces:**
- Produces: `createCheckoutSession(priceId, successUrl, cancelUrl)` consumed by Task 8
- Produces: `createPortalSession(returnUrl)` consumed by Task 8
- Produces: `getBillingUsage()` consumed by Tasks 8, 9
- Produces: `useUsageStore` Zustand store consumed by Tasks 9
- Produces: `BillingUsage` TypeScript interface consumed by Tasks 8, 9

- [ ] **Step 1: Add billing functions to `apps/web/lib/api.ts`**

At the end of `apps/web/lib/api.ts`, add:

```typescript
// ── Billing ────────────────────────────────────────────────────────────────

export interface BillingUsageResource {
  used: number;
  limit: number;
  pct: number;
}

export interface BillingUsage {
  plan_tier: string;
  trial_ends_at: string | null;
  period_start: string;
  usage: Record<string, BillingUsageResource>;
}

export async function createCheckoutSession(
  priceId: string,
  successUrl: string,
  cancelUrl: string,
): Promise<{ checkout_url: string }> {
  return apiClient.post<{ checkout_url: string }>("/billing/checkout", {
    price_id: priceId,
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

export async function createPortalSession(
  returnUrl: string,
): Promise<{ portal_url: string }> {
  return apiClient.post<{ portal_url: string }>("/billing/portal", {
    return_url: returnUrl,
  });
}

export async function getBillingUsage(): Promise<BillingUsage> {
  return apiClient.get<BillingUsage>("/billing/usage");
}
```

- [ ] **Step 2: Modify `request()` to surface 429 LIMIT_REACHED details**

In `apps/web/lib/api.ts`, update the `ApiError` class and `request()` to capture the structured detail on 429:

```typescript
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
```

In `request()`, update the error path:

```typescript
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let detail: Record<string, unknown> | undefined;
    try {
      const body = await res.json();
      if (typeof body.detail === "object" && body.detail !== null) {
        detail = body.detail as Record<string, unknown>;
        msg = (detail.code as string) ?? msg;
      } else {
        msg = body.detail ?? body.message ?? msg;
      }
    } catch {}
    throw new ApiError(res.status, msg, detail);
  }
```

- [ ] **Step 3: Create `apps/web/lib/billing-store.ts`**

```typescript
import { create } from "zustand";
import type { BillingUsage } from "./api";

interface UsageState {
  usage: BillingUsage | null;
  setUsage: (u: BillingUsage | null) => void;
  /** Returns true if any resource is ≥80% used. */
  hasWarning: () => boolean;
  /** Returns the first resource that is ≥80%, or null. */
  warnResource: () => string | null;
}

export const useUsageStore = create<UsageState>()((set, get) => ({
  usage: null,
  setUsage: (u) => set({ usage: u }),
  hasWarning: () => {
    const u = get().usage;
    if (!u) return false;
    return Object.values(u.usage).some((r) => r.pct >= 0.8);
  },
  warnResource: () => {
    const u = get().usage;
    if (!u) return null;
    const entry = Object.entries(u.usage).find(([, r]) => r.pct >= 0.8);
    return entry ? entry[0] : null;
  },
}));
```

- [ ] **Step 4: Type-check**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex
pnpm --filter @fennex/web tsc --noEmit 2>&1 | head -20
```

Expected: 0 new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/api.ts apps/web/lib/billing-store.ts
git commit -m "feat(web): billing API functions and useUsageStore"
```

---

### Task 8: Frontend — Billing settings tab

**Files:**
- Modify: `apps/web/app/(dashboard)/settings/page.tsx`

**Interfaces:**
- Consumes: `createCheckoutSession`, `createPortalSession`, `getBillingUsage`, `BillingUsage` from Task 7
- Consumes: `useUsageStore` from Task 7

- [ ] **Step 1: Add billing tab imports and constants to `settings/page.tsx`**

At the top of `apps/web/app/(dashboard)/settings/page.tsx`, add to imports:

```typescript
import { createCheckoutSession, createPortalSession, getBillingUsage, type BillingUsage } from "@/lib/api";
import { useUsageStore } from "@/lib/billing-store";
import { useQuery, useMutation } from "@tanstack/react-query";
```

Add the pricing constant after the imports block:

```typescript
const PLANS = [
  {
    id: "free",
    name: "Free",
    monthlyPrice: 0,
    annualPrice: 0,
    features: ["1 project", "4 articles/month", "5 images/month", "1 seat"],
    monthlyPriceId: null,
    annualPriceId: null,
  },
  {
    id: "starter",
    name: "Starter",
    monthlyPrice: 49,
    annualPrice: 39,
    features: ["5 projects", "20 articles/month", "50 images/month", "3 seats"],
    monthlyPriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER_MONTHLY ?? "",
    annualPriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER_ANNUAL ?? "",
  },
  {
    id: "pro",
    name: "Pro",
    monthlyPrice: 99,
    annualPrice: 79,
    features: ["10 projects", "40 articles/month", "150 images/month", "10 seats"],
    monthlyPriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY ?? "",
    annualPriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_ANNUAL ?? "",
  },
  {
    id: "agency",
    name: "Agency",
    monthlyPrice: 249,
    annualPrice: 199,
    features: ["100 projects", "400 articles/month", "Unlimited images", "Unlimited seats"],
    monthlyPriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_AGENCY_MONTHLY ?? "",
    annualPriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_AGENCY_ANNUAL ?? "",
  },
] as const;

const RESOURCE_LABELS: Record<string, string> = {
  articles: "Articles",
  images: "Images",
  social: "Social posts",
  keywords: "Keywords tracked",
  brand_voices: "Brand voices",
  audits: "Audit runs",
  backlinks: "Backlink analyses",
};
```

- [ ] **Step 2: Add `BillingSection` component**

Add this component inside `settings/page.tsx` (before the main `SettingsPage` component):

```tsx
function BillingSection() {
  const [annual, setAnnual] = useState(false);
  const setUsage = useUsageStore((s) => s.setUsage);

  const { data: billing } = useQuery({
    queryKey: ["billing-usage"],
    queryFn: async () => {
      const data = await getBillingUsage();
      setUsage(data);
      return data;
    },
    refetchInterval: 60_000,
  });

  const checkoutMutation = useMutation({
    mutationFn: ({ priceId }: { priceId: string }) =>
      createCheckoutSession(
        priceId,
        `${window.location.origin}/settings?billing=success`,
        `${window.location.origin}/settings`,
      ),
    onSuccess: ({ checkout_url }) => { window.location.href = checkout_url; },
  });

  const portalMutation = useMutation({
    mutationFn: () => createPortalSession(`${window.location.origin}/settings`),
    onSuccess: ({ portal_url }) => { window.location.href = portal_url; },
  });

  const currentTier = billing?.plan_tier ?? "free";
  const tierOrder = ["free", "starter", "pro", "agency"];
  const currentIdx = tierOrder.indexOf(currentTier);

  const trialEndsAt = billing?.trial_ends_at
    ? new Date(billing.trial_ends_at)
    : null;
  const trialDaysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86_400_000))
    : null;

  return (
    <div className="flex flex-col gap-8">
      {/* Current plan card */}
      <div className="glass rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Current plan</p>
            <p className="mt-1 text-2xl font-display font-bold capitalize">{currentTier}</p>
            {trialDaysLeft !== null && trialDaysLeft > 0 && (
              <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
                Trial ends in {trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          {currentTier !== "free" && (
            <button
              onClick={() => portalMutation.mutate()}
              disabled={portalMutation.isPending}
              className="btn-aurora px-4 py-2 text-sm"
            >
              {portalMutation.isPending ? "Opening…" : "Manage plan →"}
            </button>
          )}
        </div>
      </div>

      {/* Usage meters */}
      {billing && Object.keys(billing.usage).length > 0 && (
        <div className="glass rounded-xl p-6">
          <p className="mb-4 text-sm font-semibold">Usage this month</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Object.entries(billing.usage).map(([resource, { used, limit, pct }]) => (
              <div key={resource}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-muted-foreground">{RESOURCE_LABELS[resource] ?? resource}</span>
                  <span className={pct >= 1 ? "text-destructive" : pct >= 0.8 ? "text-warning" : "text-foreground"}>
                    {limit === -1 ? `${used} / ∞` : `${used} / ${limit}`}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all ${
                      pct >= 1 ? "bg-destructive" : pct >= 0.8 ? "bg-warning" : "bg-primary"
                    }`}
                    style={{ width: `${Math.min(pct * 100, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pricing table */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold">Plans</p>
          <div className="flex items-center gap-2 rounded-lg border border-border p-1">
            <button
              onClick={() => setAnnual(false)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${!annual ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Monthly
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${annual ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Annual <span className="text-success">−20%</span>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan) => {
            const planIdx = tierOrder.indexOf(plan.id);
            const isCurrent = plan.id === currentTier;
            const isUpgrade = planIdx > currentIdx;
            const priceId = annual ? plan.annualPriceId : plan.monthlyPriceId;

            return (
              <div
                key={plan.id}
                className={`glass rounded-xl p-5 flex flex-col gap-4 ${isCurrent ? "border-primary/50" : ""}`}
              >
                <div>
                  <p className="font-display font-bold text-lg">{plan.name}</p>
                  <p className="mt-1 text-2xl font-bold">
                    {plan.monthlyPrice === 0 ? "Free" : (
                      <>${annual ? plan.annualPrice : plan.monthlyPrice}<span className="text-sm font-normal text-muted-foreground">/mo</span></>
                    )}
                  </p>
                </div>
                <ul className="flex flex-col gap-1.5 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                {isCurrent ? (
                  <button disabled className="w-full rounded-lg border border-border py-2 text-xs text-muted-foreground cursor-default">
                    Current plan
                  </button>
                ) : isUpgrade && priceId ? (
                  <button
                    onClick={() => checkoutMutation.mutate({ priceId })}
                    disabled={checkoutMutation.isPending}
                    className="btn-aurora w-full py-2 text-xs"
                  >
                    Upgrade →
                  </button>
                ) : (
                  <button
                    onClick={() => portalMutation.mutate()}
                    disabled={portalMutation.isPending}
                    className="w-full rounded-lg border border-border py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Downgrade
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Replace "Billing coming soon" with `<BillingSection />`**

Find the sidebar item for "Billing" in `settings/page.tsx` (the one rendering the "Billing coming soon" placeholder card) and replace the placeholder content section with:

```tsx
{activeTab === "billing" && <BillingSection />}
```

If there's no `billing` tab yet in the sidebar nav, add it. In the `TABS` array (or equivalent nav config), add:

```typescript
{ id: "billing", label: "Billing", icon: CreditCard },
```

And import `CreditCard` from `lucide-react`.

- [ ] **Step 4: Add Stripe price IDs to `.env` and `web/Dockerfile.dev`**

In `.env.example`, add the `NEXT_PUBLIC_` frontend vars:

```bash
NEXT_PUBLIC_STRIPE_PRICE_STARTER_MONTHLY=price_...
NEXT_PUBLIC_STRIPE_PRICE_STARTER_ANNUAL=price_...
NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY=price_...
NEXT_PUBLIC_STRIPE_PRICE_PRO_ANNUAL=price_...
NEXT_PUBLIC_STRIPE_PRICE_AGENCY_MONTHLY=price_...
NEXT_PUBLIC_STRIPE_PRICE_AGENCY_ANNUAL=price_...
```

- [ ] **Step 5: Type-check**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex
pnpm --filter @fennex/web tsc --noEmit 2>&1 | head -30
```

Expected: 0 new errors.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(dashboard)/settings/page.tsx" .env.example
git commit -m "feat(web): billing settings tab — pricing table, plan card, usage meters"
```

---

### Task 9: Frontend — UsageBanner + UpgradeModal + 429 interception

**Files:**
- Create: `apps/web/components/billing/UsageBanner.tsx`
- Create: `apps/web/components/billing/UpgradeModal.tsx`
- Modify: `apps/web/app/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: `useUsageStore` from Task 7
- Consumes: `getBillingUsage`, `createCheckoutSession` from Task 7
- Consumes: `ApiError` (with `detail` field) from Task 7

- [ ] **Step 1: Create `apps/web/components/billing/UsageBanner.tsx`**

```tsx
"use client";

import { useState } from "react";
import { X, Zap } from "lucide-react";
import { useUsageStore } from "@/lib/billing-store";
import { cn } from "@/lib/cn";

const RESOURCE_LABELS: Record<string, string> = {
  articles: "articles", images: "images", social: "social posts",
  keywords: "keywords", brand_voices: "brand voices",
  audits: "audit runs", backlinks: "backlink analyses",
};

interface UsageBannerProps {
  onUpgrade: () => void;
}

export function UsageBanner({ onUpgrade }: UsageBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const usage = useUsageStore((s) => s.usage);
  const warnResource = useUsageStore((s) => s.warnResource);

  if (dismissed || !usage) return null;

  const resource = warnResource();
  if (!resource) return null;

  const { used, limit, pct } = usage.usage[resource];
  const isAtLimit = pct >= 1.0;
  const label = RESOURCE_LABELS[resource] ?? resource;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 px-6 py-2.5 text-sm",
        isAtLimit
          ? "bg-destructive/10 border-b border-destructive/20 text-destructive"
          : "bg-warning/10 border-b border-warning/20 text-warning",
      )}
    >
      <div className="flex items-center gap-2">
        <Zap className="h-3.5 w-3.5 shrink-0" />
        <span>
          {isAtLimit
            ? `You've reached your ${label} limit (${used}/${limit}).`
            : `You've used ${used}/${limit} ${label} this month.`}
          {" "}
          <button onClick={onUpgrade} className="underline underline-offset-2 font-medium">
            Upgrade to continue →
          </button>
        </span>
      </div>
      <button onClick={() => setDismissed(true)} className="shrink-0 opacity-60 hover:opacity-100">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/web/components/billing/UpgradeModal.tsx`**

```tsx
"use client";

import { X, Zap } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { createCheckoutSession } from "@/lib/api";
import { cn } from "@/lib/cn";

const RESOURCE_LABELS: Record<string, string> = {
  articles: "articles", images: "images", social: "social posts",
  keywords: "keywords tracked", brand_voices: "brand voices",
  audits: "audit runs", backlinks: "backlink analyses",
};

const NEXT_TIER: Record<string, { name: string; priceId: string; price: number }> = {
  free: {
    name: "Starter",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER_MONTHLY ?? "",
    price: 49,
  },
  starter: {
    name: "Pro",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY ?? "",
    price: 99,
  },
  pro: {
    name: "Agency",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_AGENCY_MONTHLY ?? "",
    price: 249,
  },
};

interface UpgradeModalProps {
  resource: string;
  used: number;
  limit: number;
  currentTier: string;
  onClose: () => void;
}

export function UpgradeModal({ resource, used, limit, currentTier, onClose }: UpgradeModalProps) {
  const next = NEXT_TIER[currentTier];
  const label = RESOURCE_LABELS[resource] ?? resource;

  const checkoutMutation = useMutation({
    mutationFn: () =>
      createCheckoutSession(
        next.priceId,
        `${window.location.origin}/settings?billing=success`,
        window.location.href,
      ),
    onSuccess: ({ checkout_url }) => { window.location.href = checkout_url; },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass w-full max-w-md rounded-2xl p-8 shadow-lg relative">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex h-12 w-12 items-center justify-center rounded-2xl gradient-brand mb-5">
          <Zap className="h-5 w-5 text-white" />
        </div>

        <h2 className="font-display text-xl font-bold">Limit reached</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You've used <strong>{used}/{limit}</strong> {label} on your current plan.
          {next ? ` Upgrade to ${next.name} to keep going.` : " Contact us for Enterprise options."}
        </p>

        {next && (
          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={() => checkoutMutation.mutate()}
              disabled={checkoutMutation.isPending}
              className="btn-aurora w-full py-3 text-sm font-semibold"
            >
              {checkoutMutation.isPending ? "Redirecting…" : `Upgrade to ${next.name} — $${next.price}/mo →`}
            </button>
            <button
              onClick={onClose}
              className="w-full py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Maybe later
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update dashboard layout to wire UsageBanner + usage poll + UpgradeModal**

Replace `apps/web/app/(dashboard)/layout.tsx` with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { CommandPaletteProvider } from "@/components/layout/CommandPalette";
import { AuroraBackground } from "@/components/layout/AuroraBackground";
import { UsageBanner } from "@/components/billing/UsageBanner";
import { UpgradeModal } from "@/components/billing/UpgradeModal";
import { getBillingUsage, isAuthenticated } from "@/lib/api";
import { useUsageStore } from "@/lib/billing-store";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const setUsage = useUsageStore((s) => s.setUsage);
  const usage = useUsageStore((s) => s.usage);
  const [upgradeResource, setUpgradeResource] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (typeof window !== "undefined" && !isAuthenticated()) {
    return null;
  }

  // Poll usage every 60 s
  useQuery({
    queryKey: ["billing-usage-global"],
    queryFn: async () => {
      const data = await getBillingUsage();
      setUsage(data);
      return data;
    },
    refetchInterval: 60_000,
    retry: false,
  });

  const upgradeInfo = upgradeResource && usage
    ? {
        resource: upgradeResource,
        used: usage.usage[upgradeResource]?.used ?? 0,
        limit: usage.usage[upgradeResource]?.limit ?? 0,
        currentTier: usage.plan_tier,
      }
    : null;

  return (
    <CommandPaletteProvider>
      <AuroraBackground />
      <div className="relative z-10 flex h-screen flex-col overflow-hidden">
        {usage && (
          <UsageBanner onUpgrade={() => {
            const warnResource = Object.entries(usage.usage).find(([, r]) => r.pct >= 0.8)?.[0] ?? null;
            setUpgradeResource(warnResource);
          }} />
        )}
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <TopBar />
            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </div>
      </div>
      {upgradeInfo && (
        <UpgradeModal
          resource={upgradeInfo.resource}
          used={upgradeInfo.used}
          limit={upgradeInfo.limit}
          currentTier={upgradeInfo.currentTier}
          onClose={() => setUpgradeResource(null)}
        />
      )}
    </CommandPaletteProvider>
  );
}
```

- [ ] **Step 4: Type-check**

```bash
cd /home/mhamnache/Startup/AI/claude/fennex
pnpm --filter @fennex/web tsc --noEmit 2>&1 | head -30
```

Expected: 0 new errors.

- [ ] **Step 5: Verify the UI in the browser**

```bash
python3 << 'EOF'
from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto("http://localhost:3001/login")
    page.wait_for_load_state("networkidle", timeout=10000)
    page.fill('input[type="email"]', "admin@fennex.com")
    page.fill('input[type="password"]', "admin03")
    page.click('button[type="submit"]')
    page.wait_for_url("**/", timeout=8000)
    time.sleep(2)
    page.goto("http://localhost:3001/settings")
    page.wait_for_load_state("networkidle", timeout=8000)
    time.sleep(2)
    page.screenshot(path="/tmp/billing_settings.png")
    print("Screenshot saved")
    browser.close()
EOF
```

Open `/tmp/billing_settings.png` and verify the Billing tab shows the pricing table and usage meters.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/billing/UsageBanner.tsx \
        apps/web/components/billing/UpgradeModal.tsx \
        "apps/web/app/(dashboard)/layout.tsx"
git commit -m "feat(web): UsageBanner, UpgradeModal, and usage polling in dashboard layout"
```
