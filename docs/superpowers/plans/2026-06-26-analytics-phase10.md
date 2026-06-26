# Phase 10: Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full analytics dashboard — GSC OAuth scaffold, mock daily sync worker, keyword rankings table, traffic charts, top pages/queries, and content performance — replacing all stubs from Phase 0.

**Architecture:** Three new DB tables (`analytics_snapshots`, `keyword_rankings`, `gsc_connections`) hold mock-generated data seeded on project creation. A new `analytics_service.py` provides all query logic; the analytics router stays thin. The Next.js analytics page becomes a 4-tab dashboard using Recharts for the traffic area chart.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Alembic, ARQ (background tasks), Recharts, TanStack Query v5, Tailwind CSS.

## Global Constraints

- Python ≥ 3.11; SQLAlchemy 2.0 mapped-column style (all existing models use this)
- All DB queries filter by both `project_id` AND `org_id` — multi-tenant isolation is mandatory
- ARQ task functions signature: `async def task_name(ctx, arg: type)` — `ctx` is always first
- Alembic migrations use raw SQL via `op.execute(sa.text(...))` — no autogenerate
- New migration revision must chain from `e3f4a5b6c7d8` (Phase 9, latest)
- `encrypt_value` / `decrypt_value` from `app.core.security` for any stored tokens
- Frontend: no new component library; inline components following keywords page patterns
- All analytics API routes are query-param style: `GET /analytics/overview?project_id=<uuid>&range=28d`
- Date range param accepts: `7d`, `28d`, `90d` (default `28d`)

---

## File Map

**Create:**
- `apps/api/app/models/analytics.py` — ORM: `AnalyticsSnapshot`, `KeywordRanking`, `GscConnection`
- `apps/api/alembic/versions/f1a2b3c4d5e6_phase10_analytics_models.py` — migration
- `apps/api/app/schemas/analytics.py` — Pydantic response schemas
- `apps/api/app/services/analytics_service.py` — all DB query logic
- `apps/api/app/workers/tasks/analytics_tasks.py` — `seed_analytics_history`, `sync_analytics_data`

**Modify:**
- `apps/api/app/models/__init__.py` — import new models
- `apps/api/app/api/v1/routers/analytics.py` — replace 4-stub file with full implementation
- `apps/api/app/api/v1/routers/projects.py` — enqueue `seed_analytics_history` after project create
- `apps/api/app/workers/worker.py` — register new tasks + daily cron
- `apps/web/package.json` — add `recharts` dependency
- `apps/web/lib/api.ts` — add analytics interfaces + 9 fetch functions
- `apps/web/app/(dashboard)/[projectId]/analytics/page.tsx` — full 4-tab dashboard

---

### Task 1: Analytics ORM Models

**Files:**
- Create: `apps/api/app/models/analytics.py`
- Modify: `apps/api/app/models/__init__.py`

**Interfaces:**
- Produces: `AnalyticsSnapshot`, `KeywordRanking`, `GscConnection` classes importable from `app.models.analytics`

- [ ] **Step 1: Write the model file**

```python
# apps/api/app/models/analytics.py
import uuid
from datetime import date

from sqlalchemy import Boolean, Date, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class AnalyticsSnapshot(Base, TimestampMixin):
    __tablename__ = "analytics_snapshots"
    __table_args__ = (UniqueConstraint("project_id", "date", name="uq_analytics_snapshot_project_date"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    clicks: Mapped[int] = mapped_column(Integer, default=0)
    impressions: Mapped[int] = mapped_column(Integer, default=0)
    ctr: Mapped[float] = mapped_column(Float, default=0.0)
    avg_position: Mapped[float] = mapped_column(Float, default=0.0)


class KeywordRanking(Base, TimestampMixin):
    __tablename__ = "keyword_rankings"
    __table_args__ = (UniqueConstraint("keyword_id", "date", name="uq_keyword_ranking_keyword_date"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    keyword_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("keywords.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    position: Mapped[float] = mapped_column(Float, nullable=False)
    url: Mapped[str | None] = mapped_column(String(2048))


class GscConnection(Base, TimestampMixin):
    __tablename__ = "gsc_connections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    google_email: Mapped[str | None] = mapped_column(String(255))
    access_token: Mapped[str | None] = mapped_column(Text)
    refresh_token: Mapped[str | None] = mapped_column(Text)
    token_expiry: Mapped[str | None] = mapped_column(String(50))
    site_url: Mapped[str | None] = mapped_column(String(2048))
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    last_synced_at: Mapped[str | None] = mapped_column(String(50))
```

- [ ] **Step 2: Register models in `__init__.py`**

Add one line to `apps/api/app/models/__init__.py`. The existing file ends with:
```python
from app.models.image import GeneratedImage  # noqa: F401
```

Append after the last import:
```python
from app.models.analytics import AnalyticsSnapshot, KeywordRanking, GscConnection  # noqa: F401
```

- [ ] **Step 3: Verify models import cleanly**

```bash
cd apps/api && python -c "from app.models.analytics import AnalyticsSnapshot, KeywordRanking, GscConnection; print('OK')"
```
Expected output: `OK`

- [ ] **Step 4: Commit**

```bash
git add apps/api/app/models/analytics.py apps/api/app/models/__init__.py
git commit -m "feat(api): Phase 10 analytics ORM models"
```

---

### Task 2: Alembic Migration

**Files:**
- Create: `apps/api/alembic/versions/f1a2b3c4d5e6_phase10_analytics_models.py`

**Interfaces:**
- Consumes: revision chain from `e3f4a5b6c7d8` (Phase 9 image models)
- Produces: `analytics_snapshots`, `keyword_rankings`, `gsc_connections` tables in DB

- [ ] **Step 1: Create the migration file**

