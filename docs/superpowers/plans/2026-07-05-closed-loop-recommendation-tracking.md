# Closed-Loop Recommendation Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist agent/opportunity recommendations the user chooses to track, freeze their baseline Search Console metrics, and after the user acts, measure and report whether they worked.

**Architecture:** One `recommendations` table (Approach A). Baseline metrics are snapshotted from `GscQueryStat` at accept-time; a measurement pass appended to the existing daily `sync_analytics_data` cron recomputes a multi-metric impact score for items past their window. A dedicated Zerda page and inline "Track this" buttons feed the table; the weekly digest gets a standup line.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, arq, pytest/pytest-asyncio (backend); Next.js 14 App Router, TypeScript, TanStack Query (frontend).

Spec: `docs/superpowers/specs/2026-07-05-closed-loop-recommendation-tracking-design.md`

## Global Constraints

- **NO EMOJI** anywhere — code, UI strings, comments, commit messages.
- Backend: async/await throughout; SQLAlchemy 2 `Mapped`/`mapped_column`; models extend `Base, TimestampMixin`.
- **Use generic `sqlalchemy.JSON`** (not `JSONB`) for JSON columns — the pytest suite runs on in-memory SQLite and JSONB tables are stripped from metadata.
- Routers use `CurrentUser` and `DB` aliases from `app.core.dependencies`; org scoping via `current_user.org_id`.
- API mounted under `/api/v1`; new router registered in `app/api/v1/router.py`.
- Frontend: all API calls via `apiClient` from `lib/api.ts`; Tailwind CSS variables only (no hard-coded colors); strings are literal here (i18n not required for this internal tool surface, matching sibling agent pages). Verify frontend with `npm run typecheck` (no FE test framework).
- Commit style: `feat(recommendations): ...`.
- Measurement constants (central, in `recommendation_scoring.py`): weights clicks 0.45 / position 0.25 / impressions 0.20 / CTR 0.10; verdict thresholds Won `> +10`, Declined `< -10`, else Flat; window 28 days.
- Verdict/status vocabulary — status: `tracking` | `done` | `dismissed`; outcome: `pending` | `won` | `flat` | `declined`.

---

### Task 1: `Recommendation` model + migration

**Files:**
- Create: `apps/api/app/models/recommendation.py`
- Modify: `apps/api/app/models/__init__.py` (register model import alongside existing ones)
- Create: `apps/api/alembic/versions/p4d5e6f7g8h9_recommendations.py`
- Test: `apps/api/tests/test_recommendations.py`

**Interfaces:**
- Produces: `Recommendation` ORM model, table `recommendations`, with columns exactly as below.

- [ ] **Step 1: Write the model**

`apps/api/app/models/recommendation.py`:
```python
import uuid

from sqlalchemy import JSON, ForeignKey, Float, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class Recommendation(Base, TimestampMixin):
    __tablename__ = "recommendations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    source: Mapped[str] = mapped_column(String(20), nullable=False)          # opportunity | agent
    source_agent: Mapped[str | None] = mapped_column(String(20))            # zerda | oasis
    kind: Mapped[str | None] = mapped_column(String(30))                    # striking_distance | ctr_win
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)
    anchor_query: Mapped[str | None] = mapped_column(String(500))           # null = non-measurable
    anchor_url: Mapped[str | None] = mapped_column(String(2048))
    status: Mapped[str] = mapped_column(String(20), default="tracking", nullable=False)
    outcome: Mapped[str | None] = mapped_column(String(20))                 # pending | won | flat | declined
    impact_score: Mapped[float | None] = mapped_column(Float)
    baseline: Mapped[dict | None] = mapped_column(JSON)                     # {clicks,impressions,ctr,position,captured_at}
    latest: Mapped[dict | None] = mapped_column(JSON)                       # {clicks,impressions,ctr,position}
    detected_content: Mapped[list | None] = mapped_column(JSON)            # [{type,id,title,matched_on}]
    done_at: Mapped[str | None] = mapped_column(String(50))                # ISO date
    measured_at: Mapped[str | None] = mapped_column(String(50))            # ISO date
```

