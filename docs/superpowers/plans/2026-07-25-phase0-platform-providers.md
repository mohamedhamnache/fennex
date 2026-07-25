# Phase 0 — Platform Providers (OpenAI-primary reseller) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip AI (LLM) and DataForSEO from user-supplied keys to **platform-owned
provider accounts** so Fennex is the reseller — users stop needing their own keys,
the app runs on our OpenAI account (Anthropic/Google ready as fallbacks), and BYOK
is plumbed for later. **No metering or quota changes in this phase.**

**Architecture:** A supplier-neutral `ProviderRegistry` resolves LLM keys and the
SEO provider **platform-first** (from a new `provider_accounts` table, then env
bootstrap), with a tenant key used only as a BYOK override. The two existing seams
— `llm_service.get_org_llm_keys` and `seo_apis.get_seo_provider_for_org` — delegate
to the registry, so all 8+ call sites keep working unchanged while the credential
source flips.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic, pytest (in-memory SQLite),
`encrypt_value`/`decrypt_value` from `app.core.security`.

## Global Constraints

- Backend Python 3.11+, async/await; models in `apps/api/app/models/`, services in
  `apps/api/app/services/`, integrations in `apps/api/app/integrations/`; register
  routers in `apps/api/app/api/v1/router.py`.
- Migrations: raw `op.execute(... IF NOT EXISTS ...)` style; `down_revision` chains
  from the current head `c8r9s0t1u2v3`. Keep the new revision ids exactly as given.
- Tests run on HOST with in-memory SQLite (aiosqlite), `asyncio_mode="auto"` (no
  `@pytest.mark.asyncio`). Each test file stands up its own engine + `setup_db`
  autouse fixture (mirror `apps/api/tests/test_workspace_provisioning.py`). New
  models MUST be import-registered in `apps/api/app/models/__init__.py`
  (`Base.metadata.create_all`, not migrations, builds test tables). **No JSONB /
  Vector columns** in these tables (SQLite compat). SQLAlchemy `default=` applies
  at flush, not construction — assert defaults after a commit.
- Secrets: platform provider credentials are encrypted with
  `app.core.security.encrypt_value`; never returned in API responses or logged.
- LLM launch models: `openai:gpt-4o-mini` (cheap) and `openai:gpt-4o` (standard).
  Anthropic/Google are fallbacks only. Premium band (Opus) is OUT of scope here.
- Commit style: `feat(billing): …` / `fix(billing): …`. End every commit body with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Branch: create/work on `feat/platform-providers` (do not commit to `main`).
- Spec: `docs/superpowers/specs/2026-07-25-reseller-billing-architecture.md`
  (Phase 0 in §6; provider abstraction §1.2b/§1.3; schema §2.5). `model_catalog`,
  band routing, and the `tiers.py` re-map are **Phase 1**, not this plan.

## Credential formats (used across tasks)

- LLM provider account: `encrypted_credentials` = the API key string (e.g. an
  OpenAI `sk-...`). `provider ∈ {"openai","anthropic","google"}`, `kind="llm"`.
- SEO provider account (DataForSEO): `encrypted_credentials` = `"login:password"`
  (matches the existing `api_keys` convention). `provider="dataforseo"`,
  `kind="seo"`.

---

### Task 1: `provider_accounts` model + migration + platform env settings

**Files:**
- Create: `apps/api/app/models/provider_account.py`
- Modify: `apps/api/app/models/__init__.py` (export `ProviderAccount`)
- Modify: `apps/api/app/core/config.py` (add platform env keys)
- Create: `apps/api/alembic/versions/d9s0t1u2v3w4_provider_accounts.py`
- Test: `apps/api/tests/test_provider_account_model.py`

**Interfaces:**
- Produces: `ProviderAccount` ORM model with columns `id, kind, provider, label,
  encrypted_credentials, is_active, priority, monthly_budget_cents, created_at,
  updated_at`. `kind ∈ {"llm","seo"}`. Lower `priority` = tried first.