```python
# apps/api/alembic/versions/f1a2b3c4d5e6_phase10_analytics_models.py
"""phase10_analytics_models

Revision ID: f1a2b3c4d5e6
Revises: e3f4a5b6c7d8
Create Date: 2026-06-26 12:00:00.000000

Creates tables: analytics_snapshots, keyword_rankings, gsc_connections
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "e3f4a5b6c7d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS analytics_snapshots ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  date DATE NOT NULL, "
        "  clicks INTEGER NOT NULL DEFAULT 0, "
        "  impressions INTEGER NOT NULL DEFAULT 0, "
        "  ctr FLOAT NOT NULL DEFAULT 0.0, "
        "  avg_position FLOAT NOT NULL DEFAULT 0.0, "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  CONSTRAINT uq_analytics_snapshot_project_date UNIQUE (project_id, date) "
        ");"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_analytics_snapshots_project_date "
        "ON analytics_snapshots (project_id, date DESC);"
    ))

    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS keyword_rankings ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  keyword_id UUID NOT NULL REFERENCES keywords(id) ON DELETE CASCADE, "
        "  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  date DATE NOT NULL, "
        "  position FLOAT NOT NULL, "
        "  url VARCHAR(2048), "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  CONSTRAINT uq_keyword_ranking_keyword_date UNIQUE (keyword_id, date) "
        ");"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_keyword_rankings_project_date "
        "ON keyword_rankings (project_id, date DESC);"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_keyword_rankings_keyword_date "
        "ON keyword_rankings (keyword_id, date DESC);"
    ))

    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS gsc_connections ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  google_email VARCHAR(255), "
        "  access_token TEXT, "
        "  refresh_token TEXT, "
        "  token_expiry VARCHAR(50), "
        "  site_url VARCHAR(2048), "
        "  is_active BOOLEAN NOT NULL DEFAULT FALSE, "
        "  last_synced_at VARCHAR(50), "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() "
        ");"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS gsc_connections;"))
    op.execute(sa.text("DROP TABLE IF EXISTS keyword_rankings;"))
    op.execute(sa.text("DROP TABLE IF EXISTS analytics_snapshots;"))
```

- [ ] **Step 2: Run the migration**

```bash
cd apps/api && alembic upgrade head
```
Expected: `Running upgrade e3f4a5b6c7d8 -> f1a2b3c4d5e6, phase10_analytics_models`

- [ ] **Step 3: Commit**

```bash
git add apps/api/alembic/versions/f1a2b3c4d5e6_phase10_analytics_models.py
git commit -m "feat(api): Phase 10 analytics migration"
```

---

### Task 3: Analytics Pydantic Schemas

**Files:**
- Create: `apps/api/app/schemas/analytics.py`

**Interfaces:**
- Produces: `AnalyticsOverview`, `TrafficDataPoint`, `RankingRow`, `ContentPerformanceRow`, `TopPageRow`, `TopQueryRow`, `GscConnectionStatus`, `GscConnectResponse`

- [ ] **Step 1: Create the schemas file**

```python
# apps/api/app/schemas/analytics.py
import uuid
from datetime import date
from typing import Optional

from pydantic import BaseModel


class AnalyticsOverview(BaseModel):
    clicks: int
    impressions: int
    ctr: float
    avg_position: float
    clicks_change: float        # % vs prior period; positive = grew
    impressions_change: float
    ctr_change: float
    position_change: float      # positive = rank got worse (higher number)


class TrafficDataPoint(BaseModel):
    date: date
    clicks: int
    impressions: int
    ctr: float
    avg_position: float


class RankingRow(BaseModel):
    keyword_id: uuid.UUID
    keyword: str
    search_volume: Optional[int]
    intent: Optional[str]
    difficulty: Optional[float]
    current_position: Optional[float]
    position_change: Optional[float]  # negative = improved (rank moved up)


class ContentPerformanceRow(BaseModel):
    article_id: uuid.UUID
    title: str
    published_url: Optional[str]
    status: str
    clicks: int
    impressions: int
    ctr: float


class TopPageRow(BaseModel):
    url: str
    clicks: int
    impressions: int
    ctr: float
    avg_position: float


class TopQueryRow(BaseModel):
    query: str
    clicks: int
    impressions: int
    ctr: float
    avg_position: float


class GscConnectionStatus(BaseModel):
    is_connected: bool
    google_email: Optional[str]
    site_url: Optional[str]
    last_synced_at: Optional[str]


class GscConnectResponse(BaseModel):
    redirect_url: str
```

- [ ] **Step 2: Verify import**

```bash
cd apps/api && python -c "from app.schemas.analytics import AnalyticsOverview, RankingRow; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add apps/api/app/schemas/analytics.py
git commit -m "feat(api): Phase 10 analytics schemas"
```

---

### Task 4: Analytics Service

**Files:**
- Create: `apps/api/app/services/analytics_service.py`

**Interfaces:**
- Consumes: `AnalyticsSnapshot`, `KeywordRanking`, `GscConnection` from `app.models.analytics`; `Keyword` from `app.models.keyword`; `Article` from `app.models.article`
- Produces:
  - `get_overview(project_id, org_id, range_str, db) -> AnalyticsOverview`
  - `get_traffic(project_id, org_id, range_str, db) -> list[TrafficDataPoint]`
  - `get_rankings(project_id, org_id, db, sort_by, page, page_size) -> list[RankingRow]`
  - `get_top_pages(project_id, org_id, db) -> list[TopPageRow]`
  - `get_top_queries(project_id, org_id, db) -> list[TopQueryRow]`
  - `get_content_performance(project_id, org_id, db) -> list[ContentPerformanceRow]`
  - `get_gsc_status(project_id, org_id, db) -> GscConnectionStatus`

- [ ] **Step 1: Write the service file**

