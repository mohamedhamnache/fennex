# Unified Content Calendar + Auto-Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A unified month/week calendar across articles, social posts, and banners, where explicitly-scheduled items auto-publish at their time via existing publish integrations.

**Architecture:** One `CalendarEntry` table is the scheduling authority (content models untouched). A `calendar_service` handles CRUD + a `publish_entry` dispatch core that routes to existing publish paths (article→WordPress, banner→WordPress, social→LinkedIn). Phase 1 = calendar + scheduling + manual "Publish now"; Phase 2 = an arq cron that calls `publish_entry` on due `scheduled` entries.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, arq, pytest (backend); Next.js 14 App Router, TypeScript, TanStack Query, Tailwind, react-i18next (frontend).

Spec: `docs/superpowers/specs/2026-07-07-content-calendar-design.md`

## Global Constraints

- **NO EMOJI** anywhere (code, UI, comments, commit messages).
- Backend async throughout; models extend `Base, TimestampMixin`; use generic `sqlalchemy` column types (no JSONB) for SQLite test compatibility.
- Routers use `CurrentUser`/`DB` from `app.core.dependencies`; org-scoped via `current_user.org_id`. API under `/api/v1`; new router registered in `app/api/v1/router.py`.
- Content types: `article` | `social` | `banner`. States: `planned` | `scheduled` | `publishing` | `published` | `failed`.
- **Auto-publish gate:** only `scheduled` entries publish. Transition to `scheduled` requires a valid target: `target_kind` set, and for `wordpress` a `connection_id` owned by the org. `linkedin` needs no `connection_id` (uses the org's LinkedIn `SocialConnection`).
- **v1 targets only:** `target_kind` ∈ {`wordpress`, `linkedin`}. Article→WordPress via `WordPressConnector`; banner→WordPress via `publish_to_wordpress`; social→LinkedIn via `ugcPosts`. Shopify + non-LinkedIn social are out of scope (blocked from `scheduled`).
- `scheduled_at` stored ISO-8601 UTC; display tz from the entry's `timezone` (creator's browser tz).
- Frontend: all API via `apiClient`; Tailwind CSS variables only; **full i18n** — every user-visible string via `t()`, keys added to `apps/web/public/locales/en/common.json` (other locales fall back to en). Verify with `npm run typecheck` (no FE test framework).
- Tests run inside docker: `docker compose exec -T api pytest ...` from repo root. Commit style `feat(calendar): ...`.

---

## PHASE 1 — Calendar + scheduling + manual publish

### Task 1: `CalendarEntry` model + migration

**Files:**
- Create: `apps/api/app/models/calendar_entry.py`
- Modify: `apps/api/app/models/__init__.py` (register import, with `# noqa: F401`, next to the others)
- Create: `apps/api/alembic/versions/<newid>_calendar_entries.py`
- Test: `apps/api/tests/test_calendar.py`

**Interfaces:**
- Produces: `CalendarEntry` ORM model, table `calendar_entries`.

- [ ] **Step 1: Write the model** — `apps/api/app/models/calendar_entry.py`:
```python
import uuid

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class CalendarEntry(Base, TimestampMixin):
    __tablename__ = "calendar_entries"
    __table_args__ = (
        Index("ix_calendar_entries_project_id", "project_id"),
        Index("ix_calendar_entries_state_scheduled_at", "state", "scheduled_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    content_type: Mapped[str] = mapped_column(String(20), nullable=False)   # article | social | banner
    content_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    scheduled_at: Mapped[str] = mapped_column(String(50), nullable=False)   # ISO-8601 UTC
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", nullable=False)
    target_kind: Mapped[str | None] = mapped_column(String(20))             # wordpress | linkedin
    connection_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    state: Mapped[str] = mapped_column(String(20), default="planned", nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    published_at: Mapped[str | None] = mapped_column(String(50))
    published_url: Mapped[str | None] = mapped_column(String(500))
```

- [ ] **Step 2: Register** in `apps/api/app/models/__init__.py`: add `from app.models.calendar_entry import CalendarEntry  # noqa: F401` beside the other model imports.

- [ ] **Step 3: Write the failing test** — create `apps/api/tests/test_calendar.py`. Copy the SQLite harness blocks from `apps/api/tests/test_recommendations.py` (engine, `override_get_db`, fake user, `setup_db`, `db_session`, `org_and_project`, `client`, `FAKE_ORG_ID`/`FAKE_PROJECT_ID`) with:
```python
SQLITE_COMPATIBLE_TABLES = [
    "organizations", "users", "projects",
    "articles", "social_posts", "generated_images", "calendar_entries",
]
from app.models.article import Article  # noqa: F401
from app.models.social import SocialPost  # noqa: F401
from app.models.image import GeneratedImage  # noqa: F401
from app.models.calendar_entry import CalendarEntry  # noqa: F401
```
First test:
```python
import pytest


@pytest.mark.asyncio
async def test_calendar_entry_persists(db_session, org_and_project):
    import uuid
    rec = CalendarEntry(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID,
        content_type="article", content_id=uuid.uuid4(), title="Hello",
        scheduled_at="2026-08-01T09:00:00+00:00", timezone="Europe/Paris", state="planned",
    )
    db_session.add(rec)
    await db_session.commit()
    await db_session.refresh(rec)
    assert rec.id is not None
    assert rec.state == "planned"
```

- [ ] **Step 4: Run to verify it fails**

Run: `docker compose exec -T api pytest tests/test_calendar.py::test_calendar_entry_persists -v`
Expected: FAIL (no table).

- [ ] **Step 5: Run to verify it passes** (model + registration make it pass)

Run: `docker compose exec -T api pytest tests/test_calendar.py::test_calendar_entry_persists -v`
Expected: PASS

