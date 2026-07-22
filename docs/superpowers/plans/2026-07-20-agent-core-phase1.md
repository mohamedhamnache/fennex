# Specialized Agent Core — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable agent core (`app/services/agents/`) — declarative Skill specs + a generic AgentRunner + a Brief with per-agent tools + a plan/review/retry director — and migrate the campaign orchestration onto it, so agents are specialized, grounded, and build on each other.

**Architecture:** A `Brief` (common grounding, built once) is passed to every `Skill` (agent+capability). Each Skill has a first-class `build_prompt` and declares `tools` (specialist data). `AgentRunner.run` executes any Skill uniformly (resolve model tier → run tools → build prompt → call LLM → parse+repair → persist). The `director` plans a sequence of Skills, then reviews each artifact and retries weak ones before continuing. The existing `Campaign`/`CampaignStep` DB models and `/campaigns` UI are unchanged.

**Tech Stack:** Python 3.11 async, SQLAlchemy 2 (asyncpg), Alembic, arq worker, Anthropic/OpenAI via `app.services.llm_service.call_llm`, pytest (`asyncio_mode = "auto"`, `testpaths = ["tests"]`).

## Global Constraints

- Package location: `apps/api/app/services/agents/` — one responsibility per file.
- Tests live in `apps/api/tests/`, run with `pytest` from `apps/api` (or `docker compose exec -T api pytest -q`). `asyncio_mode = "auto"` — async tests need no decorator.
- LLM calls go through `call_llm(provider, model, api_key, system_prompt, user_prompt, locale="en", max_tokens=DEFAULT_MAX_TOKENS) -> str` (`app.services.llm_service`). Never call SDKs directly.
- Keys/locale via `get_org_llm_keys(org_id, db) -> dict[provider,key]` and `project_locale(project_id, db) -> str` (`app.services.llm_service`).
- Agent persona text via `agent_persona(agent_id: str) -> str` (`app.agents.registry`).
- Model IDs — cheap: `("anthropic","claude-haiku-4-5-20251001")`, `("openai","gpt-4o-mini")`; premium: `("anthropic","claude-opus-4-8")`, `("openai","gpt-4o")`.
- No new agents; sharpen the existing seven (zerda, sirocco, dune, mirage, sable, oasis, nomad).
- Reviews ride in `CampaignStep.structured` (JSON) — **no schema change** to campaign tables. The only migration in Phase 1 is `organizations.agent_tier`.
- Every generative prompt must include: the goal, brand voice/kit when present, the dedup list (existing content), and — on a retry — the reviewer feedback.

---

## File Structure

```
apps/api/app/services/agents/
  __init__.py        # re-exports Skill, AgentResult, Brief, build_brief, AgentRunner, run_campaign
  tiers.py           # resolve_model(tier, weight, available) -> (provider, model)
  spec.py            # Skill, AgentResult dataclasses
  brief.py           # Brief dataclass + build_brief(project_id, org_id, goal, persona, db)
  tools.py           # TOOLS registry + tool fns (gsc_opportunities, market_insights, ...)
  runner.py          # AgentRunner.run(skill, brief, inputs, tier, db)
  reviewer.py        # review(brief, skill, result, tier, keys, db) -> ReviewResult
  registry.py        # SKILLS: dict[str, Skill]; get_skill(key)
  director.py        # plan(brief, tier, keys, db) + run_campaign(campaign, db)
  skills/
    __init__.py
    zerda.py         # pick_angle, keyword_targets
    dune.py          # write_article, product_copy
    sirocco.py       # multi_network_social, generate_visual
    oasis.py         # market_report, define_icp
    sable.py         # competitor_scan
    mirage.py        # product_shot
    nomad.py         # outreach_plan, testimonial_content
apps/api/tests/
  test_agents_tiers.py
  test_agents_brief.py
  test_agents_tools.py
  test_agents_runner.py
  test_agents_skills.py
  test_agents_reviewer.py
  test_agents_director.py
apps/api/alembic/versions/<rev>_org_agent_tier.py
```

---

### Task 1: Model tier resolver

**Files:**
- Create: `apps/api/app/services/agents/__init__.py` (empty for now)
- Create: `apps/api/app/services/agents/tiers.py`
- Test: `apps/api/tests/test_agents_tiers.py`

**Interfaces:**
- Produces: `resolve_model(tier: str, weight: str, available: list[str]) -> tuple[str, str]` — returns `(provider, model)`. `tier ∈ {"economy","balanced","max"}`, `weight ∈ {"light","heavy"}`, `available` = provider names the org has keys for (e.g. `["anthropic"]`). Raises `ValueError` if `available` is empty.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_tiers.py
import pytest
from app.services.agents.tiers import resolve_model

def test_balanced_light_is_cheap_heavy_is_premium():
    assert resolve_model("balanced", "light", ["anthropic"]) == ("anthropic", "claude-haiku-4-5-20251001")
    assert resolve_model("balanced", "heavy", ["anthropic"]) == ("anthropic", "claude-opus-4-8")

def test_economy_is_cheap_for_both_weights():
    assert resolve_model("economy", "heavy", ["openai"]) == ("openai", "gpt-4o-mini")

def test_max_is_premium_for_both_weights():
    assert resolve_model("max", "light", ["openai"]) == ("openai", "gpt-4o")

def test_prefers_anthropic_when_both_available():
    assert resolve_model("balanced", "heavy", ["openai", "anthropic"])[0] == "anthropic"

def test_falls_back_to_available_provider():
    assert resolve_model("balanced", "heavy", ["openai"]) == ("openai", "gpt-4o")

def test_unknown_tier_defaults_to_balanced():
    assert resolve_model("bogus", "heavy", ["anthropic"]) == ("anthropic", "claude-opus-4-8")

def test_no_providers_raises():
    with pytest.raises(ValueError):
        resolve_model("balanced", "light", [])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_tiers.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.agents.tiers'`.

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/app/services/agents/tiers.py
"""Resolve (provider, model) from the org's agent tier and a skill's weight."""

# provider preference order when an org has multiple keys
_ORDER = ["anthropic", "openai"]

# tier -> weight -> (anthropic_model, openai_model)
_MODELS = {
    "cheap":   {"anthropic": "claude-haiku-4-5-20251001", "openai": "gpt-4o-mini"},
    "premium": {"anthropic": "claude-opus-4-8",           "openai": "gpt-4o"},
}
# tier -> {weight -> "cheap"|"premium"}
_TIERS = {
    "economy":  {"light": "cheap",   "heavy": "cheap"},
    "balanced": {"light": "cheap",   "heavy": "premium"},
    "max":      {"light": "premium", "heavy": "premium"},
}


def resolve_model(tier: str, weight: str, available: list[str]) -> tuple[str, str]:
    if not available:
        raise ValueError("No LLM provider keys available.")
    grade = _TIERS.get(tier, _TIERS["balanced"]).get(weight, "premium")
    provider = next((p for p in _ORDER if p in available), available[0])
    return provider, _MODELS[grade][provider]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_agents_tiers.py -q`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/__init__.py apps/api/app/services/agents/tiers.py apps/api/tests/test_agents_tiers.py
git commit -m "feat(agents): model tier resolver"
```

---

### Task 2: Core dataclasses (Skill, AgentResult, Brief)

**Files:**
- Create: `apps/api/app/services/agents/spec.py`
- Create: `apps/api/app/services/agents/brief.py` (Brief dataclass only; `build_brief` is Task 3)
- Test: `apps/api/tests/test_agents_brief.py` (construction defaults)

**Interfaces:**
- Produces:
  - `AgentResult(ok: bool, summary: str = "", content: Any = None, artifact_type: str | None = None, artifact_ids: list[str] = [], structured: dict = {}, error: str | None = None)`
  - `Skill(key, agent_id, weight, tools, build_prompt, output, parse=None, label="", description="", persist=None)` where `build_prompt: Callable[[Brief, dict, dict], tuple[str, str]]`, `output ∈ {"json","markdown","text"}`, `parse: Callable[[str], Any] | None`, `persist: Callable | None`.
  - `Brief(goal, persona, project_id, org_id, locale, project_profile, brand, existing_content, artifacts)` with `brand: dict`, `existing_content: list[str]`, `artifacts: list[dict]` (default empty), plus method `Brief.add_artifact(result: AgentResult, agent_id: str, skill_key: str) -> None`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_brief.py
import uuid
from app.services.agents.spec import AgentResult, Skill
from app.services.agents.brief import Brief

def _brief():
    return Brief(goal="g", persona="creator", project_id=uuid.uuid4(), org_id=uuid.uuid4(),
                 locale="en", project_profile="", brand={}, existing_content=[], artifacts=[])

def test_agentresult_defaults():
    r = AgentResult(ok=True)
    assert r.summary == "" and r.artifact_ids == [] and r.structured == {} and r.error is None

def test_add_artifact_appends_compact_handoff():
    b = _brief()
    b.add_artifact(AgentResult(ok=True, summary="Article: X targeting kw", artifact_type="article",
                               artifact_ids=["a1"]), agent_id="dune", skill_key="dune.write_article")
    assert len(b.artifacts) == 1
    a = b.artifacts[0]
    assert a["agent"] == "dune" and a["skill"] == "dune.write_article"
    assert a["summary"] == "Article: X targeting kw" and a["artifact_ids"] == ["a1"]

def test_skill_is_constructible():
    s = Skill(key="x.y", agent_id="zerda", weight="light", tools=[],
              build_prompt=lambda brief, inputs, td: ("sys", "usr"), output="json")
    assert s.key == "x.y" and s.parse is None and s.persist is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_brief.py -q`
Expected: FAIL — `ModuleNotFoundError: app.services.agents.spec`.

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/app/services/agents/spec.py
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.agents.brief import Brief


@dataclass
class AgentResult:
    ok: bool
    summary: str = ""
    content: Any = None
    artifact_type: Optional[str] = None
    artifact_ids: list[str] = field(default_factory=list)
    structured: dict = field(default_factory=dict)
    error: Optional[str] = None


@dataclass
class Skill:
    key: str
    agent_id: str
    weight: str                                   # "light" | "heavy"
    tools: list[str]
    build_prompt: Callable[["Brief", dict, dict], tuple[str, str]]
    output: str                                   # "json" | "markdown" | "text"
    parse: Optional[Callable[[str], Any]] = None
    label: str = ""
    description: str = ""
    # persist(result_content, campaign, brief, db) -> AgentResult   (optional artifact saver)
    persist: Optional[Callable[..., Awaitable["AgentResult"]]] = None
```

