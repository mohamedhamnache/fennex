# Orchestrated Multi-Agent Campaigns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brief the Fennex Pack once — an LLM director (Sirocco) designs a campaign plan over a fixed catalog of agent actions; the user approves/edits it; a background orchestrator runs the steps in order, chaining outputs, and assembles a coherent package.

**Architecture:** `Campaign` + `CampaignStep` tables. A fixed action catalog maps keys to executor functions that wrap existing agent services. `campaign_director.draft_plan` (one LLM call, sanitized against the catalog) produces the plan; `run_campaign` (arq) executes steps sequentially in-process, passing a growing context forward. Plan preview -> approve -> run.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, arq, pytest (backend); Next.js 14 App Router, TypeScript, TanStack Query, react-i18next (frontend).

Spec: `docs/superpowers/specs/2026-07-08-orchestrated-campaigns-design.md`

## Global Constraints

- **NO EMOJI** anywhere (code, UI, comments, commit messages).
- Backend async throughout; models extend `Base, TimestampMixin`; generic `sqlalchemy` column types (no JSONB) for SQLite test compatibility.
- Routers use `CurrentUser`/`DB` from `app.core.dependencies`; org-scoped via `current_user.org_id`. API under `/api/v1`; new router registered in `app/api/v1/router.py`.
- Campaign statuses: `planned` | `running` | `completed` | `failed` | `cancelled` (draft is synchronous → created as `planned`). Step statuses: `pending` | `running` | `completed` | `failed` | `skipped`.
- LLM provider pick pattern (as in `oasis_service`): `_PROVIDERS = [("anthropic", "claude-opus-4-8"), ("openai", "gpt-4o")]`; use the first whose key is in `get_org_llm_keys(org_id, db)`.
- Executor signature: `async def executor(campaign, step, context, db) -> StepResult`. Executors reuse existing services; on unrecoverable input they may return a `StepResult` marked skipped via `structured={"skipped": True}` (orchestrator maps to `skipped`); on failure they raise (orchestrator records `failed` and continues).
- Frontend: all API via `apiClient`; Tailwind CSS variables only; **full i18n** (keys in `apps/web/public/locales/en/common.json`, other locales fall back to en); verify with `npm run typecheck`.
- Tests run inside docker: `docker compose exec -T api pytest ...` from repo root. Commit style `feat(campaigns): ...`.

---

## PHASE 1 — Director + orchestrator + research/angle actions + minimal UI

### Task 1: `Campaign` + `CampaignStep` models + migration

**Files:**
- Create: `apps/api/app/models/campaign.py`
- Modify: `apps/api/app/models/__init__.py` (register both, `# noqa: F401`)
- Create: `apps/api/alembic/versions/<uniqueid>_campaigns.py`
- Test: `apps/api/tests/test_campaigns.py`

**Interfaces:**
- Produces: `Campaign`, `CampaignStep` models; tables `campaigns`, `campaign_steps`.

- [ ] **Step 1: Write the models** — `apps/api/app/models/campaign.py`:
```python
import uuid

from sqlalchemy import JSON, Boolean, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class Campaign(Base, TimestampMixin):
    __tablename__ = "campaigns"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    goal: Mapped[str] = mapped_column(Text, nullable=False)
    persona: Mapped[str] = mapped_column(String(20), default="creator", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="planned", nullable=False)
    director_summary: Mapped[str | None] = mapped_column(Text)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class CampaignStep(Base, TimestampMixin):
    __tablename__ = "campaign_steps"
    __table_args__ = (Index("ix_campaign_steps_campaign_order", "campaign_id", "order"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    agent: Mapped[str] = mapped_column(String(20), nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    brief: Mapped[dict | None] = mapped_column(JSON)
    why: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    artifact_type: Mapped[str | None] = mapped_column(String(20))
    artifact_ids: Mapped[list | None] = mapped_column(JSON)
    structured: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[str | None] = mapped_column(String(50))
    finished_at: Mapped[str | None] = mapped_column(String(50))
```

- [ ] **Step 2: Register** in `apps/api/app/models/__init__.py`: `from app.models.campaign import Campaign, CampaignStep  # noqa: F401`.

- [ ] **Step 3: Write the failing test** — create `apps/api/tests/test_campaigns.py`. Copy the SQLite harness from `apps/api/tests/test_recommendations.py` (engine, `override_get_db`, fake user, `setup_db`, `db_session`, `org_and_project`, `client`, `FAKE_ORG_ID`/`FAKE_PROJECT_ID`) with:
```python
SQLITE_COMPATIBLE_TABLES = [
    "organizations", "users", "projects",
    "articles", "generated_images", "social_posts", "gsc_query_stats", "analytics_snapshots",
    "campaigns", "campaign_steps",
]
from app.models.article import Article  # noqa: F401
from app.models.image import GeneratedImage  # noqa: F401
from app.models.social import SocialPost  # noqa: F401
from app.models.analytics import GscQueryStat, AnalyticsSnapshot  # noqa: F401
from app.models.campaign import Campaign, CampaignStep  # noqa: F401
```
First test:
```python
import pytest


@pytest.mark.asyncio
async def test_campaign_persists(db_session, org_and_project):
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="Get clients", persona="freelancer", status="planned")
    db_session.add(c)
    await db_session.commit()
    step = CampaignStep(campaign_id=c.id, order=0, agent="zerda", action="zerda.pick_angle", status="pending")
    db_session.add(step)
    await db_session.commit()
    await db_session.refresh(c); await db_session.refresh(step)
    assert c.status == "planned" and step.order == 0
```

- [ ] **Step 4: Run to verify fail** — `docker compose exec -T api pytest tests/test_campaigns.py::test_campaign_persists -v` → FAIL (no table).

- [ ] **Step 5: Run to verify pass** — same command → PASS.