- Produces settings: `settings.OPENAI_API_KEY`, `settings.ANTHROPIC_API_KEY`,
  `settings.GOOGLE_API_KEY` (all default `""`), and
  `settings.PLATFORM_ADMIN_EMAILS: list[str]` (default `[]`).

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_provider_account_model.py
import uuid
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.provider_account import ProviderAccount

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_provider_account_defaults():
    async with Session() as db:
        pa = ProviderAccount(kind="llm", provider="openai", label="primary",
                             encrypted_credentials="enc")
        db.add(pa)
        await db.commit()
        await db.refresh(pa)
        assert pa.is_active is True
        assert pa.priority == 100
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_provider_account_model.py -v`
Expected: FAIL (`ModuleNotFoundError: app.models.provider_account`)

- [ ] **Step 3: Write the model**

```python
# apps/api/app/models/provider_account.py
import uuid
from sqlalchemy import String, Integer, Boolean, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import TimestampMixin


class ProviderAccount(Base, TimestampMixin):
    """A platform-owned provider credential (the reseller accounts). LLM keys and
    the DataForSEO login live here; the registry resolves platform creds from this
    table first, then env bootstrap."""
    __tablename__ = "provider_accounts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)          # 'llm' | 'seo'
    provider: Mapped[str] = mapped_column(String(50), nullable=False)      # 'openai','dataforseo',...
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    encrypted_credentials: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    monthly_budget_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
```

- [ ] **Step 4: Export the model**

In `apps/api/app/models/__init__.py` add:
```python
from app.models.provider_account import ProviderAccount  # noqa: F401
```

- [ ] **Step 5: Add platform env settings**

In `apps/api/app/core/config.py`, add these fields to the settings class (match the
existing `DATAFORSEO_LOGIN: str = ""` style):
```python
    OPENAI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""
    GOOGLE_API_KEY: str = ""
    PLATFORM_ADMIN_EMAILS: list[str] = []
```
(If the settings class parses lists from env via pydantic, a comma-separated
`PLATFORM_ADMIN_EMAILS` env var works; default `[]` is fine for tests.)

- [ ] **Step 6: Write the migration**

```python
# apps/api/alembic/versions/d9s0t1u2v3w4_provider_accounts.py
"""provider_accounts table

Revision ID: d9s0t1u2v3w4
Revises: c8r9s0t1u2v3
"""
from alembic import op

revision = "d9s0t1u2v3w4"
down_revision = "c8r9s0t1u2v3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS provider_accounts (
            id UUID PRIMARY KEY,
            kind VARCHAR(10) NOT NULL,
            provider VARCHAR(50) NOT NULL,
            label VARCHAR(120) NOT NULL,
            encrypted_credentials TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT true,
            priority INTEGER NOT NULL DEFAULT 100,
            monthly_budget_cents INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_provider_accounts_kind ON provider_accounts (kind, is_active)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS provider_accounts")
```

- [ ] **Step 7: Run test + migration**

Run: `cd apps/api && python -m pytest tests/test_provider_account_model.py -v` → PASS
Run: `make db-migrate` (from repo root) → upgrades to `d9s0t1u2v3w4`

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/models/provider_account.py apps/api/app/models/__init__.py \
  apps/api/app/core/config.py apps/api/alembic/versions/d9s0t1u2v3w4_provider_accounts.py \
  apps/api/tests/test_provider_account_model.py
git commit -m "feat(billing): provider_accounts model, migration, platform env keys

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `organizations.byok_enabled` column

**Files:**
- Modify: `apps/api/app/models/organization.py` (add `byok_enabled`)
- Create: `apps/api/alembic/versions/e0t1u2v3w4x5_org_byok.py`
- Test: `apps/api/tests/test_org_byok.py`

**Interfaces:**
- Produces: `Organization.byok_enabled: bool` (default False). When True, a tenant's
  own `api_keys` override platform credentials for matching providers.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_org_byok.py
from app.models.organization import Organization

def test_org_has_byok_flag():
    assert hasattr(Organization, "byok_enabled")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_org_byok.py -v`
Expected: FAIL (`byok_enabled` missing)

- [ ] **Step 3: Add the column to the model**

In `apps/api/app/models/organization.py`, add alongside the other columns:
```python
    byok_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
```
(Ensure `Boolean` is imported from `sqlalchemy` in that file; add it to the import
if missing.)

- [ ] **Step 4: Write the migration**

