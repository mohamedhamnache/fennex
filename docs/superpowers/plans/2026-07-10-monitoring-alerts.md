# Scheduled Market/Competitor Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Pack keeps watch: Zerda flags ranking moves daily, Sable re-scans watched competitor pages weekly, Oasis spots market shifts weekly — all filed into an alerts inbox behind the TopBar bell.

**Architecture:** One snapshot-diff monitoring engine (`monitoring_service`) with three deterministic detectors sharing a pattern: build snapshot → diff vs stored previous → emit dedupe-guarded alerts → store new snapshot. Three tables (`watched_competitors`, `monitor_snapshots`, `alerts`). Rankings detector hooks into the existing nightly `_sync_one_project`; competitor + market detectors run on weekly crons. Frontend replaces the TopBar's placeholder bell with a live `AlertsBell` and adds an alerts inbox page with the competitor watchlist.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + arq cron (backend); Next.js 14 + TanStack Query + react-i18next (frontend). No new dependencies. Zero LLM calls.

Spec: `docs/superpowers/specs/2026-07-10-monitoring-alerts-design.md`
Branch: `feat/monitoring-alerts` (off main, already created).

## Global Constraints

- **NO EMOJI** anywhere (code, UI, comments, commit messages).
- Backend tests inside docker from repo root: `docker compose exec -T api pytest tests/test_monitoring.py -v`. Migrations via `make db-migrate`. Commit style `feat(monitoring): ...`.
- **Migration revision ids must be verified unused** before use: `grep -r "<id>" apps/api/alembic/versions/` must return nothing (a previous feature hit a collision).
- Detection is deterministic — no LLM/network calls except the competitor crawl (existing crawler service). Never fabricate: first run per (project, kind) stores the snapshot and emits nothing.
- Alert titles/details are backend-generated English (consistent with recommendations/digest copy); the UI translates chrome (kind labels, buttons, filters) via i18n in ALL SIX locales (`en/fr/es/de/pt/ar`, native translations, key parity).
- Frontend: `apiClient` for all calls; Tailwind CSS variables only (no hex in TSX); `cd apps/web && npm run typecheck` must exit 0. Dev server port 3001.
- Alert kinds: `ranking_drop | ranking_gain | competitor_change | market_shift`. Severities: `info | warning | critical`. Snapshot kinds: `rankings | market`.
- Thresholds (exact): drop = position worsened >= 3.0 AND current impressions >= 50 (critical iff was <= 10.0 and now > 10.0, else warning); gain = improved >= 3.0 AND new position <= 10.0 (info); competitor facets = title changed, meta changed, word_count changed >= 20%, h2_count changed >= 3, schema types added; market = new queries with impressions >= 50, risers with impressions >= 100 and >= 2x previous — aggregated into ONE alert/week, top 5 listed.
- Dedupe keys embed the ISO week (`f"{kind}:{key}:{iso_week}"`); unique `(project_id, dedupe_key)`.
- Watchlist: unique `(project_id, url)`, cap 10 per project, http/https URLs only.

---

### Task 1: Migration + models + test harness

**Files:**
- Create: `apps/api/app/models/monitoring.py`
- Create: `apps/api/alembic/versions/b8c9d0e1f2a3_monitoring_tables.py`
- Modify: `apps/api/app/models/__init__.py` (if it aggregates model imports — check; otherwise skip)
- Test: `apps/api/tests/test_monitoring.py` (new — harness + one constraint smoke test)

**Interfaces:**
- Produces: `WatchedCompetitor(org_id, project_id, url, label, last_scorecard, last_scanned_at)`; `MonitorSnapshot(org_id, project_id, kind, payload, taken_at)` unique (project_id, kind); `Alert(org_id, project_id, kind, severity, title, detail, url, is_read, dedupe_key)` unique (project_id, dedupe_key). Table names: `watched_competitors`, `monitor_snapshots`, `alerts`.

- [ ] **Step 1: Verify the revision id is unused**

Run: `grep -r "b8c9d0e1f2a3" apps/api/alembic/versions/` → no output. Also `docker compose exec -T api alembic heads` → single head `a7b8c9d0e1f2`. If either fails, pick another unused 12-char id and use it consistently below.

- [ ] **Step 2: Create `apps/api/app/models/monitoring.py`:**

```python
import uuid

from sqlalchemy import JSON, Boolean, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin


class WatchedCompetitor(Base, TimestampMixin):
    """A competitor URL Sable re-scans weekly for the project."""
    __tablename__ = "watched_competitors"
    __table_args__ = (UniqueConstraint("project_id", "url", name="uq_watched_competitor_url"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    label: Mapped[str | None] = mapped_column(String(200))
    last_scorecard: Mapped[dict | None] = mapped_column(JSON)
    last_scanned_at: Mapped[str | None] = mapped_column(String(50))


class MonitorSnapshot(Base, TimestampMixin):
    """Last-seen state per (project, kind) for snapshot-diff detection."""
    __tablename__ = "monitor_snapshots"
    __table_args__ = (UniqueConstraint("project_id", "kind", name="uq_monitor_snapshot_kind"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)  # rankings | market
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    taken_at: Mapped[str] = mapped_column(String(50), nullable=False)


class Alert(Base, TimestampMixin):
    """A monitoring finding surfaced in the alerts inbox."""
    __tablename__ = "alerts"
    __table_args__ = (
        UniqueConstraint("project_id", "dedupe_key", name="uq_alert_dedupe"),
        Index("ix_alerts_project_read", "project_id", "is_read"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    severity: Mapped[str] = mapped_column(String(10), default="info", nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)
    url: Mapped[str] = mapped_column(String(500), nullable=False)  # app-relative deep link
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(200), nullable=False)
```

Check how other models import `Base`/`TimestampMixin` (open `app/models/campaign.py`) and match those import paths exactly if they differ from the above.

- [ ] **Step 3: Create the migration** `apps/api/alembic/versions/b8c9d0e1f2a3_monitoring_tables.py`:

```python
"""monitoring tables: watched_competitors, monitor_snapshots, alerts

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-07-10
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "b8c9d0e1f2a3"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "watched_competitors",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.String(2048), nullable=False),
        sa.Column("label", sa.String(200)),
        sa.Column("last_scorecard", sa.JSON()),
        sa.Column("last_scanned_at", sa.String(50)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("project_id", "url", name="uq_watched_competitor_url"),
    )
    op.create_index("ix_watched_competitors_project_id", "watched_competitors", ["project_id"])
    op.create_table(
        "monitor_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("taken_at", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("project_id", "kind", name="uq_monitor_snapshot_kind"),
    )
    op.create_index("ix_monitor_snapshots_project_id", "monitor_snapshots", ["project_id"])
    op.create_table(
        "alerts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("severity", sa.String(10), nullable=False, server_default="info"),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("detail", sa.Text()),
        sa.Column("url", sa.String(500), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("dedupe_key", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("project_id", "dedupe_key", name="uq_alert_dedupe"),
    )
    op.create_index("ix_alerts_project_id", "alerts", ["project_id"])
    op.create_index("ix_alerts_project_read", "alerts", ["project_id", "is_read"])


def downgrade() -> None:
    op.drop_table("alerts")
    op.drop_table("monitor_snapshots")
    op.drop_table("watched_competitors")
```