- [ ] **Step 6: Migration** — `docker compose exec -T api alembic heads` for the head. Verify the id is unused (`ls apps/api/alembic/versions | grep d2c3a4m5p6g7` returns nothing; pick another if it collides). Create `apps/api/alembic/versions/d2c3a4m5p6g7_campaigns.py`:
```python
"""campaigns + campaign_steps"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "d2c3a4m5p6g7"
down_revision = "<CURRENT_HEAD>"  # replace with `alembic heads`
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "campaigns",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("goal", sa.Text(), nullable=False),
        sa.Column("persona", sa.String(20), nullable=False, server_default="creator"),
        sa.Column("status", sa.String(20), nullable=False, server_default="planned"),
        sa.Column("director_summary", sa.Text()),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "campaign_steps",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("campaign_id", UUID(as_uuid=True), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("agent", sa.String(20), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("brief", sa.JSON()),
        sa.Column("why", sa.Text()),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("summary", sa.Text()),
        sa.Column("artifact_type", sa.String(20)),
        sa.Column("artifact_ids", sa.JSON()),
        sa.Column("structured", sa.JSON()),
        sa.Column("error", sa.Text()),
        sa.Column("started_at", sa.String(50)),
        sa.Column("finished_at", sa.String(50)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_campaign_steps_campaign_order", "campaign_steps", ["campaign_id", "order"])


def downgrade() -> None:
    op.drop_index("ix_campaign_steps_campaign_order", table_name="campaign_steps")
    op.drop_table("campaign_steps")
    op.drop_table("campaigns")
```

- [ ] **Step 7: Apply + verify** — `make db-migrate` then `docker compose exec -T postgres psql -U fennex -d fennex -c "\d campaigns"` and `"\d campaign_steps"`. (On a partial-apply error, `DROP TABLE IF EXISTS campaign_steps, campaigns CASCADE;` then re-run.)

- [ ] **Step 8: Commit**
```bash
git add apps/api/app/models/campaign.py apps/api/app/models/__init__.py apps/api/alembic/versions/d2c3a4m5p6g7_campaigns.py apps/api/tests/test_campaigns.py
git commit -m "feat(campaigns): add Campaign + CampaignStep models and migration"
```

---

### Task 2: Action catalog framework + Oasis/Zerda executors

**Files:**
- Create: `apps/api/app/services/campaign_catalog.py`
- Create: `apps/api/app/services/campaign_executors.py`
- Test: `apps/api/tests/test_campaigns.py` (append)

**Interfaces:**
- Produces:
  - `class CampaignContext` (attrs `goal, persona, project_profile, prior: list[dict]`)
  - `class StepResult` (attrs `summary: str, artifact_type: str | None, artifact_ids: list[str], structured: dict`)
  - `class ActionDef` (attrs `key, agent, label, description, params: dict, executor`)
  - `ACTIONS: dict[str, ActionDef]` (Phase 1: `oasis.market_report`, `zerda.pick_angle`)
  - executor `async exec_oasis_market_report(campaign, step, context, db) -> StepResult`
  - executor `async exec_zerda_pick_angle(campaign, step, context, db) -> StepResult` (structured `{topic, keyword, rationale}`)

- [ ] **Step 1: Write failing tests** — append to `tests/test_campaigns.py`:
```python
from unittest.mock import AsyncMock, patch
from app.models.analytics import GscQueryStat


def _ctx():
    from app.services.campaign_catalog import CampaignContext
    return CampaignContext(goal="grow", persona="creator", project_profile="", prior=[])


@pytest.mark.asyncio
async def test_oasis_executor_returns_report(db_session, org_and_project):
    from app.services.campaign_executors import exec_oasis_market_report
    from app.models.campaign import Campaign, CampaignStep
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="g", persona="creator", status="running")
    db_session.add(c); await db_session.commit()
    step = CampaignStep(campaign_id=c.id, order=0, agent="oasis", action="oasis.market_report")
    with patch("app.services.campaign_executors.generate_market_report",
               new=AsyncMock(return_value={"ok": True, "title": "T", "markdown": "# Report"})):
        res = await exec_oasis_market_report(c, step, _ctx(), db_session)
    assert res.artifact_type == "report"
    assert "Report" in res.summary


@pytest.mark.asyncio
async def test_zerda_executor_picks_angle(db_session, org_and_project):
    from app.services.campaign_executors import exec_zerda_pick_angle
    from app.models.campaign import Campaign, CampaignStep
    db_session.add(GscQueryStat(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, query="olive oil benefits",
                                clicks=5, impressions=900, ctr=0.005, position=7.0))
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="g", persona="creator", status="running")
    db_session.add(c); await db_session.commit()
    step = CampaignStep(campaign_id=c.id, order=0, agent="zerda", action="zerda.pick_angle")
    with patch("app.services.campaign_executors.call_llm",
               new=AsyncMock(return_value='{"topic":"Olive oil health","keyword":"olive oil benefits","rationale":"striking distance"}')):
        res = await exec_zerda_pick_angle(c, step, _ctx(), db_session)
    assert res.structured.get("keyword") == "olive oil benefits"
    assert res.summary
```

- [ ] **Step 2: Run to verify fail** — `docker compose exec -T api pytest tests/test_campaigns.py -k "oasis_executor or zerda_executor" -v` → FAIL.

- [ ] **Step 3: Implement the framework** — `apps/api/app/services/campaign_catalog.py`:
```python
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable


@dataclass
class CampaignContext:
    goal: str
    persona: str
    project_profile: str
    prior: list[dict] = field(default_factory=list)


@dataclass
class StepResult:
    summary: str
    artifact_type: str | None = None
    artifact_ids: list[str] = field(default_factory=list)
    structured: dict = field(default_factory=dict)


@dataclass
class ActionDef:
    key: str
    agent: str
    label: str
    description: str
    params: dict[str, str]  # name -> human description, for the director
    executor: Callable[..., Awaitable["StepResult"]]


def _build_actions() -> dict[str, ActionDef]:
    from app.services import campaign_executors as ex
    defs = [
        ActionDef("oasis.market_report", "oasis", "Market report",
                  "Generate a client-ready market report from the project's Search Console data.",
                  {}, ex.exec_oasis_market_report),
        ActionDef("zerda.pick_angle", "zerda", "Pick the angle",
                  "Choose one focus topic + target keyword from the project's real opportunities.",
                  {}, ex.exec_zerda_pick_angle),
    ]
    return {d.key: d for d in defs}


ACTIONS: dict[str, ActionDef] = _build_actions()
```