- [ ] **Step 2: Register the model** in `apps/api/app/models/__init__.py` — add `from app.models.recommendation import Recommendation  # noqa: F401` next to the other model imports (match the file's existing style; if it re-exports via `__all__`, add `"Recommendation"`).

- [ ] **Step 3: Write the failing test** — `apps/api/tests/test_recommendations.py`. Start with the same SQLite harness as `tests/test_articles.py` (copy the engine/session/override/setup_db/org_and_project/client blocks) but set:
```python
SQLITE_COMPATIBLE_TABLES = [
    "organizations", "users", "projects",
    "articles", "social_posts", "gsc_query_stats", "recommendations",
]
```
and add these imports so the tables register with `Base.metadata`:
```python
from app.models.article import Article  # noqa: F401
from app.models.social import SocialPost  # noqa: F401
from app.models.analytics import GscQueryStat  # noqa: F401
from app.models.recommendation import Recommendation  # noqa: F401
```
First test:
```python
@pytest.mark.asyncio
async def test_recommendation_row_persists(db_session, org_and_project):
    from app.models.recommendation import Recommendation
    rec = Recommendation(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID,
        source="opportunity", kind="striking_distance",
        title="Target 'olive oil'", anchor_query="olive oil", status="tracking",
    )
    db_session.add(rec)
    await db_session.commit()
    await db_session.refresh(rec)
    assert rec.id is not None
    assert rec.status == "tracking"
    assert rec.baseline is None
```

- [ ] **Step 4: Run test to verify it fails**

Run: `docker compose exec -T api pytest tests/test_recommendations.py::test_recommendation_row_persists -v`
Expected: FAIL (no such table `recommendations` / import error).

- [ ] **Step 5: Run test to verify it passes** (model + table registration make it pass)

Run: `docker compose exec -T api pytest tests/test_recommendations.py::test_recommendation_row_persists -v`
Expected: PASS

- [ ] **Step 6: Write the Alembic migration** — `apps/api/alembic/versions/p4d5e6f7g8h9_recommendations.py`. Set `down_revision` to the current head (find it: `docker compose exec -T api alembic heads`). Hand-write it:
```python
"""recommendations table"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "p4d5e6f7g8h9"
down_revision = "<CURRENT_HEAD>"  # replace with `alembic heads` output
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recommendations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("source_agent", sa.String(20)),
        sa.Column("kind", sa.String(30)),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("detail", sa.Text()),
        sa.Column("anchor_query", sa.String(500)),
        sa.Column("anchor_url", sa.String(2048)),
        sa.Column("status", sa.String(20), nullable=False, server_default="tracking"),
        sa.Column("outcome", sa.String(20)),
        sa.Column("impact_score", sa.Float()),
        sa.Column("baseline", sa.JSON()),
        sa.Column("latest", sa.JSON()),
        sa.Column("detected_content", sa.JSON()),
        sa.Column("done_at", sa.String(50)),
        sa.Column("measured_at", sa.String(50)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_recommendations_project_id", "recommendations", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_recommendations_project_id", table_name="recommendations")
    op.drop_table("recommendations")
```

- [ ] **Step 7: Apply and verify the migration**

Run: `make db-migrate` then `docker compose exec -T db psql -U postgres -d fennex -c "\d recommendations"`
Expected: the `recommendations` table exists with the columns above.

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/models/recommendation.py apps/api/app/models/__init__.py apps/api/alembic/versions/p4d5e6f7g8h9_recommendations.py apps/api/tests/test_recommendations.py
git commit -m "feat(recommendations): add Recommendation model and migration"
```

---

### Task 2: Impact scoring core (pure functions)

**Files:**
- Create: `apps/api/app/services/recommendation_scoring.py`
- Test: `apps/api/tests/test_recommendation_scoring.py`

**Interfaces:**
- Produces:
  - `MEASUREMENT_WINDOW_DAYS: int = 28`
  - `compute_impact(baseline: dict, latest: dict) -> tuple[float, str]` → `(score, verdict)` where verdict ∈ `{"won","flat","declined"}`.
  - `matches_query(anchor_query: str, text: str) -> bool`

- [ ] **Step 1: Write the failing tests** — `apps/api/tests/test_recommendation_scoring.py`:
```python
from app.services.recommendation_scoring import compute_impact, matches_query, MEASUREMENT_WINDOW_DAYS


def test_window_constant():
    assert MEASUREMENT_WINDOW_DAYS == 28


def test_clicks_growth_scores_won():
    base = {"clicks": 40, "impressions": 1000, "ctr": 0.04, "position": 8.0}
    latest = {"clicks": 182, "impressions": 2200, "ctr": 0.083, "position": 4.0}
    score, verdict = compute_impact(base, latest)
    assert verdict == "won"
    assert score > 10


def test_flat_when_unchanged():
    base = {"clicks": 100, "impressions": 2000, "ctr": 0.05, "position": 5.0}
    score, verdict = compute_impact(base, dict(base))
    assert verdict == "flat"
    assert -10 <= score <= 10


def test_decline_scores_declined():
    base = {"clicks": 200, "impressions": 3000, "ctr": 0.066, "position": 4.0}
    latest = {"clicks": 60, "impressions": 1500, "ctr": 0.04, "position": 9.0}
    score, verdict = compute_impact(base, latest)
    assert verdict == "declined"
    assert score < -10


def test_position_improvement_is_positive():
    # only position improves (8 -> 4), everything else equal
    base = {"clicks": 100, "impressions": 2000, "ctr": 0.05, "position": 8.0}
    latest = {"clicks": 100, "impressions": 2000, "ctr": 0.05, "position": 4.0}
    score, _ = compute_impact(base, latest)
    assert score > 0


def test_zero_baseline_clicks_no_crash():
    base = {"clicks": 0, "impressions": 0, "ctr": 0.0, "position": 0.0}
    latest = {"clicks": 5, "impressions": 100, "ctr": 0.05, "position": 6.0}
    score, verdict = compute_impact(base, latest)
    assert isinstance(score, float)


def test_matches_query_token_overlap():
    assert matches_query("olive oil benefits", "10 Olive Oil Benefits You Should Know") is True
    assert matches_query("olive oil benefits", "A guide to sourdough bread") is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose exec -T api pytest tests/test_recommendation_scoring.py -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation** — `apps/api/app/services/recommendation_scoring.py`:
```python
"""Pure scoring + matching helpers for closed-loop recommendation tracking."""

METRIC_WEIGHTS = {"clicks": 0.45, "position": 0.25, "impressions": 0.20, "ctr": 0.10}
WON_THRESHOLD = 10.0
DECLINED_THRESHOLD = -10.0
MEASUREMENT_WINDOW_DAYS = 28

_STOPWORDS = {"the", "and", "for", "with", "you", "your", "how", "what", "best", "top"}


def _pct_delta(before: float, after: float) -> float:
    before = before or 0.0
    after = after or 0.0
    if before == 0:
        return 100.0 if after > 0 else 0.0
    return (after - before) / before * 100.0


def _position_improvement_pct(baseline_pos: float, latest_pos: float) -> float:
    # Lower position is better, so improvement = baseline - latest.
    if not baseline_pos:
        return 0.0
    return (baseline_pos - latest_pos) / baseline_pos * 100.0


def compute_impact(baseline: dict, latest: dict) -> tuple[float, str]:
    """Weighted multi-metric impact score and verdict from baseline vs latest metrics.
    Both dicts hold clicks, impressions, ctr, position."""
    clicks_d = _pct_delta(baseline.get("clicks"), latest.get("clicks"))
    impr_d = _pct_delta(baseline.get("impressions"), latest.get("impressions"))
    ctr_d = _pct_delta(baseline.get("ctr"), latest.get("ctr"))
    pos_d = _position_improvement_pct(baseline.get("position") or 0.0, latest.get("position") or 0.0)

    score = round(
        METRIC_WEIGHTS["clicks"] * clicks_d
        + METRIC_WEIGHTS["impressions"] * impr_d
        + METRIC_WEIGHTS["ctr"] * ctr_d
        + METRIC_WEIGHTS["position"] * pos_d,
        1,
    )
    if score > WON_THRESHOLD:
        verdict = "won"
    elif score < DECLINED_THRESHOLD:
        verdict = "declined"
    else:
        verdict = "flat"
    return score, verdict


def _tokens(text: str) -> set[str]:
    return {w for w in "".join(c.lower() if c.isalnum() else " " for c in text).split()
            if len(w) >= 4 and w not in _STOPWORDS}


def matches_query(anchor_query: str, text: str) -> bool:
    """True if the anchor query shares a meaningful token with the text."""
    if not anchor_query or not text:
        return False
    q = _tokens(anchor_query)
    if not q:
        return False
    return bool(q & _tokens(text))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose exec -T api pytest tests/test_recommendation_scoring.py -v`
Expected: PASS (all 7).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/recommendation_scoring.py apps/api/tests/test_recommendation_scoring.py
git commit -m "feat(recommendations): add impact scoring and query matching core"
```

---

### Task 3: Service — create (baseline snapshot), list, transition

**Files:**
- Create: `apps/api/app/services/recommendation_service.py`
- Test: `apps/api/tests/test_recommendations.py` (append)

**Interfaces:**
- Consumes: `Recommendation` (Task 1); `GscQueryStat` (`app.models.analytics`).
- Produces:
  - `async create_recommendation(project_id, org_id, data: dict, db) -> Recommendation`
  - `async list_recommendations(project_id, org_id, db, status: str | None = None) -> list[Recommendation]`
  - `async transition(rec_id, org_id, status: str, db) -> Recommendation | None`
  - `data` keys: `source, source_agent?, kind?, title, detail?, anchor_query?, anchor_url?`.

- [ ] **Step 1: Write failing tests** — append to `tests/test_recommendations.py`:
```python
@pytest.mark.asyncio
async def test_create_snapshots_baseline_from_gsc(db_session, org_and_project):
    from app.models.analytics import GscQueryStat
    from app.services.recommendation_service import create_recommendation
    db_session.add(GscQueryStat(
        project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, query="olive oil",
        clicks=40, impressions=1000, ctr=0.04, position=8.0, top_url="https://x/olive",
    ))
    await db_session.commit()
    rec = await create_recommendation(
        FAKE_PROJECT_ID, FAKE_ORG_ID,
        {"source": "opportunity", "kind": "striking_distance", "title": "Target olive oil",
         "anchor_query": "olive oil"}, db_session,
    )
    assert rec.status == "tracking"
    assert rec.baseline["clicks"] == 40
    assert rec.baseline["position"] == 8.0
    assert "captured_at" in rec.baseline


@pytest.mark.asyncio
async def test_create_without_anchor_has_null_baseline(db_session, org_and_project):
    from app.services.recommendation_service import create_recommendation
    rec = await create_recommendation(
        FAKE_PROJECT_ID, FAKE_ORG_ID,
        {"source": "agent", "source_agent": "zerda", "title": "Publish more how-to content"},
        db_session,
    )
    assert rec.baseline is None
    assert rec.anchor_query is None


@pytest.mark.asyncio
async def test_transition_to_done_sets_pending_outcome(db_session, org_and_project):
    from app.models.analytics import GscQueryStat
    from app.services.recommendation_service import create_recommendation, transition
    db_session.add(GscQueryStat(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, query="olive oil",
                                clicks=40, impressions=1000, ctr=0.04, position=8.0))
    await db_session.commit()
    rec = await create_recommendation(FAKE_PROJECT_ID, FAKE_ORG_ID,
        {"source": "opportunity", "title": "t", "anchor_query": "olive oil"}, db_session)
    updated = await transition(rec.id, FAKE_ORG_ID, "done", db_session)
    assert updated.status == "done"
    assert updated.outcome == "pending"
    assert updated.done_at is not None


@pytest.mark.asyncio
async def test_list_filters_by_status(db_session, org_and_project):
    from app.services.recommendation_service import create_recommendation, transition, list_recommendations
    a = await create_recommendation(FAKE_PROJECT_ID, FAKE_ORG_ID, {"source": "agent", "title": "a"}, db_session)
    await create_recommendation(FAKE_PROJECT_ID, FAKE_ORG_ID, {"source": "agent", "title": "b"}, db_session)
    await transition(a.id, FAKE_ORG_ID, "done", db_session)
    tracking = await list_recommendations(FAKE_PROJECT_ID, FAKE_ORG_ID, db_session, status="tracking")
    assert len(tracking) == 1 and tracking[0].title == "b"
```

- [ ] **Step 2: Run to verify fail**

Run: `docker compose exec -T api pytest tests/test_recommendations.py -k "baseline or transition or list_filters" -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `apps/api/app/services/recommendation_service.py`:
```python
"""Closed-loop recommendation tracking — persistence, lifecycle, measurement, matching."""
import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics import GscQueryStat
from app.models.recommendation import Recommendation


async def _query_metrics(project_id: uuid.UUID, org_id: uuid.UUID, query: str, db: AsyncSession) -> dict | None:
    row = (await db.execute(
        select(GscQueryStat).where(
            GscQueryStat.project_id == project_id,
            GscQueryStat.org_id == org_id,
            GscQueryStat.query == query,
        )
    )).scalars().first()
    if row is None:
        return None
    return {"clicks": row.clicks, "impressions": row.impressions, "ctr": row.ctr, "position": row.position}


async def create_recommendation(project_id, org_id, data: dict, db: AsyncSession) -> Recommendation:
    anchor = (data.get("anchor_query") or "").strip() or None
    baseline = None
    if anchor:
        metrics = await _query_metrics(project_id, org_id, anchor, db)
        if metrics is not None:
            baseline = {**metrics, "captured_at": date.today().isoformat()}
    rec = Recommendation(
        org_id=org_id, project_id=project_id,
        source=data["source"], source_agent=data.get("source_agent"),
        kind=data.get("kind"), title=data["title"][:500], detail=data.get("detail"),
        anchor_query=anchor, anchor_url=data.get("anchor_url"),
        status="tracking", baseline=baseline,
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    return rec


async def list_recommendations(project_id, org_id, db: AsyncSession, status: str | None = None) -> list[Recommendation]:
    q = select(Recommendation).where(
        Recommendation.project_id == project_id, Recommendation.org_id == org_id,
    )
    if status:
        q = q.where(Recommendation.status == status)
    q = q.order_by(Recommendation.created_at.desc())
    return list((await db.execute(q)).scalars().all())


async def transition(rec_id, org_id, status: str, db: AsyncSession) -> Recommendation | None:
    rec = (await db.execute(
        select(Recommendation).where(Recommendation.id == rec_id, Recommendation.org_id == org_id)
    )).scalars().first()
    if rec is None:
        return None
    rec.status = status
    if status == "done":
        rec.done_at = date.today().isoformat()
        if rec.anchor_query and rec.outcome is None:
            rec.outcome = "pending"
    await db.commit()
    await db.refresh(rec)
    return rec
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec -T api pytest tests/test_recommendations.py -k "baseline or transition or list_filters" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/recommendation_service.py apps/api/tests/test_recommendations.py
git commit -m "feat(recommendations): service create/list/transition with baseline snapshot"
```

---

### Task 4: Service — measure() impact after window

**Files:**
- Modify: `apps/api/app/services/recommendation_service.py`
- Test: `apps/api/tests/test_recommendations.py` (append)

**Interfaces:**
- Consumes: `compute_impact`, `MEASUREMENT_WINDOW_DAYS` (Task 2); `_query_metrics` (Task 3).
- Produces: `async measure(project_id, org_id, db, today: date | None = None) -> int` (returns count measured).

- [ ] **Step 1: Write failing test** — append:
```python
@pytest.mark.asyncio
async def test_measure_scores_done_items_past_window(db_session, org_and_project):
    from datetime import date, timedelta
    from app.models.analytics import GscQueryStat
    from app.models.recommendation import Recommendation
    from app.services.recommendation_service import measure
    # Baseline frozen at 40 clicks; current GSC now shows 182 clicks / pos 4
    db_session.add(GscQueryStat(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, query="olive oil",
                                clicks=182, impressions=2200, ctr=0.083, position=4.0))
    done = (date.today() - timedelta(days=30)).isoformat()
    db_session.add(Recommendation(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, source="opportunity",
        title="t", anchor_query="olive oil", status="done", outcome="pending", done_at=done,
        baseline={"clicks": 40, "impressions": 1000, "ctr": 0.04, "position": 8.0, "captured_at": done},
    ))
    await db_session.commit()
    n = await measure(FAKE_PROJECT_ID, FAKE_ORG_ID, db_session)
    assert n == 1
    rec = (await db_session.execute(select(Recommendation))).scalars().first()
    assert rec.outcome == "won"
    assert rec.latest["clicks"] == 182
    assert rec.impact_score > 10
    assert rec.measured_at is not None


@pytest.mark.asyncio
async def test_measure_skips_items_inside_window(db_session, org_and_project):
    from datetime import date, timedelta
    from app.models.analytics import GscQueryStat
    from app.models.recommendation import Recommendation
    from app.services.recommendation_service import measure
    db_session.add(GscQueryStat(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, query="olive oil",
                                clicks=100, impressions=2000, ctr=0.05, position=5.0))
    done = (date.today() - timedelta(days=3)).isoformat()
    db_session.add(Recommendation(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, source="opportunity",
        title="t", anchor_query="olive oil", status="done", outcome="pending", done_at=done,
        baseline={"clicks": 40, "impressions": 1000, "ctr": 0.04, "position": 8.0},
    ))
    await db_session.commit()
    n = await measure(FAKE_PROJECT_ID, FAKE_ORG_ID, db_session)
    assert n == 0
    rec = (await db_session.execute(select(Recommendation))).scalars().first()
    assert rec.outcome == "pending"
```

- [ ] **Step 2: Run to verify fail**

Run: `docker compose exec -T api pytest tests/test_recommendations.py -k measure -v`
Expected: FAIL (`measure` not defined).

- [ ] **Step 3: Implement** — add to `recommendation_service.py`:
```python
from datetime import timedelta

from app.services.recommendation_scoring import compute_impact, MEASUREMENT_WINDOW_DAYS


async def measure(project_id, org_id, db: AsyncSession, today: date | None = None) -> int:
    today = today or date.today()
    recs = (await db.execute(
        select(Recommendation).where(
            Recommendation.project_id == project_id,
            Recommendation.org_id == org_id,
            Recommendation.status == "done",
            Recommendation.anchor_query.is_not(None),
            Recommendation.baseline.is_not(None),
        )
    )).scalars().all()
    measured = 0
    for rec in recs:
        if not rec.done_at:
            continue
        due = date.fromisoformat(rec.done_at) + timedelta(days=MEASUREMENT_WINDOW_DAYS)
        if today < due:
            continue
        latest = await _query_metrics(project_id, org_id, rec.anchor_query, db)
        if latest is None:
            continue
        score, verdict = compute_impact(rec.baseline, latest)
        rec.latest = latest
        rec.impact_score = score
        rec.outcome = verdict
        rec.measured_at = today.isoformat()
        measured += 1
    if measured:
        await db.commit()
    return measured
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec -T api pytest tests/test_recommendations.py -k measure -v`
Expected: PASS (2)

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/recommendation_service.py apps/api/tests/test_recommendations.py
git commit -m "feat(recommendations): measure impact for done items past the window"
```

---

### Task 5: Service — run_matching() "looks done"

**Files:**
- Modify: `apps/api/app/services/recommendation_service.py`
- Test: `apps/api/tests/test_recommendations.py` (append)

**Interfaces:**
- Consumes: `matches_query` (Task 2); `Article` (`app.models.article`), `SocialPost` (`app.models.social`).
- Produces: `async run_matching(project_id, org_id, db) -> int` (returns count newly detected).

Matching only considers published content and only `tracking` items with `anchor_query` set and no prior `detected_content`.

- [ ] **Step 1: Write failing test** — append:
```python
@pytest.mark.asyncio
async def test_matching_detects_published_article(db_session, org_and_project):
    from app.models.article import Article, ArticleStatus
    from app.models.recommendation import Recommendation
    from app.services.recommendation_service import run_matching
    db_session.add(Article(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID,
        title="10 Olive Oil Benefits You Should Know",
        target_keyword="olive oil benefits", status=ArticleStatus.published,
    ))
    db_session.add(Recommendation(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, source="opportunity",
        title="Target olive oil benefits", anchor_query="olive oil benefits", status="tracking",
    ))
    await db_session.commit()
    n = await run_matching(FAKE_PROJECT_ID, FAKE_ORG_ID, db_session)
    assert n == 1
    rec = (await db_session.execute(select(Recommendation))).scalars().first()
    assert rec.detected_content and rec.detected_content[0]["type"] == "article"


@pytest.mark.asyncio
async def test_matching_ignores_unrelated_content(db_session, org_and_project):
    from app.models.article import Article, ArticleStatus
    from app.models.recommendation import Recommendation
    from app.services.recommendation_service import run_matching
    db_session.add(Article(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID,
        title="Sourdough bread guide", target_keyword="sourdough", status=ArticleStatus.published,
    ))
    db_session.add(Recommendation(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, source="opportunity",
        title="Target olive oil", anchor_query="olive oil", status="tracking",
    ))
    await db_session.commit()
    n = await run_matching(FAKE_PROJECT_ID, FAKE_ORG_ID, db_session)
    assert n == 0
```

- [ ] **Step 2: Run to verify fail**

Run: `docker compose exec -T api pytest tests/test_recommendations.py -k matching -v`
Expected: FAIL (`run_matching` not defined).

- [ ] **Step 3: Implement** — add to `recommendation_service.py`:
```python
from app.models.article import Article, ArticleStatus
from app.models.social import SocialPost, SocialPostStatus
from app.services.recommendation_scoring import matches_query


async def run_matching(project_id, org_id, db: AsyncSession) -> int:
    recs = (await db.execute(
        select(Recommendation).where(
            Recommendation.project_id == project_id,
            Recommendation.org_id == org_id,
            Recommendation.status == "tracking",
            Recommendation.anchor_query.is_not(None),
            Recommendation.detected_content.is_(None),
        )
    )).scalars().all()
    if not recs:
        return 0

    articles = (await db.execute(
        select(Article).where(
            Article.project_id == project_id, Article.org_id == org_id,
            Article.status == ArticleStatus.published,
        )
    )).scalars().all()
    posts = (await db.execute(
        select(SocialPost).where(
            SocialPost.project_id == project_id, SocialPost.org_id == org_id,
            SocialPost.status == SocialPostStatus.published,
        )
    )).scalars().all()

    detected = 0
    for rec in recs:
        hits = []
        for a in articles:
            text = f"{a.title} {a.target_keyword or ''}"
            if matches_query(rec.anchor_query, text):
                hits.append({"type": "article", "id": str(a.id), "title": a.title, "matched_on": "title"})
        for p in posts:
            text = f"{p.content} {' '.join(p.hashtags or [])}"
            if matches_query(rec.anchor_query, text):
                hits.append({"type": "social", "id": str(p.id), "title": p.content[:80], "matched_on": "content"})
        if hits:
            rec.detected_content = hits
            detected += 1
    if detected:
        await db.commit()
    return detected
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec -T api pytest tests/test_recommendations.py -k matching -v`
Expected: PASS (2)

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/recommendation_service.py apps/api/tests/test_recommendations.py
git commit -m "feat(recommendations): detect looks-done matches in published content"
```

---

### Task 6: Service — summarize() for the digest

**Files:**
- Modify: `apps/api/app/services/recommendation_service.py`
- Test: `apps/api/tests/test_recommendations.py` (append)

**Interfaces:**
- Produces: `async summarize(project_id, org_id, db) -> dict` → `{"acted": int, "won": int, "measuring": int, "won_clicks": int}` where `acted` = done items, `measuring` = done+pending, `won_clicks` = sum of `(latest.clicks - baseline.clicks)` over won items.

- [ ] **Step 1: Write failing test** — append:
```python
@pytest.mark.asyncio
async def test_summarize_counts_and_won_clicks(db_session, org_and_project):
    from app.models.recommendation import Recommendation
    from app.services.recommendation_service import summarize
    db_session.add(Recommendation(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, source="opportunity", title="w",
        status="done", outcome="won",
        baseline={"clicks": 40, "impressions": 1, "ctr": 0.0, "position": 8.0},
        latest={"clicks": 182, "impressions": 1, "ctr": 0.0, "position": 4.0},
    ))
    db_session.add(Recommendation(
        org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, source="opportunity", title="m",
        status="done", outcome="pending",
    ))
    await db_session.commit()
    s = await summarize(FAKE_PROJECT_ID, FAKE_ORG_ID, db_session)
    assert s["acted"] == 2
    assert s["won"] == 1
    assert s["measuring"] == 1
    assert s["won_clicks"] == 142
```

- [ ] **Step 2: Run to verify fail**

Run: `docker compose exec -T api pytest tests/test_recommendations.py -k summarize -v`
Expected: FAIL.

- [ ] **Step 3: Implement** — add to `recommendation_service.py`:
```python
async def summarize(project_id, org_id, db: AsyncSession) -> dict:
    recs = (await db.execute(
        select(Recommendation).where(
            Recommendation.project_id == project_id, Recommendation.org_id == org_id,
            Recommendation.status == "done",
        )
    )).scalars().all()
    won = [r for r in recs if r.outcome == "won"]
    measuring = [r for r in recs if r.outcome == "pending"]
    won_clicks = sum(
        int((r.latest or {}).get("clicks", 0)) - int((r.baseline or {}).get("clicks", 0))
        for r in won
    )
    return {"acted": len(recs), "won": len(won), "measuring": len(measuring), "won_clicks": won_clicks}
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec -T api pytest tests/test_recommendations.py -k summarize -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/recommendation_service.py apps/api/tests/test_recommendations.py
git commit -m "feat(recommendations): summarize acted/won/measuring for digest"
```

---

### Task 7: API router `/recommendations`

**Files:**
- Create: `apps/api/app/api/v1/routers/recommendations.py`
- Modify: `apps/api/app/api/v1/router.py` (register)
- Test: `apps/api/tests/test_recommendations.py` (append endpoint tests)

**Interfaces:**
- Consumes: service functions (Tasks 3-6); `CurrentUser`, `DB`.
- Produces routes (all under `/api/v1/recommendations`):
  - `POST  /recommendations?project_id=` body `RecommendationCreate` → row dict
  - `GET   /recommendations?project_id=&status=` → list of row dicts
  - `PATCH /recommendations/{rec_id}` body `{status}` → row dict (404 if not owned)
  - `GET   /recommendations/summary?project_id=` → summary dict (registered before `/{rec_id}`)

- [ ] **Step 1: Write failing endpoint tests** — append to `tests/test_recommendations.py` (uses the `client` fixture from the copied harness):
```python
@pytest.mark.asyncio
async def test_post_and_list_endpoint(client, org_and_project):
    r = await client.post(
        f"/api/v1/recommendations?project_id={FAKE_PROJECT_ID}",
        json={"source": "agent", "source_agent": "zerda", "title": "Publish weekly"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "tracking"
    lst = await client.get(f"/api/v1/recommendations?project_id={FAKE_PROJECT_ID}")
    assert lst.status_code == 200
    assert len(lst.json()) == 1


@pytest.mark.asyncio
async def test_patch_marks_done(client, org_and_project):
    created = (await client.post(
        f"/api/v1/recommendations?project_id={FAKE_PROJECT_ID}",
        json={"source": "opportunity", "title": "t"},
    )).json()
    r = await client.patch(f"/api/v1/recommendations/{created['id']}", json={"status": "done"})
    assert r.status_code == 200
    assert r.json()["status"] == "done"


@pytest.mark.asyncio
async def test_summary_endpoint(client, org_and_project):
    r = await client.get(f"/api/v1/recommendations/summary?project_id={FAKE_PROJECT_ID}")
    assert r.status_code == 200
    assert r.json()["acted"] == 0
```
Add `get_current_user`/`get_db` overrides to the copied `client` fixture (mirror `test_articles.py`, but with no `increment_usage` patch — this router does not meter usage).

- [ ] **Step 2: Run to verify fail**

Run: `docker compose exec -T api pytest tests/test_recommendations.py -k "endpoint or marks_done" -v`
Expected: FAIL (404 / route missing).

- [ ] **Step 3: Implement router** — `apps/api/app/api/v1/routers/recommendations.py`:
```python
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.core.dependencies import CurrentUser, DB
from app.services import recommendation_service as svc

router = APIRouter()


class RecommendationCreate(BaseModel):
    source: str
    source_agent: Optional[str] = None
    kind: Optional[str] = None
    title: str
    detail: Optional[str] = None
    anchor_query: Optional[str] = None
    anchor_url: Optional[str] = None


class RecommendationPatch(BaseModel):
    status: str


def _serialize(r) -> dict:
    return {
        "id": str(r.id), "source": r.source, "source_agent": r.source_agent, "kind": r.kind,
        "title": r.title, "detail": r.detail, "anchor_query": r.anchor_query, "anchor_url": r.anchor_url,
        "status": r.status, "outcome": r.outcome, "impact_score": r.impact_score,
        "baseline": r.baseline, "latest": r.latest, "detected_content": r.detected_content,
        "done_at": r.done_at, "measured_at": r.measured_at,
    }


@router.post("", status_code=201)
async def create_recommendation(project_id: uuid.UUID, body: RecommendationCreate, current_user: CurrentUser, db: DB):
    rec = await svc.create_recommendation(project_id, current_user.org_id, body.model_dump(), db)
    return _serialize(rec)


@router.get("")
async def list_recommendations(project_id: uuid.UUID, current_user: CurrentUser, db: DB, status: Optional[str] = None):
    rows = await svc.list_recommendations(project_id, current_user.org_id, db, status)
    return [_serialize(r) for r in rows]


# Registered before /{rec_id} so "summary" is not coerced to a UUID.
@router.get("/summary")
async def recommendation_summary(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    return await svc.summarize(project_id, current_user.org_id, db)


@router.patch("/{rec_id}")
async def patch_recommendation(rec_id: uuid.UUID, body: RecommendationPatch, current_user: CurrentUser, db: DB):
    rec = await svc.transition(rec_id, current_user.org_id, body.status, db)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recommendation not found")
    return _serialize(rec)
```

- [ ] **Step 4: Register the router** — in `apps/api/app/api/v1/router.py`: add `recommendations` to the `from app.api.v1.routers import (...)` block, then:
```python
api_router.include_router(recommendations.router, prefix="/recommendations", tags=["recommendations"])
```

- [ ] **Step 5: Run to verify pass**

Run: `docker compose exec -T api pytest tests/test_recommendations.py -v`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/api/v1/routers/recommendations.py apps/api/app/api/v1/router.py apps/api/tests/test_recommendations.py
git commit -m "feat(recommendations): REST endpoints for tracking lifecycle"
```

---

### Task 8: Cron hook — measure + match after daily sync

**Files:**
- Modify: `apps/api/app/workers/tasks/analytics_tasks.py:94-142` (`_sync_one_project`)
- Test: `apps/api/tests/test_recommendations.py` (append integration-style test calling the service directly)

**Interfaces:**
- Consumes: `measure`, `run_matching` (Tasks 4-5).

- [ ] **Step 1: Write failing test** — append (verifies the combined pass runs both):
```python
@pytest.mark.asyncio
async def test_measure_then_match_pass(db_session, org_and_project):
    from datetime import date, timedelta
    from app.models.analytics import GscQueryStat
    from app.models.article import Article, ArticleStatus
    from app.models.recommendation import Recommendation
    from app.services.recommendation_service import measure, run_matching
    db_session.add(GscQueryStat(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, query="olive oil",
                                clicks=182, impressions=2200, ctr=0.083, position=4.0))
    db_session.add(Article(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID,
                           title="Olive oil guide", target_keyword="olive oil",
                           status=ArticleStatus.published))
    done = (date.today() - timedelta(days=30)).isoformat()
    db_session.add(Recommendation(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, source="opportunity",
        title="a", anchor_query="olive oil", status="done", outcome="pending", done_at=done,
        baseline={"clicks": 40, "impressions": 1000, "ctr": 0.04, "position": 8.0}))
    db_session.add(Recommendation(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, source="opportunity",
        title="b", anchor_query="olive oil", status="tracking"))
    await db_session.commit()
    assert await measure(FAKE_PROJECT_ID, FAKE_ORG_ID, db_session) == 1
    assert await run_matching(FAKE_PROJECT_ID, FAKE_ORG_ID, db_session) == 1
```

- [ ] **Step 2: Run to verify pass already** (services exist) — this confirms the combined behavior before wiring the cron.

Run: `docker compose exec -T api pytest tests/test_recommendations.py -k measure_then_match -v`
Expected: PASS

- [ ] **Step 3: Wire into the daily sync** — at the end of `_sync_one_project` (after `await session.commit()` around line 148), before the function returns, add:
```python
        # Closed-loop recommendation tracking: re-measure + detect after fresh data.
        from app.services.recommendation_service import measure, run_matching
        try:
            await measure(pid, org_id, session)
            await run_matching(pid, org_id, session)
        except Exception:
            pass  # never let tracking break the nightly analytics sync
```
(`pid` and `org_id` are already in scope in `_sync_one_project`.)

- [ ] **Step 4: Verify the sync task still imports and runs**

Run: `docker compose exec -T api python -c "from app.workers.tasks.analytics_tasks import _sync_one_project; print('ok')"`
Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/workers/tasks/analytics_tasks.py apps/api/tests/test_recommendations.py
git commit -m "feat(recommendations): run measure + match in the daily analytics sync"
```

---

### Task 9: Digest standup line

**Files:**
- Modify: `apps/api/app/services/digest_service.py:35-98` (`compose_digest`)
- Test: `apps/api/tests/test_recommendations.py` (append)

**Interfaces:**
- Consumes: `summarize` (Task 6).

- [ ] **Step 1: Write failing test** — append:
```python
@pytest.mark.asyncio
async def test_digest_includes_standup_when_acted(db_session, org_and_project):
    from app.models.project import Project
    from app.models.recommendation import Recommendation
    from app.services.digest_service import compose_digest
    db_session.add(Recommendation(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, source="opportunity",
        title="w", status="done", outcome="won",
        baseline={"clicks": 40, "impressions": 1, "ctr": 0.0, "position": 8.0},
        latest={"clicks": 182, "impressions": 1, "ctr": 0.0, "position": 4.0}))
    await db_session.commit()
    project = await db_session.get(Project, FAKE_PROJECT_ID)
    subject, html = await compose_digest(project, db_session)
    assert "Zerda" in html
    assert "acted on" in html
```
Note: `compose_digest` calls `get_overview/get_health_score/get_opportunities`, which read `analytics_snapshots`/`gsc_query_stats` — with no rows they return zeros, which is fine for this assertion. Ensure `analytics_snapshots` is in this file's `SQLITE_COMPATIBLE_TABLES` (add it).

- [ ] **Step 2: Run to verify fail**

Run: `docker compose exec -T api pytest tests/test_recommendations.py -k standup -v`
Expected: FAIL (no "acted on" in html).

- [ ] **Step 3: Implement** — in `compose_digest`, after the `top_opps`/`opps_html` block and before the final `html = f""" ... """`, add:
```python
    from app.services.recommendation_service import summarize
    rec_summary = await summarize(project.id, project.org_id, db)
    if rec_summary["acted"]:
        standup_html = (
            f"<div style='margin:16px 0;padding:12px 14px;background:#f8fafc;border-radius:12px'>"
            f"<strong>Zerda</strong> — {rec_summary['acted']} recommendation(s) acted on, "
            f"{rec_summary['won']} won"
            + (f" (+{rec_summary['won_clicks']:,} clicks)" if rec_summary["won_clicks"] else "")
            + f", {rec_summary['measuring']} still measuring.</div>"
        )
    else:
        standup_html = ""
```
Then inject `{standup_html}` into the returned `html` template (place it right after the metrics table row block, before the opportunities section).

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec -T api pytest tests/test_recommendations.py -k standup -v`
Expected: PASS

- [ ] **Step 5: Run the full backend test file + restart api/worker**

Run: `docker compose exec -T api pytest tests/test_recommendations.py tests/test_recommendation_scoring.py -v && docker compose restart api worker`
Expected: all PASS; containers restart.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/services/digest_service.py apps/api/tests/test_recommendations.py
git commit -m "feat(recommendations): add Zerda standup line to weekly digest"
```

---

### Task 10: Frontend API client + types

**Files:**
- Modify: `apps/web/lib/api.ts`

**Interfaces:**
- Produces: `Recommendation` type + `trackRecommendation`, `listRecommendations`, `updateRecommendation`, `getRecommendationSummary`.

- [ ] **Step 1: Add types and functions** — append near the analytics section of `apps/web/lib/api.ts`:
```typescript
export interface RecommendationMetrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  captured_at?: string;
}

export interface DetectedContent {
  type: "article" | "social";
  id: string;
  title: string;
  matched_on: string;
}

export interface Recommendation {
  id: string;
  source: "opportunity" | "agent";
  source_agent: string | null;
  kind: string | null;
  title: string;
  detail: string | null;
  anchor_query: string | null;
  anchor_url: string | null;
  status: "tracking" | "done" | "dismissed";
  outcome: "pending" | "won" | "flat" | "declined" | null;
  impact_score: number | null;
  baseline: RecommendationMetrics | null;
  latest: RecommendationMetrics | null;
  detected_content: DetectedContent[] | null;
  done_at: string | null;
  measured_at: string | null;
}

export interface RecommendationSummary {
  acted: number;
  won: number;
  measuring: number;
  won_clicks: number;
}

export interface TrackRecommendationInput {
  source: "opportunity" | "agent";
  source_agent?: string;
  kind?: string;
  title: string;
  detail?: string;
  anchor_query?: string;
  anchor_url?: string;
}

export async function trackRecommendation(projectId: string, input: TrackRecommendationInput): Promise<Recommendation> {
  return apiClient.post<Recommendation>(`/recommendations?project_id=${projectId}`, input);
}

export async function listRecommendations(projectId: string, status?: string): Promise<Recommendation[]> {
  const q = status ? `&status=${status}` : "";
  return apiClient.get<Recommendation[]>(`/recommendations?project_id=${projectId}${q}`);
}

export async function updateRecommendation(id: string, status: "done" | "dismissed"): Promise<Recommendation> {
  return apiClient.patch<Recommendation>(`/recommendations/${id}`, { status });
}

export async function getRecommendationSummary(projectId: string): Promise<RecommendationSummary> {
  return apiClient.get<RecommendationSummary>(`/recommendations/summary?project_id=${projectId}`);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/api.ts
git commit -m "feat(recommendations): frontend api client and types"
```

---

### Task 11: "Track this" button on the opportunities table

**Files:**
- Modify: `apps/web/app/(dashboard)/[projectId]/analytics/page.tsx` (`OppTable`, ~804-844; `OpportunitiesTab`, ~846)

**Interfaces:**
- Consumes: `trackRecommendation`, `OpportunityRow`.

- [ ] **Step 1: Thread projectId + a track handler into OppTable.** Change the signature and add an actions column:
```typescript
function OppTable({ rows, target, projectId }: { rows: OpportunityRow[]; target: string; projectId: string }) {
  const { success: showSuccess, error: showError } = useToast();
  const [tracked, setTracked] = useState<Record<string, boolean>>({});

  async function track(r: OpportunityRow) {
    try {
      await trackRecommendation(projectId, {
        source: "opportunity",
        source_agent: "zerda",
        kind: r.kind,
        title: `Target "${r.query}"`,
        anchor_query: r.query,
        anchor_url: r.url ?? undefined,
      });
      setTracked((t) => ({ ...t, [r.query]: true }));
      showSuccess("Tracking", { message: "Zerda will report back once you act on it." });
    } catch {
      showError("Could not track", { message: "Please try again." });
    }
  }
  // ... existing table; add a new header cell <th> (empty label) and a trailing <td> per row:
}
```
Add the trailing cell inside the row map:
```typescript
            <td className="px-4 py-3 text-right">
              <button
                onClick={() => track(r)}
                disabled={tracked[r.query]}
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
              >
                {tracked[r.query] ? "Tracking" : "Track"}
              </button>
            </td>
```
Add a matching empty `<th className="px-4 py-2.5" />` to the header row.

- [ ] **Step 2: Pass projectId at the two call sites** in `OpportunitiesTab` — change `<OppTable rows={data.striking_distance} target="Potential" />` and the `ctr_wins` one to include `projectId={projectId}`.

- [ ] **Step 3: Add the import** — add `trackRecommendation` to the existing `@/lib/api` import block at the top of the file.

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/[projectId]/analytics/page.tsx"
git commit -m "feat(recommendations): Track button on opportunities table"
```

---

### Task 12: "Track this" on Zerda copilot answers

**Files:**
- Modify: `apps/web/app/(dashboard)/[projectId]/analytics/page.tsx` (`CopilotPanel`, message render ~1306-1343)

**Interfaces:**
- Consumes: `trackRecommendation`.

- [ ] **Step 1: Add a track action under the latest assistant message.** Inside `CopilotPanel`, add near the top:
```typescript
  const { success: showSuccess } = useToast();
  const [trackedMsg, setTrackedMsg] = useState<Record<number, boolean>>({});

  async function trackMessage(idx: number, content: string) {
    const title = content.length > 90 ? content.slice(0, 87) + "..." : content;
    await trackRecommendation(projectId, { source: "agent", source_agent: "zerda", title, detail: content });
    setTrackedMsg((t) => ({ ...t, [idx]: true }));
    showSuccess("Tracking", { message: "Added to Zerda's tracked recommendations." });
  }
```
Then, in the assistant branch of the message map (alongside the followups block), add:
```typescript
              {m.role === "assistant" && (
                <button
                  onClick={() => trackMessage(i, m.content)}
                  disabled={trackedMsg[i]}
                  className="self-start rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {trackedMsg[i] ? "Tracking this" : "Track this recommendation"}
                </button>
              )}
```
(If `useToast` is already destructured in `CopilotPanel`, reuse it instead of re-declaring.)

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(dashboard)/[projectId]/analytics/page.tsx"
git commit -m "feat(recommendations): Track action on Zerda copilot answers"
```

---

### Task 13: Zerda Tracking page

**Files:**
- Create: `apps/web/app/(dashboard)/[projectId]/agents/tracking/page.tsx`

**Interfaces:**
- Consumes: `listRecommendations`, `updateRecommendation`, `Recommendation`.

- [ ] **Step 1: Build the page** with four lanes — Needs confirmation (`status==="tracking"` with `detected_content`), In progress (`tracking` without detected), Measuring (`done` + `outcome==="pending"`), Results (`done` + outcome in won/flat/declined):
```typescript
"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Radar, Check, X, TrendingUp, TrendingDown, Minus, Clock } from "lucide-react";
import { listRecommendations, updateRecommendation, type Recommendation } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";

const VERDICT = {
  won: { label: "Won", cls: "bg-success/12 text-success", Icon: TrendingUp },
  flat: { label: "Flat", cls: "bg-muted text-muted-foreground", Icon: Minus },
  declined: { label: "Declined", cls: "bg-destructive/12 text-destructive", Icon: TrendingDown },
} as const;

export default function TrackingPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const qc = useQueryClient();
  const { success } = useToast();
  const { data = [], isLoading } = useQuery({
    queryKey: ["recommendations", projectId],
    queryFn: () => listRecommendations(projectId),
    staleTime: 30_000,
  });

  async function setStatus(id: string, status: "done" | "dismissed") {
    await updateRecommendation(id, status);
    qc.invalidateQueries({ queryKey: ["recommendations", projectId] });
    success(status === "done" ? "Marked done" : "Dismissed");
  }

  const needsConfirm = data.filter((r) => r.status === "tracking" && r.detected_content?.length);
  const inProgress = data.filter((r) => r.status === "tracking" && !r.detected_content?.length);
  const measuring = data.filter((r) => r.status === "done" && r.outcome === "pending");
  const results = data.filter((r) => r.status === "done" && r.outcome && r.outcome !== "pending");

  if (isLoading) return <div className="h-64 animate-pulse rounded-xl border bg-muted/30" />;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <Radar className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground leading-tight">Zerda · Tracked recommendations</h1>
          <p className="text-xs text-muted-foreground leading-tight">
            What Zerda suggested, what you acted on, and whether it worked — from your real search data
          </p>
        </div>
      </div>

      <Lane title="Needs confirmation" hint="Looks done — confirm to start measuring">
        {needsConfirm.map((r) => (
          <RecCard key={r.id} r={r}>
            <button onClick={() => setStatus(r.id, "done")} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
              <Check className="mr-1 inline h-3 w-3" /> Confirm done
            </button>
          </RecCard>
        ))}
      </Lane>

      <Lane title="In progress" hint="Accepted, not yet acted on">
        {inProgress.map((r) => (
          <RecCard key={r.id} r={r}>
            <button onClick={() => setStatus(r.id, "done")} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent">Mark done</button>
            <button onClick={() => setStatus(r.id, "dismissed")} className="rounded-lg border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"><X className="h-3 w-3" /></button>
          </RecCard>
        ))}
      </Lane>

      <Lane title="Measuring" hint="Acted on — measuring impact over 28 days">
        {measuring.map((r) => (
          <RecCard key={r.id} r={r}>
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" /> measuring</span>
          </RecCard>
        ))}
      </Lane>

      <Lane title="Results" hint="Measured impact">
        {results.map((r) => {
          const v = VERDICT[r.outcome as keyof typeof VERDICT];
          return (
            <RecCard key={r.id} r={r}>
              <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${v.cls}`}>
                <v.Icon className="h-3 w-3" /> {v.label}
              </span>
              {r.baseline && r.latest && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {r.baseline.clicks} → {r.latest.clicks} clicks
                </span>
              )}
            </RecCard>
          );
        })}
      </Lane>
    </div>
  );
}