- [ ] **Step 6: Write the migration** — find the current head: `docker compose exec -T api alembic heads`. Create `apps/api/alembic/versions/c1a2l3e4n5d6_calendar_entries.py` (pick a unique revision id NOT already present — verify with `ls apps/api/alembic/versions | grep c1a2l3e4n5d6` returns nothing):
```python
"""calendar_entries table"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "c1a2l3e4n5d6"
down_revision = "<CURRENT_HEAD>"  # replace with alembic heads output
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "calendar_entries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_type", sa.String(20), nullable=False),
        sa.Column("content_id", UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("scheduled_at", sa.String(50), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
        sa.Column("target_kind", sa.String(20)),
        sa.Column("connection_id", UUID(as_uuid=True)),
        sa.Column("state", sa.String(20), nullable=False, server_default="planned"),
        sa.Column("error", sa.Text()),
        sa.Column("published_at", sa.String(50)),
        sa.Column("published_url", sa.String(500)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_calendar_entries_project_id", "calendar_entries", ["project_id"])
    op.create_index("ix_calendar_entries_state_scheduled_at", "calendar_entries", ["state", "scheduled_at"])


def downgrade() -> None:
    op.drop_index("ix_calendar_entries_state_scheduled_at", table_name="calendar_entries")
    op.drop_index("ix_calendar_entries_project_id", table_name="calendar_entries")
    op.drop_table("calendar_entries")
```

- [ ] **Step 7: Apply + verify**

Run: `make db-migrate` then `docker compose exec -T postgres psql -U fennex -d fennex -c "\d calendar_entries"`
Expected: table exists with the columns above. (If a partial apply error occurs — "relation already exists" with an unstamped revision — `docker compose exec -T postgres psql -U fennex -d fennex -c "DROP TABLE IF EXISTS calendar_entries CASCADE;"` then re-run `make db-migrate`.)

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/models/calendar_entry.py apps/api/app/models/__init__.py apps/api/alembic/versions/c1a2l3e4n5d6_calendar_entries.py apps/api/tests/test_calendar.py
git commit -m "feat(calendar): add CalendarEntry model and migration"
```

---

### Task 2: `calendar_service` — CRUD + title snapshot + scheduled-gate

**Files:**
- Create: `apps/api/app/services/calendar_service.py`
- Test: `apps/api/tests/test_calendar.py` (append)

**Interfaces:**
- Consumes: `CalendarEntry`; `Article`, `SocialPost`, `GeneratedImage`; `PublishingConnection`.
- Produces:
  - `async create_entry(project_id, org_id, data: dict, db) -> CalendarEntry`
  - `async list_entries(project_id, org_id, start_iso, end_iso, db) -> list[CalendarEntry]`
  - `async update_entry(entry_id, org_id, patch: dict, db) -> CalendarEntry | None`
  - `async delete_entry(entry_id, org_id, db) -> bool`
  - `class CalendarError(Exception)` (raised for invalid content / invalid scheduled transition)
  - `data` keys: `content_type, content_id, scheduled_at, timezone?, target_kind?, connection_id?, state?`

- [ ] **Step 1: Write failing tests** — append to `tests/test_calendar.py`:
```python
import uuid
from app.models.article import Article, ArticleStatus


@pytest.mark.asyncio
async def test_create_entry_snapshots_article_title(db_session, org_and_project):
    from app.services.calendar_service import create_entry
    art = Article(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, title="My SEO Guide", status=ArticleStatus.ready)
    db_session.add(art)
    await db_session.commit()
    entry = await create_entry(FAKE_PROJECT_ID, FAKE_ORG_ID,
        {"content_type": "article", "content_id": str(art.id), "scheduled_at": "2026-08-01T09:00:00+00:00"}, db_session)
    assert entry.title == "My SEO Guide"
    assert entry.state == "planned"


@pytest.mark.asyncio
async def test_create_entry_unknown_content_raises(db_session, org_and_project):
    from app.services.calendar_service import create_entry, CalendarError
    with pytest.raises(CalendarError):
        await create_entry(FAKE_PROJECT_ID, FAKE_ORG_ID,
            {"content_type": "article", "content_id": str(uuid.uuid4()), "scheduled_at": "2026-08-01T09:00:00+00:00"}, db_session)


@pytest.mark.asyncio
async def test_schedule_requires_valid_target(db_session, org_and_project):
    from app.services.calendar_service import create_entry, update_entry, CalendarError
    art = Article(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, title="A", status=ArticleStatus.ready)
    db_session.add(art)
    await db_session.commit()
    entry = await create_entry(FAKE_PROJECT_ID, FAKE_ORG_ID,
        {"content_type": "article", "content_id": str(art.id), "scheduled_at": "2026-08-01T09:00:00+00:00"}, db_session)
    # no target -> cannot schedule
    with pytest.raises(CalendarError):
        await update_entry(entry.id, FAKE_ORG_ID, {"state": "scheduled"}, db_session)
    # linkedin target needs no connection -> allowed
    ok = await update_entry(entry.id, FAKE_ORG_ID, {"target_kind": "linkedin", "state": "scheduled"}, db_session)
    assert ok.state == "scheduled"


@pytest.mark.asyncio
async def test_list_entries_in_range(db_session, org_and_project):
    from app.services.calendar_service import create_entry, list_entries
    art = Article(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, title="A", status=ArticleStatus.ready)
    db_session.add(art)
    await db_session.commit()
    await create_entry(FAKE_PROJECT_ID, FAKE_ORG_ID,
        {"content_type": "article", "content_id": str(art.id), "scheduled_at": "2026-08-15T09:00:00+00:00"}, db_session)
    inside = await list_entries(FAKE_PROJECT_ID, FAKE_ORG_ID, "2026-08-01T00:00:00+00:00", "2026-08-31T23:59:59+00:00", db_session)
    outside = await list_entries(FAKE_PROJECT_ID, FAKE_ORG_ID, "2026-09-01T00:00:00+00:00", "2026-09-30T23:59:59+00:00", db_session)
    assert len(inside) == 1 and len(outside) == 0