Compare the timestamp-column convention against an existing recent migration (e.g. the campaigns one) and match it — if TimestampMixin migrations there use different column defs, mirror those.

- [ ] **Step 4: Create `apps/api/tests/test_monitoring.py`** — copy the harness idiom from `tests/test_autopilot.py` (in-memory SQLite `db_session` fixture with `SQLITE_COMPATIBLE_TABLES`, `FAKE_ORG_ID`). Tables needed across this feature: `projects, gsc_connections, gsc_query_stats, watched_competitors, monitor_snapshots, alerts`. Import the monitoring models so tables register. Add one smoke test:

```python
@pytest.mark.asyncio
async def test_alert_dedupe_unique_constraint(db_session):
    p = await _mk_project(db_session)  # define like test_autopilot's helper (Project + optional GscConnection)
    a1 = Alert(org_id=FAKE_ORG_ID, project_id=p.id, kind="ranking_drop", severity="warning",
               title="t", url="/x", dedupe_key="k:2026-W28")
    db_session.add(a1)
    await db_session.commit()
    a2 = Alert(org_id=FAKE_ORG_ID, project_id=p.id, kind="ranking_drop", severity="warning",
               title="t2", url="/x", dedupe_key="k:2026-W28")
    db_session.add(a2)
    with pytest.raises(Exception):
        await db_session.commit()
    await db_session.rollback()
```

- [ ] **Step 5: Apply + test**

Run: `make db-migrate` → applies `a7b8c9d0e1f2 -> b8c9d0e1f2a3`. `docker compose exec -T api python -c "import app.models.monitoring; print('ok')"` → ok. `docker compose exec -T api pytest tests/test_monitoring.py -v` → 1 PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/models/monitoring.py apps/api/alembic/versions/b8c9d0e1f2a3_monitoring_tables.py apps/api/tests/test_monitoring.py
git commit -m "feat(monitoring): watched_competitors, monitor_snapshots and alerts tables"
```

---

### Task 2: Monitoring engine + rankings detector (Zerda)

**Files:**
- Create: `apps/api/app/services/monitoring_service.py`
- Modify: `apps/api/app/workers/tasks/analytics_tasks.py` (`_sync_one_project` hook)
- Test: `apps/api/tests/test_monitoring.py` (append)

**Interfaces:**
- Consumes: `GscQueryStat` (`query, clicks, impressions, position`), `MonitorSnapshot`, `Alert` (Task 1).
- Produces: `async detect_rankings(project_id, org_id, db) -> int`; internal helpers reused by Tasks 3-4: `_iso_week() -> str` (e.g. `"2026-W28"`), `async _prev_snapshot(project_id, kind, db) -> dict | None`, `async _store_snapshot(project_id, org_id, kind, payload, db) -> None` (upsert, sets `taken_at` to UTC ISO now), `async _create_alert(project_id, org_id, *, kind, severity, title, detail, url, dedupe_key, db) -> bool` (select-then-insert; returns False when the dedupe key already exists).

- [ ] **Step 1: Write failing tests** (append to `tests/test_monitoring.py`; add a helper seeding `GscQueryStat` rows):

```python
async def _seed_stats(db, project_id, rows):
    """rows: list of (query, position, impressions[, clicks])"""
    from app.models.analytics import GscQueryStat
    await db.execute(delete(GscQueryStat).where(GscQueryStat.project_id == project_id))
    for r in rows:
        q, pos, imp = r[0], r[1], r[2]
        clicks = r[3] if len(r) > 3 else 0
        db.add(GscQueryStat(project_id=project_id, org_id=FAKE_ORG_ID,
                            query=q, position=pos, impressions=imp, clicks=clicks, ctr=0.0))
    await db.commit()


@pytest.mark.asyncio
async def test_rankings_first_run_is_silent(db_session):
    from app.services.monitoring_service import detect_rankings
    p = await _mk_project(db_session)
    await _seed_stats(db_session, p.id, [("menu digital", 4.0, 200)])
    assert await detect_rankings(p.id, FAKE_ORG_ID, db_session) == 0
    snaps = (await db_session.execute(select(MonitorSnapshot))).scalars().all()
    assert len(snaps) == 1 and snaps[0].kind == "rankings"
    assert (await db_session.execute(select(Alert))).scalars().first() is None


@pytest.mark.asyncio
async def test_rankings_drop_gain_and_thresholds(db_session):
    from app.services.monitoring_service import detect_rankings
    p = await _mk_project(db_session)
    await _seed_stats(db_session, p.id, [
        ("off page one", 8.0, 200),   # will fall off page 1 -> critical
        ("small drop", 5.0, 200),     # will worsen 2.0 -> below threshold, silent
        ("big riser", 14.0, 200),     # will improve into top10 -> info gain
        ("low traffic", 4.0, 30),     # will worsen 5.0 but impressions < 50 -> silent
    ])
    await detect_rankings(p.id, FAKE_ORG_ID, db_session)  # first run: snapshot only
    await _seed_stats(db_session, p.id, [
        ("off page one", 12.5, 200),
        ("small drop", 7.0, 200),
        ("big riser", 6.0, 200),
        ("low traffic", 9.0, 30),
    ])
    created = await detect_rankings(p.id, FAKE_ORG_ID, db_session)
    alerts = (await db_session.execute(select(Alert))).scalars().all()
    kinds = {(a.kind, a.severity) for a in alerts}
    assert created == 2
    assert ("ranking_drop", "critical") in kinds       # off page one: 8.0 -> 12.5
    assert ("ranking_gain", "info") in kinds           # big riser: 14.0 -> 6.0
    assert all("small drop" not in a.title and "low traffic" not in a.title for a in alerts)
    drop = next(a for a in alerts if a.kind == "ranking_drop")
    assert "off page one" in drop.title and "8.0" in (drop.detail or "") and "12.5" in (drop.detail or "")