function Lane({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  const empty = items.filter(Boolean).length === 0;
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground">— {hint}</span>
      </div>
      {empty ? <p className="text-xs text-muted-foreground">Nothing here yet.</p> : <div className="flex flex-col gap-2">{children}</div>}
    </div>
  );
}

function RecCard({ r, children }: { r: Recommendation; children: React.ReactNode }) {
  return (
    <Card className="flex flex-wrap items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{r.title}</p>
        <p className="text-[11px] text-muted-foreground">
          {r.source_agent ? r.source_agent : r.source}{r.anchor_query ? ` · ${r.anchor_query}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </Card>
  );
}
```
Note the `React.ReactNode` usage requires `import type { ReactNode } from "react"` — either add that import and use `ReactNode`, or type children as `React.ReactNode` with `import * as React`. Prefer `import { type ReactNode } from "react"` and replace `React.ReactNode` with `ReactNode`.

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(dashboard)/[projectId]/agents/tracking/page.tsx"
git commit -m "feat(recommendations): Zerda tracked-recommendations page"
```

---

### Task 14: Agents hub — Zerda action + capability

**Files:**
- Modify: `apps/web/app/(dashboard)/[projectId]/agents/page.tsx` (`agentActions`, zerda case)
- Modify: `apps/web/lib/agents.ts` (Zerda capabilities)

**Interfaces:** none new.

- [ ] **Step 1: Add the tracking action** — in `agentActions`, extend the `zerda` case:
```typescript
    case "zerda":
      return [
        { label: "Ask Zerda", href: `${base}/analytics?copilot=1` },
        { label: "View opportunities", href: `${base}/analytics?ws=growth` },
        { label: "Tracked recommendations", href: `${base}/agents/tracking` },
      ];
```

- [ ] **Step 2: Name the accountability skill** — in `apps/web/lib/agents.ts`, add to Zerda's `capabilities` array:
```typescript
      "Tracks its recommendations and reports whether they worked",
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Restart web and smoke-test the route**

Run: `docker compose restart web && sleep 8 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/`
Expected: `200` or `302`. Then manually load `/<projectId>/agents/tracking` in the browser and confirm the four lanes render.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/[projectId]/agents/page.tsx" apps/web/lib/agents.ts
git commit -m "feat(recommendations): surface Zerda tracking in the agents hub"
```

---

## Final verification

- [ ] Backend: `docker compose exec -T api pytest tests/test_recommendations.py tests/test_recommendation_scoring.py -v` — all PASS.
- [ ] Frontend: `cd apps/web && npm run typecheck` — clean.
- [ ] Restart: `docker compose restart api web worker`.
- [ ] Manual loop test in the browser: open Analytics → Opportunities → Track a row; open Zerda copilot → Track an answer; open `/agents/tracking` → item appears under In progress; mark done → moves to Measuring.
- [ ] End-to-end backend smoke (real project): create → mark done with a >28-day-old `done_at` via the DB → run `measure` → verdict set (mirror the container asserts used when Oasis/Nomad were verified).