```

- [ ] **Step 2: Run to verify fail**

Run: `docker compose exec -T api pytest tests/test_calendar.py -k "snapshots or unknown_content or requires_valid_target or in_range" -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `apps/api/app/services/calendar_service.py`:
```python
"""Unified content calendar — scheduling authority + CRUD. Publish dispatch lives in calendar_publish.py."""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article
from app.models.calendar_entry import CalendarEntry
from app.models.image import GeneratedImage
from app.models.publishing import PublishingConnection
from app.models.social import SocialPost

VALID_TYPES = {"article", "social", "banner"}
VALID_TARGETS = {"wordpress", "linkedin"}


class CalendarError(Exception):
    pass


async def _content_title(content_type: str, content_id: uuid.UUID, project_id, org_id, db: AsyncSession) -> str | None:
    if content_type == "article":
        row = (await db.execute(select(Article).where(
            Article.id == content_id, Article.org_id == org_id, Article.project_id == project_id))).scalars().first()
        return row.title if row else None
    if content_type == "social":
        row = (await db.execute(select(SocialPost).where(
            SocialPost.id == content_id, SocialPost.org_id == org_id, SocialPost.project_id == project_id))).scalars().first()
        return (row.content[:80] if row else None)
    if content_type == "banner":
        row = (await db.execute(select(GeneratedImage).where(
            GeneratedImage.id == content_id, GeneratedImage.org_id == org_id, GeneratedImage.project_id == project_id))).scalars().first()
        if not row:
            return None
        return (row.caption or row.seo_filename or (row.prompt or "")[:60] or "Banner")
    return None


async def _validate_target(entry: CalendarEntry, org_id, db: AsyncSession) -> None:
    """Raise CalendarError if the entry cannot be armed to 'scheduled'."""
    if entry.target_kind not in VALID_TARGETS:
        raise CalendarError("A publish target is required before scheduling.")
    if entry.target_kind == "wordpress":
        if entry.connection_id is None:
            raise CalendarError("Select a WordPress connection before scheduling.")
        conn = (await db.execute(select(PublishingConnection).where(
            PublishingConnection.id == entry.connection_id, PublishingConnection.org_id == org_id))).scalars().first()
        if conn is None:
            raise CalendarError("The selected connection was not found.")
    # linkedin: no connection_id required here


async def create_entry(project_id, org_id, data: dict, db: AsyncSession) -> CalendarEntry:
    ctype = data["content_type"]
    if ctype not in VALID_TYPES:
        raise CalendarError(f"Unknown content type: {ctype}")
    cid = uuid.UUID(str(data["content_id"]))
    title = await _content_title(ctype, cid, project_id, org_id, db)
    if title is None:
        raise CalendarError("Content not found for this project.")
    entry = CalendarEntry(
        org_id=org_id, project_id=project_id, content_type=ctype, content_id=cid,
        title=title[:500], scheduled_at=data["scheduled_at"],
        timezone=data.get("timezone") or "UTC",
        target_kind=data.get("target_kind"), connection_id=data.get("connection_id"),
        state="planned",
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


async def list_entries(project_id, org_id, start_iso: str, end_iso: str, db: AsyncSession) -> list[CalendarEntry]:
    rows = (await db.execute(select(CalendarEntry).where(
        CalendarEntry.project_id == project_id, CalendarEntry.org_id == org_id,
        CalendarEntry.scheduled_at >= start_iso, CalendarEntry.scheduled_at <= end_iso,
    ).order_by(CalendarEntry.scheduled_at))).scalars().all()
    return list(rows)


async def update_entry(entry_id, org_id, patch: dict, db: AsyncSession) -> CalendarEntry | None:
    entry = (await db.execute(select(CalendarEntry).where(
        CalendarEntry.id == entry_id, CalendarEntry.org_id == org_id))).scalars().first()
    if entry is None:
        return None
    for field in ("scheduled_at", "timezone", "target_kind", "connection_id"):
        if field in patch and patch[field] is not None:
            setattr(entry, field, patch[field])
    if patch.get("state") == "scheduled":
        await _validate_target(entry, org_id, db)
        entry.state = "scheduled"
    elif "state" in patch and patch["state"] in ("planned", "scheduled", "failed"):
        entry.state = patch["state"]
    await db.commit()
    await db.refresh(entry)
    return entry


async def delete_entry(entry_id, org_id, db: AsyncSession) -> bool:
    entry = (await db.execute(select(CalendarEntry).where(
        CalendarEntry.id == entry_id, CalendarEntry.org_id == org_id))).scalars().first()
    if entry is None:
        return False
    await db.delete(entry)
    await db.commit()
    return True
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec -T api pytest tests/test_calendar.py -k "snapshots or unknown_content or requires_valid_target or in_range" -v`
Expected: PASS (4)

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/calendar_service.py apps/api/tests/test_calendar.py
git commit -m "feat(calendar): calendar_service CRUD with title snapshot and schedule gate"
```

---

### Task 3: `publish_entry` dispatch (article/banner/social)

**Files:**
- Create: `apps/api/app/services/calendar_publish.py`
- Test: `apps/api/tests/test_calendar.py` (append)

**Interfaces:**
- Consumes: `CalendarEntry`, content models, `PublishingConnection`, `WordPressConnector`, `publish_to_wordpress`, `decrypt_credentials`, `decrypt_value`, `SocialConnection`.
- Produces: `async publish_entry(entry, db) -> CalendarEntry` (sets `publishing` then `published`/`failed`).

- [ ] **Step 1: Write failing tests** (publish paths mocked so no network) — append:
```python
from datetime import datetime, timezone as _tz
from unittest.mock import AsyncMock, patch
from app.models.social import SocialPost, SocialPlatform, SocialPostStatus
from app.models.calendar_entry import CalendarEntry