@pytest.mark.asyncio
async def test_rankings_dedupe_same_week_and_warning_severity(db_session):
    from app.services.monitoring_service import detect_rankings
    p = await _mk_project(db_session)
    await _seed_stats(db_session, p.id, [("stays page one", 3.0, 200)])
    await detect_rankings(p.id, FAKE_ORG_ID, db_session)
    await _seed_stats(db_session, p.id, [("stays page one", 7.5, 200)])  # worsens 4.5, still page 1
    assert await detect_rankings(p.id, FAKE_ORG_ID, db_session) == 1
    a = (await db_session.execute(select(Alert))).scalars().one()
    assert a.severity == "warning"
    # same condition re-detected the same week -> deduped
    await _seed_stats(db_session, p.id, [("stays page one", 11.0, 200)])
    # previous snapshot now 7.5 -> 11.0 = 3.5 drop again, but same query+week dedupe key
    assert await detect_rankings(p.id, FAKE_ORG_ID, db_session) == 0
    assert len((await db_session.execute(select(Alert))).scalars().all()) == 1
```

(Add `from sqlalchemy import delete, select` and monitoring model imports to the test file's imports as needed.)

- [ ] **Step 2: Run to verify fail** — `docker compose exec -T api pytest tests/test_monitoring.py -v` → new tests FAIL (module not found).

- [ ] **Step 3: Implement** `apps/api/app/services/monitoring_service.py`:

```python
"""Snapshot-diff monitoring engine: Zerda (rankings), Sable (competitors),
Oasis (market). Deterministic - no LLM calls. First run per (project, kind)
stores the snapshot and emits nothing."""
import logging
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics import GscQueryStat
from app.models.monitoring import Alert, MonitorSnapshot, WatchedCompetitor

logger = logging.getLogger(__name__)

TOP_QUERIES = 200
DROP_POSITIONS = 3.0
DROP_MIN_IMPRESSIONS = 50
GAIN_POSITIONS = 3.0


def _iso_week(d: date | None = None) -> str:
    d = d or date.today()
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _prev_snapshot(project_id, kind: str, db: AsyncSession) -> dict | None:
    row = (await db.execute(select(MonitorSnapshot).where(
        MonitorSnapshot.project_id == project_id, MonitorSnapshot.kind == kind,
    ))).scalars().first()
    return row.payload if row is not None else None


async def _store_snapshot(project_id, org_id, kind: str, payload: dict, db: AsyncSession) -> None:
    row = (await db.execute(select(MonitorSnapshot).where(
        MonitorSnapshot.project_id == project_id, MonitorSnapshot.kind == kind,
    ))).scalars().first()
    if row is None:
        db.add(MonitorSnapshot(project_id=project_id, org_id=org_id, kind=kind,
                               payload=payload, taken_at=_now_iso()))
    else:
        row.payload = payload
        row.taken_at = _now_iso()


async def _create_alert(project_id, org_id, *, kind: str, severity: str, title: str,
                        detail: str | None, url: str, dedupe_key: str, db: AsyncSession) -> bool:
    existing = (await db.execute(select(Alert).where(
        Alert.project_id == project_id, Alert.dedupe_key == dedupe_key,
    ))).scalars().first()
    if existing is not None:
        return False
    db.add(Alert(project_id=project_id, org_id=org_id, kind=kind, severity=severity,
                 title=title[:500], detail=detail, url=url[:500], dedupe_key=dedupe_key[:200]))
    return True


async def detect_rankings(project_id, org_id, db: AsyncSession) -> int:
    """Zerda: diff query positions vs the previous sync's snapshot."""
    stats = (await db.execute(select(GscQueryStat).where(
        GscQueryStat.project_id == project_id,
    ).order_by(GscQueryStat.impressions.desc()).limit(TOP_QUERIES))).scalars().all()
    current = {s.query: {"position": float(s.position or 0.0), "clicks": int(s.clicks or 0),
                         "impressions": int(s.impressions or 0)} for s in stats}
    prev = await _prev_snapshot(project_id, "rankings", db)
    created = 0
    if prev is not None:
        wk = _iso_week()
        base = f"/{project_id}/analytics"
        for q, cur in current.items():
            old = prev.get(q)
            if not old:
                continue
            delta = cur["position"] - float(old.get("position") or 0.0)
            if delta >= DROP_POSITIONS and cur["impressions"] >= DROP_MIN_IMPRESSIONS:
                fell_off = float(old["position"]) <= 10.0 < cur["position"]
                if await _create_alert(
                    project_id, org_id, kind="ranking_drop",
                    severity="critical" if fell_off else "warning",
                    title=f"Ranking drop: '{q}'",
                    detail=(f"Position {old['position']:.1f} -> {cur['position']:.1f} "
                            f"({cur['impressions']} impressions)."),
                    url=base, dedupe_key=f"ranking_drop:{q}:{wk}", db=db,
                ):
                    created += 1
            elif delta <= -GAIN_POSITIONS and cur["position"] <= 10.0:
                if await _create_alert(
                    project_id, org_id, kind="ranking_gain", severity="info",
                    title=f"Ranking gain: '{q}'",
                    detail=(f"Position {old['position']:.1f} -> {cur['position']:.1f} "
                            f"({cur['impressions']} impressions)."),
                    url=base, dedupe_key=f"ranking_gain:{q}:{wk}", db=db,
                ):
                    created += 1
    await _store_snapshot(project_id, org_id, "rankings", current, db)
    await db.commit()
    return created
```

- [ ] **Step 4: Hook into the nightly sync.** In `apps/api/app/workers/tasks/analytics_tasks.py`, `_sync_one_project`, directly after the existing `measure`/`run_matching` try/except block (same indentation), add:

```python
        # The Pack keeps watch: Zerda's ranking-move detection on fresh GSC data.
        from app.services.monitoring_service import detect_rankings
        try:
            await detect_rankings(pid, org_id, session)
        except Exception:
            pass  # monitoring must never break the nightly sync
```

- [ ] **Step 5: Run to verify pass** — `docker compose exec -T api pytest tests/test_monitoring.py -v` → ALL pass (4 total).

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/services/monitoring_service.py apps/api/app/workers/tasks/analytics_tasks.py apps/api/tests/test_monitoring.py
git commit -m "feat(monitoring): rankings detector (Zerda) hooked into the nightly sync"
```

---

### Task 3: Competitor detector (Sable) + scan helper

**Files:**
- Modify: `apps/api/app/services/competitor_service.py` (public `scan_scorecard`)
- Modify: `apps/api/app/services/monitoring_service.py` (append `detect_competitors`)
- Test: `apps/api/tests/test_monitoring.py` (append)

**Interfaces:**
- Consumes: `competitor_service._crawl(url)` + `_scorecard(page)` (existing); `WatchedCompetitor`; engine helpers (Task 2).
- Produces: `competitor_service.scan_scorecard(url) -> dict` (raises on crawl failure); `monitoring_service.detect_competitors(project_id, org_id, db) -> int`. Scorecard keys used for diffing: `title`, `meta_description`, `word_count`, `h2_count`, `schema_types`.