- [ ] **Step 4: Implement the executors** — `apps/api/app/services/campaign_executors.py`:
```python
"""Executors: thin adapters wrapping existing agent services for the campaign orchestrator."""
import json
import re

from app.services.analytics_service import get_market_insights, get_opportunities
from app.services.campaign_catalog import CampaignContext, StepResult
from app.services.llm_service import call_llm, get_org_llm_keys
from app.services.oasis_service import generate_market_report

_PROVIDERS = [("anthropic", "claude-opus-4-8"), ("openai", "gpt-4o")]


def _pick_provider(keys: dict) -> tuple[str, str] | None:
    for provider, model in _PROVIDERS:
        if provider in keys:
            return provider, model
    return None


async def exec_oasis_market_report(campaign, step, context: CampaignContext, db) -> StepResult:
    res = await generate_market_report(campaign.project_id, campaign.org_id, db)
    if not res.get("ok"):
        raise RuntimeError(res.get("error", "Market report failed."))
    md = res.get("markdown", "")
    return StepResult(summary=md[:600], artifact_type="report", structured={"markdown": md, "title": res.get("title")})


async def exec_zerda_pick_angle(campaign, step, context: CampaignContext, db) -> StepResult:
    opps = await get_opportunities(campaign.project_id, campaign.org_id, db)
    market = await get_market_insights(campaign.project_id, campaign.org_id, db)
    keys = await get_org_llm_keys(campaign.org_id, db)
    pm = _pick_provider(keys)
    if pm is None:
        raise RuntimeError("No AI key configured.")
    top = (opps.striking_distance + opps.ctr_wins)[:12]
    lines = [f"- \"{o.query}\" pos {o.position:.1f}, +{o.potential_clicks} potential" for o in top]
    clusters = "; ".join(f"{c.topic} ({c.query_count} queries)" for c in market.clusters[:8])
    system = (
        "You are Zerda, Fennex's SEO strategist. From the DATA pick ONE focus for a content campaign. "
        "Respond with ONLY JSON: {\"topic\": str, \"keyword\": str, \"rationale\": str}. "
        "Prefer a striking-distance query with real demand aligned to the goal."
    )
    user = f"GOAL: {campaign.goal}\nPERSONA: {campaign.persona}\nTOPIC CLUSTERS: {clusters}\nOPPORTUNITIES:\n" + "\n".join(lines)
    raw = await call_llm(pm[0], pm[1], keys[pm[0]], system, user)
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    try:
        data = json.loads(cleaned)
    except Exception:
        data = {"topic": campaign.goal, "keyword": (top[0].query if top else campaign.goal), "rationale": "fallback"}
    topic = str(data.get("topic") or campaign.goal)[:200]
    keyword = str(data.get("keyword") or campaign.goal)[:200]
    rationale = str(data.get("rationale") or "")[:400]
    return StepResult(
        summary=f"Focus: {topic} (target keyword: {keyword}). {rationale}",
        structured={"topic": topic, "keyword": keyword, "rationale": rationale},
    )
```

- [ ] **Step 5: Run to verify pass** — `docker compose exec -T api pytest tests/test_campaigns.py -k "oasis_executor or zerda_executor" -v` → PASS (2).

- [ ] **Step 6: Commit**
```bash
git add apps/api/app/services/campaign_catalog.py apps/api/app/services/campaign_executors.py apps/api/tests/test_campaigns.py
git commit -m "feat(campaigns): action catalog framework + Oasis/Zerda executors"
```

---

### Task 3: Campaign director (LLM planner)

**Files:**
- Create: `apps/api/app/services/campaign_director.py`
- Test: `apps/api/tests/test_campaigns.py` (append)

**Interfaces:**
- Consumes: `ACTIONS` (Task 2); `agent_persona`, `project_profile`, `call_llm`, `get_org_llm_keys`.
- Produces: `async draft_plan(project_id, org_id, goal, persona, db) -> dict` → `{"summary": str, "steps": [{"agent", "action", "brief", "why"}]}`.

- [ ] **Step 1: Write failing tests** — append:
```python
@pytest.mark.asyncio
async def test_director_parses_and_sanitizes(db_session, org_and_project):
    from app.services.campaign_director import draft_plan
    raw = '{"summary":"plan","steps":[{"agent":"zerda","action":"zerda.pick_angle","brief":{},"why":"focus"},{"agent":"x","action":"bogus.action","brief":{},"why":"drop me"}]}'
    with patch("app.services.campaign_director.call_llm", new=AsyncMock(return_value=raw)):
        plan = await draft_plan(FAKE_PROJECT_ID, FAKE_ORG_ID, "grow", "creator", db_session)
    actions = [s["action"] for s in plan["steps"]]
    assert "zerda.pick_angle" in actions
    assert "bogus.action" not in actions   # unknown dropped


@pytest.mark.asyncio
async def test_director_fallback_on_bad_json(db_session, org_and_project):
    from app.services.campaign_director import draft_plan
    with patch("app.services.campaign_director.call_llm", new=AsyncMock(return_value="not json at all")):
        plan = await draft_plan(FAKE_PROJECT_ID, FAKE_ORG_ID, "grow", "creator", db_session)
    assert [s["action"] for s in plan["steps"]] == ["zerda.pick_angle", "dune.write_article"]
```
(`dune.write_article` is a valid catalog key by Phase 2; in Phase 1 the fallback list is still emitted as data — the second test asserts the fallback constant, not execution.)

- [ ] **Step 2: Run to verify fail** — `docker compose exec -T api pytest tests/test_campaigns.py -k director -v` → FAIL.