```python
# apps/api/alembic/versions/e0t1u2v3w4x5_org_byok.py
"""organizations.byok_enabled

Revision ID: e0t1u2v3w4x5
Revises: d9s0t1u2v3w4
"""
from alembic import op

revision = "e0t1u2v3w4x5"
down_revision = "d9s0t1u2v3w4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS byok_enabled BOOLEAN NOT NULL DEFAULT false")


def downgrade() -> None:
    op.execute("ALTER TABLE organizations DROP COLUMN IF EXISTS byok_enabled")
```

- [ ] **Step 5: Run test + migration**

Run: `cd apps/api && python -m pytest tests/test_org_byok.py -v` → PASS
Run: `make db-migrate` → upgrades to `e0t1u2v3w4x5`

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/models/organization.py apps/api/alembic/versions/e0t1u2v3w4x5_org_byok.py apps/api/tests/test_org_byok.py
git commit -m "feat(billing): org byok_enabled flag

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `ProviderRegistry` — platform-first LLM keys + SEO provider

**Files:**
- Create: `apps/api/app/services/providers/__init__.py` (empty)
- Create: `apps/api/app/services/providers/registry.py`
- Test: `apps/api/tests/test_provider_registry.py`

**Interfaces:**
- Consumes: `ProviderAccount`, `settings.{OPENAI,ANTHROPIC,GOOGLE}_API_KEY`,
  `settings.DATAFORSEO_LOGIN/PASSWORD`, `Organization.byok_enabled`,
  `APIKey`, `decrypt_value`, `DataForSEOProvider`.
- Produces:
  - `async def platform_llm_keys(db) -> dict[str, str]` — `{provider: key}` from
    active `provider_accounts` (kind='llm', ordered by `priority`), then env
    bootstrap for any provider not already present. First (lowest-priority) account
    per provider wins.
  - `async def get_llm_keys(org_id, db) -> dict[str, str]` — platform keys; if the
    org has `byok_enabled` True, overlay the org's own `api_keys` (org key overrides
    platform for that provider).
  - `async def resolve_seo_provider(org_id, db) -> DataForSEOProvider | None` —
    platform first (provider_accounts kind='seo' provider='dataforseo', then env
    `DATAFORSEO_*`); a tenant DataForSEO `api_key` is used ONLY if the org has
    `byok_enabled`. Returns `None` when nothing is configured.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_provider_registry.py
import uuid
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.core.config import settings
from app.core.security import encrypt_value
from app.models.provider_account import ProviderAccount
from app.models.organization import Organization
from app.models.api_key import APIKey
from app.services.providers import registry
from app.integrations.seo_apis.dataforseo import DataForSEOProvider

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def _org(db, *, byok=False):
    org = Organization(id=uuid.uuid4(), slug=f"o-{uuid.uuid4().hex[:6]}", name="Org",
                       byok_enabled=byok)
    db.add(org)
    await db.commit()
    return org.id


async def test_platform_llm_keys_from_account_then_env(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "env-openai", raising=False)
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "", raising=False)
    async with Session() as db:
        db.add(ProviderAccount(kind="llm", provider="anthropic", label="a",
                               encrypted_credentials=encrypt_value("acct-anthropic"),
                               priority=10))
        await db.commit()
        keys = await registry.platform_llm_keys(db)
    assert keys["anthropic"] == "acct-anthropic"   # from account
    assert keys["openai"] == "env-openai"           # from env bootstrap


async def test_get_llm_keys_ignores_org_key_without_byok(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "env-openai", raising=False)
    async with Session() as db:
        oid = await _org(db, byok=False)
        db.add(APIKey(id=uuid.uuid4(), org_id=oid, provider="openai",
                      encrypted_value=encrypt_value("tenant-openai")))
        await db.commit()
        keys = await registry.get_llm_keys(oid, db)
    assert keys["openai"] == "env-openai"           # platform wins; BYOK off


async def test_get_llm_keys_uses_org_key_with_byok(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "env-openai", raising=False)
    async with Session() as db:
        oid = await _org(db, byok=True)
        db.add(APIKey(id=uuid.uuid4(), org_id=oid, provider="openai",
                      encrypted_value=encrypt_value("tenant-openai")))
        await db.commit()
        keys = await registry.get_llm_keys(oid, db)
    assert keys["openai"] == "tenant-openai"        # BYOK override