- [ ] **Step 1: Write failing tests** (append; patch `scan_scorecard` where monitoring imports it):

```python
def _card(title="T", meta="M", wc=1000, h2=5, schema=None):
    return {"title": title, "meta_description": meta, "word_count": wc,
            "h2_count": h2, "schema_types": schema or ["Article"]}


async def _mk_watch(db, project_id, url="https://rival.com/guide", card=None):
    w = WatchedCompetitor(org_id=FAKE_ORG_ID, project_id=project_id, url=url,
                          last_scorecard=card)
    db.add(w)
    await db.commit()
    await db.refresh(w)
    return w


@pytest.mark.asyncio
async def test_competitor_first_scan_is_silent_and_stores(db_session):
    from app.services import monitoring_service
    p = await _mk_project(db_session)
    w = await _mk_watch(db_session, p.id, card=None)
    with patch.object(monitoring_service, "scan_scorecard", new=AsyncMock(return_value=_card())):
        assert await monitoring_service.detect_competitors(p.id, FAKE_ORG_ID, db_session) == 0
    await db_session.refresh(w)
    assert w.last_scorecard == _card() and w.last_scanned_at is not None
    assert (await db_session.execute(select(Alert))).scalars().first() is None


@pytest.mark.asyncio
async def test_competitor_change_facets_alert(db_session):
    from app.services import monitoring_service
    p = await _mk_project(db_session)
    await _mk_watch(db_session, p.id, card=_card())
    changed = _card(title="New Title", wc=1300, schema=["Article", "FAQPage"])  # 3 facets
    with patch.object(monitoring_service, "scan_scorecard", new=AsyncMock(return_value=changed)):
        assert await monitoring_service.detect_competitors(p.id, FAKE_ORG_ID, db_session) == 1
    a = (await db_session.execute(select(Alert))).scalars().one()
    assert a.kind == "competitor_change" and a.severity == "warning"
    assert "title" in (a.detail or "") and "word count" in (a.detail or "") and "FAQPage" in (a.detail or "")


@pytest.mark.asyncio
async def test_competitor_unchanged_and_small_changes_are_silent(db_session):
    from app.services import monitoring_service
    p = await _mk_project(db_session)
    await _mk_watch(db_session, p.id, card=_card(wc=1000, h2=5))
    minor = _card(wc=1100, h2=7)  # wc +10% (<20%), h2 +2 (<3) -> silent
    with patch.object(monitoring_service, "scan_scorecard", new=AsyncMock(return_value=minor)):
        assert await monitoring_service.detect_competitors(p.id, FAKE_ORG_ID, db_session) == 0


@pytest.mark.asyncio
async def test_competitor_crawl_failure_skips_and_keeps_scorecard(db_session):
    from app.services import monitoring_service
    p = await _mk_project(db_session)
    w = await _mk_watch(db_session, p.id, card=_card())
    with patch.object(monitoring_service, "scan_scorecard", new=AsyncMock(side_effect=RuntimeError("down"))):
        assert await monitoring_service.detect_competitors(p.id, FAKE_ORG_ID, db_session) == 0
    await db_session.refresh(w)
    assert w.last_scorecard == _card()  # unchanged
    assert (await db_session.execute(select(Alert))).scalars().first() is None
```

- [ ] **Step 2: Run to verify fail** — `docker compose exec -T api pytest tests/test_monitoring.py -k competitor -v` → FAIL.

- [ ] **Step 3: Implement.** In `apps/api/app/services/competitor_service.py`, add near `analyze`:

```python
async def scan_scorecard(url: str) -> dict:
    """Crawl a URL and return its scorecard only (no LLM insights). Raises on failure."""
    page = await _crawl(url)
    if page.get("error") or page.get("status_code", 0) >= 400:
        raise RuntimeError(page.get("error") or f"HTTP {page.get('status_code')}")
    return _scorecard(page)
```

In `monitoring_service.py`, add the import `from app.services.competitor_service import scan_scorecard` (module scope — tests patch `monitoring_service.scan_scorecard`) and append:

```python
WC_CHANGE_RATIO = 0.20
H2_CHANGE_MIN = 3


def _scorecard_changes(old: dict, new: dict) -> list[str]:
    changes: list[str] = []
    if (new.get("title") or "") != (old.get("title") or ""):
        changes.append("title changed")
    if (new.get("meta_description") or "") != (old.get("meta_description") or ""):
        changes.append("meta description changed")
    old_wc, new_wc = int(old.get("word_count") or 0), int(new.get("word_count") or 0)
    if old_wc and abs(new_wc - old_wc) / old_wc >= WC_CHANGE_RATIO:
        changes.append(f"word count {old_wc} -> {new_wc}")
    if abs(int(new.get("h2_count") or 0) - int(old.get("h2_count") or 0)) >= H2_CHANGE_MIN:
        changes.append(f"headings {old.get('h2_count')} -> {new.get('h2_count')}")
    added = set(new.get("schema_types") or []) - set(old.get("schema_types") or [])
    if added:
        changes.append("schema added: " + ", ".join(sorted(added)))
    return changes


async def detect_competitors(project_id, org_id, db: AsyncSession) -> int:
    """Sable: re-scan watched competitor pages and alert on scorecard changes."""
    watches = (await db.execute(select(WatchedCompetitor).where(
        WatchedCompetitor.project_id == project_id,
    ))).scalars().all()
    created = 0
    wk = _iso_week()
    for w in watches:
        try:
            card = await scan_scorecard(w.url)
        except Exception:
            logger.warning("competitor scan failed, skipping: %s", w.url)
            continue
        if w.last_scorecard:
            changes = _scorecard_changes(w.last_scorecard, card)
            if changes:
                if await _create_alert(
                    project_id, org_id, kind="competitor_change", severity="warning",
                    title=f"Competitor changed: {w.label or w.url}",
                    detail="; ".join(changes) + ".",
                    url=f"/{project_id}/analytics?ws=competitors",
                    dedupe_key=f"competitor_change:{w.url}:{wk}", db=db,
                ):
                    created += 1
        w.last_scorecard = card
        w.last_scanned_at = _now_iso()
    await db.commit()
    return created
```