- [ ] **Step 3: Implement** — `apps/api/app/services/campaign_director.py`:
```python
"""Sirocco, the campaign director — designs a plan over the fixed action catalog."""
import json
import re

from app.agents.registry import agent_persona
from app.services.ai_analytics_service import project_profile
from app.services.campaign_catalog import ACTIONS
from app.services.llm_service import call_llm, get_org_llm_keys

_PROVIDERS = [("anthropic", "claude-opus-4-8"), ("openai", "gpt-4o")]
_MAX_STEPS = 8
_FALLBACK = ["zerda.pick_angle", "dune.write_article"]


def _catalog_text() -> str:
    lines = []
    for a in ACTIONS.values():
        params = ", ".join(f"{k}: {v}" for k, v in a.params.items()) or "none"
        lines.append(f"- {a.key} ({a.agent} — {a.label}): {a.description} Params: {params}")
    return "\n".join(lines)


def _fallback_plan() -> dict:
    return {"summary": "Default content campaign.",
            "steps": [{"agent": ACTIONS.get(k).agent if k in ACTIONS else k.split('.')[0],
                       "action": k, "brief": {}, "why": "core step"} for k in _FALLBACK]}


async def draft_plan(project_id, org_id, goal: str, persona: str, db) -> dict:
    keys = await get_org_llm_keys(org_id, db)
    pm = next(((p, m) for p, m in _PROVIDERS if p in keys), None)
    if pm is None:
        raise ValueError("No AI key configured. Add an Anthropic or OpenAI key in Settings.")
    profile = await project_profile(project_id, db)
    system = agent_persona("sirocco") + (
        "You are the campaign director. Design a coherent campaign for the GOAL by selecting and "
        "ordering steps ONLY from the ACTION CATALOG. Each step: {agent, action, brief, why}. Order "
        "matters — earlier outputs feed later steps (pick the angle before writing/creating). Respond "
        "with ONLY JSON: {\"summary\": str, \"steps\": [...]}. Max 8 steps.\n\nACTION CATALOG:\n" + _catalog_text()
    )
    user = f"GOAL: {goal}\nPERSONA: {persona}" + (f"\nCLIENT PROFILE: {profile}" if profile else "")
    raw = await call_llm(pm[0], pm[1], keys[pm[0]], system, user)
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    try:
        parsed = json.loads(cleaned)
        steps_in = parsed.get("steps", [])
    except Exception:
        return _fallback_plan()

    steps = []
    for s in steps_in:
        action = str(s.get("action", ""))
        if action not in ACTIONS:
            continue
        adef = ACTIONS[action]
        brief_in = s.get("brief") or {}
        brief = {k: brief_in[k] for k in adef.params if k in brief_in} if isinstance(brief_in, dict) else {}
        steps.append({"agent": adef.agent, "action": action, "brief": brief, "why": str(s.get("why", ""))[:300]})
        if len(steps) >= _MAX_STEPS:
            break
    if not steps:
        return _fallback_plan()
    return {"summary": str(parsed.get("summary", ""))[:600], "steps": steps}
```

- [ ] **Step 4: Run to verify pass** — `docker compose exec -T api pytest tests/test_campaigns.py -k director -v` → PASS (2).

- [ ] **Step 5: Commit**
```bash
git add apps/api/app/services/campaign_director.py apps/api/tests/test_campaigns.py
git commit -m "feat(campaigns): Sirocco campaign director with catalog-sanitized planning"
```

---

### Task 4: Orchestrator worker `run_campaign`

**Files:**
- Create: `apps/api/app/workers/tasks/campaign_tasks.py`
- Modify: `apps/api/app/workers/worker.py` (register function)
- Test: `apps/api/tests/test_campaigns.py` (append)

**Interfaces:**
- Consumes: `ACTIONS`, `CampaignContext`, `StepResult` (Task 2); `Campaign`, `CampaignStep`.
- Produces: `async run_campaign(ctx, campaign_id)`; `async execute_campaign(campaign_id, db_factory=None)` (testable core).

- [ ] **Step 1: Write failing tests** — append:
```python
@pytest.mark.asyncio
async def test_execute_campaign_runs_steps_and_chains(db_session, org_and_project):
    from app.services.campaign_catalog import StepResult
    from app.workers.tasks.campaign_tasks import execute_campaign
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="g", persona="creator", status="running")
    db_session.add(c); await db_session.commit()
    db_session.add(CampaignStep(campaign_id=c.id, order=0, agent="zerda", action="zerda.pick_angle"))
    db_session.add(CampaignStep(campaign_id=c.id, order=1, agent="oasis", action="oasis.market_report"))
    await db_session.commit()
    calls = []
    async def fake_zerda(campaign, step, context, db):
        calls.append(("zerda", len(context.prior)))
        return StepResult(summary="angle", structured={"keyword": "k"})
    async def fake_oasis(campaign, step, context, db):
        calls.append(("oasis", len(context.prior)))
        return StepResult(summary="report", artifact_type="report")
    from app.services import campaign_catalog
    with patch.dict(campaign_catalog.ACTIONS["zerda.pick_angle"].__dict__, {"executor": fake_zerda}), \
         patch.dict(campaign_catalog.ACTIONS["oasis.market_report"].__dict__, {"executor": fake_oasis}):
        await execute_campaign(c.id, db_factory=lambda: _single_session(db_session))
    await db_session.refresh(c)
    steps = (await db_session.execute(select(CampaignStep).where(CampaignStep.campaign_id == c.id).order_by(CampaignStep.order))).scalars().all()
    assert c.status == "completed"
    assert [s.status for s in steps] == ["completed", "completed"]
    assert calls == [("zerda", 0), ("oasis", 1)]   # context grew between steps
```
Add this helper near the top of the test file (a context manager yielding the shared test session so the worker core can reuse it):
```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def _single_session(session):
    yield session
```

- [ ] **Step 2: Run to verify fail** — `docker compose exec -T api pytest tests/test_campaigns.py -k execute_campaign -v` → FAIL.

- [ ] **Step 3: Implement** — `apps/api/app/workers/tasks/campaign_tasks.py`:
```python
"""Campaign orchestrator: run a planned campaign's steps in order, chaining outputs."""
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.campaign import Campaign, CampaignStep
from app.services.ai_analytics_service import project_profile
from app.services.campaign_catalog import ACTIONS, CampaignContext

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def execute_campaign(campaign_id, db_factory=None) -> None:
    factory = db_factory or async_session_factory
    async with factory() as db:
        campaign = await db.get(Campaign, campaign_id)
        if campaign is None:
            return
        campaign.status = "running"
        await db.commit()
        steps = (await db.execute(select(CampaignStep).where(
            CampaignStep.campaign_id == campaign_id).order_by(CampaignStep.order))).scalars().all()

        profile = ""
        try:
            profile = await project_profile(campaign.project_id, db)
        except Exception:
            pass
        context = CampaignContext(goal=campaign.goal, persona=campaign.persona, project_profile=profile, prior=[])

        any_done = False
        for step in steps:
            await db.refresh(campaign)
            if campaign.cancel_requested:
                break
            adef = ACTIONS.get(step.action)
            if adef is None:
                step.status = "skipped"; step.error = "Unknown action."; await db.commit(); continue
            step.status = "running"; step.started_at = _now(); await db.commit()
            try:
                result = await adef.executor(campaign, step, context, db)
                if result.structured.get("skipped"):
                    step.status = "skipped"; step.summary = result.summary
                else:
                    step.status = "completed"; any_done = True
                    step.summary = result.summary
                    step.artifact_type = result.artifact_type
                    step.artifact_ids = result.artifact_ids or None
                    step.structured = result.structured or None
                    context.prior.append({"agent": step.agent, "action": step.action,
                                          "summary": result.summary, "structured": result.structured})
            except Exception as exc:  # noqa: BLE001 — record + continue
                logger.exception("campaign step failed: %s", step.action)
                step.status = "failed"; step.error = str(exc)[:2000]
            step.finished_at = _now(); await db.commit()

        await db.refresh(campaign)
        if campaign.cancel_requested:
            campaign.status = "cancelled"
        else:
            campaign.status = "completed" if any_done else "failed"
        await db.commit()


async def run_campaign(ctx, campaign_id: str) -> None:
    await execute_campaign(uuid.UUID(campaign_id))
```