```python
# apps/api/app/services/agents/brief.py
import uuid
from dataclasses import dataclass, field

from app.services.agents.spec import AgentResult


@dataclass
class Brief:
    goal: str
    persona: str
    project_id: uuid.UUID
    org_id: uuid.UUID
    locale: str
    project_profile: str
    brand: dict
    existing_content: list[str]
    artifacts: list[dict] = field(default_factory=list)

    def add_artifact(self, result: AgentResult, agent_id: str, skill_key: str) -> None:
        self.artifacts.append({
            "agent": agent_id,
            "skill": skill_key,
            "summary": result.summary,
            "artifact_type": result.artifact_type,
            "artifact_ids": result.artifact_ids,
            "structured": result.structured,
        })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_agents_brief.py -q`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/spec.py apps/api/app/services/agents/brief.py apps/api/tests/test_agents_brief.py
git commit -m "feat(agents): Skill/AgentResult/Brief dataclasses"
```

---

### Task 3: build_brief (assemble grounding once)

**Files:**
- Modify: `apps/api/app/services/agents/brief.py` (add `build_brief`)
- Test: `apps/api/tests/test_agents_brief.py` (add DB-backed test)

**Interfaces:**
- Consumes: `Brief` (Task 2); `project_profile(project_id, db)` (`app.services.ai_analytics_service`); models `BrandVoice` (`org_id, tone, voice_prompt, vocabulary, avoid_words, is_default`), `BrandKit` (`org_id, colors, primary_font, style_rules, tone`), `Article` (`org_id, project_id, title, created_at`); `project_locale(project_id, db)` (`app.services.llm_service`).
- Produces: `async build_brief(project_id: uuid.UUID, org_id: uuid.UUID, goal: str, persona: str, db) -> Brief`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_brief.py  (append)
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
from app.models.article import Article, ArticleStatus
from app.services.agents.brief import build_brief

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

async def test_build_brief_collects_titles_and_goal(db):
    org = Organization(slug="o", name="O"); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="P", domain="p.com", locale="fr"); db.add(proj); await db.flush()
    db.add(Article(org_id=org.id, project_id=proj.id, title="Old Post", status=ArticleStatus.ready))
    await db.commit()
    brief = await build_brief(proj.id, org.id, goal="Launch serum", persona="ecommerce", db=db)
    assert brief.goal == "Launch serum" and brief.persona == "ecommerce"
    assert brief.locale == "fr"
    assert "Old Post" in brief.existing_content
    assert isinstance(brief.brand, dict) and brief.artifacts == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_brief.py::test_build_brief_collects_titles_and_goal -q`
Expected: FAIL — `ImportError: cannot import name 'build_brief'`.

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/app/services/agents/brief.py  (append)
from sqlalchemy import select
from app.models.article import Article
from app.models.brand_voice import BrandVoice
from app.models.brand_kit import BrandKit
from app.services.ai_analytics_service import project_profile
from app.services.llm_service import project_locale


async def build_brief(project_id, org_id, goal: str, persona: str, db) -> Brief:
    profile = ""
    try:
        profile = await project_profile(project_id, db)
    except Exception:
        profile = ""
    locale = "en"
    try:
        locale = await project_locale(project_id, db)
    except Exception:
        locale = "en"

    voice = (await db.execute(
        select(BrandVoice).where(BrandVoice.org_id == org_id).order_by(BrandVoice.is_default.desc())
    )).scalars().first()
    kit = (await db.execute(select(BrandKit).where(BrandKit.org_id == org_id))).scalars().first()
    brand: dict = {}
    if voice:
        tone = voice.tone.value if hasattr(voice.tone, "value") else voice.tone
        brand.update({"voice_prompt": voice.voice_prompt, "tone": tone,
                      "vocabulary": voice.vocabulary or [], "avoid_words": voice.avoid_words or []})
    if kit:
        brand["kit"] = {"colors": kit.colors or [], "primary_font": kit.primary_font,
                        "style_rules": kit.style_rules, "tone": kit.tone}

    titles = (await db.execute(
        select(Article.title).where(Article.project_id == project_id, Article.org_id == org_id)
        .order_by(Article.created_at.desc()).limit(20)
    )).scalars().all()

    return Brief(goal=goal, persona=persona, project_id=project_id, org_id=org_id, locale=locale,
                 project_profile=profile, brand=brand, existing_content=[t for t in titles if t],
                 artifacts=[])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_agents_brief.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/brief.py apps/api/tests/test_agents_brief.py
git commit -m "feat(agents): build_brief assembles grounding once"
```

---

### Task 4: Tool registry

**Files:**
- Create: `apps/api/app/services/agents/tools.py`
- Test: `apps/api/tests/test_agents_tools.py`

**Interfaces:**
- Consumes: `Brief` (Task 2); existing services `get_opportunities`, `get_market_insights` (`app.services.analytics_service`, each `(project_id, org_id, db)`), `analyze` (`app.services.competitor_service`, `(project_id, org_id, url, db)`), `list_products`/`get_connection` (`app.services.shopify_service`), `list_tracked_keywords` if present.
- Produces: `TOOLS: dict[str, Callable]`; `async run_tools(names: list[str], brief: Brief, db, inputs: dict) -> dict` returning `{name: {"ok": bool, "data": Any}}`. Each tool: `async fn(brief, db, inputs) -> dict` (returns the `data` payload; `run_tools` wraps in `{ok,data}` and swallows exceptions to `{ok:False}`).

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_tools.py
import uuid, pytest
from unittest.mock import AsyncMock, patch
from app.services.agents.brief import Brief
from app.services.agents.tools import TOOLS, run_tools

def _brief():
    return Brief(goal="g", persona="creator", project_id=uuid.uuid4(), org_id=uuid.uuid4(),
                 locale="en", project_profile="", brand={}, existing_content=[], artifacts=[])

def test_registry_has_expected_tools():
    for name in ["gsc_opportunities", "market_insights", "tracked_keywords", "crawl_competitor",
                 "store_products", "our_demand", "market_data"]:
        assert name in TOOLS

async def test_run_tools_wraps_ok_and_swallows_errors():
    async def boom(brief, db, inputs): raise RuntimeError("x")
    async def good(brief, db, inputs): return {"v": 1}
    with patch.dict(TOOLS, {"boom": boom, "good": good}, clear=False):
        out = await run_tools(["good", "boom"], _brief(), db=None, inputs={})
    assert out["good"] == {"ok": True, "data": {"v": 1}}
    assert out["boom"]["ok"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_tools.py -q`
Expected: FAIL — `ModuleNotFoundError: app.services.agents.tools`.

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/app/services/agents/tools.py
"""Specialist-data tools. Each: async (brief, db, inputs) -> data payload."""
from app.services.analytics_service import get_opportunities, get_market_insights
from app.services.competitor_service import analyze as _analyze


async def gsc_opportunities(brief, db, inputs):
    o = await get_opportunities(brief.project_id, brief.org_id, db)
    top = (o.striking_distance + o.ctr_wins)[:12]
    return {"queries": [{"query": q.query, "position": q.position, "potential": q.potential_clicks} for q in top]}


async def market_insights(brief, db, inputs):
    m = await get_market_insights(brief.project_id, brief.org_id, db)
    return {"clusters": [{"topic": c.topic, "query_count": c.query_count} for c in m.clusters[:8]],
            "ideas": [{"query": i.query, "type": i.idea_type, "impressions": i.impressions} for i in m.ideas[:12]]}


async def market_data(brief, db, inputs):
    # richer bundle for the market report; reuse insights + opportunities
    m = await get_market_insights(brief.project_id, brief.org_id, db)
    o = await get_opportunities(brief.project_id, brief.org_id, db)
    return {
        "clusters": [{"topic": c.topic, "queries": c.query_count, "clicks": c.clicks,
                      "impressions": c.impressions, "avg_position": c.avg_position} for c in m.clusters[:10]],
        "ideas": [{"query": i.query, "type": i.idea_type, "impressions": i.impressions} for i in m.ideas[:15]],
        "opportunities": [{"query": q.query, "position": q.position, "potential": q.potential_clicks}
                          for q in (o.striking_distance + o.ctr_wins)[:10]],
        "total_potential": o.total_potential_clicks,
    }


async def tracked_keywords(brief, db, inputs):
    try:
        from app.services.seo_hub_service import list_tracked_keywords  # optional
        rows = await list_tracked_keywords(brief.project_id, db)
        return {"keywords": [getattr(r, "keyword", str(r)) for r in rows][:20]}
    except Exception:
        return {"keywords": []}


async def crawl_competitor(brief, db, inputs):
    url = str((inputs or {}).get("competitor_url") or "").strip()
    if not url:
        return {"skipped": True}
    return {"analysis": await _analyze(brief.project_id, brief.org_id, url, db)}


async def our_demand(brief, db, inputs):
    m = await get_market_insights(brief.project_id, brief.org_id, db)
    return {"clusters": [c.topic for c in m.clusters[:10]]}


async def store_products(brief, db, inputs):
    from app.services import shopify_service
    try:
        rows = await shopify_service.list_products(brief.project_id, brief.org_id, db)
        return {"products": [{"id": str(p.id), "title": p.title, "price": p.price} for p in rows][:50]}
    except Exception:
        return {"products": []}


TOOLS = {
    "gsc_opportunities": gsc_opportunities,
    "market_insights": market_insights,
    "market_data": market_data,
    "tracked_keywords": tracked_keywords,
    "crawl_competitor": crawl_competitor,
    "our_demand": our_demand,
    "store_products": store_products,
}