- [ ] **Step 4: Run to verify pass** — `docker compose exec -T api pytest tests/test_monitoring.py -v` → ALL pass (8 total).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/competitor_service.py apps/api/app/services/monitoring_service.py apps/api/tests/test_monitoring.py
git commit -m "feat(monitoring): competitor change detector (Sable) with scorecard diffing"
```

---

### Task 4: Market detector (Oasis) + weekly crons + digest line

**Files:**
- Modify: `apps/api/app/services/monitoring_service.py` (append `detect_market`)
- Create: `apps/api/app/workers/tasks/monitoring_tasks.py`
- Modify: `apps/api/app/workers/worker.py` (imports, functions, two crons)
- Modify: `apps/api/app/services/digest_service.py` (unread-alerts line)
- Test: `apps/api/tests/test_monitoring.py` (append)

**Interfaces:**
- Consumes: engine helpers, `GscQueryStat`, `GscConnection`, `WatchedCompetitor`, `Project`.
- Produces: `detect_market(project_id, org_id, db) -> int`; `run_competitor_monitor(ctx)` (projects with a non-empty watchlist); `run_market_monitor(ctx)` (projects with an active GSC connection); crons `cron(run_market_monitor, weekday=0, hour=7, minute=0, run_at_startup=False)` and `cron(run_competitor_monitor, weekday=1, hour=7, minute=0, run_at_startup=False)`.

- [ ] **Step 1: Write failing tests** (append):

```python
@pytest.mark.asyncio
async def test_market_first_run_silent_then_single_aggregated_alert(db_session):
    from app.services.monitoring_service import detect_market
    p = await _mk_project(db_session)
    await _seed_stats(db_session, p.id, [("existing topic", 5.0, 400)])
    assert await detect_market(p.id, FAKE_ORG_ID, db_session) == 0
    await _seed_stats(db_session, p.id, [
        ("existing topic", 5.0, 900),      # riser: 400 -> 900 (>=2x, >=100)
        ("brand new query", 6.0, 120),     # new demand (>=50)
        ("tiny new query", 6.0, 20),       # new but < 50 -> ignored
    ])
    created = await detect_market(p.id, FAKE_ORG_ID, db_session)
    assert created == 1  # ONE aggregated alert
    a = (await db_session.execute(select(Alert).where(Alert.kind == "market_shift"))).scalars().one()
    assert a.severity == "info"
    assert "brand new query" in (a.detail or "") and "existing topic" in (a.detail or "")
    assert "tiny new query" not in (a.detail or "")
    # re-run same week -> deduped
    assert await detect_market(p.id, FAKE_ORG_ID, db_session) == 0


@pytest.mark.asyncio
async def test_weekly_crons_iterate_and_isolate_failures(db_session):
    from app.workers.tasks import monitoring_tasks
    p_gsc = await _mk_project(db_session)               # active GSC -> market monitor
    p_watch = await _mk_project(db_session, gsc=False)  # watchlist -> competitor monitor
    await _mk_watch(db_session, p_watch.id)
    calls: list[str] = []

    async def fake_market(project_id, org_id, db):
        calls.append(f"market:{project_id}")
        raise RuntimeError("boom")

    async def fake_comp(project_id, org_id, db):
        calls.append(f"comp:{project_id}")
        return 0

    with patch.object(monitoring_tasks, "detect_market", new=fake_market), \
         patch.object(monitoring_tasks, "detect_competitors", new=fake_comp), \
         patch.object(monitoring_tasks, "async_session_factory",
                      new=lambda: _single_session(db_session)):
        await monitoring_tasks.run_market_monitor(None)     # must not raise despite boom
        await monitoring_tasks.run_competitor_monitor(None)
    assert f"market:{p_gsc.id}" in calls and f"comp:{p_watch.id}" in calls
```

(`_mk_project(db, gsc=True)` and `_single_session` mirror `tests/test_autopilot.py` — reuse the same local definitions in this file.)

- [ ] **Step 2: Run to verify fail** — `docker compose exec -T api pytest tests/test_monitoring.py -k "market or crons" -v` → FAIL.

- [ ] **Step 3: Implement.** Append to `monitoring_service.py`:

```python
MARKET_NEW_MIN_IMPRESSIONS = 50
MARKET_RISER_MIN_IMPRESSIONS = 100
MARKET_RISER_RATIO = 2.0
MARKET_TOP_FINDINGS = 5


async def detect_market(project_id, org_id, db: AsyncSession) -> int:
    """Oasis: new demand and rising queries vs last week's snapshot - one alert/week."""
    stats = (await db.execute(select(GscQueryStat).where(
        GscQueryStat.project_id == project_id,
    ).order_by(GscQueryStat.impressions.desc()).limit(TOP_QUERIES))).scalars().all()
    current = {s.query: int(s.impressions or 0) for s in stats}
    prev = await _prev_snapshot(project_id, "market", db)
    created = 0
    if prev is not None:
        findings: list[tuple[int, str]] = []
        for q, imp in current.items():
            old = prev.get(q)
            if old is None and imp >= MARKET_NEW_MIN_IMPRESSIONS:
                findings.append((imp, f"new demand: '{q}' ({imp} impressions)"))
            elif old and imp >= MARKET_RISER_MIN_IMPRESSIONS and imp >= MARKET_RISER_RATIO * old:
                findings.append((imp, f"rising: '{q}' ({old} -> {imp} impressions)"))
        if findings:
            top = [line for _, line in sorted(findings, reverse=True)[:MARKET_TOP_FINDINGS]]
            if await _create_alert(
                project_id, org_id, kind="market_shift", severity="info",
                title=f"Market shift: {len(findings)} queries moved",
                detail="; ".join(top) + ".",
                url=f"/{project_id}/analytics?ws=market",
                dedupe_key=f"market_shift:{_iso_week()}", db=db,
            ):
                created += 1
    await _store_snapshot(project_id, org_id, "market", current, db)
    await db.commit()
    return created
```

Create `apps/api/app/workers/tasks/monitoring_tasks.py`:

```python
"""Weekly monitoring crons: Sable competitor re-scans, Oasis market shifts."""
import logging

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.analytics import GscConnection
from app.models.monitoring import WatchedCompetitor
from app.models.project import Project
from app.services.monitoring_service import detect_competitors, detect_market

logger = logging.getLogger(__name__)


async def run_market_monitor(ctx) -> None:
    async with async_session_factory() as db:
        projects = (await db.execute(
            select(Project).join(GscConnection, GscConnection.project_id == Project.id)
            .where(GscConnection.is_active.is_(True))
        )).scalars().all()
    for p in projects:
        try:
            async with async_session_factory() as db:
                await detect_market(p.id, p.org_id, db)
        except Exception:  # noqa: BLE001 - one project must not break the batch
            logger.exception("market monitor failed for project %s", p.id)


async def run_competitor_monitor(ctx) -> None:
    async with async_session_factory() as db:
        projects = (await db.execute(
            select(Project).join(WatchedCompetitor, WatchedCompetitor.project_id == Project.id)
            .distinct()
        )).scalars().all()
    for p in projects:
        try:
            async with async_session_factory() as db:
                await detect_competitors(p.id, p.org_id, db)
        except Exception:  # noqa: BLE001
            logger.exception("competitor monitor failed for project %s", p.id)