- [ ] **Step 4: Register in the worker** — in `apps/api/app/workers/worker.py`: import `run_campaign` alongside the other task imports and add it to the `functions = [...]` list (no cron).

- [ ] **Step 5: Run to verify pass** — `docker compose exec -T api pytest tests/test_campaigns.py -k execute_campaign -v` → PASS. Then `docker compose exec -T api python -c "from app.workers.tasks.campaign_tasks import run_campaign; print('ok')"` → `ok`.

- [ ] **Step 6: Commit**
```bash
git add apps/api/app/workers/tasks/campaign_tasks.py apps/api/app/workers/worker.py apps/api/tests/test_campaigns.py
git commit -m "feat(campaigns): orchestrator worker runs steps in order with context chaining"
```

---

### Task 5: API router `/campaigns`

**Files:**
- Create: `apps/api/app/api/v1/routers/campaigns.py`
- Modify: `apps/api/app/api/v1/router.py` (register)
- Test: `apps/api/tests/test_campaigns.py` (append endpoint tests)

**Interfaces:**
- Consumes: `draft_plan` (Task 3), `Campaign`/`CampaignStep`; `CurrentUser`/`DB`.
- Produces routes under `/api/v1/campaigns`: `POST`, `GET`, `GET /{id}`, `PATCH /{id}/plan`, `POST /{id}/run`, `POST /{id}/cancel`.

- [ ] **Step 1: Write failing endpoint tests** — append:
```python
@pytest.mark.asyncio
async def test_create_campaign_persists_plan(client, org_and_project):
    plan = {"summary": "s", "steps": [{"agent": "zerda", "action": "zerda.pick_angle", "brief": {}, "why": "w"},
                                       {"agent": "oasis", "action": "oasis.market_report", "brief": {}, "why": "w2"}]}
    with patch("app.api.v1.routers.campaigns.draft_plan", new=AsyncMock(return_value=plan)):
        r = await client.post(f"/api/v1/campaigns?project_id={FAKE_PROJECT_ID}", json={"goal": "grow"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "planned" and len(body["steps"]) == 2


@pytest.mark.asyncio
async def test_plan_edit_and_run(client, org_and_project):
    plan = {"summary": "s", "steps": [{"agent": "zerda", "action": "zerda.pick_angle", "brief": {}, "why": "w"},
                                       {"agent": "oasis", "action": "oasis.market_report", "brief": {}, "why": "w2"}]}
    with patch("app.api.v1.routers.campaigns.draft_plan", new=AsyncMock(return_value=plan)):
        cid = (await client.post(f"/api/v1/campaigns?project_id={FAKE_PROJECT_ID}", json={"goal": "grow"})).json()["id"]
    got = (await client.get(f"/api/v1/campaigns/{cid}")).json()
    keep = [got["steps"][1]["id"]]   # keep only the 2nd step
    pr = await client.patch(f"/api/v1/campaigns/{cid}/plan", json={"step_ids": keep})
    assert pr.status_code == 200 and len(pr.json()["steps"]) == 1
    with patch("app.api.v1.routers.campaigns.enqueue_campaign", new=AsyncMock(return_value=None)):
        run = await client.post(f"/api/v1/campaigns/{cid}/run")
    assert run.status_code == 200 and run.json()["status"] == "running"
```

- [ ] **Step 2: Run to verify fail** — `docker compose exec -T api pytest tests/test_campaigns.py -k "create_campaign or plan_edit" -v` → FAIL.

- [ ] **Step 3: Implement router** — `apps/api/app/api/v1/routers/campaigns.py`:
```python
import uuid

import arq
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.models.campaign import Campaign, CampaignStep
from app.services.campaign_director import draft_plan


router = APIRouter()


class CampaignCreate(BaseModel):
    goal: str


class PlanEdit(BaseModel):
    step_ids: list[str]


def _step(s: CampaignStep) -> dict:
    return {"id": str(s.id), "order": s.order, "agent": s.agent, "action": s.action, "brief": s.brief,
            "why": s.why, "status": s.status, "summary": s.summary, "artifact_type": s.artifact_type,
            "artifact_ids": s.artifact_ids, "structured": s.structured, "error": s.error}


def _campaign(c: Campaign, steps: list[CampaignStep]) -> dict:
    return {"id": str(c.id), "goal": c.goal, "persona": c.persona, "status": c.status,
            "director_summary": c.director_summary,
            "steps": [_step(s) for s in sorted(steps, key=lambda x: x.order)]}


async def _load(campaign_id, org_id, db) -> Campaign | None:
    return (await db.execute(select(Campaign).where(Campaign.id == campaign_id, Campaign.org_id == org_id))).scalars().first()


async def _steps(campaign_id, db) -> list[CampaignStep]:
    return list((await db.execute(select(CampaignStep).where(CampaignStep.campaign_id == campaign_id))).scalars().all())


async def enqueue_campaign(campaign_id: str) -> None:
    pool = await arq.create_pool(settings.REDIS_SETTINGS)
    try:
        await pool.enqueue_job("run_campaign", campaign_id)
    finally:
        await pool.aclose()


@router.post("", status_code=201)
async def create_campaign(project_id: uuid.UUID, body: CampaignCreate, current_user: CurrentUser, db: DB):
    from app.models.project import Project
    proj = await db.get(Project, project_id)
    if proj is None or proj.org_id != current_user.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    persona = proj.persona or "creator"
    try:
        plan = await draft_plan(project_id, current_user.org_id, body.goal, persona, db)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    campaign = Campaign(org_id=current_user.org_id, project_id=project_id, goal=body.goal,
                        persona=persona, status="planned", director_summary=plan.get("summary"))
    db.add(campaign)
    await db.flush()
    for i, s in enumerate(plan["steps"]):
        db.add(CampaignStep(campaign_id=campaign.id, order=i, agent=s["agent"], action=s["action"],
                            brief=s.get("brief") or {}, why=s.get("why"), status="pending"))
    await db.commit()
    return _campaign(campaign, await _steps(campaign.id, db))


@router.get("")
async def list_campaigns(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    rows = (await db.execute(select(Campaign).where(
        Campaign.project_id == project_id, Campaign.org_id == current_user.org_id
    ).order_by(Campaign.created_at.desc()))).scalars().all()
    out = []
    for c in rows:
        out.append(_campaign(c, await _steps(c.id, db)))
    return out


@router.get("/{campaign_id}")
async def get_campaign(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campaign not found")
    return _campaign(c, await _steps(c.id, db))


@router.patch("/{campaign_id}/plan")
async def edit_plan(campaign_id: uuid.UUID, body: PlanEdit, current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campaign not found")
    if c.status != "planned":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Plan can only be edited before running.")
    keep = [uuid.UUID(x) for x in body.step_ids]
    steps = await _steps(campaign_id, db)
    for s in steps:
        if s.id not in keep:
            await db.delete(s)
    for order, sid in enumerate(keep):
        s = next((x for x in steps if x.id == sid), None)
        if s is not None:
            s.order = order
    await db.commit()
    return _campaign(c, await _steps(campaign_id, db))


@router.post("/{campaign_id}/run")
async def run(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campaign not found")
    if c.status != "planned":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Campaign is not in a runnable state.")
    c.status = "running"
    await db.commit()
    await enqueue_campaign(str(campaign_id))
    return _campaign(c, await _steps(campaign_id, db))


@router.post("/{campaign_id}/cancel")
async def cancel(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campaign not found")
    c.cancel_requested = True
    await db.commit()
    return _campaign(c, await _steps(campaign_id, db))
```