@pytest.mark.asyncio
async def test_publish_entry_social_success(db_session, org_and_project):
    from app.services.calendar_publish import publish_entry
    post = SocialPost(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, platform=SocialPlatform.linkedin,
                      content="hello world", status=SocialPostStatus.draft, char_count=11)
    db_session.add(post)
    await db_session.commit()
    entry = CalendarEntry(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, content_type="social",
                          content_id=post.id, title="hello", scheduled_at="2026-01-01T00:00:00+00:00",
                          target_kind="linkedin", state="scheduled")
    db_session.add(entry)
    await db_session.commit()
    with patch("app.services.calendar_publish._publish_social", new=AsyncMock(return_value={"ok": True, "url": None})):
        out = await publish_entry(entry, db_session)
    assert out.state == "published"
    assert out.published_at is not None
    refreshed = (await db_session.execute(select(SocialPost))).scalars().first()
    assert refreshed.status == SocialPostStatus.published


@pytest.mark.asyncio
async def test_publish_entry_failure_sets_failed(db_session, org_and_project):
    from app.services.calendar_publish import publish_entry
    post = SocialPost(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, platform=SocialPlatform.linkedin,
                      content="x", status=SocialPostStatus.draft, char_count=1)
    db_session.add(post)
    await db_session.commit()
    entry = CalendarEntry(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, content_type="social",
                          content_id=post.id, title="x", scheduled_at="2026-01-01T00:00:00+00:00",
                          target_kind="linkedin", state="scheduled")
    db_session.add(entry)
    await db_session.commit()
    with patch("app.services.calendar_publish._publish_social", new=AsyncMock(side_effect=RuntimeError("boom"))):
        out = await publish_entry(entry, db_session)
    assert out.state == "failed"
    assert "boom" in (out.error or "")


@pytest.mark.asyncio
async def test_publish_entry_skips_non_scheduled(db_session, org_and_project):
    from app.services.calendar_publish import publish_entry
    entry = CalendarEntry(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, content_type="social",
                          content_id=uuid.uuid4(), title="x", scheduled_at="2026-01-01T00:00:00+00:00",
                          target_kind="linkedin", state="published")
    db_session.add(entry)
    await db_session.commit()
    out = await publish_entry(entry, db_session)
    assert out.state == "published"  # unchanged; not re-dispatched
```

- [ ] **Step 2: Run to verify fail**

Run: `docker compose exec -T api pytest tests/test_calendar.py -k "publish_entry" -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `apps/api/app/services/calendar_publish.py`:
```python
"""Publish dispatch for calendar entries. Reuses the existing per-type publish paths."""
import json
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decrypt_credentials, decrypt_value
from app.integrations.publishing.wordpress import WordPressConnector
from app.models.article import Article, ArticleStatus
from app.models.calendar_entry import CalendarEntry
from app.models.image import GeneratedImage
from app.models.publishing import PublishingConnection, PublishJob, PublishJobStatus
from app.models.social import SocialConnection, SocialPlatform, SocialPost, SocialPostStatus
from app.services.publish_service import publish_to_wordpress


async def _wp_connection(entry: CalendarEntry, db: AsyncSession) -> PublishingConnection:
    conn = (await db.execute(select(PublishingConnection).where(
        PublishingConnection.id == entry.connection_id, PublishingConnection.org_id == entry.org_id))).scalars().first()
    if conn is None or not conn.credentials_encrypted:
        raise RuntimeError("WordPress connection missing or has no credentials.")
    return conn


async def _publish_article(entry: CalendarEntry, db: AsyncSession) -> dict:
    art = (await db.execute(select(Article).where(
        Article.id == entry.content_id, Article.org_id == entry.org_id))).scalars().first()
    if art is None:
        raise RuntimeError("Article no longer exists.")
    conn = await _wp_connection(entry, db)
    creds = decrypt_credentials(conn.credentials_encrypted)
    wp = WordPressConnector(site_url=conn.site_url, username=creds["username"], app_password=creds["app_password"])
    result = await wp.publish_post(
        title=art.title, content_html=art.body_html or "", status="publish",
        meta_title=art.meta_title, meta_description=art.meta_description,
    )
    if not result.get("ok"):
        raise RuntimeError(f"WordPress publish failed: {result}")
    db.add(PublishJob(org_id=entry.org_id, project_id=entry.project_id, connection_id=conn.id,
                      article_id=art.id, status=PublishJobStatus.done,
                      platform_post_id=str(result.get("post_id")), published_url=result.get("url")))
    art.status = ArticleStatus.published
    return {"ok": True, "url": result.get("url")}


async def _publish_banner(entry: CalendarEntry, db: AsyncSession) -> dict:
    img = (await db.execute(select(GeneratedImage).where(
        GeneratedImage.id == entry.content_id, GeneratedImage.org_id == entry.org_id))).scalars().first()
    if img is None or not img.image_url:
        raise RuntimeError("Banner image no longer exists.")
    conn = await _wp_connection(entry, db)
    creds = decrypt_credentials(conn.credentials_encrypted)
    result = await publish_to_wordpress(
        image_url=img.image_url, seo_filename=img.seo_filename, alt_text=img.alt_text,
        wp_url=conn.site_url, wp_user=creds.get("username", ""), wp_app_password=creds.get("app_password", ""),
    )
    if not result.get("ok"):
        raise RuntimeError(f"WordPress image publish failed: {result}")
    return {"ok": True, "url": result.get("url")}


async def _publish_social(entry: CalendarEntry, db: AsyncSession) -> dict:
    post = (await db.execute(select(SocialPost).where(
        SocialPost.id == entry.content_id, SocialPost.org_id == entry.org_id))).scalars().first()
    if post is None:
        raise RuntimeError("Social post no longer exists.")
    if post.platform != SocialPlatform.linkedin:
        raise RuntimeError("Only LinkedIn auto-publish is supported.")
    conn = (await db.execute(select(SocialConnection).where(
        SocialConnection.org_id == entry.org_id, SocialConnection.platform == SocialPlatform.linkedin))).scalars().first()
    if conn is None:
        raise RuntimeError("LinkedIn is not connected.")
    creds = json.loads(decrypt_value(conn.encrypted_token))
    token, urn = creds.get("access_token"), creds.get("urn")
    if not token or not urn:
        raise RuntimeError("LinkedIn credentials are incomplete — reconnect.")
    text = post.content
    if post.hashtags:
        text += "\n\n" + " ".join(h if h.startswith("#") else f"#{h}" for h in post.hashtags)
    body = {
        "author": urn, "lifecycleState": "PUBLISHED",
        "specificContent": {"com.linkedin.ugc.ShareContent": {
            "shareCommentary": {"text": text[:2900]}, "shareMediaCategory": "NONE"}},
        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post("https://api.linkedin.com/v2/ugcPosts",
            headers={"Authorization": f"Bearer {token}", "X-Restli-Protocol-Version": "2.0.0"}, json=body)
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"LinkedIn rejected the post ({resp.status_code}): {resp.text[:180]}")
    post.status = SocialPostStatus.published
    return {"ok": True, "url": None}


_DISPATCH = {"article": _publish_article, "banner": _publish_banner, "social": _publish_social}


async def publish_entry(entry: CalendarEntry, db: AsyncSession) -> CalendarEntry:
    """Publish a single calendar entry. No-op unless it is armed (scheduled or failed-retry)."""
    if entry.state not in ("scheduled", "failed"):
        return entry
    entry.state = "publishing"
    await db.commit()
    try:
        result = await _DISPATCH[entry.content_type](entry, db)
        entry.state = "published"
        entry.published_at = datetime.now(timezone.utc).isoformat()
        entry.published_url = result.get("url")
        entry.error = None
    except Exception as exc:  # noqa: BLE001 — record any publish failure on the entry
        entry.state = "failed"
        entry.error = str(exc)[:2000]
    await db.commit()
    await db.refresh(entry)
    return entry
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec -T api pytest tests/test_calendar.py -k "publish_entry" -v`
Expected: PASS (3)

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/calendar_publish.py apps/api/tests/test_calendar.py
git commit -m "feat(calendar): publish_entry dispatch for article/banner/social"
```

---

### Task 4: API router `/calendar`

**Files:**
- Create: `apps/api/app/api/v1/routers/calendar.py`
- Modify: `apps/api/app/api/v1/router.py` (register)
- Test: `apps/api/tests/test_calendar.py` (append endpoint tests)

**Interfaces:**
- Consumes: `calendar_service` (Task 2), `publish_entry` (Task 3), `CurrentUser`/`DB`.
- Produces routes under `/api/v1/calendar`: `GET`, `POST`, `PATCH /{entry_id}`, `DELETE /{entry_id}`, `POST /{entry_id}/publish-now`.

- [ ] **Step 1: Write failing endpoint tests** — append:
```python
@pytest.mark.asyncio
async def test_calendar_endpoints_crud(client, org_and_project, db_session):
    art = Article(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, title="Endpoint", status=ArticleStatus.ready)
    db_session.add(art)
    await db_session.commit()
    r = await client.post(f"/api/v1/calendar?project_id={FAKE_PROJECT_ID}",
        json={"content_type": "article", "content_id": str(art.id), "scheduled_at": "2026-08-01T09:00:00+00:00"})
    assert r.status_code == 201, r.text
    eid = r.json()["id"]
    lst = await client.get(f"/api/v1/calendar?project_id={FAKE_PROJECT_ID}&start=2026-08-01T00:00:00+00:00&end=2026-08-31T23:59:59+00:00")
    assert lst.status_code == 200 and len(lst.json()) == 1
    patched = await client.patch(f"/api/v1/calendar/{eid}", json={"target_kind": "linkedin", "state": "scheduled"})
    assert patched.status_code == 200 and patched.json()["state"] == "scheduled"
    dele = await client.delete(f"/api/v1/calendar/{eid}")
    assert dele.status_code == 204