```

In `worker.py`: import both, append to `functions`, and add crons:

```python
        # The Pack keeps watch: Oasis market shifts Monday (before the 08:00 digest),
        # Sable competitor re-scans Tuesday.
        cron(run_market_monitor, weekday=0, hour=7, minute=0, run_at_startup=False),
        cron(run_competitor_monitor, weekday=1, hour=7, minute=0, run_at_startup=False),
```

In `digest_service.py`, `compose_digest`, after the opportunities are gathered, compute the unread count and include one line in the HTML near the CTA (adapt placement to the existing template structure):

```python
    unread_alerts = 0
    try:
        from sqlalchemy import func as _func, select as _select
        from app.models.monitoring import Alert
        unread_alerts = (await db.execute(
            _select(_func.count()).select_from(Alert).where(
                Alert.project_id == project.id, Alert.is_read.is_(False))
        )).scalar() or 0
    except Exception:
        pass  # monitoring must never break the digest
```

```python
    alerts_html = (
        f"<p style='margin:12px 0'><strong>{unread_alerts}</strong> unread alert(s) from the Pack - "
        f"<a href='{base_url}/alerts'>open your inbox</a>.</p>"
    ) if unread_alerts else ""
```

and interpolate `{alerts_html}` into the digest HTML body.

- [ ] **Step 4: Run to verify pass + worker registers**

Run: `docker compose exec -T api pytest tests/test_monitoring.py -v` → ALL pass (10). `docker compose restart worker && sleep 6 && docker compose logs worker 2>&1 | tail -6` → lists `run_market_monitor`, `run_competitor_monitor`, no import errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/monitoring_service.py apps/api/app/workers/tasks/monitoring_tasks.py apps/api/app/workers/worker.py apps/api/app/services/digest_service.py apps/api/tests/test_monitoring.py
git commit -m "feat(monitoring): market detector (Oasis), weekly crons and digest line"
```

---

### Task 5: Monitoring router + frontend API client

**Files:**
- Create: `apps/api/app/api/v1/routers/monitoring.py`
- Modify: `apps/api/app/api/v1/router.py` (register, prefix `/monitoring`)
- Modify: `apps/web/lib/api.ts` (types + client functions)
- Test: `apps/api/tests/test_monitoring.py` (append endpoint tests)

**Interfaces:**
- Consumes: models (Task 1). Look at `apps/api/app/api/v1/routers/campaigns.py` for the router idioms (CurrentUser/DB dependencies, org scoping, 404 pattern) and at `tests/test_campaigns.py` for the `client` fixture pattern to copy into `test_monitoring.py`.
- Produces (backend): `GET /monitoring/alerts?project_id=&unread_only=&kind=&limit=` (newest first, default limit 50); `POST /monitoring/alerts/{alert_id}/read`; `POST /monitoring/alerts/read-all?project_id=` → `{"marked": n}`; `GET /monitoring/alerts/unread-count?project_id=` → `{"count": n}`; `GET /monitoring/competitors?project_id=`; `POST /monitoring/competitors` body `{project_id, url, label?}` (409 on duplicate url, 400 on invalid url or watchlist cap 10); `DELETE /monitoring/competitors/{watch_id}`. Alert JSON: `{id, kind, severity, title, detail, url, is_read, created_at}`. Competitor JSON: `{id, url, label, last_scanned_at}`.
- Produces (frontend, `apps/web/lib/api.ts`):

```typescript
export interface Alert {
  id: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string | null;
  url: string;
  is_read: boolean;
  created_at: string;
}
export interface WatchedCompetitor {
  id: string;
  url: string;
  label: string | null;
  last_scanned_at: string | null;
}
export async function listAlerts(projectId: string, opts?: { unreadOnly?: boolean; kind?: string; limit?: number }): Promise<Alert[]>
export async function markAlertRead(alertId: string): Promise<{ ok: boolean }>
export async function markAllAlertsRead(projectId: string): Promise<{ marked: number }>
export async function getUnreadAlertCount(projectId: string): Promise<{ count: number }>
export async function listWatchedCompetitors(projectId: string): Promise<WatchedCompetitor[]>
export async function addWatchedCompetitor(projectId: string, url: string, label?: string): Promise<WatchedCompetitor>
export async function removeWatchedCompetitor(watchId: string): Promise<{ ok: boolean }>
```

- [ ] **Step 1: Write failing endpoint tests** (append; copy the `client` fixture idiom from `tests/test_campaigns.py`, including its auth/dependency overrides):

```python
@pytest.mark.asyncio
async def test_alerts_endpoints(client, db_session, org_and_project):
    p = await _mk_project(db_session)
    for i in range(3):
        db_session.add(Alert(org_id=FAKE_ORG_ID, project_id=p.id, kind="ranking_drop",
                             severity="warning", title=f"t{i}", url="/x", dedupe_key=f"k{i}"))
    await db_session.commit()
    r = await client.get(f"/api/v1/monitoring/alerts?project_id={p.id}")
    assert r.status_code == 200 and len(r.json()) == 3
    first_id = r.json()[0]["id"]
    r = await client.post(f"/api/v1/monitoring/alerts/{first_id}/read")
    assert r.status_code == 200
    r = await client.get(f"/api/v1/monitoring/alerts?project_id={p.id}&unread_only=true")
    assert len(r.json()) == 2
    r = await client.get(f"/api/v1/monitoring/alerts/unread-count?project_id={p.id}")
    assert r.json()["count"] == 2
    r = await client.post(f"/api/v1/monitoring/alerts/read-all?project_id={p.id}")
    assert r.json()["marked"] == 2
    r = await client.get(f"/api/v1/monitoring/alerts/unread-count?project_id={p.id}")
    assert r.json()["count"] == 0


@pytest.mark.asyncio
async def test_watchlist_endpoints_validation(client, db_session, org_and_project):
    p = await _mk_project(db_session)
    r = await client.post("/api/v1/monitoring/competitors",
                          json={"project_id": str(p.id), "url": "https://rival.com", "label": "Rival"})
    assert r.status_code == 201, r.text
    wid = r.json()["id"]
    # duplicate URL -> 409
    r = await client.post("/api/v1/monitoring/competitors",
                          json={"project_id": str(p.id), "url": "https://rival.com"})
    assert r.status_code == 409
    # invalid URL -> 400
    r = await client.post("/api/v1/monitoring/competitors",
                          json={"project_id": str(p.id), "url": "not-a-url"})
    assert r.status_code == 400
    # cap 10
    for i in range(9):
        await client.post("/api/v1/monitoring/competitors",
                          json={"project_id": str(p.id), "url": f"https://r{i}.com"})
    r = await client.post("/api/v1/monitoring/competitors",
                          json={"project_id": str(p.id), "url": "https://one-too-many.com"})
    assert r.status_code == 400
    r = await client.get(f"/api/v1/monitoring/competitors?project_id={p.id}")
    assert len(r.json()) == 10
    r = await client.delete(f"/api/v1/monitoring/competitors/{wid}")
    assert r.status_code == 200
```

