# Phase 11a: Backlinks — Data Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the 6 backlink database tables and their ORM models.

**Architecture:** Single Alembic migration (revision `g2b3c4d5e6f7`, chaining from `f1a2b3c4d5e6`) creates all tables. ORM models in a new `app/models/backlinks.py` file following the same `Base + TimestampMixin + mapped_column` pattern as every other model in this codebase.

**Tech Stack:** SQLAlchemy 2.0 async mapped_column style, Alembic raw-SQL `op.execute(sa.text(...))`, PostgreSQL.

## Global Constraints

- Revision ID: `g2b3c4d5e6f7`, down_revision: `f1a2b3c4d5e6`
- All models use `class Foo(Base, TimestampMixin)` — import both from `app.core.database` and `app.models.base`
- UUID PKs: `mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)`
- All FK CASCADE: `ForeignKey("table.id", ondelete="CASCADE")`
- Migration uses raw SQL only — no `op.create_table()`; use `op.execute(sa.text(...))`
- String lengths from spec: domain 255, url 2048, anchor_text 500, link_type 20, status 20, niche 100, language 10

---

### Task 1: ORM Models

**Files:**
- Create: `apps/api/app/models/backlinks.py`

**Interfaces:**
- Produces: `BacklinkProfile`, `Backlink`, `BacklinkOpportunity`, `ExchangeListing`, `ExchangeRequest`, `ExchangeMessage` — all importable from `app.models.backlinks`

- [ ] **Step 1: Write the test**

```python
# apps/api/tests/test_backlink_models.py
import uuid
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.backlinks import (
    BacklinkProfile, Backlink, BacklinkOpportunity,
    ExchangeListing, ExchangeRequest, ExchangeMessage,
)
from app.models.organization import Organization
from app.models.project import Project

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
engine = create_async_engine(TEST_DATABASE_URL, echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.mark.asyncio
async def test_models_importable():
    for cls in [BacklinkProfile, Backlink, BacklinkOpportunity, ExchangeListing, ExchangeRequest, ExchangeMessage]:
        assert hasattr(cls, "__tablename__")

@pytest.mark.asyncio
async def test_backlink_profile_tablename():
    assert BacklinkProfile.__tablename__ == "backlink_profiles"

@pytest.mark.asyncio
async def test_exchange_request_tablename():
    assert ExchangeRequest.__tablename__ == "exchange_requests"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && python -m pytest tests/test_backlink_models.py -v
```
Expected: ImportError — `backlinks` module doesn't exist yet.

- [ ] **Step 3: Create the models file**