@pytest.mark.asyncio
async def test_patch_schedule_without_target_400(client, org_and_project, db_session):
    art = Article(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, title="NT", status=ArticleStatus.ready)
    db_session.add(art)
    await db_session.commit()
    eid = (await client.post(f"/api/v1/calendar?project_id={FAKE_PROJECT_ID}",
        json={"content_type": "article", "content_id": str(art.id), "scheduled_at": "2026-08-01T09:00:00+00:00"})).json()["id"]
    r = await client.patch(f"/api/v1/calendar/{eid}", json={"state": "scheduled"})
    assert r.status_code == 400
```

- [ ] **Step 2: Run to verify fail**

Run: `docker compose exec -T api pytest tests/test_calendar.py -k "endpoints_crud or without_target" -v`
Expected: FAIL (routes missing).

- [ ] **Step 3: Implement router** — `apps/api/app/api/v1/routers/calendar.py`:
```python
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.core.dependencies import CurrentUser, DB
from app.services import calendar_service as svc
from app.services.calendar_publish import publish_entry

router = APIRouter()


class EntryCreate(BaseModel):
    content_type: str
    content_id: str
    scheduled_at: str
    timezone: Optional[str] = None
    target_kind: Optional[str] = None
    connection_id: Optional[str] = None


class EntryPatch(BaseModel):
    scheduled_at: Optional[str] = None
    timezone: Optional[str] = None
    target_kind: Optional[str] = None
    connection_id: Optional[str] = None
    state: Optional[str] = None


def _serialize(e) -> dict:
    return {
        "id": str(e.id), "content_type": e.content_type, "content_id": str(e.content_id),
        "title": e.title, "scheduled_at": e.scheduled_at, "timezone": e.timezone,
        "target_kind": e.target_kind, "connection_id": str(e.connection_id) if e.connection_id else None,
        "state": e.state, "error": e.error, "published_at": e.published_at, "published_url": e.published_url,
    }


@router.get("")
async def list_calendar(project_id: uuid.UUID, start: str, end: str, current_user: CurrentUser, db: DB):
    rows = await svc.list_entries(project_id, current_user.org_id, start, end, db)
    return [_serialize(r) for r in rows]