- [ ] **Step 4: Register** — in `apps/api/app/api/v1/router.py`: add `campaigns` to the imports block and `api_router.include_router(campaigns.router, prefix="/campaigns", tags=["campaigns"])`.

- [ ] **Step 5: Run to verify pass** — `docker compose exec -T api pytest tests/test_campaigns.py -v` → all PASS.

- [ ] **Step 6: Commit**
```bash
git add apps/api/app/api/v1/routers/campaigns.py apps/api/app/api/v1/router.py apps/api/tests/test_campaigns.py
git commit -m "feat(campaigns): REST endpoints — create/list/get/plan-edit/run/cancel"
```

---

### Task 6: Frontend API client + types

**Files:**
- Modify: `apps/web/lib/api.ts`

**Interfaces:**
- Produces: `Campaign`, `CampaignStep` types + `createCampaign`, `listCampaigns`, `getCampaign`, `updateCampaignPlan`, `runCampaign`, `cancelCampaign`.

- [ ] **Step 1: Add types + functions** — append to `apps/web/lib/api.ts`:
```typescript
export type CampaignStatus = "planned" | "running" | "completed" | "failed" | "cancelled";
export type CampaignStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface CampaignStep {
  id: string;
  order: number;
  agent: string;
  action: string;
  brief: Record<string, unknown> | null;
  why: string | null;
  status: CampaignStepStatus;
  summary: string | null;
  artifact_type: string | null;
  artifact_ids: string[] | null;
  structured: Record<string, unknown> | null;
  error: string | null;
}

export interface Campaign {
  id: string;
  goal: string;
  persona: string;
  status: CampaignStatus;
  director_summary: string | null;
  steps: CampaignStep[];
}

export async function createCampaign(projectId: string, goal: string): Promise<Campaign> {
  return apiClient.post<Campaign>(`/campaigns?project_id=${projectId}`, { goal });
}
export async function listCampaigns(projectId: string): Promise<Campaign[]> {
  return apiClient.get<Campaign[]>(`/campaigns?project_id=${projectId}`);
}
export async function getCampaign(id: string): Promise<Campaign> {
  return apiClient.get<Campaign>(`/campaigns/${id}`);
}
export async function updateCampaignPlan(id: string, stepIds: string[]): Promise<Campaign> {
  return apiClient.patch<Campaign>(`/campaigns/${id}/plan`, { step_ids: stepIds });
}
export async function runCampaign(id: string): Promise<Campaign> {
  return apiClient.post<Campaign>(`/campaigns/${id}/run`, {});
}
export async function cancelCampaign(id: string): Promise<Campaign> {
  return apiClient.post<Campaign>(`/campaigns/${id}/cancel`, {});
}
```