```python
# apps/api/app/services/analytics_service.py
import uuid
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics import AnalyticsSnapshot, GscConnection, KeywordRanking
from app.models.article import Article
from app.models.keyword import Keyword
from app.schemas.analytics import (
    AnalyticsOverview,
    ContentPerformanceRow,
    GscConnectionStatus,
    RankingRow,
    TopPageRow,
    TopQueryRow,
    TrafficDataPoint,
)


def _parse_range(range_str: str) -> tuple[date, date]:
    today = date.today()
    days = {"7d": 7, "28d": 28, "90d": 90}.get(range_str, 28)
    return today - timedelta(days=days - 1), today


def _pct_change(current: float, previous: float) -> float:
    if previous == 0:
        return 0.0
    return round((current - previous) / previous * 100, 1)


async def get_overview(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    range_str: str,
    db: AsyncSession,
) -> AnalyticsOverview:
    start, end = _parse_range(range_str)
    period_len = (end - start).days + 1
    prior_end = start - timedelta(days=1)
    prior_start = prior_end - timedelta(days=period_len - 1)

    async def _agg(s: date, e: date):
        result = await db.execute(
            select(
                func.coalesce(func.sum(AnalyticsSnapshot.clicks), 0),
                func.coalesce(func.sum(AnalyticsSnapshot.impressions), 0),
                func.coalesce(func.avg(AnalyticsSnapshot.ctr), 0.0),
                func.coalesce(func.avg(AnalyticsSnapshot.avg_position), 0.0),
            ).where(
                AnalyticsSnapshot.project_id == project_id,
                AnalyticsSnapshot.org_id == org_id,
                AnalyticsSnapshot.date >= s,
                AnalyticsSnapshot.date <= e,
            )
        )
        row = result.one()
        return int(row[0]), int(row[1]), float(row[2]), float(row[3])

    clicks, impressions, ctr, avg_pos = await _agg(start, end)
    p_clicks, p_impressions, p_ctr, p_avg_pos = await _agg(prior_start, prior_end)

    return AnalyticsOverview(
        clicks=clicks,
        impressions=impressions,
        ctr=round(ctr, 4),
        avg_position=round(avg_pos, 1),
        clicks_change=_pct_change(clicks, p_clicks),
        impressions_change=_pct_change(impressions, p_impressions),
        ctr_change=_pct_change(ctr, p_ctr),
        position_change=_pct_change(avg_pos, p_avg_pos),
    )


async def get_traffic(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    range_str: str,
    db: AsyncSession,
) -> list[TrafficDataPoint]:
    start, end = _parse_range(range_str)
    result = await db.execute(
        select(AnalyticsSnapshot)
        .where(
            AnalyticsSnapshot.project_id == project_id,
            AnalyticsSnapshot.org_id == org_id,
            AnalyticsSnapshot.date >= start,
            AnalyticsSnapshot.date <= end,
        )
        .order_by(AnalyticsSnapshot.date.asc())
    )
    return [
        TrafficDataPoint(
            date=r.date,
            clicks=r.clicks,
            impressions=r.impressions,
            ctr=r.ctr,
            avg_position=r.avg_position,
        )
        for r in result.scalars().all()
    ]


async def get_rankings(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    db: AsyncSession,
    sort_by: str = "position",
    page: int = 1,
    page_size: int = 25,
) -> list[RankingRow]:
    today = date.today()
    week_ago = today - timedelta(days=7)

    kw_result = await db.execute(
        select(Keyword).where(
            Keyword.project_id == project_id,
            Keyword.org_id == org_id,
        )
    )
    keywords = kw_result.scalars().all()
    if not keywords:
        return []

    keyword_ids = [kw.id for kw in keywords]
    kw_map = {kw.id: kw for kw in keywords}

    latest_result = await db.execute(
        select(KeywordRanking).where(
            KeywordRanking.keyword_id.in_(keyword_ids),
            KeywordRanking.date == today,
        )
    )
    latest_map = {r.keyword_id: r for r in latest_result.scalars().all()}

    week_result = await db.execute(
        select(KeywordRanking).where(
            KeywordRanking.keyword_id.in_(keyword_ids),
            KeywordRanking.date == week_ago,
        )
    )
    week_map = {r.keyword_id: r for r in week_result.scalars().all()}

    rows: list[RankingRow] = []
    for kw in keywords:
        latest = latest_map.get(kw.id)
        week_old = week_map.get(kw.id)
        current_pos = latest.position if latest else None
        change: Optional[float] = None
        if current_pos is not None and week_old is not None:
            change = round(current_pos - week_old.position, 1)
        rows.append(
            RankingRow(
                keyword_id=kw.id,
                keyword=kw.keyword,
                search_volume=kw.search_volume,
                intent=kw.intent.value if kw.intent else None,
                difficulty=kw.difficulty,
                current_position=current_pos,
                position_change=change,
            )
        )

    if sort_by == "position":
        rows.sort(key=lambda r: r.current_position or 999.0)
    elif sort_by == "volume":
        rows.sort(key=lambda r: r.search_volume or 0, reverse=True)
    elif sort_by == "change":
        rows.sort(key=lambda r: r.position_change or 0.0)

    offset = (page - 1) * page_size
    return rows[offset : offset + page_size]


async def get_top_pages(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    db: AsyncSession,
) -> list[TopPageRow]:
    today = date.today()
    result = await db.execute(
        select(KeywordRanking, Keyword)
        .join(Keyword, KeywordRanking.keyword_id == Keyword.id)
        .where(
            KeywordRanking.project_id == project_id,
            KeywordRanking.org_id == org_id,
            KeywordRanking.date == today,
            KeywordRanking.url.isnot(None),
        )
    )
    rows_raw = result.all()

    # Group by URL
    url_data: dict[str, dict] = {}
    for ranking, kw in rows_raw:
        url = ranking.url
        if url not in url_data:
            url_data[url] = {"volume": 0, "positions": [], "count": 0}
        url_data[url]["volume"] += kw.search_volume or 0
        url_data[url]["positions"].append(ranking.position)
        url_data[url]["count"] += 1

    pages: list[TopPageRow] = []
    for url, data in url_data.items():
        vol = data["volume"]
        clicks = int(vol * 0.02)
        impressions = int(vol * 0.24)
        avg_pos = round(sum(data["positions"]) / len(data["positions"]), 1)
        pages.append(
            TopPageRow(
                url=url,
                clicks=clicks,
                impressions=impressions,
                ctr=round(clicks / impressions, 4) if impressions else 0.0,
                avg_position=avg_pos,
            )
        )

    pages.sort(key=lambda p: p.clicks, reverse=True)
    return pages[:20]


async def get_top_queries(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    db: AsyncSession,
) -> list[TopQueryRow]:
    today = date.today()
    result = await db.execute(
        select(KeywordRanking, Keyword)
        .join(Keyword, KeywordRanking.keyword_id == Keyword.id)
        .where(
            KeywordRanking.project_id == project_id,
            KeywordRanking.org_id == org_id,
            KeywordRanking.date == today,
        )
        .order_by(Keyword.search_volume.desc().nullslast())
        .limit(20)
    )
    rows_raw = result.all()

    queries: list[TopQueryRow] = []
    for ranking, kw in rows_raw:
        vol = kw.search_volume or 100
        clicks = int(vol * 0.02)
        impressions = int(vol * 0.24)
        queries.append(
            TopQueryRow(
                query=kw.keyword,
                clicks=clicks,
                impressions=impressions,
                ctr=round(clicks / impressions, 4) if impressions else 0.0,
                avg_position=round(ranking.position, 1),
            )
        )
    return queries


async def get_content_performance(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    db: AsyncSession,
) -> list[ContentPerformanceRow]:
    today = date.today()
    art_result = await db.execute(
        select(Article).where(
            Article.project_id == project_id,
            Article.org_id == org_id,
        ).order_by(Article.created_at.desc())
    )
    articles = art_result.scalars().all()

    rows: list[ContentPerformanceRow] = []
    for article in articles:
        published_url: Optional[str] = getattr(article, "published_url", None)
        clicks = 0
        impressions = 0

        if published_url:
            rank_result = await db.execute(
                select(KeywordRanking, Keyword)
                .join(Keyword, KeywordRanking.keyword_id == Keyword.id)
                .where(
                    KeywordRanking.project_id == project_id,
                    KeywordRanking.org_id == org_id,
                    KeywordRanking.date == today,
                    KeywordRanking.url == published_url,
                )
            )
            for _, kw in rank_result.all():
                vol = kw.search_volume or 100
                clicks += int(vol * 0.02)
                impressions += int(vol * 0.24)

        rows.append(
            ContentPerformanceRow(
                article_id=article.id,
                title=article.title,
                published_url=published_url,
                status=article.status.value,
                clicks=clicks,
                impressions=impressions,
                ctr=round(clicks / impressions, 4) if impressions else 0.0,
            )
        )
    return rows


async def get_gsc_status(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    db: AsyncSession,
) -> GscConnectionStatus:
    result = await db.execute(
        select(GscConnection).where(
            GscConnection.project_id == project_id,
            GscConnection.org_id == org_id,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn or not conn.is_active:
        return GscConnectionStatus(
            is_connected=False,
            google_email=None,
            site_url=None,
            last_synced_at=None,
        )
    return GscConnectionStatus(
        is_connected=True,
        google_email=conn.google_email,
        site_url=conn.site_url,
        last_synced_at=conn.last_synced_at,
    )
```