@router.post("", status_code=201)
async def create_calendar(project_id: uuid.UUID, body: EntryCreate, current_user: CurrentUser, db: DB):
    try:
        entry = await svc.create_entry(project_id, current_user.org_id, body.model_dump(), db)
    except svc.CalendarError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    return _serialize(entry)


@router.patch("/{entry_id}")
async def patch_calendar(entry_id: uuid.UUID, body: EntryPatch, current_user: CurrentUser, db: DB):
    try:
        entry = await svc.update_entry(entry_id, current_user.org_id, body.model_dump(exclude_none=True), db)
    except svc.CalendarError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
    return _serialize(entry)


@router.delete("/{entry_id}", status_code=204)
async def delete_calendar(entry_id: uuid.UUID, current_user: CurrentUser, db: DB):
    ok = await svc.delete_entry(entry_id, current_user.org_id, db)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")


@router.post("/{entry_id}/publish-now")
async def publish_now(entry_id: uuid.UUID, current_user: CurrentUser, db: DB):
    from sqlalchemy import select
    from app.models.calendar_entry import CalendarEntry
    entry = (await db.execute(select(CalendarEntry).where(
        CalendarEntry.id == entry_id, CalendarEntry.org_id == current_user.org_id))).scalars().first()
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
    if entry.state == "planned":
        # allow immediate publish only when a target is set
        try:
            await svc._validate_target(entry, current_user.org_id, db)  # noqa: SLF001 — reuse gate
        except svc.CalendarError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
        entry.state = "scheduled"
    result = await publish_entry(entry, db)
    return _serialize(result)
```

- [ ] **Step 4: Register** in `apps/api/app/api/v1/router.py`: add `calendar` to the `from app.api.v1.routers import (...)` block and `api_router.include_router(calendar.router, prefix="/calendar", tags=["calendar"])`.

- [ ] **Step 5: Run to verify pass**

Run: `docker compose exec -T api pytest tests/test_calendar.py -v`
Expected: PASS (all in file).

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/api/v1/routers/calendar.py apps/api/app/api/v1/router.py apps/api/tests/test_calendar.py
git commit -m "feat(calendar): REST endpoints for calendar entries + publish-now"
```

---

### Task 5: Frontend API client + types

**Files:**
- Modify: `apps/web/lib/api.ts`

**Interfaces:**
- Produces: `CalendarEntry` type + `listCalendar`, `createCalendarEntry`, `updateCalendarEntry`, `deleteCalendarEntry`, `publishCalendarEntryNow`.

- [ ] **Step 1: Add types + functions** — append near the analytics section of `apps/web/lib/api.ts`:
```typescript
export type CalendarContentType = "article" | "social" | "banner";
export type CalendarState = "planned" | "scheduled" | "publishing" | "published" | "failed";

export interface CalendarEntry {
  id: string;
  content_type: CalendarContentType;
  content_id: string;
  title: string;
  scheduled_at: string;
  timezone: string;
  target_kind: "wordpress" | "linkedin" | null;
  connection_id: string | null;
  state: CalendarState;
  error: string | null;
  published_at: string | null;
  published_url: string | null;
}

export interface CreateCalendarEntryInput {
  content_type: CalendarContentType;
  content_id: string;
  scheduled_at: string;
  timezone?: string;
  target_kind?: "wordpress" | "linkedin";
  connection_id?: string;
}

export interface UpdateCalendarEntryInput {
  scheduled_at?: string;
  timezone?: string;
  target_kind?: "wordpress" | "linkedin";
  connection_id?: string;
  state?: CalendarState;
}

export async function listCalendar(projectId: string, start: string, end: string): Promise<CalendarEntry[]> {
  return apiClient.get<CalendarEntry[]>(`/calendar?project_id=${projectId}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
}
export async function createCalendarEntry(projectId: string, body: CreateCalendarEntryInput): Promise<CalendarEntry> {
  return apiClient.post<CalendarEntry>(`/calendar?project_id=${projectId}`, body);
}
export async function updateCalendarEntry(id: string, patch: UpdateCalendarEntryInput): Promise<CalendarEntry> {
  return apiClient.patch<CalendarEntry>(`/calendar/${id}`, patch);
}
export async function deleteCalendarEntry(id: string): Promise<void> {
  return apiClient.delete<void>(`/calendar/${id}`);
}
export async function publishCalendarEntryNow(id: string): Promise<CalendarEntry> {
  return apiClient.post<CalendarEntry>(`/calendar/${id}/publish-now`, {});
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/api.ts
git commit -m "feat(calendar): frontend api client and types"
```

---

### Task 6: Calendar page (month grid) + sidebar nav + i18n

**Files:**
- Create: `apps/web/app/(dashboard)/[projectId]/calendar/page.tsx`
- Modify: `apps/web/components/layout/Sidebar.tsx` (add `calendar` to `NAV_ITEMS` + each persona primary list)
- Modify: `apps/web/public/locales/en/common.json` (add `nav.calendar` + a `calendar` block)

**Interfaces:**
- Consumes: `listCalendar`, `CalendarEntry` (Task 5).

- [ ] **Step 1: Add i18n keys** — in `apps/web/public/locales/en/common.json`, add `"calendar": "Calendar"` to the `nav` object, and a new top-level block:
```json
"calendar": {
  "title": "Content calendar",
  "subtitle": "Plan and schedule articles, social posts and banners",
  "addContent": "Add content",
  "prev": "Previous",
  "next": "Next",
  "today": "Today",
  "empty": "Nothing scheduled. Click a day or Add content to start.",
  "publishNow": "Publish now",
  "reschedule": "Reschedule",
  "delete": "Remove from calendar",
  "target": "Publish target",
  "targetWordpress": "WordPress",
  "targetLinkedin": "LinkedIn",
  "state": { "planned": "Planned", "scheduled": "Scheduled", "publishing": "Publishing", "published": "Published", "failed": "Failed" },
  "type": { "article": "Article", "social": "Social", "banner": "Banner" },
  "pickDate": "Date & time",
  "save": "Save",
  "cancel": "Cancel",
  "needTarget": "Choose a publish target to schedule this."
}
```

- [ ] **Step 2: Add `calendar` to the sidebar** — in `apps/web/components/layout/Sidebar.tsx`:
  - Import an icon: add `CalendarDays` to the existing `lucide-react` import.
  - In `NAV_ITEMS`, add: `calendar: { label: "Calendar", href: "calendar", key: "calendar", icon: CalendarDays },` (match the existing NavItem shape — if items use `key`, set `key: "calendar"`; the label renders via `t("nav.calendar")`).
  - In `PERSONA_PRIMARY`, add `"calendar"` to each persona's array (e.g. after `overview`): creator/ecommerce/freelancer all get `calendar`.

- [ ] **Step 3: Build the page** — `apps/web/app/(dashboard)/[projectId]/calendar/page.tsx`:
```typescript
"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { listCalendar, type CalendarEntry } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

const TYPE_COLOR: Record<string, string> = {
  article: "bg-primary/15 text-primary",
  social: "bg-violet-500/15 text-violet-500",
  banner: "bg-amber-500/15 text-amber-600",
};

function monthMatrix(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const startDow = (first.getDay() + 6) % 7; // Monday-first
  const start = new Date(year, month, 1 - startDow);
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) {
      row.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d));
    }
    weeks.push(row);
  }
  return weeks;
}