async def test_resolve_seo_platform_first(monkeypatch):
    monkeypatch.setattr(settings, "DATAFORSEO_LOGIN", "", raising=False)
    monkeypatch.setattr(settings, "DATAFORSEO_PASSWORD", "", raising=False)
    async with Session() as db:
        oid = await _org(db, byok=False)
        db.add(ProviderAccount(kind="seo", provider="dataforseo", label="d",
                               encrypted_credentials=encrypt_value("plat-login:plat-pass")))
        await db.commit()
        prov = await registry.resolve_seo_provider(oid, db)
    assert isinstance(prov, DataForSEOProvider)


async def test_resolve_seo_none_when_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "DATAFORSEO_LOGIN", "", raising=False)
    monkeypatch.setattr(settings, "DATAFORSEO_PASSWORD", "", raising=False)
    async with Session() as db:
        oid = await _org(db, byok=False)
        prov = await registry.resolve_seo_provider(oid, db)
    assert prov is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_provider_registry.py -v`
Expected: FAIL (`ModuleNotFoundError: app.services.providers.registry`)

- [ ] **Step 3: Write the registry**

```python
# apps/api/app/services/providers/registry.py
"""Supplier-neutral provider resolution. Platform credentials (provider_accounts,
then env bootstrap) are the default; a tenant key is used only when the org has
byok_enabled. LLM launch supplier is OpenAI; Anthropic/Google are fallbacks."""
import uuid

from sqlalchemy import select

from app.core.config import settings
from app.core.security import decrypt_value
from app.integrations.seo_apis.dataforseo import DataForSEOProvider
from app.models.api_key import APIKey
from app.models.organization import Organization
from app.models.provider_account import ProviderAccount

_ENV_LLM = {
    "openai": lambda: settings.OPENAI_API_KEY,
    "anthropic": lambda: settings.ANTHROPIC_API_KEY,
    "google": lambda: settings.GOOGLE_API_KEY,
}


async def platform_llm_keys(db) -> dict[str, str]:
    rows = (await db.execute(
        select(ProviderAccount).where(
            ProviderAccount.kind == "llm", ProviderAccount.is_active == True  # noqa: E712
        ).order_by(ProviderAccount.priority.asc())
    )).scalars().all()
    keys: dict[str, str] = {}
    for row in rows:
        if row.provider not in keys:  # lowest priority per provider wins
            keys[row.provider] = decrypt_value(row.encrypted_credentials)
    for provider, getter in _ENV_LLM.items():
        if provider not in keys and getter():
            keys[provider] = getter()
    return keys


async def _org(org_id: uuid.UUID, db) -> Organization | None:
    return (await db.execute(
        select(Organization).where(Organization.id == org_id)
    )).scalar_one_or_none()


async def get_llm_keys(org_id: uuid.UUID, db) -> dict[str, str]:
    keys = await platform_llm_keys(db)
    org = await _org(org_id, db)
    if org is not None and org.byok_enabled:
        rows = (await db.execute(
            select(APIKey).where(APIKey.org_id == org_id)
        )).scalars().all()
        for k in rows:
            if k.provider in _ENV_LLM:  # only llm providers override llm keys
                keys[k.provider] = decrypt_value(k.encrypted_value)
    return keys