async def run_tools(names, brief, db, inputs) -> dict:
    out = {}
    for name in names or []:
        fn = TOOLS.get(name)
        if fn is None:
            out[name] = {"ok": False, "data": None}
            continue
        try:
            out[name] = {"ok": True, "data": await fn(brief, db, inputs)}
        except Exception:
            out[name] = {"ok": False, "data": None}
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_agents_tools.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/tools.py apps/api/tests/test_agents_tools.py
git commit -m "feat(agents): tool registry for specialist grounding"
```

---

### Task 5: AgentRunner

**Files:**
- Create: `apps/api/app/services/agents/runner.py`
- Test: `apps/api/tests/test_agents_runner.py`

**Interfaces:**
- Consumes: `Skill`, `AgentResult`, `Brief` (Tasks 2), `run_tools` (Task 4), `resolve_model` (Task 1), `call_llm` + `get_org_llm_keys` (`app.services.llm_service`).
- Produces: `async AgentRunner.run(skill: Skill, brief: Brief, inputs: dict, tier: str, db, keys: dict | None = None, campaign=None) -> AgentResult`. Behaviour: resolve model from `keys` providers; run tools; `system, user = skill.build_prompt(brief, inputs, tool_data)`; `call_llm`; parse per `skill.output` with one repair-retry on `json`; if `skill.persist` call it; else set `content`. On any exception return `AgentResult(ok=False, error=...)`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_runner.py
import uuid, json, pytest
from unittest.mock import AsyncMock, patch
from app.services.agents.brief import Brief
from app.services.agents.spec import Skill, AgentResult
from app.services.agents.runner import AgentRunner

def _brief():
    return Brief(goal="g", persona="creator", project_id=uuid.uuid4(), org_id=uuid.uuid4(),
                 locale="en", project_profile="", brand={}, existing_content=[], artifacts=[])

def _json_skill():
    return Skill(key="zerda.pick_angle", agent_id="zerda", weight="light", tools=[],
                 build_prompt=lambda b, i, td: ("SYS", "USR"), output="json",
                 parse=lambda raw: json.loads(raw))

async def test_run_parses_json_and_builds_summary():
    with patch("app.services.agents.runner.call_llm", new=AsyncMock(return_value='{"topic":"T","keyword":"k"}')):
        r = await AgentRunner.run(_json_skill(), _brief(), inputs={}, tier="balanced",
                                  db=None, keys={"anthropic": "x"})
    assert r.ok and r.content == {"topic": "T", "keyword": "k"}

async def test_run_repairs_malformed_json_once():
    calls = AsyncMock(side_effect=["not json", '{"topic":"T2"}'])
    with patch("app.services.agents.runner.call_llm", new=calls):
        r = await AgentRunner.run(_json_skill(), _brief(), inputs={}, tier="balanced",
                                  db=None, keys={"openai": "x"})
    assert r.ok and r.content == {"topic": "T2"} and calls.call_count == 2

async def test_run_returns_error_when_no_keys():
    r = await AgentRunner.run(_json_skill(), _brief(), inputs={}, tier="balanced", db=None, keys={})
    assert r.ok is False and r.error
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_runner.py -q`
Expected: FAIL — `ModuleNotFoundError: app.services.agents.runner`.

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/app/services/agents/runner.py
import logging
from app.services.agents.spec import AgentResult
from app.services.agents.tiers import resolve_model
from app.services.agents.tools import run_tools
from app.services.llm_service import call_llm, get_org_llm_keys

logger = logging.getLogger(__name__)


class AgentRunner:
    @staticmethod
    async def run(skill, brief, inputs, tier, db, keys=None, campaign=None) -> AgentResult:
        if keys is None:
            keys = await get_org_llm_keys(brief.org_id, db)
        available = list(keys.keys())
        if not available:
            return AgentResult(ok=False, error="No AI key configured. Add an Anthropic or OpenAI key in Settings.")
        try:
            provider, model = resolve_model(tier, skill.weight, available)
            tool_data = await run_tools(skill.tools, brief, db, inputs)
            system, user = skill.build_prompt(brief, inputs or {}, tool_data)
            raw = await call_llm(provider, model, keys[provider], system, user, locale=brief.locale)
            content = _parse(skill, raw)
            if content is None and skill.output == "json":
                raw2 = await call_llm(provider, model, keys[provider], system,
                                      user + "\n\nReturn ONLY valid JSON. No prose, no code fences.",
                                      locale=brief.locale)
                content = _parse(skill, raw2)
            if content is None:
                return AgentResult(ok=False, error="Agent returned an unusable format.")
            if skill.persist:
                return await skill.persist(content, campaign, brief, db)
            return AgentResult(ok=True, summary=str(content)[:200], content=content)
        except Exception as exc:  # noqa: BLE001
            logger.exception("agent skill failed: %s", skill.key)
            return AgentResult(ok=False, error=str(exc))


def _parse(skill, raw: str):
    if skill.parse is None:
        return raw
    try:
        return skill.parse(raw)
    except Exception:
        return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_agents_runner.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/runner.py apps/api/tests/test_agents_runner.py
git commit -m "feat(agents): AgentRunner with tools, tiering, parse+repair"
```

---

### Task 6: Shared prompt helpers + Zerda skills

**Files:**
- Create: `apps/api/app/services/agents/skills/__init__.py`
- Create: `apps/api/app/services/agents/skills/_common.py` (shared prompt fragments + json parser)
- Create: `apps/api/app/services/agents/skills/zerda.py`
- Test: `apps/api/tests/test_agents_skills.py`

**Interfaces:**
- Consumes: `Skill` (Task 2), `agent_persona` (`app.agents.registry`), `Brief`.
- Produces:
  - `_common.brief_block(brief) -> str` (goal + profile + brand + dedup list, rendered), `_common.feedback_block(inputs) -> str` (renders `inputs["feedback"]` as a "FIX THIS" block or ""), `_common.parse_json(raw) -> Any` (strips fences, `json.loads`).
  - `zerda.PICK_ANGLE: Skill` (key `"zerda.pick_angle"`), `zerda.KEYWORD_TARGETS: Skill` (key `"zerda.keyword_targets"`).

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_skills.py
import uuid, json
from app.services.agents.brief import Brief
from app.services.agents.skills import zerda
from app.services.agents.skills._common import brief_block, feedback_block, parse_json

def _brief(existing=None):
    return Brief(goal="Rank for vegan protein", persona="creator", project_id=uuid.uuid4(),
                 org_id=uuid.uuid4(), locale="en", project_profile="A vegan nutrition blog",
                 brand={"tone": "friendly", "avoid_words": ["cheap"]},
                 existing_content=existing or ["Best vegan protein powders"], artifacts=[])

def test_brief_block_includes_goal_and_dedup():
    txt = brief_block(_brief())
    assert "Rank for vegan protein" in txt and "Best vegan protein powders" in txt and "friendly" in txt

def test_feedback_block_present_only_when_feedback():
    assert feedback_block({}) == ""
    assert "FIX THIS" in feedback_block({"feedback": "too generic"})

def test_pick_angle_prompt_is_goal_first_and_dedup_aware():
    td = {"gsc_opportunities": {"ok": True, "data": {"queries": [{"query": "vegan protein for runners",
          "position": 8.1, "potential": 40}]}}, "market_insights": {"ok": True, "data": {"clusters": [], "ideas": []}}}
    system, user = zerda.PICK_ANGLE.build_prompt(_brief(), {}, td)
    assert "Rank for vegan protein" in user
    assert "Best vegan protein powders" in user            # dedup list present
    assert "vegan protein for runners" in user             # opportunity keyword present
    assert zerda.PICK_ANGLE.output == "json"

def test_pick_angle_parses_json_with_fences():
    assert parse_json('```json\n{"topic":"X"}\n```') == {"topic": "X"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_skills.py -q`
Expected: FAIL — `ModuleNotFoundError: app.services.agents.skills`.

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/app/services/agents/skills/__init__.py
# (namespace package for skill modules)
```

```python
# apps/api/app/services/agents/skills/_common.py
import json
import re


def parse_json(raw: str):
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    return json.loads(cleaned)


def brief_block(brief) -> str:
    parts = [f"GOAL: {brief.goal}", f"PERSONA: {brief.persona}"]
    if brief.project_profile:
        parts.append(f"CLIENT PROFILE: {brief.project_profile}")
    b = brief.brand or {}
    if b.get("tone"):
        parts.append(f"BRAND TONE: {b['tone']}")
    if b.get("voice_prompt"):
        parts.append(f"BRAND VOICE: {b['voice_prompt']}")
    if b.get("avoid_words"):
        parts.append(f"AVOID WORDS: {', '.join(b['avoid_words'])}")
    if brief.existing_content:
        parts.append("EXISTING CONTENT (choose an angle clearly different from every one):\n"
                     + "\n".join(f"- {t}" for t in brief.existing_content))
    if brief.artifacts:
        parts.append("ALREADY PRODUCED THIS CAMPAIGN:\n"
                     + "\n".join(f"- {a['summary']}" for a in brief.artifacts if a.get("summary")))
    return "\n".join(parts)


def feedback_block(inputs) -> str:
    fb = (inputs or {}).get("feedback")
    return f"\n\nPREVIOUS ATTEMPT — FIX THIS:\n{fb}\n" if fb else ""
```

```python
# apps/api/app/services/agents/skills/zerda.py
from app.agents.registry import agent_persona
from app.services.agents.spec import Skill
from app.services.agents.skills._common import brief_block, feedback_block, parse_json


def _pick_angle_prompt(brief, inputs, td):
    opp = (td.get("gsc_opportunities") or {}).get("data") or {}
    lines = [f'- "{q["query"]}" pos {q.get("position")}, +{q.get("potential")} potential'
             for q in opp.get("queries", [])]
    system = (
        agent_persona("zerda")
        + " Scope ONE content piece for THIS campaign.\n"
        "1. The GOAL defines the subject — derive a specific, opinionated ANGLE (a question, use-case, "
        "comparison or audience cut), not a restatement of the goal.\n"
        "2. Use OPPORTUNITY KEYWORDS only as supporting targets when one genuinely fits.\n"
        "3. Do NOT repeat or lightly reword any EXISTING CONTENT — pick a clearly different angle.\n"
        'Respond with ONLY JSON: {"topic": specific angle/title, "keyword": target keyword, '
        '"intent": informational|commercial|transactional|navigational, '
        '"rationale": one sentence on why it wins and how it differs}.'
    )
    user = (brief_block(brief) + "\n\nOPPORTUNITY KEYWORDS:\n" + ("\n".join(lines) or "- (none yet)")
            + feedback_block(inputs))
    return system, user


PICK_ANGLE = Skill(
    key="zerda.pick_angle", agent_id="zerda", weight="light",
    tools=["gsc_opportunities", "market_insights"], build_prompt=_pick_angle_prompt,
    output="json", parse=parse_json, label="Pick the angle",
    description="Choose one specific, fresh content angle from the goal + real demand.",
)