- [ ] **Step 2: Typecheck** — `cd apps/web && npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**
```bash
git add apps/web/lib/api.ts
git commit -m "feat(campaigns): frontend api client and types"
```

---

### Task 7: Campaigns page (composer + plan edit + run/progress) + sidebar + i18n

**Files:**
- Create: `apps/web/app/(dashboard)/[projectId]/campaigns/page.tsx`
- Modify: `apps/web/components/layout/Sidebar.tsx` (add `campaigns` to `NAV_ITEMS` + each persona primary list)
- Modify: `apps/web/public/locales/en/common.json` (`nav.campaigns` + a `campaigns` block)

**Interfaces:**
- Consumes: `createCampaign`, `listCampaigns`, `getCampaign`, `updateCampaignPlan`, `runCampaign`, `cancelCampaign`, `Campaign`.

- [ ] **Step 1: Add i18n keys** — in `apps/web/public/locales/en/common.json`: add `"campaigns": "Campaigns"` to `nav`, and a top-level block:
```json
"campaigns": {
  "title": "Campaigns",
  "subtitle": "Brief the Pack once — they plan and run a whole campaign",
  "newGoal": "What do you want to achieve?",
  "goalPlaceholder": "e.g. Win 3 new restaurant clients this quarter",
  "draft": "Draft plan",
  "planReady": "Here's the plan",
  "run": "Run campaign",
  "running": "Running...",
  "cancel": "Cancel",
  "remove": "Remove step",
  "why": "Why",
  "empty": "No campaigns yet. Set a goal to start.",
  "status": { "planned": "Planned", "running": "Running", "completed": "Completed", "failed": "Failed", "cancelled": "Cancelled" },
  "stepStatus": { "pending": "Pending", "running": "Running", "completed": "Done", "failed": "Failed", "skipped": "Skipped" }
}
```

- [ ] **Step 2: Sidebar** — in `apps/web/components/layout/Sidebar.tsx`: add `Megaphone` to the `lucide-react` import; add to `NAV_ITEMS`: `campaigns: { key: "campaigns", href: "campaigns", icon: Megaphone }` (match the file's NavItem shape); add `"campaigns"` to each persona array in `PERSONA_PRIMARY` (after `"agents"`).

- [ ] **Step 3: Build the page** — `apps/web/app/(dashboard)/[projectId]/campaigns/page.tsx`. A client component with three views driven by local state: (a) **composer** — a goal textarea + "Draft plan" button calling `createCampaign` (shows a spinner while the director works); (b) **plan preview** — the returned campaign's steps as cards (agent + action label, `why`, a Remove button that calls `updateCampaignPlan` with the remaining ids), plus a "Run campaign" button calling `runCampaign`; (c) **run/progress** — after run, `useQuery` polls `getCampaign(id)` with `refetchInterval: 2500` while `status === "running"`, rendering a step timeline coloured by `step.status` (`campaigns.stepStatus.*`) with each `step.summary`; a Cancel button calls `cancelCampaign`. Also list existing campaigns from `listCampaigns` with click-through to their progress view. Every user-visible string via `t("campaigns.*")`. Use `Card`, `useToast`, `useQueryClient`. NO EMOJI; Tailwind CSS variables only. Header uses a `Megaphone` icon and `t("campaigns.title")`/`t("campaigns.subtitle")`.

- [ ] **Step 4: Typecheck** — `cd apps/web && npm run typecheck` → exit 0.

- [ ] **Step 5: Restart + smoke** — `docker compose restart web && sleep 8 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/` → 200/302. In the browser: open `/<projectId>/campaigns`, set a goal, draft, remove a step, run, watch progress.

- [ ] **Step 6: Commit**
```bash
git add "apps/web/app/(dashboard)/[projectId]/campaigns/page.tsx" apps/web/components/layout/Sidebar.tsx apps/web/public/locales/en/common.json
git commit -m "feat(campaigns): composer, plan preview, run progress + sidebar + i18n"
```

---

## PHASE 2 — Artifact executors + package view

Each Phase-2 executor task follows the same shape: write a failing test (underlying service mocked), implement the executor in `campaign_executors.py`, register it in `campaign_catalog._build_actions()`, run the test.

### Task 8: `dune.write_article` executor

**Files:** Modify `apps/api/app/services/campaign_executors.py`, `apps/api/app/services/campaign_catalog.py`; Test `apps/api/tests/test_campaigns.py`.

**Interfaces:** Produces `async exec_dune_write_article(campaign, step, context, db) -> StepResult` (artifact_type `article`).

- [ ] **Step 1: Failing test** — append:
```python
@pytest.mark.asyncio
async def test_dune_executor_creates_article(db_session, org_and_project):
    from app.services.campaign_executors import exec_dune_write_article
    from app.services.campaign_catalog import CampaignContext
    from app.models.article import Article
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="g", persona="creator", status="running")
    db_session.add(c); await db_session.commit()
    step = CampaignStep(campaign_id=c.id, order=0, agent="dune", action="dune.write_article", brief={})
    ctx = CampaignContext(goal="g", persona="creator", project_profile="",
                          prior=[{"agent": "zerda", "action": "zerda.pick_angle", "summary": "",
                                  "structured": {"topic": "Olive oil", "keyword": "olive oil benefits"}}])
    with patch("app.services.campaign_executors.call_llm", new=AsyncMock(return_value="# Olive oil benefits\n\nBody text here.")):
        res = await exec_dune_write_article(c, step, ctx, db_session)
    assert res.artifact_type == "article" and res.artifact_ids
    art = (await db_session.execute(select(Article))).scalars().first()
    assert art is not None and art.body_markdown
```

- [ ] **Step 2: Run → FAIL**: `docker compose exec -T api pytest tests/test_campaigns.py -k dune_executor -v`.

- [ ] **Step 3: Implement** — add to `campaign_executors.py` (imports at top of file):
```python
from app.models.article import Article, ArticleStatus
from app.workers.tasks.article_tasks import _build_system_prompt, _build_user_prompt, _parse_llm_response


def _angle(context: CampaignContext) -> dict:
    for p in context.prior:
        st = p.get("structured") or {}
        if st.get("keyword") or st.get("topic"):
            return st
    return {}


async def exec_dune_write_article(campaign, step, context: CampaignContext, db) -> StepResult:
    brief = step.brief or {}
    angle = _angle(context)
    title = str(brief.get("title") or angle.get("topic") or campaign.goal)[:500]
    keyword = str(brief.get("keyword") or angle.get("keyword") or "")[:500] or None
    keys = await get_org_llm_keys(campaign.org_id, db)
    pm = _pick_provider(keys)
    if pm is None:
        raise RuntimeError("No AI key configured.")
    article = Article(org_id=campaign.org_id, project_id=campaign.project_id, title=title,
                      target_keyword=keyword, status=ArticleStatus.generating)
    db.add(article); await db.flush()
    system = _build_system_prompt(None, context.project_profile)
    user = _build_user_prompt(article)
    try:
        raw = await call_llm(pm[0], pm[1], keys[pm[0]], system, user)
    except Exception:
        article.status = ArticleStatus.failed
        raise
    parsed = _parse_llm_response(raw, title)
    article.body_markdown = parsed["body_markdown"]
    article.word_count = len(parsed["body_markdown"].split())
    article.status = ArticleStatus.ready
    await db.commit()
    return StepResult(summary=f"Drafted article: {title}", artifact_type="article",
                      artifact_ids=[str(article.id)], structured={"article_id": str(article.id), "title": title})
```

- [ ] **Step 4: Register** — in `campaign_catalog._build_actions()` add:
```python
        ActionDef("dune.write_article", "dune", "Write an article",
                  "Write an SEO article on the chosen angle (uses the picked topic/keyword if present).",
                  {"title": "optional article title", "keyword": "optional target keyword"}, ex.exec_dune_write_article),