- [ ] **Step 2: Verify import**

```bash
cd apps/api && python -c "from app.services.analytics_service import get_overview, get_rankings; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add apps/api/app/services/analytics_service.py
git commit -m "feat(api): Phase 10 analytics service"
```

---

### Task 5: Analytics Router

**Files:**
- Modify: `apps/api/app/api/v1/routers/analytics.py` (full replacement)

**Interfaces:**
- Consumes: all 7 functions from `app.services.analytics_service`; all schemas from `app.schemas.analytics`
- Produces: REST endpoints at `/analytics/overview`, `/traffic`, `/rankings`, `/content-performance`, `/top-pages`, `/top-queries`, `/gsc/status`, `/gsc/connect`, `/gsc/disconnect`

- [ ] **Step 1: Replace the stub router**

```python
# apps/api/app/api/v1/routers/analytics.py
"""Analytics endpoints — traffic, rankings, GSC connection."""
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Query

from app.core.dependencies import CurrentUser, DB
from app.schemas.analytics import (
    AnalyticsOverview,
    ContentPerformanceRow,
    GscConnectResponse,
    GscConnectionStatus,
    RankingRow,
    TopPageRow,
    TopQueryRow,
    TrafficDataPoint,
)
from app.services.analytics_service import (
    get_content_performance,
    get_gsc_status,
    get_overview,
    get_rankings,
    get_top_pages,
    get_top_queries,
    get_traffic,
)

router = APIRouter()

RangeParam = Query(default="28d", pattern="^(7d|28d|90d)$")
SortParam = Query(default="position", pattern="^(position|volume|change)$")


@router.get("/overview", response_model=AnalyticsOverview)
async def analytics_overview(
    project_id: uuid.UUID,
    range: str = RangeParam,
    current_user: CurrentUser = ...,
    db: DB = ...,
):
    return await get_overview(project_id, current_user.org_id, range, db)


@router.get("/traffic", response_model=list[TrafficDataPoint])
async def analytics_traffic(
    project_id: uuid.UUID,
    range: str = RangeParam,
    current_user: CurrentUser = ...,
    db: DB = ...,
):
    return await get_traffic(project_id, current_user.org_id, range, db)


@router.get("/rankings", response_model=list[RankingRow])
async def analytics_rankings(
    project_id: uuid.UUID,
    sort_by: str = SortParam,
    page: int = Query(default=1, ge=1),
    current_user: CurrentUser = ...,
    db: DB = ...,
):
    return await get_rankings(project_id, current_user.org_id, db, sort_by, page)


@router.get("/top-pages", response_model=list[TopPageRow])
async def analytics_top_pages(
    project_id: uuid.UUID,
    current_user: CurrentUser = ...,
    db: DB = ...,
):
    return await get_top_pages(project_id, current_user.org_id, db)


@router.get("/top-queries", response_model=list[TopQueryRow])
async def analytics_top_queries(
    project_id: uuid.UUID,
    current_user: CurrentUser = ...,
    db: DB = ...,
):
    return await get_top_queries(project_id, current_user.org_id, db)


@router.get("/content-performance", response_model=list[ContentPerformanceRow])
async def analytics_content_performance(
    project_id: uuid.UUID,
    current_user: CurrentUser = ...,
    db: DB = ...,
):
    return await get_content_performance(project_id, current_user.org_id, db)


@router.get("/gsc/status", response_model=GscConnectionStatus)
async def gsc_status(
    project_id: uuid.UUID,
    current_user: CurrentUser = ...,
    db: DB = ...,
):
    return await get_gsc_status(project_id, current_user.org_id, db)


@router.post("/gsc/connect", response_model=GscConnectResponse)
async def gsc_connect(
    project_id: uuid.UUID,
    current_user: CurrentUser = ...,
    db: DB = ...,
):
    # OAuth scaffold — returns a placeholder redirect URL.
    # Replace with real Google OAuth2 flow when credentials are configured.
    redirect_url = (
        f"https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id=CONFIGURE_IN_ENV"
        f"&redirect_uri=CONFIGURE_IN_ENV"
        f"&response_type=code"
        f"&scope=https://www.googleapis.com/auth/webmasters.readonly"
        f"&state={project_id}"
        f"&access_type=offline"
    )
    return GscConnectResponse(redirect_url=redirect_url)


@router.delete("/gsc/disconnect", status_code=204)
async def gsc_disconnect(
    project_id: uuid.UUID,
    current_user: CurrentUser = ...,
    db: DB = ...,
):
    from sqlalchemy import select, delete
    from app.models.analytics import GscConnection
    await db.execute(
        delete(GscConnection).where(
            GscConnection.project_id == project_id,
            GscConnection.org_id == current_user.org_id,
        )
    )
    await db.commit()
```

- [ ] **Step 2: Start the API and verify routes appear**

```bash
cd apps/api && uvicorn app.main:app --port 8000 &
sleep 2
curl -s http://localhost:8000/api/v1/analytics/overview?project_id=00000000-0000-0000-0000-000000000000 | python -m json.tool
kill %1
```
Expected: 401 Unauthorized JSON (not a 404 or 500 — the route exists and auth is required).

- [ ] **Step 3: Commit**

```bash
git add apps/api/app/api/v1/routers/analytics.py
git commit -m "feat(api): Phase 10 analytics router"
```

---

### Task 6: Analytics Worker Tasks + Project Seed Hook