```python
# apps/api/app/models/backlinks.py
import uuid
from sqlalchemy import Boolean, Date, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import TimestampMixin


class BacklinkProfile(Base, TimestampMixin):
    __tablename__ = "backlink_profiles"
    __table_args__ = (UniqueConstraint("project_id", name="uq_backlink_profile_project"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    domain: Mapped[str | None] = mapped_column(String(255))
    total_backlinks: Mapped[int] = mapped_column(Integer, default=0)
    domain_authority: Mapped[float | None] = mapped_column(Float)
    trust_score: Mapped[float | None] = mapped_column(Float)
    spam_score: Mapped[float | None] = mapped_column(Float)
    referring_domains: Mapped[int] = mapped_column(Integer, default=0)
    last_synced_at: Mapped[str | None] = mapped_column(String(50))


class Backlink(Base, TimestampMixin):
    __tablename__ = "backlinks"
    __table_args__ = (UniqueConstraint("project_id", "source_url", name="uq_backlink_project_source"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("backlink_profiles.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    source_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    source_domain: Mapped[str | None] = mapped_column(String(255))
    target_url: Mapped[str | None] = mapped_column(String(2048))
    anchor_text: Mapped[str | None] = mapped_column(String(500))
    domain_authority: Mapped[float | None] = mapped_column(Float)
    trust_score: Mapped[float | None] = mapped_column(Float)
    spam_score: Mapped[float | None] = mapped_column(Float)
    is_spam: Mapped[bool] = mapped_column(Boolean, default=False)
    link_type: Mapped[str] = mapped_column(String(20), default="dofollow")
    first_seen: Mapped[str | None] = mapped_column(String(20))
    last_seen: Mapped[str | None] = mapped_column(String(20))


class BacklinkOpportunity(Base, TimestampMixin):
    __tablename__ = "backlink_opportunities"
    __table_args__ = (UniqueConstraint("project_id", "source_url", name="uq_opportunity_project_source"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    source_domain: Mapped[str | None] = mapped_column(String(255))
    source_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    domain_authority: Mapped[float | None] = mapped_column(Float)
    trust_score: Mapped[float | None] = mapped_column(Float)
    spam_score: Mapped[float | None] = mapped_column(Float)
    is_spam: Mapped[bool] = mapped_column(Boolean, default=False)
    linking_to_competitor: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20), default="new")


class ExchangeListing(Base, TimestampMixin):
    __tablename__ = "exchange_listings"
    __table_args__ = (UniqueConstraint("project_id", name="uq_exchange_listing_project"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    site_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    niche: Mapped[str | None] = mapped_column(String(100))
    language: Mapped[str | None] = mapped_column(String(10))
    domain_authority: Mapped[float | None] = mapped_column(Float)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class ExchangeRequest(Base, TimestampMixin):
    __tablename__ = "exchange_requests"
    __table_args__ = (UniqueConstraint("requester_project_id", "target_project_id", name="uq_exchange_request_pair"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    requester_project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    target_project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    requester_org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    target_org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    requester_url: Mapped[str | None] = mapped_column(String(2048))
    target_url: Mapped[str | None] = mapped_column(String(2048))
    requester_link_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    target_link_verified: Mapped[bool] = mapped_column(Boolean, default=False)


class ExchangeMessage(Base, TimestampMixin):
    __tablename__ = "exchange_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("exchange_requests.id", ondelete="CASCADE"), nullable=False)
    sender_org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/api && python -m pytest tests/test_backlink_models.py -v
```
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/models/backlinks.py apps/api/tests/test_backlink_models.py
git commit -m "feat(api): Phase 11a — backlink ORM models"
```

---

### Task 2: Alembic Migration

**Files:**
- Create: `apps/api/alembic/versions/g2b3c4d5e6f7_phase11_backlink_models.py`

**Interfaces:**
- Consumes: revision `f1a2b3c4d5e6` (phase10 analytics models) must exist
- Produces: 6 tables + indexes in the database

- [ ] **Step 1: Create the migration file**

```python
# apps/api/alembic/versions/g2b3c4d5e6f7_phase11_backlink_models.py
"""phase11_backlink_models

Revision ID: g2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-06-27 00:00:00.000000
"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "g2b3c4d5e6f7"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS backlink_profiles ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  domain VARCHAR(255), "
        "  total_backlinks INTEGER NOT NULL DEFAULT 0, "
        "  domain_authority FLOAT, "
        "  trust_score FLOAT, "
        "  spam_score FLOAT, "
        "  referring_domains INTEGER NOT NULL DEFAULT 0, "
        "  last_synced_at VARCHAR(50), "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() "
        ");"
    ))

    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS backlinks ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  profile_id UUID NOT NULL REFERENCES backlink_profiles(id) ON DELETE CASCADE, "
        "  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  source_url VARCHAR(2048) NOT NULL, "
        "  source_domain VARCHAR(255), "
        "  target_url VARCHAR(2048), "
        "  anchor_text VARCHAR(500), "
        "  domain_authority FLOAT, "
        "  trust_score FLOAT, "
        "  spam_score FLOAT, "
        "  is_spam BOOLEAN NOT NULL DEFAULT FALSE, "
        "  link_type VARCHAR(20) NOT NULL DEFAULT 'dofollow', "
        "  first_seen VARCHAR(20), "
        "  last_seen VARCHAR(20), "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  CONSTRAINT uq_backlink_project_source UNIQUE (project_id, source_url) "
        ");"
    ))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_backlinks_project_id ON backlinks(project_id);"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_backlinks_is_spam ON backlinks(project_id, is_spam);"))

    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS backlink_opportunities ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  source_domain VARCHAR(255), "
        "  source_url VARCHAR(2048) NOT NULL, "
        "  domain_authority FLOAT, "
        "  trust_score FLOAT, "
        "  spam_score FLOAT, "
        "  is_spam BOOLEAN NOT NULL DEFAULT FALSE, "
        "  linking_to_competitor VARCHAR(255), "
        "  status VARCHAR(20) NOT NULL DEFAULT 'new', "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  CONSTRAINT uq_opportunity_project_source UNIQUE (project_id, source_url) "
        ");"
    ))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_backlink_opportunities_project_status ON backlink_opportunities(project_id, status);"))

    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS exchange_listings ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  site_url VARCHAR(2048) NOT NULL, "
        "  niche VARCHAR(100), "
        "  language VARCHAR(10), "
        "  domain_authority FLOAT, "
        "  description TEXT, "
        "  is_active BOOLEAN NOT NULL DEFAULT TRUE, "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() "
        ");"
    ))

    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS exchange_requests ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  requester_project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
        "  target_project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
        "  requester_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  target_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  status VARCHAR(20) NOT NULL DEFAULT 'pending', "
        "  requester_url VARCHAR(2048), "
        "  target_url VARCHAR(2048), "
        "  requester_link_verified BOOLEAN NOT NULL DEFAULT FALSE, "
        "  target_link_verified BOOLEAN NOT NULL DEFAULT FALSE, "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  CONSTRAINT uq_exchange_request_pair UNIQUE (requester_project_id, target_project_id) "
        ");"
    ))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_exchange_requests_requester ON exchange_requests(requester_project_id);"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_exchange_requests_target ON exchange_requests(target_project_id);"))

    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS exchange_messages ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  request_id UUID NOT NULL REFERENCES exchange_requests(id) ON DELETE CASCADE, "
        "  sender_org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  body TEXT NOT NULL, "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() "
        ");"
    ))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_exchange_messages_request ON exchange_messages(request_id, created_at);"))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS exchange_messages;"))
    op.execute(sa.text("DROP TABLE IF EXISTS exchange_requests;"))
    op.execute(sa.text("DROP TABLE IF EXISTS exchange_listings;"))
    op.execute(sa.text("DROP TABLE IF EXISTS backlink_opportunities;"))
    op.execute(sa.text("DROP TABLE IF EXISTS backlinks;"))
    op.execute(sa.text("DROP TABLE IF EXISTS backlink_profiles;"))
```

- [ ] **Step 2: Run migration**

```bash
cd apps/api && docker compose exec api alembic upgrade head
```
Expected: `Running upgrade f1a2b3c4d5e6 -> g2b3c4d5e6f7`

- [ ] **Step 3: Verify tables exist**

```bash
docker compose exec db psql -U postgres -d fennex -c "\dt backlink*" -c "\dt exchange*"
```
Expected: lists `backlink_profiles`, `backlinks`, `backlink_opportunities`, `exchange_listings`, `exchange_requests`, `exchange_messages`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/alembic/versions/g2b3c4d5e6f7_phase11_backlink_models.py
git commit -m "feat(api): Phase 11a — backlink migration g2b3c4d5e6f7"
```