def _keyword_targets_prompt(brief, inputs, td):
    tracked = (td.get("tracked_keywords") or {}).get("data", {}).get("keywords", [])
    opp = (td.get("gsc_opportunities") or {}).get("data", {}).get("queries", [])
    angle = (inputs or {}).get("angle") or brief.goal
    system = (
        agent_persona("zerda")
        + ' For the ANGLE, choose one primary keyword and 3-6 supporting keywords from real demand. '
        'Respond with ONLY JSON: {"primary": str, "secondary": [str, ...]}.'
    )
    user = (f"ANGLE: {angle}\n" + brief_block(brief)
            + f"\nTRACKED KEYWORDS: {', '.join(tracked) or 'none'}\n"
            + "OPPORTUNITIES: " + ", ".join(q["query"] for q in opp) + feedback_block(inputs))
    return system, user


KEYWORD_TARGETS = Skill(
    key="zerda.keyword_targets", agent_id="zerda", weight="light",
    tools=["tracked_keywords", "gsc_opportunities"], build_prompt=_keyword_targets_prompt,
    output="json", parse=parse_json, label="Keyword targets",
    description="Primary + supporting keywords for the chosen angle.",
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_agents_skills.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/skills/ apps/api/tests/test_agents_skills.py
git commit -m "feat(agents): shared prompt helpers + Zerda skills"
```

---

### Task 7: Dune skills (write_article, product_copy) with artifact persistence

**Files:**
- Create: `apps/api/app/services/agents/skills/dune.py`
- Test: `apps/api/tests/test_agents_skills.py` (append)

**Interfaces:**
- Consumes: `_common` (Task 6); `_build_system_prompt`, `_build_user_prompt`, `_parse_llm_response` (`app.workers.tasks.article_tasks`); `compute_seo_score`, `_markdown_to_html` (`app.services.article_service`); models `Article`, `ArticleStatus`; `StoreProduct` (`app.models.store_product`); `AgentResult`.
- Produces: `dune.WRITE_ARTICLE: Skill` (output `"markdown"`, has `persist` that creates an `Article` and returns `AgentResult(artifact_type="article")`); `dune.PRODUCT_COPY: Skill` (output `"json"`).

Notes: `WRITE_ARTICLE.build_prompt` reuses the strong article prompt and appends the campaign/angle context (goal + rationale + brand) and feedback. Because article generation returns raw markdown (not JSON), `WRITE_ARTICLE.output = "markdown"` and its `parse` returns the raw string; the `persist` fn runs `_parse_llm_response`, `compute_seo_score`, saves the `Article`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_skills.py  (append)
from app.services.agents.skills import dune

def test_write_article_prompt_includes_angle_and_feedback():
    b = _brief()
    inputs = {"angle": "Vegan protein for marathon runners", "keyword": "vegan protein runners",
              "rationale": "Targets an underserved athlete niche", "feedback": "Add training-load specifics"}
    system, user = dune.WRITE_ARTICLE.build_prompt(b, inputs, {})
    assert "Vegan protein for marathon runners" in user
    assert "Targets an underserved athlete niche" in user
    assert "FIX THIS" in user
    assert dune.WRITE_ARTICLE.output == "markdown" and dune.WRITE_ARTICLE.persist is not None

def test_product_copy_prompt_and_output():
    system, user = dune.PRODUCT_COPY.build_prompt(_brief(), {"product": {"title": "Serum", "price": "19"}}, {})
    assert "Serum" in user and dune.PRODUCT_COPY.output == "json"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_skills.py -q`
Expected: FAIL — `ModuleNotFoundError: app.services.agents.skills.dune`.

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/app/services/agents/skills/dune.py
from app.services.agents.spec import Skill, AgentResult
from app.services.agents.skills._common import brief_block, feedback_block, parse_json
from app.models.article import Article, ArticleStatus
from app.services.article_service import compute_seo_score, _markdown_to_html
from app.workers.tasks.article_tasks import _build_system_prompt, _build_user_prompt, _parse_llm_response


def _write_article_prompt(brief, inputs, td):
    title = str(inputs.get("angle") or inputs.get("title") or brief.goal)[:500]
    keyword = str(inputs.get("keyword") or "") or title
    # Reuse the proven article prompt (title/keyword carried on a lightweight shim object).
    class _Shim:
        pass
    art = _Shim()
    art.title = title
    art.target_keyword = keyword
    art.tone = (brief.brand or {}).get("tone", "professional")
    art.word_count_target = 1600
    system = _build_system_prompt(None, brief.project_profile)
    user = _build_user_prompt(art)
    ctx = [f"This article serves the campaign goal: {brief.goal}. Keep it pointed at that goal."]
    if inputs.get("rationale"):
        ctx.append(f"Chosen angle & why it wins: {inputs['rationale']}")
    user += ("\n\nCAMPAIGN CONTEXT (write specifically to this angle — do NOT drift into a generic "
             "keyword overview):\n- " + "\n- ".join(ctx) + feedback_block(inputs))
    return system, user


async def _persist_article(raw_markdown, campaign, brief, db):
    inputs_title = raw_markdown  # not used; content is the raw model text
    parsed = _parse_llm_response(raw_markdown, "Article")
    title = parsed["meta_title"] or "Article"
    keyword = None
    art = Article(org_id=brief.org_id, project_id=brief.project_id, title=title,
                  target_keyword=keyword, status=ArticleStatus.generating)
    db.add(art); await db.flush()
    art.body_markdown = parsed["body_markdown"]
    art.body_html = _markdown_to_html(parsed["body_markdown"])
    art.meta_title = parsed["meta_title"]
    art.meta_description = parsed["meta_description"]
    art.word_count = len(parsed["body_markdown"].split())
    art.seo_score, _ = compute_seo_score(title, parsed["body_markdown"], keyword, parsed["meta_description"])
    art.status = ArticleStatus.ready
    await db.commit()
    return AgentResult(ok=True, summary=f"Article: {title}", artifact_type="article",
                       artifact_ids=[str(art.id)], structured={"article_id": str(art.id), "title": title,
                       "seo_score": art.seo_score, "word_count": art.word_count})


WRITE_ARTICLE = Skill(
    key="dune.write_article", agent_id="dune", weight="heavy", tools=[],
    build_prompt=_write_article_prompt, output="markdown", parse=lambda raw: raw,
    persist=_persist_article, label="Write the article",
    description="Write an SEO article on the chosen angle.",
)


def _product_copy_prompt(brief, inputs, td):
    p = inputs.get("product") or {}
    system = (
        "You are Dune. Write SEO ecommerce product copy. Return ONLY JSON: "
        '{"title": str (<=70), "description_html": str (2-4 <p> paragraphs), "meta_description": str (<=155)}. '
        "Never invent facts not in the product data. No emoji."
    )
    user = (f"PRODUCT: {p.get('title','')}\nPRICE: {p.get('price','')}\n"
            f"CURRENT DESCRIPTION: {p.get('description','')}\n" + brief_block(brief) + feedback_block(inputs))
    return system, user


PRODUCT_COPY = Skill(
    key="dune.product_copy", agent_id="dune", weight="light", tools=[],
    build_prompt=_product_copy_prompt, output="json", parse=parse_json,
    label="Product copy", description="SEO product title/description/meta from real product data.",
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_agents_skills.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/skills/dune.py apps/api/tests/test_agents_skills.py
git commit -m "feat(agents): Dune skills (write_article w/ persistence, product_copy)"
```

---

### Task 8: Sirocco, Oasis, Sable, Mirage, Nomad skills

**Files:**
- Create: `apps/api/app/services/agents/skills/sirocco.py` (`MULTI_NETWORK_SOCIAL`, `GENERATE_VISUAL`)
- Create: `apps/api/app/services/agents/skills/oasis.py` (`MARKET_REPORT`, `DEFINE_ICP`)
- Create: `apps/api/app/services/agents/skills/sable.py` (`COMPETITOR_SCAN`)
- Create: `apps/api/app/services/agents/skills/mirage.py` (`PRODUCT_SHOT`)
- Create: `apps/api/app/services/agents/skills/nomad.py` (`OUTREACH_PLAN`, `TESTIMONIAL_CONTENT`)
- Test: `apps/api/tests/test_agents_skills.py` (append)

**Interfaces:**
- Consumes: `_common`, `Skill`, `AgentResult`, `agent_persona`; for visual/product_shot `generate_image_dalle(prompt, style, usage, openai_api_key)` (`app.services.image_service`), `GeneratedImage`/`ImageStatus` (`app.models.image`); for social `SocialPost`/`SocialPlatform`/`SocialPostStatus`/`SocialPostType` (`app.models.social`).
- Produces: the six `Skill` constants above. `GENERATE_VISUAL` and `PRODUCT_SHOT` are two-step: their `persist` isn't used for text — instead they use a dedicated executor pattern. To keep the runner uniform, model these two as `output="text"` skills whose `build_prompt` produces the **art-direction** prompt request, and whose `persist` receives the crafted prompt string, calls the image model, and saves `GeneratedImage`. (i.e. the LLM output *is* the image prompt; `persist` renders + stores it.)

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_skills.py  (append)
from app.services.agents.skills import sirocco, oasis, sable, nomad, mirage

def test_multi_network_social_prompt_lists_platforms():
    inp = {"topic": "Summer serum launch", "platforms": ["linkedin", "instagram"]}
    system, user = sirocco.MULTI_NETWORK_SOCIAL.build_prompt(_brief(), inp, {})
    assert "linkedin" in user and "instagram" in user and sirocco.MULTI_NETWORK_SOCIAL.output == "json"

def test_generate_visual_is_two_step_with_persist():
    system, user = sirocco.GENERATE_VISUAL.build_prompt(_brief(), {"topic": "serum"}, {})
    assert "NO text" in system or "no text" in system.lower()
    assert sirocco.GENERATE_VISUAL.persist is not None and sirocco.GENERATE_VISUAL.output == "text"

def test_market_report_is_markdown_and_icp_is_json():
    assert oasis.MARKET_REPORT.output == "markdown"
    assert oasis.DEFINE_ICP.output == "json"

def test_outreach_and_testimonial_outputs():
    assert nomad.OUTREACH_PLAN.output == "json" and nomad.TESTIMONIAL_CONTENT.output == "json"

def test_competitor_scan_reads_url_input():
    td = {"crawl_competitor": {"ok": True, "data": {"analysis": {"url": "x.com", "scorecard": {"score": 60}}}}}
    system, user = sable.COMPETITOR_SCAN.build_prompt(_brief(), {"competitor_url": "x.com"}, td)
    assert "x.com" in user and sable.COMPETITOR_SCAN.output == "json"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_skills.py -q`
Expected: FAIL — `ModuleNotFoundError: app.services.agents.skills.sirocco`.

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/app/services/agents/skills/sirocco.py
from app.agents.registry import agent_persona
from app.services.agents.spec import Skill, AgentResult
from app.services.agents.skills._common import brief_block, feedback_block, parse_json
from app.models.social import SocialPost, SocialPlatform, SocialPostStatus, SocialPostType
from app.models.image import GeneratedImage, ImageStatus
from app.services.image_service import generate_image_dalle

_PLATFORMS = ["linkedin", "instagram", "twitter", "facebook", "tiktok"]


def _social_prompt(brief, inputs, td):
    topic = inputs.get("topic") or brief.goal
    platforms = [p for p in (inputs.get("platforms") or ["linkedin", "instagram", "twitter"]) if p in _PLATFORMS]
    system = (
        agent_persona("sirocco")
        + " Write native social posts for each requested network from ONE topic. No emoji. "
        'Return ONLY JSON: {"variants": [{"platform": str, "content": str, "hashtags": [str]}]}. '
        "Tune length and voice to each network."
    )
    user = (f"TOPIC: {topic}\nNETWORKS: {', '.join(platforms)}\n" + brief_block(brief) + feedback_block(inputs))
    return system, user


async def _persist_social(content, campaign, brief, db):
    ids = []
    for v in (content or {}).get("variants", []):
        try:
            plat = SocialPlatform(v["platform"])
        except (ValueError, KeyError):
            continue
        body = v.get("content", "")
        post = SocialPost(org_id=brief.org_id, project_id=brief.project_id, platform=plat,
                          post_type=SocialPostType.tip, status=SocialPostStatus.draft,
                          content=body, hashtags=v.get("hashtags", []), char_count=len(body))
        db.add(post); await db.flush(); ids.append(str(post.id))
    await db.commit()
    return AgentResult(ok=True, summary=f"Drafted {len(ids)} native social posts.",
                       artifact_type="social", artifact_ids=ids, structured={"count": len(ids)})


MULTI_NETWORK_SOCIAL = Skill(
    key="sirocco.multi_network_social", agent_id="sirocco", weight="light", tools=[],
    build_prompt=_social_prompt, output="json", parse=parse_json, persist=_persist_social,
    label="Multi-network social", description="Native post variants per network from the angle.",
)


_ART_DIRECTOR = (
    "You are Sirocco, a creative director. Output ONLY an image-generation prompt (no quotes, no preamble). "
    "Describe a specific scene: subject and focal point, composition, setting, lighting, mood, a tight color "
    "palette, and art style. ABSOLUTELY NO text, letters, numbers, logos, watermarks, charts or UI. Under 80 words."
)


def _visual_prompt(brief, inputs, td):
    subject = inputs.get("topic") or brief.goal
    user = f"Campaign goal: {brief.goal}\nAngle: {subject}\n" + brief_block(brief) + feedback_block(inputs)
    return _ART_DIRECTOR, user


async def _persist_visual(prompt_text, campaign, brief, db):
    from app.services.llm_service import get_org_llm_keys
    keys = await get_org_llm_keys(brief.org_id, db)
    if "openai" not in keys:
        return AgentResult(ok=False, error="Image generation needs an OpenAI key.")
    prompt = (prompt_text or f"Marketing visual for: {brief.goal}").strip()[:900]
    result = await generate_image_dalle(prompt=prompt, style="professional", usage="marketing_banner",
                                        openai_api_key=keys["openai"])
    if not result.get("ok"):
        return AgentResult(ok=False, error=result.get("error", "Image generation failed."))
    img = GeneratedImage(org_id=brief.org_id, project_id=brief.project_id, prompt=prompt,
                         revised_prompt=result.get("revised_prompt"), style="professional",
                         usage="marketing_banner", status=ImageStatus.ready, image_url=result.get("image_url"),
                         width=result.get("width"), height=result.get("height"), cost_usd=result.get("cost_usd"))
    db.add(img); await db.commit()
    return AgentResult(ok=True, summary="Generated a campaign visual.", artifact_type="image",
                       artifact_ids=[str(img.id)], structured={"image_id": str(img.id)})


GENERATE_VISUAL = Skill(
    key="sirocco.generate_visual", agent_id="sirocco", weight="heavy", tools=[],
    build_prompt=_visual_prompt, output="text", parse=lambda raw: raw, persist=_persist_visual,
    label="Generate a visual", description="Art-direct then render a campaign image.",
)
```

```python
# apps/api/app/services/agents/skills/oasis.py
from app.agents.registry import agent_persona
from app.services.agents.spec import Skill, AgentResult
from app.services.agents.skills._common import brief_block, feedback_block, parse_json


def _report_prompt(brief, inputs, td):
    data = (td.get("market_data") or {}).get("data") or {}
    system = (
        agent_persona("oasis")
        + " Produce a client-ready MARKET REPORT in Markdown with sections: Executive summary, Market demand, "
        "Topic landscape, Opportunity analysis, Risks & gaps, Recommendations. Cite ONLY numbers in DATA — "
        "never invent figures. No emoji. ~500-700 words."
    )
    user = brief_block(brief) + f"\n\nDATA:\n{data}" + feedback_block(inputs)
    return system, user


MARKET_REPORT = Skill(
    key="oasis.market_report", agent_id="oasis", weight="heavy", tools=["market_data"],
    build_prompt=_report_prompt, output="markdown", parse=lambda raw: raw,
    label="Market report", description="Client-ready market report from real GSC data.",
)


def _icp_prompt(brief, inputs, td):
    system = (
        agent_persona("oasis")
        + ' Define 3 ideal client segments. Return ONLY JSON: {"segments": [{"name", "description", '
        '"pains": [..], "channels": [..], "angle"}]}. Be specific to the niche; no emoji.'
    )
    user = brief_block(brief) + feedback_block(inputs)
    return system, user


DEFINE_ICP = Skill(
    key="oasis.define_icp", agent_id="oasis", weight="light", tools=["market_insights"],
    build_prompt=_icp_prompt, output="json", parse=parse_json,
    label="Define ideal client", description="Ideal client segments to target.",
)
```

```python
# apps/api/app/services/agents/skills/sable.py
from app.agents.registry import agent_persona
from app.services.agents.spec import Skill
from app.services.agents.skills._common import brief_block, feedback_block, parse_json


def _scan_prompt(brief, inputs, td):
    analysis = (td.get("crawl_competitor") or {}).get("data", {}).get("analysis", {})
    url = str((inputs or {}).get("competitor_url") or analysis.get("url") or "")
    system = (
        agent_persona("sable")
        + ' Compare the competitor to our demand and name the gaps worth striking first. '
        'Return ONLY JSON: {"scorecard": {...}, "gaps": [str], "insights": str}.'
    )
    user = f"COMPETITOR URL: {url}\nCOMPETITOR ANALYSIS: {analysis}\n" + brief_block(brief) + feedback_block(inputs)
    return system, user


COMPETITOR_SCAN = Skill(
    key="sable.competitor_scan", agent_id="sable", weight="heavy",
    tools=["crawl_competitor", "our_demand"], build_prompt=_scan_prompt, output="json", parse=parse_json,
    label="Scan a competitor", description="Score a competitor and find the gap to strike.",
)
```

```python
# apps/api/app/services/agents/skills/nomad.py
from app.agents.registry import agent_persona
from app.services.agents.spec import Skill
from app.services.agents.skills._common import brief_block, feedback_block, parse_json


def _outreach_prompt(brief, inputs, td):
    audience = (inputs or {}).get("audience", "")
    system = (
        agent_persona("nomad")
        + ' Build a one-week LinkedIn outreach plan. Return ONLY JSON: {"posts": [5 items {day,type,content,'
        'hashtags}], "messages": [3 items {scenario,content}], "tips": [3-5 str]}. No emoji.'
    )
    user = (f"TARGET AUDIENCE: {audience}\n" if audience else "") + brief_block(brief) + feedback_block(inputs)
    return system, user


OUTREACH_PLAN = Skill(
    key="nomad.outreach_plan", agent_id="nomad", weight="heavy", tools=[],
    build_prompt=_outreach_prompt, output="json", parse=parse_json,
    label="Outreach plan", description="A week of LinkedIn posts + DM templates.",
)


def _testimonial_prompt(brief, inputs, td):
    t = (inputs or {}).get("testimonial", "")
    system = (
        agent_persona("nomad")
        + ' Turn the TESTIMONIAL into social proof. Return ONLY JSON: {"pieces": [{"format": '
        'linkedin_post|case_study|quote_card|website_blurb, "content"}]}. Never invent facts. No emoji.'
    )
    user = f"TESTIMONIAL: {t}\n" + brief_block(brief) + feedback_block(inputs)
    return system, user


TESTIMONIAL_CONTENT = Skill(
    key="nomad.testimonial_content", agent_id="nomad", weight="light", tools=[],
    build_prompt=_testimonial_prompt, output="json", parse=parse_json,
    label="Testimonial to content", description="Client testimonial -> social proof pieces.",
)
```

```python
# apps/api/app/services/agents/skills/mirage.py
from app.agents.registry import agent_persona
from app.services.agents.spec import Skill, AgentResult
from app.services.agents.skills._common import brief_block, feedback_block
from app.models.image import GeneratedImage, ImageStatus
from app.services.image_service import generate_image_dalle

_SHOT_DIRECTOR = (
    "You are Mirage. Output ONLY an image-generation prompt for a professional product shot: the product as "
    "the clear hero, studio or lifestyle scene, lighting, surface, mood, palette. NO text, logos or watermarks. Under 80 words."
)


def _shot_prompt(brief, inputs, td):
    p = inputs.get("product") or {}
    user = f"PRODUCT: {p.get('title','')}\nDESCRIPTION: {p.get('description','')}\n" + brief_block(brief) + feedback_block(inputs)
    return _SHOT_DIRECTOR, user


async def _persist_shot(prompt_text, campaign, brief, db):
    from app.services.llm_service import get_org_llm_keys
    keys = await get_org_llm_keys(brief.org_id, db)
    if "openai" not in keys:
        return AgentResult(ok=False, error="Image generation needs an OpenAI key.")
    prompt = (prompt_text or "Professional product shot").strip()[:900]
    result = await generate_image_dalle(prompt=prompt, style="professional", usage="product_shot",
                                        openai_api_key=keys["openai"])
    if not result.get("ok"):
        return AgentResult(ok=False, error=result.get("error", "Image generation failed."))
    img = GeneratedImage(org_id=brief.org_id, project_id=brief.project_id, prompt=prompt,
                         revised_prompt=result.get("revised_prompt"), style="professional", usage="product_shot",
                         status=ImageStatus.ready, image_url=result.get("image_url"),
                         width=result.get("width"), height=result.get("height"), cost_usd=result.get("cost_usd"))
    db.add(img); await db.commit()
    return AgentResult(ok=True, summary="Generated a product shot.", artifact_type="image",
                       artifact_ids=[str(img.id)], structured={"image_id": str(img.id)})


PRODUCT_SHOT = Skill(
    key="mirage.product_shot", agent_id="mirage", weight="heavy", tools=[],
    build_prompt=_shot_prompt, output="text", parse=lambda raw: raw, persist=_persist_shot,
    label="Product shot", description="Art-direct then render a product photo.",
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_agents_skills.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/skills/ apps/api/tests/test_agents_skills.py
git commit -m "feat(agents): Sirocco/Oasis/Sable/Mirage/Nomad skills"
```

---

### Task 9: Skill registry

**Files:**
- Create: `apps/api/app/services/agents/registry.py`
- Test: `apps/api/tests/test_agents_skills.py` (append)

**Interfaces:**
- Consumes: all skill modules (Tasks 6–8).
- Produces: `SKILLS: dict[str, Skill]` keyed by `skill.key`; `get_skill(key: str) -> Skill | None`; `catalog_text() -> str` (for the director's planning prompt: one line per skill `- <key> (<agent> — <label>): <description>`).

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_skills.py  (append)
from app.services.agents.registry import SKILLS, get_skill, catalog_text

def test_registry_contains_all_core_skills():
    for key in ["zerda.pick_angle", "zerda.keyword_targets", "dune.write_article", "dune.product_copy",
                "sirocco.multi_network_social", "sirocco.generate_visual", "oasis.market_report",
                "oasis.define_icp", "sable.competitor_scan", "mirage.product_shot",
                "nomad.outreach_plan", "nomad.testimonial_content"]:
        assert key in SKILLS, key
    assert get_skill("dune.write_article").agent_id == "dune"
    assert get_skill("nope") is None

def test_catalog_text_lists_keys_and_agents():
    txt = catalog_text()
    assert "zerda.pick_angle (zerda" in txt and "dune.write_article (dune" in txt
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_skills.py -q`
Expected: FAIL — `ModuleNotFoundError: app.services.agents.registry`.

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/app/services/agents/registry.py
from app.services.agents.skills import zerda, dune, sirocco, oasis, sable, mirage, nomad

_ALL = [
    zerda.PICK_ANGLE, zerda.KEYWORD_TARGETS,
    dune.WRITE_ARTICLE, dune.PRODUCT_COPY,
    sirocco.MULTI_NETWORK_SOCIAL, sirocco.GENERATE_VISUAL,
    oasis.MARKET_REPORT, oasis.DEFINE_ICP,
    sable.COMPETITOR_SCAN,
    mirage.PRODUCT_SHOT,
    nomad.OUTREACH_PLAN, nomad.TESTIMONIAL_CONTENT,
]

SKILLS = {s.key: s for s in _ALL}


def get_skill(key: str):
    return SKILLS.get(key)


def catalog_text() -> str:
    return "\n".join(f"- {s.key} ({s.agent_id} — {s.label}): {s.description}" for s in _ALL)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_agents_skills.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/registry.py apps/api/tests/test_agents_skills.py
git commit -m "feat(agents): skill registry + catalog text"
```

---

### Task 10: Reviewer

**Files:**
- Create: `apps/api/app/services/agents/reviewer.py`
- Test: `apps/api/tests/test_agents_reviewer.py`

**Interfaces:**
- Consumes: `Skill`, `AgentResult`, `Brief`, `resolve_model` (Task 1), `call_llm`.
- Produces: `async review(brief, skill, result, tier, keys, db) -> dict` = `{"passed": bool, "score": int, "feedback": str}`. Deterministic pre-checks: if `result.ok is False` → `{passed: False, feedback: result.error}`; if `artifact_type == "article"` and `structured.seo_score` present and `< 80` → fail with a keyword/length hint. Then one light-tier LLM judgment (`on-goal? on-angle? specific & grounded?`) returning JSON `{score, feedback}`; `passed = score >= 70`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_reviewer.py
import uuid, json, pytest
from unittest.mock import AsyncMock, patch
from app.services.agents.brief import Brief
from app.services.agents.spec import Skill, AgentResult
from app.services.agents.reviewer import review

def _brief():
    return Brief(goal="g", persona="creator", project_id=uuid.uuid4(), org_id=uuid.uuid4(),
                 locale="en", project_profile="", brand={}, existing_content=[], artifacts=[])

def _skill():
    return Skill(key="dune.write_article", agent_id="dune", weight="heavy", tools=[],
                 build_prompt=lambda b, i, t: ("s", "u"), output="markdown")

async def test_failed_result_fails_review_without_llm():
    r = AgentResult(ok=False, error="boom")
    out = await review(_brief(), _skill(), r, tier="balanced", keys={"anthropic": "x"}, db=None)
    assert out["passed"] is False and "boom" in out["feedback"]

async def test_low_seo_score_fails_deterministically():
    r = AgentResult(ok=True, artifact_type="article", structured={"seo_score": 55}, summary="Article: X")
    out = await review(_brief(), _skill(), r, tier="balanced", keys={"anthropic": "x"}, db=None)
    assert out["passed"] is False and "SEO" in out["feedback"]

async def test_good_artifact_uses_llm_judgment():
    r = AgentResult(ok=True, artifact_type="article", structured={"seo_score": 92}, summary="Article: X")
    with patch("app.services.agents.reviewer.call_llm", new=AsyncMock(return_value='{"score": 88, "feedback": "solid"}')):
        out = await review(_brief(), _skill(), r, tier="balanced", keys={"anthropic": "x"}, db=None)
    assert out["passed"] is True and out["score"] == 88
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_reviewer.py -q`
Expected: FAIL — `ModuleNotFoundError: app.services.agents.reviewer`.

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/app/services/agents/reviewer.py
import re, json
from app.services.agents.tiers import resolve_model
from app.services.llm_service import call_llm


async def review(brief, skill, result, tier, keys, db) -> dict:
    if not result.ok:
        return {"passed": False, "score": 0, "feedback": result.error or "The agent produced no usable output."}
    # deterministic gate for articles
    if result.artifact_type == "article":
        score = result.structured.get("seo_score")
        if isinstance(score, (int, float)) and score < 80:
            return {"passed": False, "score": int(score),
                    "feedback": "SEO score below bar — ensure the primary keyword is in the H1 and first "
                                "paragraph, keep 0.5-2.5% density, 1500+ words, and multiple H2s."}
    available = list((keys or {}).keys())
    if not available:
        return {"passed": True, "score": 75, "feedback": ""}   # no key to judge with; accept
    provider, model = resolve_model(tier, "light", available)
    system = ('You are a strict editor. Judge the ARTIFACT against the GOAL. Return ONLY JSON: '
              '{"score": 0-100, "feedback": one actionable sentence}. Score low if generic, off-goal, '
              'off-angle, or vague.')
    artifact = result.content if result.content is not None else result.summary
    user = f"GOAL: {brief.goal}\nARTIFACT SUMMARY: {result.summary}\nARTIFACT: {str(artifact)[:4000]}"
    try:
        raw = await call_llm(provider, model, keys[provider], system, user, locale=brief.locale)
        data = json.loads(re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip()))
        score = int(data.get("score", 70))
        return {"passed": score >= 70, "score": score, "feedback": str(data.get("feedback", ""))}
    except Exception:
        return {"passed": True, "score": 70, "feedback": ""}   # reviewer failure never blocks the pipeline
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_agents_reviewer.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/reviewer.py apps/api/tests/test_agents_reviewer.py
git commit -m "feat(agents): reviewer (deterministic gate + LLM judgment)"
```

---

### Task 11: Director — plan + guard

**Files:**
- Create: `apps/api/app/services/agents/director.py` (plan + guard first; run loop in Task 12)
- Test: `apps/api/tests/test_agents_director.py`

**Interfaces:**
- Consumes: `SKILLS`, `catalog_text` (Task 9), `resolve_model`, `call_llm`, `Brief`.
- Produces: `_persona_flow(persona: str) -> list[str]` (skill-key sequences, from the spec's persona flows, mapped to the new keys); `async plan(brief, tier, keys, db) -> list[dict]` returning `[{"skill": key, "why": str, "inputs": dict}]`; `_has_create_and_distribute(steps) -> bool`. `plan` calls the LLM, validates keys against `SKILLS`, and falls back to `_persona_flow` if the plan is empty or lacks a create+distribute step.

Persona flows (skill keys):
- creator: `["zerda.pick_angle", "dune.write_article", "sirocco.generate_visual", "sirocco.multi_network_social"]`
- ecommerce: `["oasis.market_report", "zerda.pick_angle", "dune.write_article", "sirocco.generate_visual", "sirocco.multi_network_social"]`
- freelancer: `["oasis.define_icp", "zerda.pick_angle", "dune.write_article", "sirocco.multi_network_social"]`
- company: `["oasis.market_report", "zerda.pick_angle", "dune.write_article", "sirocco.generate_visual", "sirocco.multi_network_social", "sable.competitor_scan"]`

Create skills: `{"dune.write_article", "sirocco.generate_visual", "mirage.product_shot"}`. Distribute skills: `{"sirocco.multi_network_social", "nomad.outreach_plan"}`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_director.py
import uuid, json, pytest
from unittest.mock import AsyncMock, patch
from app.services.agents.brief import Brief
from app.services.agents import director

def _brief(persona="creator"):
    return Brief(goal="g", persona=persona, project_id=uuid.uuid4(), org_id=uuid.uuid4(),
                 locale="en", project_profile="", brand={}, existing_content=[], artifacts=[])

def test_persona_flow_has_create_and_distribute():
    for persona in ["creator", "ecommerce", "freelancer", "company"]:
        steps = [{"skill": k} for k in director._persona_flow(persona)]
        assert director._has_create_and_distribute(steps)

async def test_plan_falls_back_when_llm_plan_is_thin():
    with patch("app.services.agents.director.call_llm", new=AsyncMock(return_value='{"steps":[{"skill":"zerda.pick_angle"}]}')):
        steps = await director.plan(_brief("creator"), tier="balanced", keys={"anthropic": "x"}, db=None)
    # thin plan (no create+distribute) -> persona fallback
    assert any(s["skill"] == "dune.write_article" for s in steps)
    assert director._has_create_and_distribute(steps)

async def test_plan_keeps_valid_llm_plan():
    good = {"steps": [{"skill": "zerda.pick_angle", "why": "a"}, {"skill": "dune.write_article", "why": "b"},
                      {"skill": "sirocco.multi_network_social", "why": "c"}]}
    with patch("app.services.agents.director.call_llm", new=AsyncMock(return_value=json.dumps(good))):
        steps = await director.plan(_brief("creator"), tier="balanced", keys={"anthropic": "x"}, db=None)
    assert [s["skill"] for s in steps] == ["zerda.pick_angle", "dune.write_article", "sirocco.multi_network_social"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_director.py -q`
Expected: FAIL — `ModuleNotFoundError: app.services.agents.director`.

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/app/services/agents/director.py
import re, json, logging
from app.services.agents.registry import SKILLS, catalog_text
from app.services.agents.tiers import resolve_model
from app.services.llm_service import call_llm

logger = logging.getLogger(__name__)

_FLOWS = {
    "creator":   ["zerda.pick_angle", "dune.write_article", "sirocco.generate_visual", "sirocco.multi_network_social"],
    "ecommerce": ["oasis.market_report", "zerda.pick_angle", "dune.write_article", "sirocco.generate_visual", "sirocco.multi_network_social"],
    "freelancer":["oasis.define_icp", "zerda.pick_angle", "dune.write_article", "sirocco.multi_network_social"],
    "company":   ["oasis.market_report", "zerda.pick_angle", "dune.write_article", "sirocco.generate_visual", "sirocco.multi_network_social", "sable.competitor_scan"],
}
_CREATE = {"dune.write_article", "sirocco.generate_visual", "mirage.product_shot"}
_DISTRIBUTE = {"sirocco.multi_network_social", "nomad.outreach_plan"}


def _persona_flow(persona: str) -> list[str]:
    return [k for k in _FLOWS.get(persona, _FLOWS["creator"]) if k in SKILLS]


def _has_create_and_distribute(steps) -> bool:
    keys = {s["skill"] for s in steps}
    return bool(keys & _CREATE) and bool(keys & _DISTRIBUTE)


def _fallback(persona: str) -> list[dict]:
    return [{"skill": k, "why": SKILLS[k].label, "inputs": {}} for k in _persona_flow(persona)]


async def plan(brief, tier, keys, db) -> list[dict]:
    available = list((keys or {}).keys())
    if not available:
        return _fallback(brief.persona)
    provider, model = resolve_model(tier, "light", available)
    recommended = " -> ".join(_persona_flow(brief.persona))
    system = (
        "You are the campaign director leading a squad. Design a COMPLETE campaign for the GOAL: research/target "
        "-> angle -> create -> distribute, using a VARIETY of agents and ending with a distribution step. "
        "Order matters (earlier outputs feed later steps). Pick ONLY skill keys from the CATALOG. Aim for 5-7 "
        'steps. Respond with ONLY JSON: {"steps": [{"skill": key, "why": str}]}.\n\n'
        f"RECOMMENDED SHAPE for {brief.persona}: {recommended}\n\nCATALOG:\n{catalog_text()}"
    )
    user = f"GOAL: {brief.goal}\nPERSONA: {brief.persona}" + (f"\nPROFILE: {brief.project_profile}" if brief.project_profile else "")
    try:
        raw = await call_llm(provider, model, keys[provider], system, user, locale=brief.locale)
        parsed = json.loads(re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip()))
        steps = [{"skill": s["skill"], "why": str(s.get("why", ""))[:300], "inputs": {}}
                 for s in parsed.get("steps", []) if s.get("skill") in SKILLS][:8]
    except Exception:
        return _fallback(brief.persona)
    if not steps or not _has_create_and_distribute(steps):
        return _fallback(brief.persona)
    return steps
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_agents_director.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/director.py apps/api/tests/test_agents_director.py
git commit -m "feat(agents): director plan + create/distribute guard"
```

---

### Task 12: Director run loop (execute + review + retry + handoff)

**Files:**
- Modify: `apps/api/app/services/agents/director.py` (add `run_campaign`)
- Modify: `apps/api/app/services/agents/__init__.py` (re-export `run_campaign`, `build_brief`)
- Test: `apps/api/tests/test_agents_director.py` (append)

**Interfaces:**
- Consumes: `plan` (Task 11), `AgentRunner.run` (Task 5), `review` (Task 10), `build_brief` (Task 3), `SKILLS`, `get_org_llm_keys`, models `Campaign`, `CampaignStep`.
- Produces: `async run_campaign(campaign, db, tier: str | None = None) -> None`. Builds the Brief; runs `plan`; **replaces any pre-seeded `CampaignStep`s** with the planned steps (or creates them); for each step: run skill via `AgentRunner` (inputs carry prior angle/keyword from `brief.artifacts`), review, retry ≤2 with feedback, write `CampaignStep.status/summary/artifact_*/structured` (structured includes `review`), append to `brief.artifacts`; set `campaign.status`. **Inputs threading:** before running, merge into `inputs` the most recent `structured` that has `topic`/`keyword` (as `angle`/`keyword`) so Dune/Sirocco receive Zerda's angle.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_director.py  (append)
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
from app.models.campaign import Campaign, CampaignStep
from app.services.agents.spec import AgentResult
from app.services.agents import director as D

_engine = create_async_engine("sqlite+aiosqlite:///:memory:")
_Session = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)

@pytest.fixture
async def db():
    async with _engine.begin() as c: await c.run_sync(Base.metadata.create_all)
    async with _Session() as s: yield s
    async with _engine.begin() as c: await c.run_sync(Base.metadata.drop_all)

async def test_run_campaign_executes_plan_and_records_steps(db):
    org = Organization(slug="o", name="O"); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="P", domain="p.com"); db.add(proj); await db.flush()
    camp = Campaign(org_id=org.id, project_id=proj.id, goal="Launch", persona="creator", status="planned")
    db.add(camp); await db.commit()

    async def fake_run(skill, brief, inputs, tier, db, keys=None, campaign=None):
        return AgentResult(ok=True, summary=f"did {skill.key}",
                           structured={"topic": "T", "keyword": "k"} if skill.key.endswith("pick_angle") else {})
    with patch.object(D, "plan", new=AsyncMock(return_value=[
             {"skill": "zerda.pick_angle", "why": "", "inputs": {}},
             {"skill": "dune.write_article", "why": "", "inputs": {}},
             {"skill": "sirocco.multi_network_social", "why": "", "inputs": {}}])), \
         patch("app.services.agents.director.AgentRunner.run", new=AsyncMock(side_effect=fake_run)), \
         patch("app.services.agents.director.review", new=AsyncMock(return_value={"passed": True, "score": 90, "feedback": ""})), \
         patch("app.services.agents.director.get_org_llm_keys", new=AsyncMock(return_value={"anthropic": "x"})):
        await D.run_campaign(camp, db)

    steps = (await db.execute(select(CampaignStep).where(CampaignStep.campaign_id == camp.id).order_by(CampaignStep.order))).scalars().all()
    assert [s.action for s in steps] == ["zerda.pick_angle", "dune.write_article", "sirocco.multi_network_social"]
    assert all(s.status == "completed" for s in steps)
    await db.refresh(camp); assert camp.status == "completed"

async def test_run_campaign_retries_weak_step_then_continues(db):
    org = Organization(slug="o2", name="O"); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="P", domain="p.com"); db.add(proj); await db.flush()
    camp = Campaign(org_id=org.id, project_id=proj.id, goal="G", persona="creator", status="planned"); db.add(camp); await db.commit()
    reviews = [{"passed": False, "score": 40, "feedback": "too generic"}, {"passed": True, "score": 85, "feedback": ""}]
    run = AsyncMock(return_value=AgentResult(ok=True, summary="x", structured={}))
    with patch.object(D, "plan", new=AsyncMock(return_value=[{"skill": "dune.write_article", "why": "", "inputs": {}},
             {"skill": "sirocco.multi_network_social", "why": "", "inputs": {}}])), \
         patch("app.services.agents.director.AgentRunner.run", new=run), \
         patch("app.services.agents.director.review", new=AsyncMock(side_effect=reviews + [{"passed": True, "score": 80, "feedback": ""}])), \
         patch("app.services.agents.director.get_org_llm_keys", new=AsyncMock(return_value={"anthropic": "x"})):
        await D.run_campaign(camp, db)
    # write_article ran twice (initial + 1 retry), social ran once => 3 runner calls
    assert run.call_count == 3
```

Add imports at top of the test file: `from unittest.mock import AsyncMock, patch` and `from sqlalchemy import select`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_director.py -q`
Expected: FAIL — `AttributeError: module ... has no attribute 'run_campaign'`.

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/app/services/agents/director.py  (append)
from datetime import datetime, timezone
from sqlalchemy import select, delete
from app.models.campaign import Campaign, CampaignStep
from app.services.agents.brief import build_brief
from app.services.agents.runner import AgentRunner
from app.services.agents.reviewer import review
from app.services.agents.registry import SKILLS
from app.services.llm_service import get_org_llm_keys
from app.core.config import settings  # noqa: F401  (tier default source, if org lacks one)

_MAX_RETRIES = 2


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _prior_angle(brief) -> dict:
    for a in reversed(brief.artifacts):
        st = a.get("structured") or {}
        if st.get("topic") or st.get("keyword"):
            return {"angle": st.get("topic"), "keyword": st.get("keyword"), "rationale": st.get("rationale")}
    return {}


async def run_campaign(campaign, db, tier: str | None = None) -> None:
    org = None
    if tier is None:
        org = await db.get(type(campaign).__mro__[0], campaign.org_id) if False else None
    resolved_tier = tier or "balanced"
    keys = await get_org_llm_keys(campaign.org_id, db)
    brief = await build_brief(campaign.project_id, campaign.org_id, campaign.goal, campaign.persona, db)

    campaign.status = "running"
    await db.commit()
    steps_plan = await plan(brief, resolved_tier, keys, db)

    # Reset steps to the fresh plan.
    await db.execute(delete(CampaignStep).where(CampaignStep.campaign_id == campaign.id))
    order = 0
    for p in steps_plan:
        db.add(CampaignStep(campaign_id=campaign.id, org_id=campaign.org_id, project_id=campaign.project_id,
                            order=order, agent=SKILLS[p["skill"]].agent_id, action=p["skill"],
                            why=p.get("why", ""), status="pending"))
        order += 1
    await db.commit()

    rows = (await db.execute(select(CampaignStep).where(CampaignStep.campaign_id == campaign.id)
            .order_by(CampaignStep.order))).scalars().all()

    for step in rows:
        await db.refresh(campaign)
        if campaign.cancel_requested:
            break
        skill = SKILLS.get(step.action)
        if skill is None:
            step.status = "skipped"; step.error = "Unknown skill."; await db.commit(); continue
        step.status = "running"; step.started_at = _now(); await db.commit()

        inputs = dict(_prior_angle(brief))
        result = None; rev = {"passed": True, "score": 75, "feedback": ""}
        for attempt in range(_MAX_RETRIES + 1):
            result = await AgentRunner.run(skill, brief, inputs, resolved_tier, db,
                                           keys=keys, campaign=campaign)
            rev = await review(brief, skill, result, resolved_tier, keys, db)
            if rev["passed"] or not result.ok:
                break
            inputs = {**inputs, "feedback": rev["feedback"]}   # retry with feedback

        step.finished_at = _now()
        if result and result.ok:
            step.status = "completed"
            step.summary = result.summary
            step.artifact_type = result.artifact_type
            step.artifact_ids = result.artifact_ids or None
            step.structured = {**(result.structured or {}), "review": rev}
            brief.add_artifact(result, skill.agent_id, skill.key)
        else:
            step.status = "failed"
            step.error = (result.error if result else "no result")
        await db.commit()

    await db.refresh(campaign)
    if not campaign.cancel_requested:
        campaign.status = "completed"
    else:
        campaign.status = "cancelled"
    await db.commit()
```

Also update `apps/api/app/services/agents/__init__.py`:

```python
from app.services.agents.brief import Brief, build_brief
from app.services.agents.spec import Skill, AgentResult
from app.services.agents.runner import AgentRunner
from app.services.agents.director import run_campaign, plan

__all__ = ["Brief", "build_brief", "Skill", "AgentResult", "AgentRunner", "run_campaign", "plan"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_agents_director.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/director.py apps/api/app/services/agents/__init__.py apps/api/tests/test_agents_director.py
git commit -m "feat(agents): director run loop with review/retry/handoff"
```

---

### Task 13: `organizations.agent_tier` column + settings

**Files:**
- Modify: `apps/api/app/models/organization.py` (add `agent_tier`)
- Create: `apps/api/alembic/versions/<rev>_org_agent_tier.py`
- Modify: `apps/api/app/api/v1/routers/organizations.py` (expose `agent_tier` in the org update + response schema)
- Test: `apps/api/tests/test_agents_director.py` (append a resolution test)

**Interfaces:**
- Consumes: `Organization`.
- Produces: `Organization.agent_tier: str | None` (values `economy|balanced|max`, default `balanced`); `run_campaign` reads it when `tier is None`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_director.py  (append)
async def test_run_campaign_reads_org_tier(db):
    from app.services.agents import director as D2
    org = Organization(slug="o3", name="O", agent_tier="max"); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="P", domain="p.com"); db.add(proj); await db.flush()
    camp = Campaign(org_id=org.id, project_id=proj.id, goal="G", persona="creator", status="planned"); db.add(camp); await db.commit()
    seen = {}
    async def fake_run(skill, brief, inputs, tier, db, keys=None, campaign=None):
        seen["tier"] = tier
        return AgentResult(ok=True, summary="x", structured={})
    with patch.object(D2, "plan", new=AsyncMock(return_value=[{"skill": "dune.write_article", "why": "", "inputs": {}},
             {"skill": "sirocco.multi_network_social", "why": "", "inputs": {}}])), \
         patch("app.services.agents.director.AgentRunner.run", new=AsyncMock(side_effect=fake_run)), \
         patch("app.services.agents.director.review", new=AsyncMock(return_value={"passed": True, "score": 90, "feedback": ""})), \
         patch("app.services.agents.director.get_org_llm_keys", new=AsyncMock(return_value={"anthropic": "x"})):
        await D2.run_campaign(camp, db)   # tier=None -> read org.agent_tier
    assert seen["tier"] == "max"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_director.py::test_run_campaign_reads_org_tier -q`
Expected: FAIL — `TypeError: 'agent_tier' is an invalid keyword argument for Organization`.

- [ ] **Step 3: Write minimal implementation**

Add the column (in `apps/api/app/models/organization.py`, after `plan_locked_at`):

```python
    agent_tier: Mapped[str | None] = mapped_column(String(20), nullable=True)  # economy | balanced | max