async def resolve_seo_provider(org_id: uuid.UUID, db) -> DataForSEOProvider | None:
    org = await _org(org_id, db)
    # BYOK: tenant DataForSEO key wins only when byok is on.
    if org is not None and org.byok_enabled:
        row = (await db.execute(select(APIKey).where(
            APIKey.org_id == org_id, APIKey.provider == "dataforseo"
        ))).scalars().first()
        if row is not None:
            login, _, password = decrypt_value(row.encrypted_value).partition(":")
            if login and password:
                return DataForSEOProvider(login, password)
    # Platform account first, then env bootstrap.
    acct = (await db.execute(select(ProviderAccount).where(
        ProviderAccount.kind == "seo", ProviderAccount.provider == "dataforseo",
        ProviderAccount.is_active == True,  # noqa: E712
    ).order_by(ProviderAccount.priority.asc()))).scalars().first()
    if acct is not None:
        login, _, password = decrypt_value(acct.encrypted_credentials).partition(":")
        if login and password:
            return DataForSEOProvider(login, password)
    if settings.DATAFORSEO_LOGIN and settings.DATAFORSEO_PASSWORD:
        return DataForSEOProvider(settings.DATAFORSEO_LOGIN, settings.DATAFORSEO_PASSWORD)
    return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && python -m pytest tests/test_provider_registry.py -v`
Expected: PASS (all 5)

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/providers/__init__.py apps/api/app/services/providers/registry.py apps/api/tests/test_provider_registry.py
git commit -m "feat(billing): ProviderRegistry — platform-first LLM keys + SEO provider

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Flip `get_org_llm_keys` to platform-first (delegate to registry)

**Files:**
- Modify: `apps/api/app/services/llm_service.py` (`get_org_llm_keys` body)
- Test: `apps/api/tests/test_llm_keys_platform_first.py`

**Interfaces:**
- Consumes: `registry.get_llm_keys`.
- Produces: `get_org_llm_keys(org_id, db)` keeps its **exact signature and return
  type** (`dict[str, str]`) — all 8 existing call sites are unchanged — but now
  returns platform keys (BYOK override when the org opts in).

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_llm_keys_platform_first.py
import uuid
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.core.config import settings
from app.models.organization import Organization
from app.services.llm_service import get_org_llm_keys

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_get_org_llm_keys_returns_platform_keys(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "env-openai", raising=False)
    async with Session() as db:
        org = Organization(id=uuid.uuid4(), slug="o", name="Org", byok_enabled=False)
        db.add(org)
        await db.commit()
        keys = await get_org_llm_keys(org.id, db)
    assert keys.get("openai") == "env-openai"   # platform key, no tenant key needed
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_llm_keys_platform_first.py -v`
Expected: FAIL (returns `{}` — today it only reads tenant `api_keys`)

- [ ] **Step 3: Delegate to the registry**