```

- [ ] **Step 5: Run → PASS**; **Commit** `feat(campaigns): Dune write-article executor`.

---

### Task 9: `sirocco.generate_visual` executor

**Interfaces:** `async exec_sirocco_generate_visual(campaign, step, context, db) -> StepResult` (artifact_type `image`).

- [ ] **Step 1: Failing test** — mock `generate_image_dalle` to return `{"ok": True, "image_url": "data:...", "revised_prompt": "p", "width": 1024, "height": 1024, "cost_usd": 0.04}`; assert a `GeneratedImage` row is created and `res.artifact_type == "image"`. The org needs an OpenAI key row — seed an `APIKey(org_id=FAKE_ORG_ID, provider="openai", encrypted_value=...)` or mock `get_org_llm_keys` to return `{"openai": "k"}`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — add to `campaign_executors.py`:
```python
from app.models.image import GeneratedImage, ImageStatus
from app.services.image_service import generate_image_dalle


async def exec_sirocco_generate_visual(campaign, step, context: CampaignContext, db) -> StepResult:
    keys = await get_org_llm_keys(campaign.org_id, db)
    if "openai" not in keys:
        raise RuntimeError("Image generation needs an OpenAI key.")
    brief = step.brief or {}
    angle = _angle(context)
    prompt = str(brief.get("prompt") or f"Marketing visual for: {angle.get('topic') or campaign.goal}")[:800]
    result = await generate_image_dalle(prompt=prompt, style="professional", usage="marketing", openai_api_key=keys["openai"])
    if not result.get("ok"):
        raise RuntimeError(result.get("error", "Image generation failed."))
    img = GeneratedImage(org_id=campaign.org_id, project_id=campaign.project_id, prompt=prompt,
                         revised_prompt=result.get("revised_prompt"), style="professional", usage="marketing",
                         status=ImageStatus.completed, image_url=result.get("image_url"),
                         width=result.get("width"), height=result.get("height"), cost_usd=result.get("cost_usd"))
    db.add(img); await db.commit()
    return StepResult(summary="Generated a campaign visual.", artifact_type="image",
                      artifact_ids=[str(img.id)], structured={"image_id": str(img.id)})
```
(Verify `GeneratedImage`/`ImageStatus` field + enum names against `app/models/image.py`; adjust `usage`/`style` to valid values if the model constrains them — `ImageStatus.completed` and free-string usage per the model.)

- [ ] **Step 4: Register** `sirocco.generate_visual` (agent `sirocco`, label "Generate a visual", params `{prompt}`). **Run → PASS; Commit** `feat(campaigns): Sirocco visual executor`.

---

### Task 10: `nomad.social_posts` executor

**Interfaces:** `async exec_nomad_social_posts(campaign, step, context, db) -> StepResult` (artifact_type `social`).

- [ ] **Step 1: Failing test** — mock `generate_outreach_plan` to return `{"ok": True, "posts": [{...}], "drafts_saved": 3}`; assert `res.artifact_type == "social"` and summary mentions drafts.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — add to `campaign_executors.py`:
```python
from app.services.nomad_service import generate_outreach_plan


async def exec_nomad_social_posts(campaign, step, context: CampaignContext, db) -> StepResult:
    angle = _angle(context)
    goal = str((step.brief or {}).get("goal") or angle.get("topic") or campaign.goal)
    res = await generate_outreach_plan(campaign.project_id, campaign.org_id, goal, db)
    if not res.get("ok"):
        raise RuntimeError(res.get("error", "Outreach generation failed."))
    n = res.get("drafts_saved", 0)
    return StepResult(summary=f"Created {n} social drafts to distribute the campaign.",
                      artifact_type="social", structured={"drafts_saved": n})
```

- [ ] **Step 4: Register** `nomad.social_posts` (agent `nomad`, label "Create social posts", params `{goal}`). **Run → PASS; Commit** `feat(campaigns): Nomad social-posts executor`.

---

### Task 11: `sable.competitor_scan` executor

**Interfaces:** `async exec_sable_competitor_scan(campaign, step, context, db) -> StepResult` (artifact_type `analysis`; skips if no url).

- [ ] **Step 1: Failing tests** — (a) with `brief={"competitor_url": "https://x"}` and `analyze` mocked to `{"ok": True, ...}`, assert `artifact_type == "analysis"`; (b) with `brief={}` assert `res.structured.get("skipped") is True`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — add to `campaign_executors.py`:
```python
from app.services.competitor_service import analyze as analyze_competitor


async def exec_sable_competitor_scan(campaign, step, context: CampaignContext, db) -> StepResult:
    url = str((step.brief or {}).get("competitor_url") or "").strip()
    if not url:
        return StepResult(summary="No competitor URL provided — skipped.", structured={"skipped": True})
    res = await analyze_competitor(campaign.project_id, campaign.org_id, url, db)
    if not res.get("ok"):
        raise RuntimeError(res.get("error", "Competitor scan failed."))
    return StepResult(summary=f"Scanned competitor {url}.", artifact_type="analysis", structured={"analysis": res})
```

- [ ] **Step 4: Register** `sable.competitor_scan` (agent `sable`, label "Scan a competitor", params `{competitor_url}`). **Run → PASS; Commit** `feat(campaigns): Sable competitor-scan executor`.

---

### Task 12: Package view (artifacts in the run UI)

**Files:** Modify `apps/web/app/(dashboard)/[projectId]/campaigns/page.tsx` (+ i18n keys as needed).

- [ ] **Step 1:** When `campaign.status === "completed"`, render a **package** section below the timeline: for each completed step with an `artifact_type`, show a linked card — `article` → link to `/${projectId}/articles`; `image` → thumbnail from the step's `structured.image_id` (or a link to `/${projectId}/images`); `social` → link to `/${projectId}/social`; `report`/`analysis` → an expandable panel showing the step `summary`/`structured.markdown`. Reuse the existing markdown renderer pattern if present; else render `summary` as preformatted text. All labels via `t("campaigns.*")`. NO EMOJI.

- [ ] **Step 2: Typecheck** — `cd apps/web && npm run typecheck` → exit 0.

- [ ] **Step 3: Restart + smoke** — `docker compose restart web api worker`; run a full campaign end to end in the browser and confirm artifacts appear.

- [ ] **Step 4: Commit** `feat(campaigns): package view linking produced artifacts`.

---

## Final verification

- [ ] Backend: `docker compose exec -T api pytest tests/test_campaigns.py -v` — all PASS.
- [ ] Frontend: `cd apps/web && npm run typecheck` — clean.
- [ ] Restart: `docker compose restart api web worker`; confirm the worker log lists `run_campaign`.
- [ ] Live: create a campaign, edit the plan, run it, watch the timeline, and confirm the package links to the produced report/article/image/social drafts. A step failure (e.g. no OpenAI key for the visual) should show as a failed step without aborting the rest.