```

Fix `run_campaign` tier resolution (replace the placeholder `org = None` block from Task 12 with):

```python
    resolved_tier = tier
    if resolved_tier is None:
        org = await db.get(Campaign, campaign.id)  # ensure attached
        org_row = await db.get(type(campaign), campaign.id)
        from app.models.organization import Organization
        org_obj = await db.get(Organization, campaign.org_id)
        resolved_tier = (org_obj.agent_tier if org_obj and org_obj.agent_tier else "balanced")
```

Migration:

```python
# apps/api/alembic/versions/<rev>_org_agent_tier.py
from alembic import op
revision = "<rev>"          # fill with a fresh id, down_revision = current head
down_revision = "<current_head>"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.execute("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS agent_tier VARCHAR(20)")

def downgrade() -> None:
    op.execute("ALTER TABLE organizations DROP COLUMN IF EXISTS agent_tier")
```

Expose in `organizations.py` router: add `agent_tier: Optional[str] = None` to the org update request and response schemas (mirror how `name` is handled), so Settings → Organization can set it.

- [ ] **Step 4: Run tests**

Run: `cd apps/api && pytest tests/test_agents_director.py -q` (all pass) and apply the migration: `docker compose exec -T api alembic upgrade head` (Running upgrade → org agent_tier).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/models/organization.py apps/api/alembic/versions/*_org_agent_tier.py apps/api/app/api/v1/routers/organizations.py apps/api/app/services/agents/director.py apps/api/tests/test_agents_director.py
git commit -m "feat(agents): org agent_tier setting drives model tier"
```