function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

export default function CalendarPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { t } = useTranslation();
  const [cursor, setCursor] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const weeks = useMemo(() => monthMatrix(year, month), [year, month]);
  const rangeStart = new Date(year, month, 1 - ((new Date(year, month, 1).getDay() + 6) % 7)).toISOString();
  const rangeEnd = new Date(year, month + 1, 7).toISOString();

  const { data: entries = [] } = useQuery({
    queryKey: ["calendar", projectId, year, month],
    queryFn: () => listCalendar(projectId, rangeStart, rangeEnd),
    staleTime: 60_000,
  });

  const byDay = useMemo(() => {
    const map: Record<string, CalendarEntry[]> = {};
    for (const e of entries) {
      const key = ymd(new Date(e.scheduled_at));
      (map[key] ||= []).push(e);
    }
    return map;
  }, [entries]);

  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const todayKey = ymd(new Date());

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <CalendarDays className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-foreground leading-tight">{t("calendar.title")}</h1>
          <p className="text-xs text-muted-foreground leading-tight">{t("calendar.subtitle")}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="rounded-lg border border-border p-1.5 hover:bg-accent" aria-label={t("calendar.prev")}><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[9rem] text-center text-sm font-semibold text-foreground">{monthLabel}</span>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="rounded-lg border border-border p-1.5 hover:bg-accent" aria-label={t("calendar.next")}><ChevronRight className="h-4 w-4" /></button>
          <button onClick={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); }} className="ml-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent">{t("calendar.today")}</button>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-7 border-b bg-muted/30 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="px-2 py-2 text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {weeks.flat().map((day, i) => {
            const key = ymd(day);
            const items = byDay[key] ?? [];
            const dim = day.getMonth() !== month;
            return (
              <div key={i} className={cn("min-h-[92px] border-b border-r p-1.5", dim && "bg-muted/20")}>
                <div className={cn("mb-1 text-[11px] font-medium", key === todayKey ? "text-primary" : "text-muted-foreground")}>
                  {day.getDate()}
                </div>
                <div className="flex flex-col gap-1">
                  {items.slice(0, 3).map((e) => (
                    <div key={e.id} className={cn("truncate rounded px-1.5 py-0.5 text-[11px] font-medium", TYPE_COLOR[e.content_type])} title={e.title}>
                      {e.title}
                    </div>
                  ))}
                  {items.length > 3 && <span className="px-1 text-[10px] text-muted-foreground">+{items.length - 3}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      {entries.length === 0 && <p className="text-center text-xs text-muted-foreground">{t("calendar.empty")}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/[projectId]/calendar/page.tsx" apps/web/components/layout/Sidebar.tsx apps/web/public/locales/en/common.json
git commit -m "feat(calendar): month calendar page with sidebar entry and i18n"
```

---

### Task 7: Add-content modal + entry popover (schedule, target, publish-now, delete)

**Files:**
- Create: `apps/web/components/calendar/AddToCalendarModal.tsx`
- Create: `apps/web/components/calendar/CalendarEntryPopover.tsx`
- Modify: `apps/web/app/(dashboard)/[projectId]/calendar/page.tsx` (wire modal + popover)

**Interfaces:**
- Consumes: `createCalendarEntry`, `updateCalendarEntry`, `deleteCalendarEntry`, `publishCalendarEntryNow`, `listArticles`, `getSocialPosts`/`listSocialPosts`, `listImages`/images list, `getPublishingConnections` (whatever the existing functions are named — verify in `lib/api.ts` before use), `CalendarEntry`.

- [ ] **Step 1: Verify the existing list functions** you will reuse — run `grep -n "export async function listArticles\|SocialPost\|export async function.*[Ii]mages\|[Cc]onnection" apps/web/lib/api.ts` and note the exact names for: draft articles, draft social posts, banners (generated images with a `banner_format`), and WordPress publishing connections. Use those exact names in the modal.

- [ ] **Step 2: Build `AddToCalendarModal.tsx`** — a dialog with: a content-type tab (Article/Social/Banner), a list of that type's schedulable items (fetched via the verified functions; for banners filter `banner_format != null`), a datetime-local input, and (shown only for article/banner) a WordPress connection select. On submit call `createCalendarEntry(projectId, { content_type, content_id, scheduled_at: new Date(local).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, target_kind, connection_id })` then invalidate `["calendar", projectId]`. All labels via `t("calendar.*")`. Use `.popover`/existing modal styling patterns (see an existing modal such as `components/projects/CreateProjectModal.tsx`). No emoji.

- [ ] **Step 3: Build `CalendarEntryPopover.tsx`** — given an entry: show its title, type badge, state badge; a datetime-local to reschedule (`updateCalendarEntry(id, { scheduled_at })`); a target select (WordPress connection / LinkedIn) (`updateCalendarEntry(id, { target_kind, connection_id })`); a Planned/Scheduled toggle (`updateCalendarEntry(id, { state })` — surface the 400 "needTarget" error via a toast if arming without a target); a **Publish now** button (`publishCalendarEntryNow(id)`); a **Remove** button (`deleteCalendarEntry(id)`). Invalidate `["calendar", projectId]` after each mutation. All labels via `t()`. No emoji.

- [ ] **Step 4: Wire into the page** — add an "Add content" button in the header opening `AddToCalendarModal`; make each day cell clickable to open the modal pre-set to that date; make each entry chip clickable to open `CalendarEntryPopover`. Color the chip border/badge by `state` (e.g. failed → destructive, published → success).

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Restart web + smoke test**

Run: `docker compose restart web && sleep 8 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/`
Expected: 200/302. Then in the browser: open `/<projectId>/calendar`, add a draft article on a date, set target, toggle Scheduled, and Publish now.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/calendar/ "apps/web/app/(dashboard)/[projectId]/calendar/page.tsx"
git commit -m "feat(calendar): add-content modal and entry popover with publish-now"
```

---

## PHASE 2 — Auto-publish scheduler

### Task 8: `run_content_scheduler` cron

**Files:**
- Create: `apps/api/app/workers/tasks/calendar_tasks.py`
- Modify: `apps/api/app/workers/worker.py` (register function + cron)
- Test: `apps/api/tests/test_calendar.py` (append)

**Interfaces:**
- Consumes: `publish_entry` (Task 3), `CalendarEntry`.
- Produces: `async run_content_scheduler(ctx)`; a testable helper `async publish_due(db, now_iso) -> int`.

- [ ] **Step 1: Write failing tests** — append:
```python
@pytest.mark.asyncio
async def test_publish_due_selects_only_scheduled_and_due(db_session, org_and_project):
    from unittest.mock import AsyncMock, patch
    from app.workers.tasks.calendar_tasks import publish_due
    post = SocialPost(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, platform=SocialPlatform.linkedin,
                      content="x", status=SocialPostStatus.draft, char_count=1)
    db_session.add(post)
    await db_session.commit()
    # due + scheduled
    db_session.add(CalendarEntry(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, content_type="social",
        content_id=post.id, title="due", scheduled_at="2020-01-01T00:00:00+00:00", target_kind="linkedin", state="scheduled"))
    # future + scheduled -> skip
    db_session.add(CalendarEntry(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, content_type="social",
        content_id=post.id, title="future", scheduled_at="2099-01-01T00:00:00+00:00", target_kind="linkedin", state="scheduled"))
    # due + planned -> skip
    db_session.add(CalendarEntry(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, content_type="social",
        content_id=post.id, title="planned", scheduled_at="2020-01-01T00:00:00+00:00", target_kind="linkedin", state="planned"))
    await db_session.commit()
    with patch("app.services.calendar_publish._publish_social", new=AsyncMock(return_value={"ok": True, "url": None})):
        n = await publish_due(db_session, "2026-01-01T00:00:00+00:00")
    assert n == 1
```

- [ ] **Step 2: Run to verify fail**

Run: `docker compose exec -T api pytest tests/test_calendar.py -k publish_due -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `apps/api/app/workers/tasks/calendar_tasks.py`:
```python
"""Auto-publish scheduler: publish calendar entries that are due and scheduled."""
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.calendar_entry import CalendarEntry
from app.services.calendar_publish import publish_entry


async def publish_due(db, now_iso: str) -> int:
    """Publish all scheduled entries with scheduled_at <= now_iso. Returns count attempted."""
    rows = (await db.execute(select(CalendarEntry).where(
        CalendarEntry.state == "scheduled",
        CalendarEntry.scheduled_at <= now_iso,
    ).limit(50))).scalars().all()
    count = 0
    for entry in rows:
        try:
            await publish_entry(entry, db)
        except Exception:
            pass  # publish_entry records failure on the entry; never break the batch
        count += 1
    return count


async def run_content_scheduler(ctx):
    now_iso = datetime.now(timezone.utc).isoformat()
    async with async_session_factory() as db:
        await publish_due(db, now_iso)
```

- [ ] **Step 4: Register in the worker** — in `apps/api/app/workers/worker.py`: import `run_content_scheduler` where the other task functions are imported; add it to the `functions = [...]` list; and add to `cron_jobs`:
```python
        cron(run_content_scheduler, minute={0, 15, 30, 45}, run_at_startup=False),
```

- [ ] **Step 5: Run to verify pass + worker loads**

Run: `docker compose exec -T api pytest tests/test_calendar.py -k publish_due -v`
Expected: PASS
Run: `docker compose restart worker && docker compose logs worker 2>&1 | grep -i "Starting worker for" | tail -1`
Expected: the function list now includes `run_content_scheduler` and `cron:run_content_scheduler`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/workers/tasks/calendar_tasks.py apps/api/app/workers/worker.py apps/api/tests/test_calendar.py
git commit -m "feat(calendar): auto-publish scheduler cron for due scheduled entries"
```

---

## Final verification

- [ ] Backend: `docker compose exec -T api pytest tests/test_calendar.py -v` — all PASS.
- [ ] Frontend: `cd apps/web && npm run typecheck` — clean.
- [ ] Restart: `docker compose restart api web worker`.
- [ ] Live browser check at `http://localhost:3001/<projectId>/calendar`: add a draft article to a date, set a WordPress target, toggle Scheduled, Publish now → chip shows Published; add a LinkedIn social post, Publish now → posts (or shows a clear failure if LinkedIn not connected).
- [ ] Scheduler smoke (container python, mirroring prior features): create a `scheduled` LinkedIn entry with `scheduled_at` in the past, run `publish_due(db, utcnow_iso)`, assert the entry moved to `published` (or `failed` with a clear error if no LinkedIn connection).