In `apps/api/app/services/llm_service.py`, replace the body of `get_org_llm_keys`
with a delegation (keep the signature; the old direct-query body is removed):
```python
async def get_org_llm_keys(org_id: uuid.UUID, db: AsyncSession) -> dict[str, str]:
    """Return {provider: plaintext_key} for LLM calls. Platform accounts/env by
    default; a tenant's own keys override only when the org has byok_enabled."""
    from app.services.providers import registry
    return await registry.get_llm_keys(org_id, db)
```
(The `select`/`APIKey`/`decrypt_value` imports at the top of `llm_service.py` may
now be unused by this function — leave them if other functions use them; otherwise
remove to keep the module clean.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_llm_keys_platform_first.py -v` → PASS

- [ ] **Step 5: Regression — full suite**

Run: `cd apps/api && python -m pytest -q`
Expected: no NEW failures. The known pre-existing failures (a Postgres-auth
`test_edit_model.py` and any host-package `test_strands_runtime.py`) may appear —
ignore those; anything touching LLM keys/onboarding/agents must stay green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/services/llm_service.py apps/api/tests/test_llm_keys_platform_first.py
git commit -m "feat(billing): LLM keys resolve platform-first via ProviderRegistry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Flip `get_seo_provider_for_org` to platform-first (delegate to registry)

**Files:**
- Modify: `apps/api/app/integrations/seo_apis/__init__.py` (`get_seo_provider_for_org`)
- Test: `apps/api/tests/test_seo_provider_platform_first.py`

**Interfaces:**
- Consumes: `registry.resolve_seo_provider`.
- Produces: `get_seo_provider_for_org(org_id, db)` keeps its signature/return type
  (`DataForSEOProvider | None`); now platform-first with BYOK override.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_seo_provider_platform_first.py
import uuid
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.core.config import settings
from app.core.security import encrypt_value
from app.models.organization import Organization
from app.models.provider_account import ProviderAccount
from app.integrations.seo_apis import get_seo_provider_for_org
from app.integrations.seo_apis.dataforseo import DataForSEOProvider

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_platform_account_used_without_tenant_key(monkeypatch):
    monkeypatch.setattr(settings, "DATAFORSEO_LOGIN", "", raising=False)
    monkeypatch.setattr(settings, "DATAFORSEO_PASSWORD", "", raising=False)
    async with Session() as db:
        org = Organization(id=uuid.uuid4(), slug="o", name="Org", byok_enabled=False)
        db.add(org)
        db.add(ProviderAccount(kind="seo", provider="dataforseo", label="d",
                               encrypted_credentials=encrypt_value("plat:pass")))
        await db.commit()
        prov = await get_seo_provider_for_org(org.id, db)
    assert isinstance(prov, DataForSEOProvider)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_seo_provider_platform_first.py -v`
Expected: FAIL (today it returns None — reads only tenant key + env, not
`provider_accounts`)

- [ ] **Step 3: Delegate to the registry**

In `apps/api/app/integrations/seo_apis/__init__.py`, replace the body of
`get_seo_provider_for_org` with:
```python
async def get_seo_provider_for_org(org_id, db) -> DataForSEOProvider | None:
    """Platform DataForSEO account/env by default; a tenant key is used only when
    the org has byok_enabled. Returns None when nothing is configured."""
    from app.services.providers import registry
    return await registry.resolve_seo_provider(org_id, db)
```
Keep the `get_seo_provider()` helper and the module imports as they are.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_seo_provider_platform_first.py -v` → PASS

- [ ] **Step 5: Regression — SEO/competitor/onboarding suites**

Run: `cd apps/api && python -m pytest tests/test_discovery_competitors.py tests/test_onboarding_suggest.py -q`
Expected: PASS. (These monkeypatch `get_seo_provider_for_org` /
`discovery_service._org_model`, so the delegation must not change their behavior.)
Then full suite: `python -m pytest -q` → no new failures beyond the known
pre-existing ones.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/integrations/seo_apis/__init__.py apps/api/tests/test_seo_provider_platform_first.py
git commit -m "feat(billing): SEO provider resolves platform-first via ProviderRegistry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Staff-only admin CRUD for `provider_accounts`

**Files:**
- Create: `apps/api/app/api/v1/routers/provider_accounts.py`
- Modify: `apps/api/app/api/v1/router.py` (register)
- Test: `apps/api/tests/test_provider_accounts_router.py`

**Interfaces:**
- Produces endpoints under `/api/v1/admin/provider-accounts`, gated to platform
  staff (`current_user.email in settings.PLATFORM_ADMIN_EMAILS`):
  - `GET ""` → list accounts (credentials NEVER returned — only a masked hint).
  - `POST ""` body `{kind, provider, label, credentials, priority?, monthly_budget_cents?}`
    → creates one (credentials encrypted at rest); returns the masked row.
  - `DELETE /{id}` → deletes one.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_provider_accounts_router.py
import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.core.config import settings
from app.core.dependencies import get_current_user, get_db
from app.main import app as fastapi_app
from app.models.organization import Organization
from app.models.user import User, UserRole

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
ORG = uuid.uuid4()


async def override_get_db():
    async with Session() as s:
        try:
            yield s
            await s.commit()
        except Exception:
            await s.rollback()
            raise


def _user(email):
    return User(id=uuid.uuid4(), org_id=ORG, email=email, hashed_password="x",
                full_name="U", role=UserRole.OWNER, is_active=True)


@pytest.fixture(autouse=True)
async def setup_db(monkeypatch):
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as s:
        s.add(Organization(id=ORG, slug="o", name="Org"))
        await s.commit()
    monkeypatch.setattr(settings, "PLATFORM_ADMIN_EMAILS", ["staff@fennex.ai"], raising=False)
    fastapi_app.dependency_overrides[get_db] = override_get_db
    yield
    fastapi_app.dependency_overrides.clear()
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as ac:
        yield ac


async def test_non_staff_forbidden(client):
    fastapi_app.dependency_overrides[get_current_user] = lambda: _user("user@x.com")
    r = await client.get("/api/v1/admin/provider-accounts")
    assert r.status_code == 403


async def test_staff_create_and_list_masks_secret(client):
    fastapi_app.dependency_overrides[get_current_user] = lambda: _user("staff@fennex.ai")
    r = await client.post("/api/v1/admin/provider-accounts", json={
        "kind": "llm", "provider": "openai", "label": "primary",
        "credentials": "sk-secret-123456",
    })
    assert r.status_code == 201
    body = r.json()
    assert "secret" not in str(body).lower() or body["credentials_hint"].endswith("3456")
    assert "sk-secret-123456" not in str(body)  # raw secret never returned
    lst = await client.get("/api/v1/admin/provider-accounts")
    assert lst.status_code == 200
    assert lst.json()[0]["provider"] == "openai"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_provider_accounts_router.py -v`
Expected: FAIL (404 — router not registered)

- [ ] **Step 3: Write the router**

```python
# apps/api/app/api/v1/routers/provider_accounts.py
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.core.security import encrypt_value
from app.models.provider_account import ProviderAccount

router = APIRouter()


def _require_staff(current_user: CurrentUser) -> None:
    if current_user.email not in (settings.PLATFORM_ADMIN_EMAILS or []):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff only")


class CreateAccount(BaseModel):
    kind: str
    provider: str
    label: str
    credentials: str
    priority: int = 100
    monthly_budget_cents: Optional[int] = None


def _out(a: ProviderAccount) -> dict:
    return {
        "id": str(a.id), "kind": a.kind, "provider": a.provider, "label": a.label,
        "is_active": a.is_active, "priority": a.priority,
        "monthly_budget_cents": a.monthly_budget_cents,
        "credentials_hint": "****",  # never expose the secret; hint is fixed mask
    }


@router.get("")
async def list_accounts(current_user: CurrentUser, db: DB) -> list[dict]:
    _require_staff(current_user)
    rows = (await db.execute(
        select(ProviderAccount).order_by(ProviderAccount.kind, ProviderAccount.priority)
    )).scalars().all()
    return [_out(a) for a in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_account(body: CreateAccount, current_user: CurrentUser, db: DB) -> dict:
    _require_staff(current_user)
    if body.kind not in ("llm", "seo"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="kind must be llm|seo")
    acct = ProviderAccount(
        id=uuid.uuid4(), kind=body.kind, provider=body.provider, label=body.label,
        encrypted_credentials=encrypt_value(body.credentials),
        priority=body.priority, monthly_budget_cents=body.monthly_budget_cents,
    )
    db.add(acct)
    await db.commit()
    await db.refresh(acct)
    out = _out(acct)
    out["credentials_hint"] = "…" + body.credentials[-4:]  # last-4 hint on create
    return out


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(account_id: uuid.UUID, current_user: CurrentUser, db: DB) -> None:
    _require_staff(current_user)
    acct = await db.get(ProviderAccount, account_id)
    if acct is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.delete(acct)
    await db.commit()
```

- [ ] **Step 4: Register the router**

In `apps/api/app/api/v1/router.py`, add `provider_accounts` to the
`from app.api.v1.routers import (...)` list and:
```python
api_router.include_router(provider_accounts.router, prefix="/admin/provider-accounts", tags=["admin"])
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && python -m pytest tests/test_provider_accounts_router.py -v` → PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/api/v1/routers/provider_accounts.py apps/api/app/api/v1/router.py apps/api/tests/test_provider_accounts_router.py
git commit -m "feat(billing): staff-only provider_accounts admin CRUD

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Full backend suite: `cd apps/api && python -m pytest -q` → only the known
  pre-existing failures (Postgres-auth `test_edit_model.py`, missing-package
  `test_strands_runtime.py`) remain; all new + touched suites pass.
- [ ] Migrations applied: `make db-migrate` shows head `e0t1u2v3w4x5`.
- [ ] Manual smoke (with a real `OPENAI_API_KEY` in the api container env and no
  tenant key): run any AI feature (e.g. onboarding discovery) and confirm it works
  off the platform key — no "connect your API key" state. Restart the worker after
  changing env so it reloads (`docker compose restart worker`).

## Notes for the implementer

- **Reuse the seams, don't rewrite callers.** The whole point is that
  `get_org_llm_keys` and `get_seo_provider_for_org` keep their signatures, so the 8+
  existing call sites (writing_service, campaign_director, agents/runner, discovery,
  etc.) are untouched — only the credential *source* flips.
- **Out of scope (Phase 1):** the `model_catalog` table, capability-band routing,
  the `tiers.py` band re-map, `UsageMeter`/metering, quotas, and Stripe. Do not add
  them here — this phase is purely the platform-provider flip + BYOK plumbing.
- **Match existing test fixtures.** Inspect `tests/test_workspace_provisioning.py`
  and `tests/test_onboarding_router.py` for the SQLite/dep-override patterns and
  mirror them rather than inventing new fixtures.
- **Encryption round-trips.** `encrypt_value`/`decrypt_value` are symmetric; tests
  encrypt before insert and expect the registry to decrypt.