---

### Task 14: Wire the campaign worker to the new director

**Files:**
- Modify: `apps/api/app/workers/tasks/campaign_tasks.py:102-` (`execute_campaign` delegates to `run_campaign`)
- Test: manual golden run (no unit test — this is the integration seam)

**Interfaces:**
- Consumes: `run_campaign` (Task 12).
- Produces: `execute_campaign(campaign_id, db_factory=None)` now builds a session and calls `await run_campaign(campaign, db)`; the old per-step loop + `CampaignContext` + `ACTIONS` usage is removed.

- [ ] **Step 1: Replace the body of `execute_campaign`**

```python
# apps/api/app/workers/tasks/campaign_tasks.py  (execute_campaign)
async def execute_campaign(campaign_id, db_factory=None) -> None:
    factory = db_factory or async_session_factory
    async with factory() as db:
        campaign = await db.get(Campaign, campaign_id)
        if campaign is None:
            return
        from app.services.agents.director import run_campaign
        await run_campaign(campaign, db)
```

Remove now-unused imports in that file (`CampaignContext`, `ACTIONS`, `project_profile`, `_now` if unused elsewhere) — run `python -c "import app.workers.tasks.campaign_tasks"` to confirm no NameErrors.

- [ ] **Step 2: Verify the worker module imports cleanly**

