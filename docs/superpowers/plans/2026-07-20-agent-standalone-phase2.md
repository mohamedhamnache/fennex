# Specialized Agent Standalone Skills — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repoint the standalone AI endpoints (market report, ICP, testimonials, outreach, multi-network social, competitor scan) onto the Phase 1 agent core (`AgentRunner.run(skill)`), and add the one missing surface (product copy), so every generative endpoint runs the same specialized prompts + grounding + tiering the campaign director already uses.

**Architecture:** A new `run_standalone(skill, project_id, org_id, goal, db, inputs)` helper resolves the org's `agent_tier`, builds a `Brief` once, and runs a `Skill` through `AgentRunner` — the same path the director uses, minus the multi-step plan/review loop. Each service function keeps its **exact public signature and return dict shape** (so routers and the frontend are unchanged) but replaces its bespoke prompt + `call_llm` + provider-loop with a single `run_standalone` call and a small result-mapping. Where repointing would drop grounding a skill doesn't yet gather (market overview/health) or output a caller needs (social hooks/best-time), the relevant tool or skill is enriched — never the caller's contract.

**Tech Stack:** Python 3.11 async, SQLAlchemy 2 (asyncpg), Anthropic/OpenAI via `app.services.agents.runner.AgentRunner` → `app.services.llm_service.call_llm`, pytest (`asyncio_mode = "auto"`, `testpaths = ["tests"]`). No Alembic migration in Phase 2 (`organizations.agent_tier` already exists from Phase 1).

## Global Constraints

- All generation goes through `AgentRunner.run(skill, brief, inputs, tier, db, keys=None)` (`app.services.agents.runner`) — never call `call_llm` or SDKs directly in a repointed service.
- Tier comes from `run_standalone` (resolves `Organization.agent_tier`, default `"balanced"`). Never hard-code a provider/model in a repointed service.
- Every repointed service keeps its current **function signature and return-dict keys** byte-for-byte, so routers/response-models/frontends are untouched. The only allowed change to a caller is deleting now-dead prompt constants/imports.
- Skills, briefs, tools live in `apps/api/app/services/agents/`. Tests live in `apps/api/tests/`, run with `cd apps/api && pytest -q` (or `docker compose exec -T api pytest -q`). `asyncio_mode = "auto"` — async tests need no decorator.
- No emoji anywhere (code, prompts, UI, tests).
- Repoint tests must not hit a real LLM: patch `run_standalone` (or `AgentRunner.run`) to return a canned `AgentResult` and assert the service maps it to the right dict.
- Reuse Phase 1 skills as-is unless a task explicitly enriches one: `oasis.MARKET_REPORT`, `oasis.DEFINE_ICP`, `nomad.OUTREACH_PLAN`, `nomad.TESTIMONIAL_CONTENT`, `sirocco.MULTI_NETWORK_SOCIAL`, `sable.COMPETITOR_SCAN`, `dune.PRODUCT_COPY` (registry in `app.services.agents.registry`).

---

## File Structure

```
apps/api/app/services/agents/
  standalone.py        # NEW: org_tier(org_id, db) + run_standalone(skill, project_id, org_id, goal, db, inputs, persona)
  director.py          # MODIFY: reuse org_tier (DRY); behaviour unchanged
  tools.py             # MODIFY: market_data gains overview + health (grounding parity for the report)
  skills/sirocco.py    # MODIFY: MULTI_NETWORK_SOCIAL emits hooks[] per variant
apps/api/app/services/
  oasis_service.py     # MODIFY: generate_market_report / generate_icp delegate to run_standalone
  nomad_service.py     # MODIFY: generate_outreach_plan / generate_testimonial_content delegate
  influencer_service.py# MODIFY: generate_studio delegates to run_standalone (keeps StudioResult shape)
  competitor_service.py# MODIFY: AI insights block routes through run_standalone (keeps CompetitorAnalysis shape)
apps/api/app/api/v1/routers/
  store.py             # MODIFY: add POST /store/products/{product_id}/generate-copy (net-new surface)
apps/api/tests/
  test_agents_standalone.py   # foundation
  test_standalone_oasis.py    # market_report + icp
  test_standalone_nomad.py    # outreach + testimonial
  test_standalone_social.py   # studio (multi-network)
  test_standalone_competitor.py
  test_standalone_product_copy.py
```

---

### Task 1: `run_standalone` foundation + director DRY

**Files:**
- Create: `apps/api/app/services/agents/standalone.py`
- Modify: `apps/api/app/services/agents/director.py` (reuse `org_tier`)
- Test: `apps/api/tests/test_agents_standalone.py`

**Interfaces:**
- Consumes: `Organization` (`app.models.organization`), `Project` (`app.models.project`), `build_brief` (`app.services.agents.brief`), `AgentRunner` (`app.services.agents.runner`), `AgentResult`/`Skill` (`app.services.agents.spec`).
- Produces:
  - `async org_tier(org_id, db) -> str` — returns `Organization.agent_tier` or `"balanced"`.
  - `async run_standalone(skill: Skill, project_id, org_id, goal: str, db, inputs: dict | None = None, persona: str | None = None) -> AgentResult` — resolves tier via `org_tier`, derives `persona` from `Project.persona` when `None` (fallback `"creator"`), builds a `Brief`, runs `AgentRunner.run`, returns the `AgentResult`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_standalone.py
import uuid, pytest
from unittest.mock import AsyncMock, patch
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
from app.services.agents.spec import AgentResult, Skill
from app.services.agents import standalone as S

_engine = create_async_engine("sqlite+aiosqlite:///:memory:")
_Session = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture
async def db():
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with _Session() as s:
        yield s
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


def _skill():
    return Skill(key="oasis.define_icp", agent_id="oasis", weight="light", tools=[],
                 build_prompt=lambda b, i, td: ("s", "u"), output="json")


async def test_org_tier_defaults_to_balanced(db):
    org = Organization(slug="o", name="O"); db.add(org); await db.flush()
    assert await S.org_tier(org.id, db) == "balanced"
    org.agent_tier = "max"; await db.flush()
    assert await S.org_tier(org.id, db) == "max"