- [ ] **Step 2: Run to verify fail** — `docker compose exec -T api pytest tests/test_monitoring.py -k endpoints -v` → FAIL (404s).

- [ ] **Step 3: Implement** `apps/api/app/api/v1/routers/monitoring.py` (match campaigns.py idioms for deps and org scoping):

```python
"""Monitoring: alerts inbox + competitor watchlist."""
import uuid
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select, update

from app.core.dependencies import CurrentUser, DB
from app.models.monitoring import Alert, WatchedCompetitor

router = APIRouter()

WATCHLIST_CAP = 10


def _alert(a: Alert) -> dict:
    return {"id": str(a.id), "kind": a.kind, "severity": a.severity, "title": a.title,
            "detail": a.detail, "url": a.url, "is_read": a.is_read,
            "created_at": a.created_at.isoformat() if a.created_at else None}


@router.get("/alerts")
async def list_alerts(project_id: uuid.UUID, current_user: CurrentUser, db: DB,
                      unread_only: bool = False, kind: str | None = None, limit: int = 50):
    q = select(Alert).where(Alert.project_id == project_id, Alert.org_id == current_user.org_id)
    if unread_only:
        q = q.where(Alert.is_read.is_(False))
    if kind:
        q = q.where(Alert.kind == kind)
    rows = (await db.execute(q.order_by(Alert.created_at.desc()).limit(min(limit, 200)))).scalars().all()
    return [_alert(a) for a in rows]


@router.post("/alerts/{alert_id}/read")
async def mark_read(alert_id: uuid.UUID, current_user: CurrentUser, db: DB):
    a = (await db.execute(select(Alert).where(
        Alert.id == alert_id, Alert.org_id == current_user.org_id))).scalars().first()
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")
    a.is_read = True
    await db.flush()
    return {"ok": True}


@router.post("/alerts/read-all")
async def mark_all_read(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    result = await db.execute(update(Alert).where(
        Alert.project_id == project_id, Alert.org_id == current_user.org_id,
        Alert.is_read.is_(False)).values(is_read=True))
    await db.flush()
    return {"marked": result.rowcount or 0}


@router.get("/alerts/unread-count")
async def unread_count(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    n = (await db.execute(select(func.count()).select_from(Alert).where(
        Alert.project_id == project_id, Alert.org_id == current_user.org_id,
        Alert.is_read.is_(False)))).scalar() or 0
    return {"count": n}


class WatchIn(BaseModel):
    project_id: uuid.UUID
    url: str
    label: str | None = None


def _watch(w: WatchedCompetitor) -> dict:
    return {"id": str(w.id), "url": w.url, "label": w.label, "last_scanned_at": w.last_scanned_at}


@router.get("/competitors")
async def list_watchlist(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    rows = (await db.execute(select(WatchedCompetitor).where(
        WatchedCompetitor.project_id == project_id,
        WatchedCompetitor.org_id == current_user.org_id))).scalars().all()
    return [_watch(w) for w in rows]


@router.post("/competitors", status_code=status.HTTP_201_CREATED)
async def add_watch(body: WatchIn, current_user: CurrentUser, db: DB):
    parsed = urlparse(body.url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enter a valid http(s) URL.")
    count = (await db.execute(select(func.count()).select_from(WatchedCompetitor).where(
        WatchedCompetitor.project_id == body.project_id,
        WatchedCompetitor.org_id == current_user.org_id))).scalar() or 0
    if count >= WATCHLIST_CAP:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Watchlist is limited to {WATCHLIST_CAP} competitors.")
    dup = (await db.execute(select(WatchedCompetitor).where(
        WatchedCompetitor.project_id == body.project_id,
        WatchedCompetitor.url == body.url.strip()))).scalars().first()
    if dup is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already on the watchlist.")
    w = WatchedCompetitor(org_id=current_user.org_id, project_id=body.project_id,
                          url=body.url.strip(), label=(body.label or None))
    db.add(w)
    await db.flush()
    await db.refresh(w)
    return _watch(w)


@router.delete("/competitors/{watch_id}")
async def remove_watch(watch_id: uuid.UUID, current_user: CurrentUser, db: DB):
    w = (await db.execute(select(WatchedCompetitor).where(
        WatchedCompetitor.id == watch_id,
        WatchedCompetitor.org_id == current_user.org_id))).scalars().first()
    if w is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    await db.delete(w)
    await db.flush()
    return {"ok": True}
```

Register in `apps/api/app/api/v1/router.py`: `api_router.include_router(monitoring.router, prefix="/monitoring", tags=["monitoring"])` (+ import). Then add the frontend types/functions from the Interfaces block to `apps/web/lib/api.ts` following the existing `apiClient.get/post/delete` patterns (e.g. `listAlerts` builds the query string from opts).