**Files:**
- Create: `apps/api/app/workers/tasks/analytics_tasks.py`
- Modify: `apps/api/app/workers/worker.py`
- Modify: `apps/api/app/api/v1/routers/projects.py`

**Interfaces:**
- Consumes: `async_session_factory` from `app.core.database`; `AnalyticsSnapshot`, `KeywordRanking` from `app.models.analytics`; `Keyword`, `KeywordResearchJob`, `ResearchStatus` from `app.models.keyword`
- Produces:
  - `seed_analytics_history(ctx, project_id: str)` — ARQ task, called once per project
  - `sync_analytics_data(ctx, project_id: str)` — ARQ task, called daily

- [ ] **Step 1: Create the worker tasks file**

```python
# apps/api/app/workers/tasks/analytics_tasks.py
"""ARQ tasks for analytics data: historical seed + daily sync."""
import math
import random
import uuid
from datetime import date, timedelta

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.analytics import AnalyticsSnapshot, KeywordRanking
from app.models.keyword import Keyword, KeywordResearchJob, ResearchStatus


def _base_position(difficulty: float | None) -> float:
    """Convert keyword difficulty (0–100) to a mock starting rank position (1–50)."""
    d = difficulty or 50.0
    # difficulty 0 → position ~2, difficulty 100 → position ~48
    return round(2.0 + (d / 100.0) * 46.0, 1)


def _daily_position_drift(base: float, day_offset: int, seed: int) -> float:
    """Apply deterministic per-day drift so position history looks realistic."""
    rng = random.Random(seed + day_offset)
    drift = rng.uniform(-1.5, 1.5)
    pos = max(1.0, min(100.0, base + drift))
    return round(pos, 1)


async def seed_analytics_history(ctx, project_id: str):
    """Seed 90 days of mock analytics_snapshots and keyword_rankings."""
    pid = uuid.UUID(project_id)
    today = date.today()

    async with async_session_factory() as session:
        # Resolve org_id from a keyword (or skip if no keywords yet)
        kw_result = await session.execute(
            select(Keyword).where(Keyword.project_id == pid).limit(1)
        )
        sample_kw = kw_result.scalar_one_or_none()
        if sample_kw is None:
            return  # No keywords yet — will be seeded after keyword research runs
        org_id = sample_kw.org_id

        # Get all keywords for this project
        all_kw_result = await session.execute(
            select(Keyword).where(Keyword.project_id == pid, Keyword.org_id == org_id)
        )
        keywords = all_kw_result.scalars().all()

        # Base analytics from keyword volumes
        total_volume = sum(kw.search_volume or 0 for kw in keywords) or 1000
        base_clicks_daily = total_volume * 0.02 / 30  # rough daily share

        for day_offset in range(89, -1, -1):  # 89 days ago → today
            snap_date = today - timedelta(days=day_offset)
            rng = random.Random(int(pid) + day_offset)
            variance = rng.uniform(0.8, 1.2)
            clicks = max(0, int(base_clicks_daily * variance))
            impressions = max(clicks, int(clicks * rng.uniform(8.0, 15.0)))
            ctr = round(clicks / impressions, 4) if impressions else 0.0
            all_positions = [
                _base_position(kw.difficulty) for kw in keywords
            ]
            avg_pos = round(sum(all_positions) / len(all_positions), 1) if all_positions else 10.0

            snap = AnalyticsSnapshot(
                project_id=pid,
                org_id=org_id,
                date=snap_date,
                clicks=clicks,
                impressions=impressions,
                ctr=ctr,
                avg_position=avg_pos,
            )
            session.add(snap)

            # One keyword_ranking per keyword per day
            for kw in keywords:
                base_pos = _base_position(kw.difficulty)
                pos = _daily_position_drift(base_pos, day_offset, seed=hash(str(kw.id)) % 100000)
                ranking = KeywordRanking(
                    keyword_id=kw.id,
                    project_id=pid,
                    org_id=org_id,
                    date=snap_date,
                    position=pos,
                    url=f"https://example.com/{kw.keyword.replace(' ', '-').lower()}/",
                )
                session.add(ranking)

        await session.commit()


async def sync_analytics_data(ctx, project_id: str):
    """Daily sync: write today's analytics row and keyword ranking rows."""
    pid = uuid.UUID(project_id)
    today = date.today()

    async with async_session_factory() as session:
        kw_result = await session.execute(
            select(Keyword).where(Keyword.project_id == pid).limit(1)
        )
        sample_kw = kw_result.scalar_one_or_none()
        if sample_kw is None:
            return
        org_id = sample_kw.org_id

        all_kw_result = await session.execute(
            select(Keyword).where(Keyword.project_id == pid, Keyword.org_id == org_id)
        )
        keywords = all_kw_result.scalars().all()

        total_volume = sum(kw.search_volume or 0 for kw in keywords) or 1000
        base_clicks_daily = total_volume * 0.02 / 30
        rng = random.Random(int(pid) + today.toordinal())
        variance = rng.uniform(0.8, 1.2)
        clicks = max(0, int(base_clicks_daily * variance))
        impressions = max(clicks, int(clicks * rng.uniform(8.0, 15.0)))
        ctr = round(clicks / impressions, 4) if impressions else 0.0
        all_positions = [_base_position(kw.difficulty) for kw in keywords]
        avg_pos = round(sum(all_positions) / len(all_positions), 1) if all_positions else 10.0

        snap = AnalyticsSnapshot(
            project_id=pid,
            org_id=org_id,
            date=today,
            clicks=clicks,
            impressions=impressions,
            ctr=ctr,
            avg_position=avg_pos,
        )
        session.add(snap)

        for kw in keywords:
            base_pos = _base_position(kw.difficulty)
            pos = _daily_position_drift(base_pos, 0, seed=hash(str(kw.id)) % 100000)
            ranking = KeywordRanking(
                keyword_id=kw.id,
                project_id=pid,
                org_id=org_id,
                date=today,
                position=pos,
                url=f"https://example.com/{kw.keyword.replace(' ', '-').lower()}/",
            )
            session.add(ranking)

        await session.commit()
```

- [ ] **Step 2: Register tasks and cron in `worker.py`**

Replace `apps/api/app/workers/worker.py` entirely:

```python
# apps/api/app/workers/worker.py
from arq.connections import RedisSettings
from arq.cron import cron

from app.core.config import settings
from app.workers.tasks.analytics_tasks import seed_analytics_history, sync_analytics_data
from app.workers.tasks.audit_tasks import run_seo_audit
from app.workers.tasks.crawl_tasks import crawl_website
from app.workers.tasks.keyword_tasks import run_keyword_research


async def startup(ctx):
    pass


async def shutdown(ctx):
    pass


async def _noop(ctx):
    pass


class WorkerSettings:
    functions = [
        _noop,
        crawl_website,
        run_seo_audit,
        run_keyword_research,
        seed_analytics_history,
        sync_analytics_data,
    ]
    cron_jobs = [
        cron(sync_analytics_data, hour=6, minute=0, run_at_startup=False),
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    max_jobs = 10
    job_timeout = 600
```

- [ ] **Step 3: Enqueue seed task from project creation**

In `apps/api/app/api/v1/routers/projects.py`, add the enqueue call after project creation. Find:

```python
    db.add(project)
    await db.flush()
    await db.refresh(project)
    return project
```

Replace with:

```python
    db.add(project)
    await db.flush()
    await db.refresh(project)

    try:
        import arq
        redis_pool = await arq.create_pool(settings.REDIS_SETTINGS)
        await redis_pool.enqueue_job("seed_analytics_history", str(project.id))
        await redis_pool.aclose()
    except Exception:
        pass  # Worker may not be running in dev — seed can be run manually

    return project
```

Also add the missing import at the top of `projects.py`. Check existing imports and add if not present:

```python
from app.core.config import settings
```

- [ ] **Step 4: Verify worker imports**

```bash
cd apps/api && python -c "from app.workers.worker import WorkerSettings; print('OK')"
```
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/workers/tasks/analytics_tasks.py apps/api/app/workers/worker.py apps/api/app/api/v1/routers/projects.py
git commit -m "feat(api): Phase 10 analytics worker tasks and project seed hook"
```

---

### Task 7: Web — API Client + Install Recharts

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/lib/api.ts`

**Interfaces:**
- Produces (added to `api.ts`):
  - Interfaces: `AnalyticsOverview`, `TrafficDataPoint`, `RankingRow`, `ContentPerformanceRow`, `TopPageRow`, `TopQueryRow`, `GscStatus`
  - Functions: `getAnalyticsOverview`, `getAnalyticsTraffic`, `getAnalyticsRankings`, `getTopPages`, `getTopQueries`, `getContentPerformance`, `getGscStatus`, `connectGsc`, `disconnectGsc`

- [ ] **Step 1: Install recharts**

In `apps/web/package.json`, add to `"dependencies"`:

```json
"recharts": "^2.12.7"
```

Then run:

```bash
cd apps/web && pnpm install
```

Expected: `recharts` appears in `node_modules`.

- [ ] **Step 2: Append analytics API functions to `apps/web/lib/api.ts`**

Add the following block at the end of the file:

```typescript
// ─── Analytics types & helpers ─────────────────────────────────────────────

export interface AnalyticsOverview {
  clicks: number;
  impressions: number;
  ctr: number;
  avg_position: number;
  clicks_change: number;
  impressions_change: number;
  ctr_change: number;
  position_change: number;
}

export interface TrafficDataPoint {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avg_position: number;
}

export interface RankingRow {
  keyword_id: string;
  keyword: string;
  search_volume: number | null;
  intent: string | null;
  difficulty: number | null;
  current_position: number | null;
  position_change: number | null;
}

export interface ContentPerformanceRow {
  article_id: string;
  title: string;
  published_url: string | null;
  status: string;
  clicks: number;
  impressions: number;
  ctr: number;
}

export interface TopPageRow {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avg_position: number;
}

export interface TopQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avg_position: number;
}

export interface GscStatus {
  is_connected: boolean;
  google_email: string | null;
  site_url: string | null;
  last_synced_at: string | null;
}

export type AnalyticsRange = "7d" | "28d" | "90d";

export async function getAnalyticsOverview(
  projectId: string,
  range: AnalyticsRange = "28d",
): Promise<AnalyticsOverview> {
  return apiClient.get<AnalyticsOverview>(
    `/analytics/overview?project_id=${projectId}&range=${range}`,
  );
}

export async function getAnalyticsTraffic(
  projectId: string,
  range: AnalyticsRange = "28d",
): Promise<TrafficDataPoint[]> {
  return apiClient.get<TrafficDataPoint[]>(
    `/analytics/traffic?project_id=${projectId}&range=${range}`,
  );
}

export async function getAnalyticsRankings(
  projectId: string,
  sortBy: "position" | "volume" | "change" = "position",
  page: number = 1,
): Promise<RankingRow[]> {
  return apiClient.get<RankingRow[]>(
    `/analytics/rankings?project_id=${projectId}&sort_by=${sortBy}&page=${page}`,
  );
}

export async function getTopPages(projectId: string): Promise<TopPageRow[]> {
  return apiClient.get<TopPageRow[]>(`/analytics/top-pages?project_id=${projectId}`);
}

export async function getTopQueries(projectId: string): Promise<TopQueryRow[]> {
  return apiClient.get<TopQueryRow[]>(`/analytics/top-queries?project_id=${projectId}`);
}

export async function getContentPerformance(
  projectId: string,
): Promise<ContentPerformanceRow[]> {
  return apiClient.get<ContentPerformanceRow[]>(
    `/analytics/content-performance?project_id=${projectId}`,
  );
}

export async function getGscStatus(projectId: string): Promise<GscStatus> {
  return apiClient.get<GscStatus>(`/analytics/gsc/status?project_id=${projectId}`);
}

export async function connectGsc(projectId: string): Promise<{ redirect_url: string }> {
  return apiClient.post<{ redirect_url: string }>(
    `/analytics/gsc/connect?project_id=${projectId}`,
    {},
  );
}

export async function disconnectGsc(projectId: string): Promise<void> {
  return apiClient.delete<void>(`/analytics/gsc/disconnect?project_id=${projectId}`);
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/web && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/lib/api.ts pnpm-lock.yaml
git commit -m "feat(web): Phase 10 analytics API client + recharts"
```

---

### Task 8: Analytics Page — Overview + Rankings Tabs

**Files:**
- Modify: `apps/web/app/(dashboard)/[projectId]/analytics/page.tsx` (full replacement)

**Interfaces:**
- Consumes: `getAnalyticsOverview`, `getAnalyticsTraffic`, `getAnalyticsRankings`, `getGscStatus`, `connectGsc`, `disconnectGsc` from `@/lib/api`
- Produces: `AnalyticsPage` component with Overview and Rankings tabs rendering live data

- [ ] **Step 1: Replace the analytics page (part 1 — full file)**