Run: `docker compose exec -T api python -c "import app.workers.tasks.campaign_tasks; from app.services.agents.director import run_campaign; print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Full test suite green**

Run: `docker compose exec -T api pytest -q`
Expected: all agent tests pass; no import errors in the campaign path.

- [ ] **Step 4: Golden run (manual)**

With an org that has an AI key, create a campaign per persona via `/campaigns` and Run it. Confirm in the DB / UI: steps use varied agents; two campaigns for the same goal produce **different** article titles (dedup); `CampaignStep.structured.review` shows a score; the visual is on-brief. Note results in the PR description.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/workers/tasks/campaign_tasks.py
git commit -m "feat(agents): campaign worker runs on the new agent director"
```

---

## Self-Review

**Spec coverage:**
- Brief + build_brief → Tasks 2, 3. ✅
- Skill/AgentResult + AgentRunner (tools, tier, parse+repair, persist) → Tasks 2, 5. ✅
- Tool registry → Task 4. ✅
- Specialized skills for all 7 agents → Tasks 6, 7, 8. ✅
- Skill registry (supersedes ACTIONS) → Task 9. ✅
- Reviewer (deterministic + LLM) → Task 10. ✅
- Director plan + guard + review/retry/handoff loop → Tasks 11, 12. ✅
- User-configurable tier (org column + resolve_model) → Tasks 1, 13. ✅
- Campaign migration (models/UI unchanged; worker delegates) → Task 14. ✅
- Error handling (tool degrade, parse repair, provider fallback, reviewer never blocks) → Tasks 4, 5, 10, 12. ✅
- Testing (pure-function pytest + golden run) → every task + Task 14. ✅
- Phase 2/3 (standalone surfaces, copilots) → **out of scope for this plan** (separate plans), matching the spec's phasing.

**Placeholder scan:** Task 13's migration uses `<rev>`/`<current_head>` — these are intentional fill-ins the implementer sets from `alembic heads` (documented in the step), not vague requirements. No "TBD/handle edge cases/similar to Task N".

**Type consistency:** `AgentResult`, `Skill`, `Brief` fields are used identically across Tasks 2–14. `build_prompt(brief, inputs, tool_data) -> (system, user)` is consistent. `run(skill, brief, inputs, tier, db, keys, campaign)` matches its callers in Task 12. `review(...) -> {passed, score, feedback}` consistent Tasks 10/12. `resolve_model(tier, weight, available)` consistent Tasks 1/5/10/11.

One correction folded in: Task 12's initial `resolved_tier` uses a placeholder `org = None` block that Task 13 replaces with the real org-tier lookup — Task 13 explicitly rewrites it, so the final state is correct.