async def test_run_standalone_builds_brief_and_runs_with_org_tier(db):
    org = Organization(slug="o2", name="O", agent_tier="economy"); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="P", domain="p.com", persona="ecommerce"); db.add(proj); await db.flush()
    await db.commit()
    seen = {}
    async def fake_run(skill, brief, inputs, tier, db, keys=None, campaign=None):
        seen["tier"] = tier; seen["persona"] = brief.persona; seen["goal"] = brief.goal
        return AgentResult(ok=True, summary="did it", content={"x": 1})
    with patch("app.services.agents.standalone.AgentRunner.run", new=AsyncMock(side_effect=fake_run)):
        r = await S.run_standalone(_skill(), proj.id, org.id, goal="Define clients", db=db, inputs={"k": "v"})
    assert r.ok and r.content == {"x": 1}
    assert seen == {"tier": "economy", "persona": "ecommerce", "goal": "Define clients"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_standalone.py -q`
Expected: FAIL — `ModuleNotFoundError: app.services.agents.standalone`.

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/app/services/agents/standalone.py
"""Run a single Skill outside a campaign — the standalone-endpoint seam.

Same path as the director (resolve tier -> build brief -> AgentRunner.run), minus
the plan/review loop. Endpoints stay thin: call run_standalone, map the AgentResult."""
from app.models.organization import Organization
from app.models.project import Project
from app.services.agents.brief import build_brief
from app.services.agents.runner import AgentRunner


async def org_tier(org_id, db) -> str:
    org = await db.get(Organization, org_id)
    return org.agent_tier if org and org.agent_tier else "balanced"


async def run_standalone(skill, project_id, org_id, goal: str, db, inputs=None, persona=None):
    if persona is None:
        proj = await db.get(Project, project_id)
        persona = getattr(proj, "persona", None) or "creator"
    tier = await org_tier(org_id, db)
    brief = await build_brief(project_id, org_id, goal, persona, db)
    return await AgentRunner.run(skill, brief, inputs or {}, tier, db)
```

Then DRY the director (behaviour identical). In `apps/api/app/services/agents/director.py`, replace the inline tier lookup:

```python
    resolved_tier = tier
    if resolved_tier is None:
        org_obj = await db.get(Organization, campaign.org_id)
        resolved_tier = (org_obj.agent_tier if org_obj and org_obj.agent_tier else "balanced")
```

with:

```python
    from app.services.agents.standalone import org_tier
    resolved_tier = tier if tier is not None else await org_tier(campaign.org_id, db)
```

(The `from app.models.organization import Organization` import in `director.py` may now be unused — leave it; it is harmless and other future edits may use it.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_agents_standalone.py tests/test_agents_director.py -q`
Expected: PASS (all — director behaviour unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/standalone.py apps/api/app/services/agents/director.py apps/api/tests/test_agents_standalone.py
git commit -m "feat(agents): run_standalone seam for standalone skill endpoints"
```

---

### Task 2: Grounding parity — `market_data` tool gains overview + health

**Files:**
- Modify: `apps/api/app/services/agents/tools.py` (`market_data`)
- Test: `apps/api/tests/test_agents_tools.py` (append)

**Why:** `oasis_service.generate_market_report` grounds its prompt on overview (clicks/impressions/CTR/position) + SEO health + clusters + opportunities. The `oasis.MARKET_REPORT` skill uses only the `market_data` tool, which today omits overview + health. Enrich the tool so the repointed report keeps its richness. `oasis._report_prompt` already renders the whole `data` dict, so no skill change is needed.

**Interfaces:**
- Consumes: `get_overview`, `get_health_score` (`app.services.analytics_service`, each `(project_id, org_id, ..., db)`), already-used `get_market_insights`/`get_opportunities`.
- Produces: `market_data` returns the existing keys plus `overview` and `health`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_tools.py  (append)
async def test_market_data_includes_overview_and_health():
    from types import SimpleNamespace as NS
    from app.services.agents import tools as T
    ov = NS(clicks=10, impressions=100, ctr=0.1, avg_position=5.0, clicks_change=1.0, impressions_change=2.0)
    health = NS(score=80, grade="B", components=[])
    market = NS(clusters=[], ideas=[])
    opps = NS(striking_distance=[], ctr_wins=[], total_potential_clicks=0)
    with patch.object(T, "get_overview", new=AsyncMock(return_value=ov)), \
         patch.object(T, "get_health_score", new=AsyncMock(return_value=health)), \
         patch.object(T, "get_market_insights", new=AsyncMock(return_value=market)), \
         patch.object(T, "get_opportunities", new=AsyncMock(return_value=opps)):
        data = await T.market_data(_brief(), db=None, inputs={})
    assert data["overview"]["clicks"] == 10 and data["overview"]["ctr"] == 0.1
    assert data["health"]["score"] == 80 and data["health"]["grade"] == "B"
```

(Ensure the file's top imports include `from unittest.mock import AsyncMock, patch` — Task 4 of Phase 1 already imported `patch`; add `AsyncMock` to that import if missing.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_tools.py::test_market_data_includes_overview_and_health -q`
Expected: FAIL — `KeyError: 'overview'`.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/app/services/agents/tools.py`, add the imports and enrich `market_data`:

```python
from app.services.analytics_service import (
    get_opportunities, get_market_insights, get_overview, get_health_score,
)
```

```python
async def market_data(brief, db, inputs):
    m = await get_market_insights(brief.project_id, brief.org_id, db)
    o = await get_opportunities(brief.project_id, brief.org_id, db)
    ov = await get_overview(brief.project_id, brief.org_id, "28d", db)
    health = await get_health_score(brief.project_id, brief.org_id, db)
    return {
        "overview": {"clicks": ov.clicks, "impressions": ov.impressions, "ctr": ov.ctr,
                     "avg_position": ov.avg_position, "clicks_change": ov.clicks_change,
                     "impressions_change": ov.impressions_change},
        "health": {"score": health.score, "grade": health.grade,
                   "components": [{"label": c.label, "score": c.score, "detail": c.detail}
                                  for c in (health.components or [])]},
        "clusters": [{"topic": c.topic, "queries": c.query_count, "clicks": c.clicks,
                      "impressions": c.impressions, "avg_position": c.avg_position} for c in m.clusters[:10]],
        "ideas": [{"query": i.query, "type": i.idea_type, "impressions": i.impressions} for i in m.ideas[:15]],
        "opportunities": [{"query": q.query, "position": q.position, "potential": q.potential_clicks}
                          for q in (o.striking_distance + o.ctr_wins)[:10]],
        "total_potential": o.total_potential_clicks,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_agents_tools.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/tools.py apps/api/tests/test_agents_tools.py
git commit -m "feat(agents): market_data tool adds overview + health for the report"
```

---

### Task 3: Repoint `generate_market_report`

**Files:**
- Modify: `apps/api/app/services/oasis_service.py` (`generate_market_report`; delete `_SYSTEM`, `_PROVIDERS`, and the manual DATA/`call_llm` block it used)
- Test: `apps/api/tests/test_standalone_oasis.py`

**Interfaces:**
- Consumes: `run_standalone` (Task 1), `oasis.MARKET_REPORT` (`app.services.agents.skills.oasis`), `Project`.
- Produces: `generate_market_report(project_id, org_id, db) -> dict` — **unchanged keys**: `{ok, title, markdown, generated_at}` on success; `{ok: False, error}` otherwise.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_standalone_oasis.py
import uuid, pytest
from unittest.mock import AsyncMock, patch
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
from app.services.agents.spec import AgentResult

_engine = create_async_engine("sqlite+aiosqlite:///:memory:")
_Session = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture
async def db():
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with _Session() as s:
        yield s
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def _org_proj(db, tier=None):
    org = Organization(slug=f"o{uuid.uuid4().hex[:6]}", name="O", agent_tier=tier); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="Acme", domain="acme.com", persona="ecommerce"); db.add(proj)
    await db.commit(); return org, proj


async def test_market_report_maps_ok_result(db):
    from app.services import oasis_service
    org, proj = await _org_proj(db)
    res = AgentResult(ok=True, summary="report", content="# Report\n\nBody")
    with patch("app.services.oasis_service.run_standalone", new=AsyncMock(return_value=res)):
        out = await oasis_service.generate_market_report(proj.id, org.id, db)
    assert out["ok"] is True and out["markdown"] == "# Report\n\nBody"
    assert out["title"] == "Acme — Market Report" and "generated_at" in out


async def test_market_report_maps_error(db):
    from app.services import oasis_service
    org, proj = await _org_proj(db)
    res = AgentResult(ok=False, error="No AI key configured.")
    with patch("app.services.oasis_service.run_standalone", new=AsyncMock(return_value=res)):
        out = await oasis_service.generate_market_report(proj.id, org.id, db)
    assert out["ok"] is False and "AI key" in out["error"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_standalone_oasis.py::test_market_report_maps_ok_result -q`
Expected: FAIL — `AttributeError: module 'app.services.oasis_service' has no attribute 'run_standalone'`.

- [ ] **Step 3: Write minimal implementation**

Replace the body of `generate_market_report` in `apps/api/app/services/oasis_service.py` (keep the `import` line for `run_standalone`, `date`, `Project`):

```python
from datetime import date
from app.models.project import Project
from app.services.agents.skills import oasis as oasis_skills
from app.services.agents.standalone import run_standalone


async def generate_market_report(project_id, org_id, db) -> dict:
    project = await db.get(Project, project_id)
    name = project.name if project else "Project"
    goal = f"Produce a client-ready market report for {name}."
    result = await run_standalone(oasis_skills.MARKET_REPORT, project_id, org_id, goal, db)
    if not result.ok:
        return {"ok": False, "error": result.error or "Could not generate the market report."}
    return {"ok": True, "title": f"{name} — Market Report",
            "markdown": str(result.content or "").strip(), "generated_at": date.today().isoformat()}
```

Delete the now-dead `_SYSTEM`, `_PROVIDERS`, and their `call_llm`/analytics imports **only if** `generate_icp` (Task 4) no longer needs them — do this cleanup at the end of Task 4.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_standalone_oasis.py -q`
Expected: PASS (report tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/oasis_service.py apps/api/tests/test_standalone_oasis.py
git commit -m "feat(agents): market report endpoint runs on oasis.MARKET_REPORT skill"
```

---

### Task 4: Repoint `generate_icp`

**Files:**
- Modify: `apps/api/app/services/oasis_service.py` (`generate_icp`; then remove all now-dead constants/imports: `_SYSTEM`, `_ICP_SYSTEM`, `_PROVIDERS`, `call_llm`, `get_health_score`/`get_overview`/etc. no longer referenced)
- Test: `apps/api/tests/test_standalone_oasis.py` (append)

**Interfaces:**
- Consumes: `run_standalone`, `oasis.DEFINE_ICP`.
- Produces: `generate_icp(project_id, org_id, db) -> dict` — **unchanged keys**: `{ok, segments}` on success (each segment: `name<=80, description<=400, pains[<=4], channels[<=3], angle<=300`); `{ok: False, error}` otherwise.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_standalone_oasis.py  (append)
async def test_icp_maps_and_sanitizes_segments(db):
    from app.services import oasis_service
    org, proj = await _org_proj(db)
    content = {"segments": [
        {"name": "Boutique DTC brands", "description": "Small ecommerce teams.",
         "pains": ["low traffic", "thin content", "", "a", "b", "c"],
         "channels": ["LinkedIn", "SEO", "x", "y"], "angle": "Rank without an agency."},
        {"name": "", "description": "no name -> dropped"},
    ]}
    res = AgentResult(ok=True, summary="icp", content=content)
    with patch("app.services.oasis_service.run_standalone", new=AsyncMock(return_value=res)):
        out = await oasis_service.generate_icp(proj.id, org.id, db)
    assert out["ok"] is True and len(out["segments"]) == 1
    seg = out["segments"][0]
    assert seg["name"] == "Boutique DTC brands"
    assert len(seg["pains"]) == 4 and len(seg["channels"]) == 3


async def test_icp_bad_content_errors(db):
    from app.services import oasis_service
    org, proj = await _org_proj(db)
    with patch("app.services.oasis_service.run_standalone",
               new=AsyncMock(return_value=AgentResult(ok=True, content={"segments": []}))):
        out = await oasis_service.generate_icp(proj.id, org.id, db)
    assert out["ok"] is False and out["error"] == "bad_format"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_standalone_oasis.py::test_icp_maps_and_sanitizes_segments -q`
Expected: FAIL — old body ignores `run_standalone` / builds its own prompt.

- [ ] **Step 3: Write minimal implementation**

Replace `generate_icp` in `apps/api/app/services/oasis_service.py`:

```python
async def generate_icp(project_id, org_id, db) -> dict:
    result = await run_standalone(oasis_skills.DEFINE_ICP, project_id, org_id,
                                  "Define the ideal client segments to target.", db)
    if not result.ok:
        return {"ok": False, "error": result.error or "provider_unreachable"}
    segments = []
    for s in (result.content or {}).get("segments", [])[:4]:
        if not isinstance(s, dict):
            continue
        nm = str(s.get("name", "")).strip()
        desc = str(s.get("description", "")).strip()
        if not nm or not desc:
            continue
        segments.append({
            "name": nm[:80], "description": desc[:400],
            "pains": [str(p).strip() for p in (s.get("pains") or []) if str(p).strip()][:4],
            "channels": [str(c).strip() for c in (s.get("channels") or []) if str(c).strip()][:3],
            "angle": str(s.get("angle", "")).strip()[:300],
        })
    if not segments:
        return {"ok": False, "error": "bad_format"}
    return {"ok": True, "segments": segments}
```

Now remove every constant/import in `oasis_service.py` no longer referenced: `_SYSTEM`, `_ICP_SYSTEM`, `_PROVIDERS`, `call_llm`, `get_org_llm_keys`, `get_overview`, `get_market_insights`, `get_opportunities`, `get_health_score`, `agent_persona`, `json`, `re` (keep `date`, `uuid`, `Project`, the two skill/standalone imports). Verify: `cd apps/api && python -c "import app.services.oasis_service"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_standalone_oasis.py -q`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/oasis_service.py apps/api/tests/test_standalone_oasis.py
git commit -m "feat(agents): ICP endpoint runs on oasis.DEFINE_ICP skill; drop dead oasis prompt code"
```

---

### Task 5: Repoint `generate_testimonial_content`

**Files:**
- Modify: `apps/api/app/services/nomad_service.py` (`generate_testimonial_content`)
- Test: `apps/api/tests/test_standalone_nomad.py`

**Interfaces:**
- Consumes: `run_standalone`, `nomad.TESTIMONIAL_CONTENT`.
- Produces: `generate_testimonial_content(project_id, org_id, testimonial, client, service, db) -> dict` — **unchanged keys**: `{ok, pieces}` (each `{format in {linkedin_post,case_study,quote_card,website_blurb}, content<=3000}`); `{ok: False, error}` otherwise. Empty-testimonial guard (`{"ok": False, "error": "empty"}`) is preserved.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_standalone_nomad.py
import uuid, pytest
from unittest.mock import AsyncMock, patch
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
from app.services.agents.spec import AgentResult

_engine = create_async_engine("sqlite+aiosqlite:///:memory:")
_Session = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture
async def db():
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with _Session() as s:
        yield s
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def _org_proj(db):
    org = Organization(slug=f"o{uuid.uuid4().hex[:6]}", name="O"); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="Acme", domain="acme.com", persona="freelancer"); db.add(proj)
    await db.commit(); return org, proj


async def test_testimonial_empty_guard(db):
    from app.services import nomad_service
    org, proj = await _org_proj(db)
    out = await nomad_service.generate_testimonial_content(proj.id, org.id, "  ", "", "", db)
    assert out == {"ok": False, "error": "empty"}


async def test_testimonial_maps_pieces(db):
    from app.services import nomad_service
    org, proj = await _org_proj(db)
    content = {"pieces": [
        {"format": "linkedin_post", "content": "A story."},
        {"format": "bogus", "content": "dropped"},
        {"format": "quote_card", "content": "Great work."},
    ]}
    with patch("app.services.nomad_service.run_standalone",
               new=AsyncMock(return_value=AgentResult(ok=True, content=content))):
        out = await nomad_service.generate_testimonial_content(proj.id, org.id, "They loved it", "Bob", "SEO", db)
    assert out["ok"] is True and [p["format"] for p in out["pieces"]] == ["linkedin_post", "quote_card"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_standalone_nomad.py::test_testimonial_maps_pieces -q`
Expected: FAIL — no `run_standalone` on `nomad_service`.

- [ ] **Step 3: Write minimal implementation**

Add imports at the top of `apps/api/app/services/nomad_service.py`:

```python
from app.services.agents.skills import nomad as nomad_skills
from app.services.agents.standalone import run_standalone

_TESTIMONIAL_FORMATS = {"linkedin_post", "case_study", "quote_card", "website_blurb"}
```

Replace `generate_testimonial_content`:

```python
async def generate_testimonial_content(project_id, org_id, testimonial, client, service, db) -> dict:
    testimonial = (testimonial or "").strip()
    if not testimonial:
        return {"ok": False, "error": "empty"}
    inputs = {"testimonial": testimonial, "client": client, "service": service}
    result = await run_standalone(nomad_skills.TESTIMONIAL_CONTENT, project_id, org_id,
                                  "Turn a client testimonial into social-proof content.", db, inputs=inputs)
    if not result.ok:
        return {"ok": False, "error": result.error or "provider_unreachable"}
    pieces = []
    for item in (result.content or {}).get("pieces", []):
        if not isinstance(item, dict):
            continue
        fmt = str(item.get("format", "")).strip()
        content = str(item.get("content", "")).strip()
        if fmt in _TESTIMONIAL_FORMATS and content:
            pieces.append({"format": fmt, "content": content[:3000]})
    if not pieces:
        return {"ok": False, "error": "bad_format"}
    return {"ok": True, "pieces": pieces}
```

Note: `nomad.TESTIMONIAL_CONTENT`'s `build_prompt` reads `inputs["testimonial"]` (Phase 1); `client`/`service` are extra context the skill ignores today — acceptable (contract preserved). Leave `_TESTIMONIAL_SYSTEM` in place until Task 6 removes shared dead code.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_standalone_nomad.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/nomad_service.py apps/api/tests/test_standalone_nomad.py
git commit -m "feat(agents): testimonial endpoint runs on nomad.TESTIMONIAL_CONTENT skill"
```

---

### Task 6: Repoint `generate_outreach_plan` (preserve draft-saving)

**Files:**
- Modify: `apps/api/app/services/nomad_service.py` (`generate_outreach_plan`; then delete dead `_SYSTEM`, `_TESTIMONIAL_SYSTEM`, `_PROVIDERS`, `call_llm`, and unused sanitizers if fully replaced)
- Test: `apps/api/tests/test_standalone_nomad.py` (append)

**Interfaces:**
- Consumes: `run_standalone`, `nomad.OUTREACH_PLAN`, `SocialPost`/`SocialPlatform`/`SocialPostType`/`SocialPostStatus` (`app.models.social`).
- Produces: `generate_outreach_plan(project_id, org_id, goal, db, audience="") -> dict` — **unchanged keys**: `{ok, posts, messages, tips, drafts_saved}`. Still saves each post as a LinkedIn draft `SocialPost`. Post shape unchanged: `{day, type in POST_TYPES, content<=3000, hashtags[<=5]}`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_standalone_nomad.py  (append)
from sqlalchemy import select
from app.models.social import SocialPost


async def test_outreach_maps_and_saves_drafts(db):
    from app.services import nomad_service
    org, proj = await _org_proj(db)
    content = {
        "posts": [{"day": "Mon", "type": "tip", "content": "Post one", "hashtags": ["#seo", "", "#x"]},
                  {"type": "story", "content": "Post two"}],
        "messages": [{"scenario": "cold", "content": "Hi there"}],
        "tips": ["be consistent", ""],
    }
    with patch("app.services.nomad_service.run_standalone",
               new=AsyncMock(return_value=AgentResult(ok=True, content=content))):
        out = await nomad_service.generate_outreach_plan(proj.id, org.id, "Win clients", db, "founders")
    assert out["ok"] is True and out["drafts_saved"] == 2 and len(out["posts"]) == 2
    assert out["posts"][0]["hashtags"] == ["#seo", "#x"]
    saved = (await db.execute(select(SocialPost).where(SocialPost.project_id == proj.id))).scalars().all()
    assert len(saved) == 2 and all(p.platform.value == "linkedin" for p in saved)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_standalone_nomad.py::test_outreach_maps_and_saves_drafts -q`
Expected: FAIL — old body builds its own prompt.

- [ ] **Step 3: Write minimal implementation**

Replace `generate_outreach_plan` in `apps/api/app/services/nomad_service.py` (keep the module's existing `_POST_TYPES`, `_sanitize_posts`, `_sanitize_messages` helpers and `SocialPost*` imports):

```python
async def generate_outreach_plan(project_id, org_id, goal, db, audience="") -> dict:
    inputs = {"audience": audience, "goal": goal}
    result = await run_standalone(nomad_skills.OUTREACH_PLAN, project_id, org_id,
                                  (goal or "Attract new clients on LinkedIn"), db, inputs=inputs)
    if not result.ok:
        return {"ok": False, "error": result.error or "Could not reach the AI provider — please try again."}
    parsed = result.content or {}
    posts = _sanitize_posts(parsed.get("posts"))
    messages = _sanitize_messages(parsed.get("messages"))
    tips = [str(t).strip() for t in parsed.get("tips", []) if str(t).strip()][:5]
    if not posts:
        return {"ok": False, "error": "The AI returned no usable posts — please try again."}
    for p in posts:
        db.add(SocialPost(org_id=org_id, project_id=project_id, platform=SocialPlatform.linkedin,
                          post_type=SocialPostType(p["type"]), status=SocialPostStatus.draft,
                          content=p["content"], hashtags=p["hashtags"], char_count=len(p["content"])))
    await db.commit()
    return {"ok": True, "posts": posts, "messages": messages, "tips": tips, "drafts_saved": len(posts)}
```

Now remove dead code in `nomad_service.py`: `_SYSTEM`, `_TESTIMONIAL_SYSTEM`, `_PROVIDERS`, and the `call_llm`/`get_org_llm_keys`/`project_profile`/`agent_persona`/`json`/`re`/`date` imports that are no longer referenced (keep `_POST_TYPES`, `_sanitize_*`, `SocialPost*`, `uuid`). Verify: `cd apps/api && python -c "import app.services.nomad_service"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_standalone_nomad.py -q`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/nomad_service.py apps/api/tests/test_standalone_nomad.py
git commit -m "feat(agents): outreach endpoint runs on nomad.OUTREACH_PLAN skill; drop dead nomad prompt code"
```

---

### Task 7: Multi-network social — enrich Sirocco skill with hooks, repoint `generate_studio`

**Files:**
- Modify: `apps/api/app/services/agents/skills/sirocco.py` (`MULTI_NETWORK_SOCIAL`: emit `hooks[]` per variant)
- Modify: `apps/api/app/services/influencer_service.py` (`generate_studio` delegates)
- Test: `apps/api/tests/test_standalone_social.py`, and `apps/api/tests/test_agents_skills.py` (append hooks assertion)

**Why:** The `/social/studio` endpoint returns `StudioResult{ok, variants[{platform, hooks[], content, hashtags, char_count, best_time}]}`. The Phase 1 `sirocco.MULTI_NETWORK_SOCIAL` skill emits `{variants:[{platform, content, hashtags}]}` — no hooks. Add `hooks` to the skill so the studio keeps its per-variant hooks; `best_time` and `char_count` are deterministic and filled by the wrapper.

**Interfaces:**
- Consumes: `run_standalone`, `sirocco.MULTI_NETWORK_SOCIAL`, `influencer_service.BEST_TIMES` (existing), `influencer_service.PLATFORM_BRIEFS` (existing, for char limits).
- Produces: `generate_studio(project_id, org_id, topic, platforms, tone, keyword, db) -> dict` — **unchanged keys**: `{ok, variants[], error}`; each variant `{platform, hooks[<=3], content, hashtags[], char_count, best_time}`.

- [ ] **Step 1: Write the failing tests**

```python
# apps/api/tests/test_agents_skills.py  (append)
def test_multi_network_social_prompt_requests_hooks():
    system, user = sirocco.MULTI_NETWORK_SOCIAL.build_prompt(_brief(), {"topic": "t", "platforms": ["linkedin"]}, {})
    assert "hooks" in system.lower()
```

```python
# apps/api/tests/test_standalone_social.py
import uuid, pytest
from unittest.mock import AsyncMock, patch
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
from app.services.agents.spec import AgentResult

_engine = create_async_engine("sqlite+aiosqlite:///:memory:")
_Session = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture
async def db():
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with _Session() as s:
        yield s
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def _org_proj(db):
    org = Organization(slug=f"o{uuid.uuid4().hex[:6]}", name="O"); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="Acme", domain="acme.com", persona="creator"); db.add(proj)
    await db.commit(); return org, proj


async def test_studio_maps_variants_with_best_time_and_char_count(db):
    from app.services import influencer_service
    org, proj = await _org_proj(db)
    content = {"variants": [
        {"platform": "linkedin", "hooks": ["h1", "h2"], "content": "A LinkedIn post", "hashtags": ["#seo"]},
        {"platform": "bogus", "content": "dropped"},
    ]}
    with patch("app.services.influencer_service.run_standalone",
               new=AsyncMock(return_value=AgentResult(ok=True, content=content))):
        out = await influencer_service.generate_studio(proj.id, org.id, "Launch", ["linkedin"], "professional", None, db)
    assert out["ok"] is True and len(out["variants"]) == 1
    v = out["variants"][0]
    assert v["platform"] == "linkedin" and v["hooks"] == ["h1", "h2"]
    assert v["char_count"] == len("A LinkedIn post") and v["best_time"] == influencer_service.BEST_TIMES["linkedin"]


async def test_studio_missing_topic_short_circuits(db):
    from app.services import influencer_service
    org, proj = await _org_proj(db)
    out = await influencer_service.generate_studio(proj.id, org.id, "  ", ["linkedin"], "professional", None, db)
    assert out == {"ok": False, "error": "missing_topic", "variants": []}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_standalone_social.py tests/test_agents_skills.py::test_multi_network_social_prompt_requests_hooks -q`
Expected: FAIL — skill has no hooks; `generate_studio` builds its own variants.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/app/services/agents/skills/sirocco.py`, update `_social_prompt` (add hooks to the schema and instruction):

```python
    system = (
        agent_persona("sirocco")
        + " Write native social posts for each requested network from ONE topic. No emoji. "
        'Return ONLY JSON: {"variants": [{"platform": str, "hooks": [up to 3 scroll-stopping opening lines], '
        '"content": str, "hashtags": [str]}]}. Tune length and voice to each network.'
    )
```

In `apps/api/app/services/influencer_service.py`, replace `generate_studio` (keep `PLATFORM_BRIEFS`, `BEST_TIMES`; the per-platform `_generate_one`/`_parse_variant` become dead once no longer referenced — remove them and the now-unused `_PROVIDERS`, `_pick`, `call_llm`, `asyncio`, regex helpers if nothing else uses them):

```python
from app.services.agents.skills import sirocco as sirocco_skills
from app.services.agents.standalone import run_standalone


async def generate_studio(project_id, org_id, topic, platforms, tone, keyword, db) -> dict:
    topic = (topic or "").strip()
    if not topic:
        return {"ok": False, "error": "missing_topic", "variants": []}
    wanted = [p for p in platforms if p in PLATFORM_BRIEFS] or ["linkedin"]
    inputs = {"topic": topic, "platforms": wanted, "tone": tone, "keyword": keyword}
    result = await run_standalone(sirocco_skills.MULTI_NETWORK_SOCIAL, project_id, org_id,
                                  f"Create social posts about: {topic}", db, inputs=inputs)
    if not result.ok:
        return {"ok": False, "error": result.error or "generation_failed", "variants": []}
    variants = []
    for v in (result.content or {}).get("variants", []):
        plat = str(v.get("platform", "")).strip()
        if plat not in PLATFORM_BRIEFS:
            continue
        content = str(v.get("content", "")).strip()[:PLATFORM_BRIEFS[plat]["limit"]]
        variants.append({
            "platform": plat,
            "hooks": [str(h).strip() for h in (v.get("hooks") or []) if str(h).strip()][:3],
            "content": content,
            "hashtags": [str(t).strip() for t in (v.get("hashtags") or []) if str(t).strip()][:10],
            "char_count": len(content),
            "best_time": BEST_TIMES.get(plat),
        })
    if not variants:
        return {"ok": False, "error": "generation_failed", "variants": []}
    return {"ok": True, "variants": variants}
```

Verify: `cd apps/api && python -c "import app.services.influencer_service"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_standalone_social.py tests/test_agents_skills.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/skills/sirocco.py apps/api/app/services/influencer_service.py apps/api/tests/test_standalone_social.py apps/api/tests/test_agents_skills.py
git commit -m "feat(agents): studio runs on sirocco.MULTI_NETWORK_SOCIAL (with hooks) skill"
```

---

### Task 8: Competitor scan — route AI insights through Sable skill

**Files:**
- Modify: `apps/api/app/services/competitor_service.py` (`analyze`: replace the inline `call_llm` insights block with `run_standalone` over `sable.COMPETITOR_SCAN`, rendered to the existing `insights` string; keep the deterministic crawl + `_scorecard`)
- Test: `apps/api/tests/test_standalone_competitor.py`

**Why:** `/analytics/competitor` returns `CompetitorAnalysis(**result)` — a fixed response model built from `analyze`'s flat dict (scorecard fields + `insights` string). Keep that contract: the crawl and scorecard stay deterministic; only the AI `insights` prose is produced via the skill. The `sable.COMPETITOR_SCAN` skill returns `{scorecard, gaps, insights}`; render `gaps` + `insights` into the single `insights` string the response expects.

**Interfaces:**
- Consumes: `run_standalone`, `sable.COMPETITOR_SCAN`.
- Produces: `analyze(project_id, org_id, url, db) -> dict` — **unchanged keys** (whatever `CompetitorAnalysis` expects), with `insights: str` now sourced from the skill. On skill failure, `insights` falls back to `""` (as today when no key/unreachable).

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_standalone_competitor.py
import uuid, pytest
from unittest.mock import AsyncMock, patch
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
from app.services.agents.spec import AgentResult

_engine = create_async_engine("sqlite+aiosqlite:///:memory:")
_Session = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture
async def db():
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with _Session() as s:
        yield s
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def _org_proj(db):
    org = Organization(slug=f"o{uuid.uuid4().hex[:6]}", name="O"); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="Acme", domain="acme.com", persona="company"); db.add(proj)
    await db.commit(); return org, proj


async def test_analyze_renders_skill_insights(db):
    from app.services import competitor_service as C
    org, proj = await _org_proj(db)
    page = {"status_code": 200, "title": "T", "meta_description": "M", "h2": ["A", "B"]}
    card = {"title": "T", "meta_description": "M", "word_count": 900, "h1_count": 1, "h2_count": 2,
            "schema_types": [], "internal_links": 3, "score": 61}
    skill_out = AgentResult(ok=True, content={"scorecard": {"score": 61},
                            "gaps": ["No FAQ schema", "Thin intro"], "insights": "They rank on brand terms only."})
    with patch.object(C, "_crawl", new=AsyncMock(return_value=page)), \
         patch.object(C, "_scorecard", return_value=card), \
         patch("app.services.competitor_service.run_standalone", new=AsyncMock(return_value=skill_out)):
        out = await C.analyze(proj.id, org.id, "https://rival.com", db)
    assert out["ok"] is True and out["score"] == 61
    assert "They rank on brand terms only." in out["insights"]
    assert "No FAQ schema" in out["insights"]  # gaps folded into the insights string


async def test_analyze_insights_empty_on_skill_failure(db):
    from app.services import competitor_service as C
    org, proj = await _org_proj(db)
    page = {"status_code": 200, "title": "T", "meta_description": "M", "h2": []}
    card = {"title": "T", "meta_description": "M", "word_count": 500, "h1_count": 1, "h2_count": 0,
            "schema_types": [], "internal_links": 1, "score": 40}
    with patch.object(C, "_crawl", new=AsyncMock(return_value=page)), \
         patch.object(C, "_scorecard", return_value=card), \
         patch("app.services.competitor_service.run_standalone",
               new=AsyncMock(return_value=AgentResult(ok=False, error="no key"))):
        out = await C.analyze(proj.id, org.id, "https://rival.com", db)
    assert out["ok"] is True and out["insights"] == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_standalone_competitor.py -q`
Expected: FAIL — `analyze` still calls `call_llm` directly; no `run_standalone` attribute.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/app/services/competitor_service.py`, add:

```python
from app.services.agents.skills import sable as sable_skills
from app.services.agents.standalone import run_standalone


def _render_insights(content: dict) -> str:
    gaps = [str(g).strip() for g in (content.get("gaps") or []) if str(g).strip()]
    prose = str(content.get("insights", "")).strip()
    parts = []
    if prose:
        parts.append(prose)
    if gaps:
        parts.append("Gaps to strike first:\n" + "\n".join(f"- {g}" for g in gaps))
    return "\n\n".join(parts)
```

Replace the AI-insights block inside `analyze` (the `keys = await get_org_llm_keys(...)` ... provider loop that sets `insights`) with:

```python
    insights = ""
    result = await run_standalone(sable_skills.COMPETITOR_SCAN, project_id, org_id,
                                  f"Scan competitor {url} and find the gaps to beat them.", db,
                                  inputs={"competitor_url": url})
    if result.ok and isinstance(result.content, dict):
        insights = _render_insights(result.content)
```

Keep everything else in `analyze` (crawl, `_scorecard`, the final return dict shape) exactly as-is; `insights` continues to feed the same return key. Remove the now-dead `_SYSTEM`, `_PROVIDERS`, `call_llm`, `get_top_queries`/`get_market_insights`/`project_locale` imports only if nothing else in the file uses them (the `sable.COMPETITOR_SCAN` skill's `crawl_competitor` + `our_demand` tools now supply that grounding). Verify: `cd apps/api && python -c "import app.services.competitor_service"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_standalone_competitor.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/competitor_service.py apps/api/tests/test_standalone_competitor.py
git commit -m "feat(agents): competitor insights run on sable.COMPETITOR_SCAN skill (contract preserved)"
```

---

### Task 9: Product copy — net-new endpoint on `dune.PRODUCT_COPY`

**Files:**
- Modify: `apps/api/app/api/v1/routers/store.py` (add `POST /store/products/{product_id}/generate-copy`)
- Test: `apps/api/tests/test_standalone_product_copy.py`

**Why:** `dune.PRODUCT_COPY` exists (Phase 1) but has no endpoint. Add the missing surface: given a synced `StoreProduct`, generate SEO title/description/meta. This is the only net-new endpoint in Phase 2.

**Interfaces:**
- Consumes: `run_standalone`, `dune.PRODUCT_COPY`, `StoreProduct` (`app.models.store_product`), auth deps `CurrentUser`, `DB` (`app.core.dependencies`).
- Produces: `POST /store/products/{product_id}/generate-copy?project_id=...` → `{ok, title, description_html, meta_description}` on success; `404` if the product is missing / not the caller's org; `{ok: False, error}` on generation failure.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_standalone_product_copy.py
import uuid, pytest
from unittest.mock import AsyncMock, patch
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.organization import Organization
from app.models.project import Project
from app.models.user import User, UserRole
from app.models.store_product import StoreProduct  # noqa: F401
from app.services.agents.spec import AgentResult

_engine = create_async_engine("sqlite+aiosqlite:///:memory:")
_Session = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)
ORG = uuid.uuid4(); PROJ = uuid.uuid4(); PROD = uuid.uuid4()
_user = User(id=uuid.uuid4(), org_id=ORG, email="t@f.ai", hashed_password="x", full_name="T", role=UserRole.OWNER, is_active=True)


@pytest.fixture(autouse=True)
async def _setup():
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with _Session() as s:
        s.add(Organization(id=ORG, slug="o", name="O"))
        s.add(Project(id=PROJ, org_id=ORG, name="P", domain="p.com"))
        s.add(StoreProduct(id=PROD, org_id=ORG, project_id=PROJ, title="Serum", price="19", description="A serum"))
        await s.commit()
    app.dependency_overrides[get_current_user] = lambda: _user
    async def _od():
        async with _Session() as s:
            yield s
    app.dependency_overrides[get_db] = _od
    yield
    app.dependency_overrides.clear()
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def test_generate_copy_maps_result():
    res = AgentResult(ok=True, content={"title": "Best Serum", "description_html": "<p>Glow</p>",
                                        "meta_description": "Buy the best serum."})
    with patch("app.api.v1.routers.store.run_standalone", new=AsyncMock(return_value=res)):
        async with await _client() as c:
            r = await c.post(f"/api/v1/store/products/{PROD}/generate-copy?project_id={PROJ}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True and body["title"] == "Best Serum" and body["description_html"] == "<p>Glow</p>"


async def test_generate_copy_404_for_unknown_product():
    with patch("app.api.v1.routers.store.run_standalone", new=AsyncMock(return_value=AgentResult(ok=True, content={}))):
        async with await _client() as c:
            r = await c.post(f"/api/v1/store/products/{uuid.uuid4()}/generate-copy?project_id={PROJ}")
    assert r.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_standalone_product_copy.py -q`
Expected: FAIL — route does not exist (404 for the mapping test / no `run_standalone` symbol).

- [ ] **Step 3: Write minimal implementation**

In `apps/api/app/api/v1/routers/store.py`, add imports and the endpoint (match the file's existing `CurrentUser`/`DB` dependency style):

```python
import uuid
from app.models.store_product import StoreProduct
from app.services.agents.skills import dune as dune_skills
from app.services.agents.standalone import run_standalone


@router.post("/products/{product_id}/generate-copy")
async def generate_product_copy(product_id: uuid.UUID, project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    product = await db.get(StoreProduct, product_id)
    if product is None or product.org_id != current_user.org_id:
        raise HTTPException(status_code=404, detail="Product not found")
    inputs = {"product": {"title": product.title, "price": product.price, "description": product.description or ""}}
    result = await run_standalone(dune_skills.PRODUCT_COPY, project_id, current_user.org_id,
                                  f"Write SEO product copy for {product.title}.", db, inputs=inputs)
    if not result.ok:
        return {"ok": False, "error": result.error or "Could not generate product copy."}
    c = result.content or {}
    return {"ok": True, "title": str(c.get("title", "")).strip(),
            "description_html": str(c.get("description_html", "")).strip(),
            "meta_description": str(c.get("meta_description", "")).strip()}
```

Confirm `HTTPException` and the `CurrentUser`/`DB` deps are already imported in `store.py`; if not, add `from fastapi import HTTPException` and `from app.core.dependencies import CurrentUser, DB`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_standalone_product_copy.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/api/v1/routers/store.py apps/api/tests/test_standalone_product_copy.py
git commit -m "feat(agents): product-copy endpoint runs on dune.PRODUCT_COPY skill"
```

---

### Task 10: Full-suite verification + golden run

**Files:** none (verification only)

- [ ] **Step 1: Import sanity across every touched module**

Run:
```bash
cd apps/api && python -c "import app.services.oasis_service, app.services.nomad_service, app.services.influencer_service, app.services.competitor_service, app.api.v1.routers.store, app.services.agents.standalone, app.services.agents.director; print('ok')"
```
Expected: `ok`.

- [ ] **Step 2: Full test suite**

Run: `cd apps/api && pytest -q`
Expected: all Phase 2 tests pass; the pre-existing failures (`test_edit_model.py::test_generated_image_has_source_image_id_column`, `test_images.py::test_delete_image`, `test_storage.py::test_upload_bytes_calls_put_object`) remain and are unrelated. No new failures.

- [ ] **Step 3: Golden run (manual, with an AI key)**

Hit each repointed surface and confirm the response shape is unchanged and the copy is on-brief:
- `POST /api/v1/analytics/market-report?project_id=…` → `{ok, title, markdown, generated_at}`
- `POST /api/v1/analytics/icp?project_id=…` → `{ok, segments[]}`
- `POST /api/v1/social/outreach-plan?project_id=…` → `{ok, posts, messages, tips, drafts_saved}` + drafts appear in Social
- `POST /api/v1/social/testimonial-content?project_id=…` → `{ok, pieces[]}`
- `POST /api/v1/social/studio` → `{ok, variants[]}` with hooks + best_time
- `POST /api/v1/analytics/competitor?project_id=…` → same `CompetitorAnalysis` shape, insights present
- `POST /api/v1/store/products/{id}/generate-copy?project_id=…` → `{ok, title, description_html, meta_description}`

Note results in the PR description.

- [ ] **Step 4: Commit (if any doc/notes changes)**

```bash
git add -A
git commit -m "chore(agents): Phase 2 verification notes" --allow-empty
```

---

## Self-Review

**Spec coverage (Phase 2 line: "Repoint product-copy, ICP, testimonials, outreach, multi-network social, competitor scan, and article generation"):**
- product-copy → Task 9 (net-new endpoint; no prior surface existed). ✅
- ICP → Task 4. ✅
- testimonials → Task 5. ✅
- outreach → Task 6 (draft-saving preserved). ✅
- multi-network social → Task 7 (studio; skill enriched with hooks). ✅
- competitor scan → Task 8 (contract preserved; insights via skill). ✅
- market report → Tasks 2-3 (adjacent Oasis surface; grounding parity via tool enrichment). ✅
- **article generation** — the spec lists it, but Phase 1 Task 7 already built `dune.write_article` and the campaign path uses it. The standalone async article endpoint (`article_tasks.generate_article_task`) is a large, separately-shippable migration (its own prompt/scoring/persistence pipeline). **Deferred to a Phase 2b plan** to keep this plan's tasks uniform and low-risk; noted here so it is not lost.
- Foundation seam (`run_standalone`) → Task 1. ✅

**Placeholder scan:** No "TBD/handle edge cases/similar to Task N". Each service edit shows full replacement code; each test is concrete. Cleanup steps name the exact symbols to remove and give an import-sanity command.

**Type consistency:** `run_standalone(skill, project_id, org_id, goal, db, inputs=None, persona=None) -> AgentResult` is used identically in Tasks 3-9. Every repointed function keeps its Phase-1/pre-existing signature and return keys (asserted in tests). `AgentResult.content` is the parsed skill output (dict for json skills, str for markdown), consistent with Phase 1 `runner._parse`.

**Risk notes:** Tasks 3/4/6/7/8 delete dead prompt constants — the import-sanity command in each Step 3 catches an over-deletion before commit. Only Task 9 adds a route; all others preserve response contracts, so no frontend change is required in Phase 2.
```