- [ ] **Step 4: Run to verify pass** — `docker compose exec -T api pytest tests/test_monitoring.py -v` → ALL pass (12). `cd apps/web && npm run typecheck` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/api/v1/routers/monitoring.py apps/api/app/api/v1/router.py apps/web/lib/api.ts apps/api/tests/test_monitoring.py
git commit -m "feat(monitoring): alerts and watchlist API + frontend client"
```

---

### Task 6: AlertsBell + inbox page + watchlist + i18n

**Files:**
- Create: `apps/web/components/monitoring/AlertsBell.tsx`
- Create: `apps/web/components/monitoring/WatchlistCard.tsx`
- Create: `apps/web/app/(dashboard)/[projectId]/alerts/page.tsx`
- Modify: `apps/web/components/layout/TopBar.tsx` (replace the placeholder notifications block)
- Modify: `apps/web/public/locales/{en,fr,es,de,pt,ar}/common.json` (`alertsCenter.*`)

**Interfaces:**
- Consumes: Task 5 client functions/types; `FENNEX_AGENTS` from `@/lib/agents` (icons — kind mapping: `ranking_drop`/`ranking_gain` → zerda, `competitor_change` → sable, `market_shift` → oasis); `.popover` CSS class; `useProjectStore`.
- Produces: `<AlertsBell />` (self-contained, resolves project from URL path with store fallback — same pattern as I18nProvider); the `/[projectId]/alerts` inbox route.

- [ ] **Step 1: Create `apps/web/components/monitoring/AlertsBell.tsx`.** Behavior (write complete code following these rules):
  - `"use client"`. Resolve `projectId`: first path segment of `usePathname()` if it matches an id in the `["projects"]` query (`listProjects`, staleTime 5min), else `useProjectStore().currentProjectId`, else first project; render a bare (badge-less, popover-empty-state) bell when none.
  - `useQuery(["alerts-unread", projectId], () => getUnreadAlertCount(projectId), { enabled: !!projectId, staleTime: 60_000, refetchInterval: 120_000 })`.
  - Bell button styled exactly like the current TopBar placeholder button (same classes, `aria-label={t("alertsCenter.bell")}`); when `count > 0` show a badge: absolutely-positioned `min-w-4 h-4 rounded-full bg-destructive text-[10px] text-white` with the count (cap display at "9+").
  - Popover (`.popover animate-scale-in absolute right-0 top-full z-50 mt-2 w-80`): header row with `t("alertsCenter.title")` + a "view all" link to `/${projectId}/alerts` (closes popover). Body: `useQuery(["alerts", projectId, "recent"], () => listAlerts(projectId, { limit: 5 }), { enabled: open && !!projectId })`; each row shows the agent icon (kind mapping above, gradient circle like the campaigns feed), title (truncate), relative time (format with `i18n.language` via `new Date(...).toLocaleDateString`), unread dot when `!is_read`; onClick → `markAlertRead(id)`, invalidate `["alerts-unread", projectId]` + `["alerts"]`, `router.push(alert.url)`, close. Empty state: success-check + `t("alertsCenter.caughtUp")` (mirror the placeholder's layout).
  - Outside-click close via a ref (copy the pattern from the existing TopBar notif block before deleting it).
- [ ] **Step 2: Replace the TopBar placeholder.** In `TopBar.tsx`, delete the whole `{/* Notifications */}` block (the `notifRef` div through its closing `</div>`) plus the now-unused `notifOpen`/`notifRef` state and `Bell`/`Check` imports if unused elsewhere, and render `<AlertsBell />` in its place. Keep the user-menu's `setNotifOpen(false)` coordination out (AlertsBell manages itself).
- [ ] **Step 3: Create `apps/web/components/monitoring/WatchlistCard.tsx`.** Card titled `t("alertsCenter.watchlist.title")` + hint `t("alertsCenter.watchlist.hint")`; `useQuery(["watchlist", projectId], () => listWatchedCompetitors(projectId))`; rows (favicon-less: globe icon, `label ?? url` truncated, last-scanned relative date, remove button → `removeWatchedCompetitor` + invalidate); add form: URL input + optional label input + add button (`addWatchedCompetitor`, on 400/409 toast the server message via `useToast`). Disable add when list length >= 10 and show `t("alertsCenter.watchlist.cap")`.
- [ ] **Step 4: Create the inbox page** `apps/web/app/(dashboard)/[projectId]/alerts/page.tsx`:
  - `PageHeader` (icon `Bell`) with `t("alertsCenter.title")` / `t("alertsCenter.subtitle")`; header action "mark all read" (`markAllAlertsRead` + invalidate both alert queries), disabled when unread count is 0.
  - Filter row: All / Unread toggle + kind chips (`t(\`alertsCenter.kinds.${kind}\`)` for the 4 kinds) driving `listAlerts(projectId, { unreadOnly, kind })` in `useQuery(["alerts", projectId, unreadOnly, kind], ...)`.
  - Layout `lg:grid-cols-3`: alerts list (2 cols) + `WatchlistCard` (1 col).
  - Alert row: severity dot (`info` → `bg-muted-foreground/40`, `warning` → `bg-warning`, `critical` → `bg-destructive`), agent gradient icon + name (from `FENNEX_AGENTS`), title (font-medium, dim when read), detail (text-xs muted, line-clamp-2), relative time (locale-formatted), action button `t("alertsCenter.open")` linking to `alert.url` that also marks read on click. Unread rows get `bg-primary/[0.03]`.
  - Empty state: `t("alertsCenter.empty")` with a shield/check visual.
- [ ] **Step 5: i18n.** Add a top-level `alertsCenter` block to ALL SIX locales (native translations; en values):

```json
"alertsCenter": {
  "bell": "Alerts",
  "title": "Alerts",
  "subtitle": "The Pack keeps watch - ranking moves, competitor changes and market shifts land here",
  "viewAll": "View all",
  "caughtUp": "All caught up - the Pack has nothing to report",
  "markAllRead": "Mark all read",
  "unreadOnly": "Unread",
  "all": "All",
  "open": "Open",
  "empty": "The Pack is keeping watch - no alerts yet.",
  "kinds": {
    "ranking_drop": "Ranking drop",
    "ranking_gain": "Ranking gain",
    "competitor_change": "Competitor change",
    "market_shift": "Market shift"
  },
  "watchlist": {
    "title": "Watched competitors",
    "hint": "Sable re-scans these pages every week and alerts you when they change.",
    "add": "Watch",
    "urlPlaceholder": "https://competitor.com/their-best-page",
    "labelPlaceholder": "Label (optional)",
    "cap": "Watchlist is full (10). Remove one to add another.",
    "empty": "No competitors watched yet."
  }
}
```

- [ ] **Step 6: Verify + smoke**

Run: `cd apps/web && npm run typecheck` → exit 0. JSON validity for all 6 locales. `docker compose restart web && sleep 9 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/` → 200/302. Grep new components for hardcoded visible strings → none.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/monitoring/ "apps/web/app/(dashboard)/[projectId]/alerts/page.tsx" apps/web/components/layout/TopBar.tsx apps/web/public/locales/*/common.json
git commit -m "feat(monitoring): alerts bell, inbox page and competitor watchlist"
```

---

## Final verification

- [ ] Backend: `docker compose exec -T api pytest tests/test_monitoring.py tests/test_autopilot.py tests/test_campaigns.py -v` — all PASS.
- [ ] `make db-migrate` idempotent; worker logs list `run_market_monitor` + `run_competitor_monitor` + existing tasks.
- [ ] Frontend: typecheck clean; 6 locale JSONs valid with `alertsCenter.*` parity.
- [ ] Live: add a competitor to the watchlist; run the detectors manually
  (`docker compose exec -T api python -c "import asyncio; from app.workers.tasks.monitoring_tasks import run_competitor_monitor, run_market_monitor; asyncio.run(run_market_monitor(None)); asyncio.run(run_competitor_monitor(None))"`),
  and trigger a ranking diff by running the nightly sync
  (`... from app.workers.tasks.analytics_tasks import sync_analytics_data; asyncio.run(sync_analytics_data(None))`);
  bell badge appears, popover lists alerts, inbox filters/mark-read work, deep links land, digest includes the alerts line. Both themes.
- [ ] Ledger updated; branch ready.