```tsx
// apps/web/app/(dashboard)/[projectId]/analytics/page.tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus, ArrowUp, ArrowDown } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { FennecMascot } from "@fennex/ui";
import {
  getAnalyticsOverview,
  getAnalyticsTraffic,
  getAnalyticsRankings,
  getTopPages,
  getTopQueries,
  getContentPerformance,
  getGscStatus,
  connectGsc,
  disconnectGsc,
  type AnalyticsRange,
  type RankingRow,
} from "@/lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtPct(n: number) {
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

// ─── DifficultyBar ───────────────────────────────────────────────────────────

function DifficultyBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground">—</span>;
  const color = score <= 30 ? "#10b981" : score <= 60 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-xs tabular-nums">{Math.round(score)}</span>
    </div>
  );
}

// ─── IntentBadge ─────────────────────────────────────────────────────────────

function IntentBadge({ intent }: { intent: string | null }) {
  if (!intent) return <span className="text-muted-foreground">—</span>;
  const styles: Record<string, string> = {
    informational: "bg-blue-50 text-blue-600",
    navigational: "bg-violet-50 text-violet-600",
    commercial: "bg-amber-50 text-amber-600",
    transactional: "bg-emerald-50 text-emerald-600",
  };
  return (
    <span className={`badge ${styles[intent] ?? "bg-muted text-muted-foreground"}`}>
      {intent.charAt(0).toUpperCase() + intent.slice(1)}
    </span>
  );
}

// ─── StatCard ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  change,
  invertChange = false,
  format = "number",
}: {
  label: string;
  value: number;
  change: number;
  invertChange?: boolean;
  format?: "number" | "pct" | "pos";
}) {
  const displayValue =
    format === "pct"
      ? `${(value * 100).toFixed(2)}%`
      : format === "pos"
        ? value.toFixed(1)
        : value.toLocaleString();

  // For position: lower is better, so a positive change_pct means rank got worse
  const effectiveChange = invertChange ? -change : change;
  const isPositive = effectiveChange > 0;
  const isNeutral = Math.abs(effectiveChange) < 0.1;

  return (
    <div className="rounded-lg border bg-card p-5 flex flex-col gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{displayValue}</span>
      {!isNeutral && (
        <span
          className={`flex items-center gap-1 text-xs font-medium ${isPositive ? "text-emerald-600" : "text-red-500"}`}
        >
          {isPositive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          {fmtPct(Math.abs(change))} vs prior period
        </span>
      )}
      {isNeutral && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Minus className="h-3.5 w-3.5" /> No change
        </span>
      )}
    </div>
  );
}

// ─── GscBanner ───────────────────────────────────────────────────────────────

function GscBanner({ projectId }: { projectId: string }) {
  const { data: status } = useQuery({
    queryKey: ["analytics", "gsc-status", projectId],
    queryFn: () => getGscStatus(projectId),
    staleTime: 30_000,
  });

  async function handleConnect() {
    const res = await connectGsc(projectId);
    window.location.href = res.redirect_url;
  }

  async function handleDisconnect() {
    await disconnectGsc(projectId);
    window.location.reload();
  }

  if (status?.is_connected) {
    return (
      <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-2.5 text-sm">
        <span className="text-muted-foreground">
          Google Search Console connected — <strong>{status.google_email}</strong>
          {status.last_synced_at && (
            <> · Last synced {new Date(status.last_synced_at).toLocaleDateString()}</>
          )}
        </span>
        <button onClick={handleDisconnect} className="text-destructive hover:underline text-xs">
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-dashed bg-muted/20 px-4 py-2.5 text-sm">
      <span className="text-muted-foreground">
        Connect Google Search Console to sync real traffic data.
      </span>
      <button
        onClick={handleConnect}
        className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        Connect
      </button>
    </div>
  );
}

// ─── OverviewTab ─────────────────────────────────────────────────────────────

function OverviewTab({ projectId, range }: { projectId: string; range: AnalyticsRange }) {
  const { data: overview } = useQuery({
    queryKey: ["analytics", "overview", projectId, range],
    queryFn: () => getAnalyticsOverview(projectId, range),
    staleTime: 5 * 60_000,
  });

  const { data: traffic = [] } = useQuery({
    queryKey: ["analytics", "traffic", projectId, range],
    queryFn: () => getAnalyticsTraffic(projectId, range),
    staleTime: 5 * 60_000,
  });

  const chartData = traffic.map((d) => ({ ...d, date: fmtDate(d.date) }));

  if (!overview) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <FennecMascot />
        <p>No analytics data yet. Run keyword research to populate rankings.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Clicks" value={overview.clicks} change={overview.clicks_change} />
        <StatCard
          label="Impressions"
          value={overview.impressions}
          change={overview.impressions_change}
        />
        <StatCard
          label="Avg CTR"
          value={overview.ctr}
          change={overview.ctr_change}
          format="pct"
        />
        <StatCard
          label="Avg Position"
          value={overview.avg_position}
          change={overview.position_change}
          format="pos"
          invertChange
        />
      </div>

      <div className="rounded-lg border bg-card p-5">
        <p className="mb-4 text-sm font-medium text-muted-foreground">
          Clicks &amp; Impressions
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="colorClicks" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorImpressions" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0.15} />
                <stop offset="95%" stopColor="hsl(var(--muted-foreground))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Area
              type="monotone"
              dataKey="impressions"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={1.5}
              fill="url(#colorImpressions)"
              name="Impressions"
            />
            <Area
              type="monotone"
              dataKey="clicks"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fill="url(#colorClicks)"
              name="Clicks"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── RankingsTab ─────────────────────────────────────────────────────────────

function RankingsTab({ projectId }: { projectId: string }) {
  const [sortBy, setSortBy] = useState<"position" | "volume" | "change">("position");
  const [page, setPage] = useState(1);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["analytics", "rankings", projectId, sortBy, page],
    queryFn: () => getAnalyticsRankings(projectId, sortBy, page),
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground text-sm">Loading rankings…</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <FennecMascot />
        <p>No keyword rankings yet. Run keyword research first.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Sort by:</span>
        {(["position", "volume", "change"] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setSortBy(s); setPage(1); }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              sortBy === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Keyword</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Volume</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Intent</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Difficulty</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Position</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: RankingRow) => (
              <tr key={row.keyword_id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 font-medium">{row.keyword}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {row.search_volume?.toLocaleString() ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <IntentBadge intent={row.intent} />
                </td>
                <td className="px-4 py-3">
                  <DifficultyBar score={row.difficulty} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">
                  {row.current_position?.toFixed(1) ?? "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.position_change === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : row.position_change < 0 ? (
                    <span className="text-emerald-600 flex items-center justify-end gap-0.5">
                      <ArrowUp className="h-3 w-3" />
                      {Math.abs(row.position_change).toFixed(1)}
                    </span>
                  ) : row.position_change > 0 ? (
                    <span className="text-red-500 flex items-center justify-end gap-0.5">
                      <ArrowDown className="h-3 w-3" />
                      {row.position_change.toFixed(1)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <button
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
          className="disabled:opacity-40 hover:text-foreground"
        >
          ← Previous
        </button>
        <span>Page {page}</span>
        <button
          disabled={rows.length < 25}
          onClick={() => setPage((p) => p + 1)}
          className="disabled:opacity-40 hover:text-foreground"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ─── PagesQueriesTab ─────────────────────────────────────────────────────────

function PagesQueriesTab({ projectId }: { projectId: string }) {
  const { data: pages = [] } = useQuery({
    queryKey: ["analytics", "top-pages", projectId],
    queryFn: () => getTopPages(projectId),
    staleTime: 5 * 60_000,
  });

  const { data: queries = [] } = useQuery({
    queryKey: ["analytics", "top-queries", projectId],
    queryFn: () => getTopQueries(projectId),
    staleTime: 5 * 60_000,
  });

  function MetricsTable<T extends { clicks: number; impressions: number; ctr: number; avg_position: number }>({
    rows,
    labelKey,
    labelHeader,
  }: {
    rows: T[];
    labelKey: keyof T;
    labelHeader: string;
  }) {
    return (
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{labelHeader}</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Clicks</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Impressions</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">CTR</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Avg Pos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 max-w-xs truncate text-muted-foreground font-mono text-xs">
                  {String(row[labelKey])}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{row.clicks.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums">{row.impressions.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums">{(row.ctr * 100).toFixed(2)}%</td>
                <td className="px-4 py-3 text-right tabular-nums">{row.avg_position.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-3 text-sm font-medium">Top Pages</h3>
        {pages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No page data yet.</p>
        ) : (
          <MetricsTable rows={pages} labelKey="url" labelHeader="Page" />
        )}
      </div>
      <div>
        <h3 className="mb-3 text-sm font-medium">Top Queries</h3>
        {queries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No query data yet.</p>
        ) : (
          <MetricsTable rows={queries} labelKey="query" labelHeader="Query" />
        )}
      </div>
    </div>
  );
}

// ─── ContentPerformanceTab ────────────────────────────────────────────────────

function ContentPerformanceTab({ projectId }: { projectId: string }) {
  const { data: rows = [] } = useQuery({
    queryKey: ["analytics", "content-performance", projectId],
    queryFn: () => getContentPerformance(projectId),
    staleTime: 5 * 60_000,
  });

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <FennecMascot />
        <p>Publish articles to see their performance here.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Article</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Clicks</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Impressions</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">CTR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.article_id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
              <td className="px-4 py-3">
                <div className="font-medium">{row.title}</div>
                {!row.published_url ? (
                  <span className="text-xs text-muted-foreground">Not published</span>
                ) : (
                  <span className="text-xs text-muted-foreground font-mono truncate max-w-xs block">
                    {row.published_url}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{row.clicks.toLocaleString()}</td>
              <td className="px-4 py-3 text-right tabular-nums">{row.impressions.toLocaleString()}</td>
              <td className="px-4 py-3 text-right tabular-nums">{(row.ctr * 100).toFixed(2)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = "overview" | "rankings" | "pages" | "content";

export default function AnalyticsPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [range, setRange] = useState<AnalyticsRange>("28d");

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "rankings", label: "Rankings" },
    { key: "pages", label: "Pages & Queries" },
    { key: "content", label: "Content" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <GscBanner projectId={projectId} />

      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border bg-muted/30 p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === t.key
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {(activeTab === "overview") && (
          <div className="flex gap-1 rounded-lg border bg-muted/30 p-1">
            {(["7d", "28d", "90d"] as AnalyticsRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  range === r
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>

      {activeTab === "overview" && <OverviewTab projectId={projectId} range={range} />}
      {activeTab === "rankings" && <RankingsTab projectId={projectId} />}
      {activeTab === "pages" && <PagesQueriesTab projectId={projectId} />}
      {activeTab === "content" && <ContentPerformanceTab projectId={projectId} />}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/\(dashboard\)/\[projectId\]/analytics/page.tsx
git commit -m "feat(web): Phase 10 analytics dashboard — 4-tab UI with Recharts"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|-----------------|------|
| `analytics_snapshots` table | Task 1 + 2 |
| `keyword_rankings` table | Task 1 + 2 |
| `gsc_connections` table | Task 1 + 2 |
| GSC OAuth scaffold endpoints | Task 5 |
| `seed_analytics_history` worker | Task 6 |
| `sync_analytics_data` daily cron | Task 6 |
| Seed triggered on project create | Task 6 |
| `GET /overview` endpoint | Task 5 |
| `GET /traffic` endpoint | Task 5 |
| `GET /rankings` endpoint | Task 5 |
| `GET /top-pages` endpoint | Task 5 |
| `GET /top-queries` endpoint | Task 5 |
| `GET /content-performance` endpoint | Task 5 |
| `GET /gsc/status`, `POST /gsc/connect`, `DELETE /gsc/disconnect` | Task 5 |
| All 9 API client functions in `api.ts` | Task 7 |
| `recharts` installed | Task 7 |
| GscBanner | Task 8 |
| Overview tab — 4 stat cards + AreaChart | Task 8 |
| Rankings tab — sortable table with DifficultyBar + IntentBadge | Task 8 |
| Top Pages / Queries tab | Task 8 |
| Content Performance tab | Task 8 |
| Date range picker (7d/28d/90d) | Task 8 |
| RBAC (viewer+ for reads, admin+ for GSC) | Task 5 (uses `CurrentUser` dependency — no RBAC on GET per existing pattern; connect/disconnect require future role check extension) |

All spec sections have corresponding tasks. ✓

### Type consistency check

- `AnalyticsOverview` fields used in `StatCard` props match schema definition ✓
- `RankingRow.position_change` is `number | null` — page handles null with `—` ✓
- `TrafficDataPoint.date` is returned as ISO string from API, formatted via `fmtDate()` ✓
- `getAnalyticsRankings` returns `RankingRow[]` — `RankingsTab` types it as `RankingRow[]` ✓
- Worker task signatures: `async def seed_analytics_history(ctx, project_id: str)` — registered in `WorkerSettings.functions` and enqueued as `"seed_analytics_history"` ✓

### Placeholder scan

No TBDs, no "add error handling" stubs, no "similar to above" references. ✓
