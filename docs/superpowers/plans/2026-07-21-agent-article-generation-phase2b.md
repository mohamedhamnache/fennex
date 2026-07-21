# Article Generation on the Agent Core — Phase 2b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move standalone long-form article generation (`generate_article_task`) onto the agent core — running it through `AgentRunner`/a Dune skill — while preserving every quality guarantee it has today: the long-form token budget, real-search grounding, the `ensure_seo_quality` repair loop, `ArticleRevision` history, in-place update of the existing article row, and explicit provider/model overrides.

**Architecture:** Three small, backward-compatible enrichments to the core (a per-`Skill` `max_tokens`, `provider/model` overrides on `AgentRunner.run`/`run_standalone`, and a `brief.runtime` dict the runner fills with the resolved provider/model/key so `persist` steps that need to make follow-up LLM calls can) unlock a new `dune.GENERATE_ARTICLE` skill. Its tools load the existing article's context + SEO grounding (async, into `tool_data`); its `build_prompt` reuses the proven article prompt; its `persist` runs `ensure_seo_quality`, updates the existing `Article` in place, and writes an `ArticleRevision`. The arq worker `generate_article_task` becomes a thin wrapper: resolve overrides → `run_standalone(dune.GENERATE_ARTICLE, …)` → map failures to `Article.status = failed`.

**Tech Stack:** Python 3.11 async, SQLAlchemy 2 (asyncpg), arq worker, Anthropic/OpenAI via `AgentRunner` → `call_llm`, pytest (`asyncio_mode = "auto"`). No migration.

## Global Constraints

- The three core enrichments MUST be backward compatible: every existing `Skill` (no `max_tokens`), every existing `persist` (ignores `brief.runtime`), and every existing `AgentRunner.run` caller (no overrides) behaves exactly as before. Phase 1 campaign tests and Phase 2 standalone tests must stay green.
- Generation goes through `AgentRunner.run` / `run_standalone`; never call `call_llm` directly in the worker.
- Preserve the article endpoint contract: `POST /articles/{id}/generate` still enqueues `generate_article_task(article_id, org_id, provider_override, model_override)`; the task still updates the existing `Article` in place and writes one `ArticleRevision` noted `"Initial generation"`.
- Preserve quality: long-form budget `ARTICLE_MAX_TOKENS = 8192` (`app.services.llm_service`); `ensure_seo_quality(provider, model, api_key, title, keyword, body_md, meta_description, locale) -> (body_md, score)` (`app.services.writing_service`); `_seo_grounding(project, article, live_body, db, include_checks=False) -> str` (same module).
- No emoji anywhere. Tests in `apps/api/tests/`, run `cd apps/api && pytest -q`.

---

## File Structure

```
apps/api/app/services/agents/
  spec.py       # MODIFY: Skill.max_tokens: int | None = None
  brief.py      # MODIFY: Brief.runtime: dict (default {})
  runner.py     # MODIFY: max_tokens pass-through; provider/model overrides; fill brief.runtime before persist
  standalone.py # MODIFY: run_standalone passes provider_override/model_override through
  tools.py      # MODIFY: add article_context + seo_grounding tools
  skills/dune.py# MODIFY: add GENERATE_ARTICLE skill (in-place persist + ensure_seo_quality + revision)
  registry.py   # MODIFY: register dune.GENERATE_ARTICLE
apps/api/app/workers/tasks/
  article_tasks.py  # MODIFY: generate_article_task delegates to run_standalone
apps/api/tests/
  test_agents_runner.py        # append: max_tokens, overrides, brief.runtime
  test_agents_article_skill.py # new: article_context/seo_grounding tools + GENERATE_ARTICLE persist
```

---

### Task 1: Per-`Skill` `max_tokens` + runner pass-through

**Files:**
- Modify: `apps/api/app/services/agents/spec.py` (add `max_tokens`)
- Modify: `apps/api/app/services/agents/runner.py` (pass to `call_llm`)
- Test: `apps/api/tests/test_agents_runner.py` (append)

**Interfaces:**
- Produces: `Skill.max_tokens: int | None = None`. When set, `AgentRunner.run` calls `call_llm(..., max_tokens=skill.max_tokens)` for both the initial and repair call; when `None`, `call_llm` is invoked exactly as today (its own default applies).

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_runner.py  (append)
def _mt_skill():
    from app.services.agents.spec import Skill
    return Skill(key="dune.generate_article", agent_id="dune", weight="heavy", tools=[],
                 build_prompt=lambda b, i, td: ("SYS", "USR"), output="markdown",
                 parse=lambda raw: raw, max_tokens=8192)


async def test_run_passes_skill_max_tokens_to_call_llm():
    seen = {}
    async def fake_call(provider, model, key, system, user, locale="en", max_tokens=4096):
        seen["max_tokens"] = max_tokens
        return "body"
    with patch("app.services.agents.runner.call_llm", new=fake_call):
        r = await AgentRunner.run(_mt_skill(), _brief(), inputs={}, tier="balanced", db=None, keys={"anthropic": "x"})
    assert r.ok and seen["max_tokens"] == 8192
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_runner.py::test_run_passes_skill_max_tokens_to_call_llm -q`
Expected: FAIL — `TypeError: Skill.__init__() got an unexpected keyword argument 'max_tokens'`.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/app/services/agents/spec.py`, add to `Skill` (after `persist`):

```python
    max_tokens: Optional[int] = None
```

In `apps/api/app/services/agents/runner.py`, replace the two `call_llm(...)` calls so `max_tokens` is forwarded only when set:

```python
            mt = {"max_tokens": skill.max_tokens} if skill.max_tokens else {}
            raw = await call_llm(provider, model, keys[provider], system, user, locale=brief.locale, **mt)
```

and for the repair call:

```python
                raw2 = await call_llm(provider, model, keys[provider], system,
                                      user + "\n\nReturn ONLY valid JSON. No prose, no code fences.",
                                      locale=brief.locale, **mt)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_agents_runner.py -q`
Expected: PASS (all, including Phase 1 runner tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/spec.py apps/api/app/services/agents/runner.py apps/api/tests/test_agents_runner.py
git commit -m "feat(agents): per-skill max_tokens forwarded to call_llm"
```

---

### Task 2: Provider/model overrides + `brief.runtime`

**Files:**
- Modify: `apps/api/app/services/agents/brief.py` (add `runtime`)
- Modify: `apps/api/app/services/agents/runner.py` (overrides + fill `brief.runtime`)
- Modify: `apps/api/app/services/agents/standalone.py` (pass overrides through)
- Test: `apps/api/tests/test_agents_runner.py` (append)

**Interfaces:**
- Produces:
  - `Brief.runtime: dict` (default `{}`) — filled by the runner each run with `{"provider", "model", "api_key", "tier", "inputs"}` right before `persist`, so a `persist` that must make follow-up LLM calls (e.g. `ensure_seo_quality`) uses the same model.
  - `AgentRunner.run(..., provider_override=None, model_override=None)` — when both set and `provider_override` is in `keys`, use them verbatim instead of `resolve_model`; otherwise resolve as today.
  - `run_standalone(..., provider_override=None, model_override=None)` — forwards both to `AgentRunner.run`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_runner.py  (append)
async def test_override_bypasses_resolve_and_fills_runtime():
    captured = {}
    async def persist(content, campaign, brief, db):
        captured["runtime"] = dict(brief.runtime)
        from app.services.agents.spec import AgentResult
        return AgentResult(ok=True, summary="saved")
    from app.services.agents.spec import Skill
    skill = Skill(key="dune.generate_article", agent_id="dune", weight="heavy", tools=[],
                  build_prompt=lambda b, i, td: ("S", "U"), output="markdown", parse=lambda r: r, persist=persist)
    async def fake_call(provider, model, key, system, user, locale="en", max_tokens=4096):
        captured["provider"] = provider; captured["model"] = model
        return "body"
    with patch("app.services.agents.runner.call_llm", new=fake_call):
        r = await AgentRunner.run(skill, _brief(), inputs={"a": 1}, tier="balanced", db=None,
                                  keys={"anthropic": "x", "openai": "y"},
                                  provider_override="openai", model_override="gpt-4o")
    assert r.ok and captured["provider"] == "openai" and captured["model"] == "gpt-4o"
    assert captured["runtime"]["provider"] == "openai" and captured["runtime"]["api_key"] == "y"
    assert captured["runtime"]["inputs"] == {"a": 1}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_runner.py::test_override_bypasses_resolve_and_fills_runtime -q`
Expected: FAIL — `run` has no `provider_override`; `brief.runtime` missing.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/app/services/agents/brief.py`, add to the `Brief` dataclass (after `artifacts`):

```python
    runtime: dict = field(default_factory=dict)
```

In `apps/api/app/services/agents/runner.py`, update the signature and resolution:

```python
    @staticmethod
    async def run(skill, brief, inputs, tier, db, keys=None, campaign=None,
                  provider_override=None, model_override=None) -> AgentResult:
```

Replace the `provider, model = resolve_model(...)` line with:

```python
            if provider_override and model_override and provider_override in keys:
                provider, model = provider_override, model_override
            else:
                provider, model = resolve_model(tier, skill.weight, available)
```

Immediately before `if skill.persist:`, fill runtime:

```python
            brief.runtime = {"provider": provider, "model": model, "api_key": keys[provider],
                             "tier": tier, "inputs": inputs or {}}
```

In `apps/api/app/services/agents/standalone.py`, thread overrides:

```python
async def run_standalone(skill, project_id, org_id, goal: str, db, inputs=None, persona=None,
                         provider_override=None, model_override=None):
    if persona is None:
        proj = await db.get(Project, project_id)
        persona = getattr(proj, "persona", None) or "creator"
    tier = await org_tier(org_id, db)
    brief = await build_brief(project_id, org_id, goal, persona, db)
    return await AgentRunner.run(skill, brief, inputs or {}, tier, db,
                                 provider_override=provider_override, model_override=model_override)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_agents_runner.py tests/test_agents_standalone.py tests/test_agents_director.py -q`
Expected: PASS (all — existing persists ignore `brief.runtime`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/brief.py apps/api/app/services/agents/runner.py apps/api/app/services/agents/standalone.py apps/api/tests/test_agents_runner.py
git commit -m "feat(agents): runner provider/model overrides + brief.runtime for persist follow-ups"
```

---

### Task 3: `article_context` + `seo_grounding` tools

**Files:**
- Modify: `apps/api/app/services/agents/tools.py` (two async tools)
- Test: `apps/api/tests/test_agents_article_skill.py` (new)

**Interfaces:**
- Consumes: `Article`, `BrandVoice` (`app.models`), `_build_system_prompt`/`_build_user_prompt` (`app.workers.tasks.article_tasks`), `_seo_grounding` (`app.services.writing_service`), `project_profile` (`app.services.ai_analytics_service`).
- Produces (both read `inputs["article_id"]`; both degrade to a safe empty payload on any failure, per the tool contract):
  - `article_context(brief, db, inputs) -> {"system": str, "user": str, "title": str, "keyword": str|None}` — loads the Article (+ its BrandVoice + profile), returns the ready-built article prompts and identifiers. Returns `{}` if the article is missing.
  - `seo_grounding(brief, db, inputs) -> {"grounding": str}` — loads Project + Article and returns `_seo_grounding(project, article, None, db, include_checks=False)`; `{"grounding": ""}` on failure.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_article_skill.py
import uuid, pytest
from unittest.mock import AsyncMock, patch
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
from app.models.article import Article, ArticleStatus
from app.services.agents.brief import Brief
from app.services.agents import tools as T

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


async def _brief_art(db):
    org = Organization(slug=f"o{uuid.uuid4().hex[:6]}", name="O"); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="P", domain="p.com"); db.add(proj); await db.flush()
    art = Article(org_id=org.id, project_id=proj.id, title="Vegan protein guide",
                  target_keyword="vegan protein", status=ArticleStatus.generating)
    db.add(art); await db.commit()
    brief = Brief(goal="g", persona="creator", project_id=proj.id, org_id=org.id, locale="en",
                  project_profile="A vegan blog", brand={}, existing_content=[], artifacts=[])
    return brief, art


async def test_article_context_returns_prompts(db):
    brief, art = await _brief_art(db)
    data = await T.article_context(brief, db, {"article_id": str(art.id)})
    assert data["title"] == "Vegan protein guide" and data["keyword"] == "vegan protein"
    assert isinstance(data["system"], str) and "vegan protein" in data["user"].lower()


async def test_article_context_missing_article(db):
    brief, art = await _brief_art(db)
    assert await T.article_context(brief, db, {"article_id": str(uuid.uuid4())}) == {}


async def test_seo_grounding_tool_degrades(db):
    brief, art = await _brief_art(db)
    with patch("app.services.writing_service._seo_grounding", new=AsyncMock(return_value="GSC: vegan protein (pos 8)")):
        data = await T.seo_grounding(brief, db, {"article_id": str(art.id)})
    assert data["grounding"] == "GSC: vegan protein (pos 8)"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_article_skill.py -q`
Expected: FAIL — `AttributeError: module ... has no attribute 'article_context'`.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/app/services/agents/tools.py`:

```python
async def article_context(brief, db, inputs):
    from app.models.article import Article
    from app.models.brand_voice import BrandVoice
    from app.workers.tasks.article_tasks import _build_system_prompt, _build_user_prompt
    aid = (inputs or {}).get("article_id")
    if not aid:
        return {}
    article = await db.get(Article, aid if not isinstance(aid, str) else __import__("uuid").UUID(aid))
    if article is None:
        return {}
    brand_voice = await db.get(BrandVoice, article.brand_voice_id) if article.brand_voice_id else None
    return {"system": _build_system_prompt(brand_voice, brief.project_profile),
            "user": _build_user_prompt(article),
            "title": article.title, "keyword": article.target_keyword}


async def seo_grounding(brief, db, inputs):
    from app.models.article import Article
    from app.models.project import Project
    from app.services.writing_service import _seo_grounding
    aid = (inputs or {}).get("article_id")
    if not aid:
        return {"grounding": ""}
    try:
        art = await db.get(Article, aid if not isinstance(aid, str) else __import__("uuid").UUID(aid))
        project = await db.get(Project, art.project_id) if art else None
        if art is None or project is None:
            return {"grounding": ""}
        return {"grounding": await _seo_grounding(project, art, None, db, include_checks=False)}
    except Exception:
        return {"grounding": ""}
```

Register both in the `TOOLS` dict:

```python
    "article_context": article_context,
    "seo_grounding": seo_grounding,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_agents_article_skill.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/tools.py apps/api/tests/test_agents_article_skill.py
git commit -m "feat(agents): article_context + seo_grounding tools"
```

---

### Task 4: `dune.GENERATE_ARTICLE` skill (in-place persist + ensure_seo_quality + revision)

**Files:**
- Modify: `apps/api/app/services/agents/skills/dune.py` (new `GENERATE_ARTICLE`)
- Modify: `apps/api/app/services/agents/registry.py` (register it)
- Test: `apps/api/tests/test_agents_article_skill.py` (append)

**Interfaces:**
- Consumes: `article_context`/`seo_grounding` tools (Task 3), `brief.runtime` (Task 2), `ensure_seo_quality` (`app.services.writing_service`), `compute_seo_score`/`_markdown_to_html` (`app.services.article_service`), `_parse_llm_response` (`app.workers.tasks.article_tasks`), `Article`/`ArticleStatus`/`ArticleRevision`.
- Produces: `dune.GENERATE_ARTICLE: Skill` — `weight="heavy"`, `max_tokens=ARTICLE_MAX_TOKENS`, `tools=["article_context", "seo_grounding"]`, `output="markdown"`, `parse=lambda r: r`. `build_prompt` returns the article_context prompts (+ grounding appended to `user`, + feedback). `persist` runs `ensure_seo_quality` (via `brief.runtime`), updates the existing `Article` in place, writes an `ArticleRevision` noted `"Initial generation"`, returns `AgentResult(artifact_type="article", artifact_ids=[article_id])`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_article_skill.py  (append)
from sqlalchemy import select
from app.models.article import ArticleRevision
from app.services.agents.spec import AgentResult


def test_generate_article_prompt_uses_tool_context_and_grounding():
    from app.services.agents.skills import dune
    from app.services.agents.brief import Brief
    brief = Brief(goal="g", persona="creator", project_id=uuid.uuid4(), org_id=uuid.uuid4(), locale="en",
                  project_profile="", brand={}, existing_content=[], artifacts=[])
    td = {"article_context": {"ok": True, "data": {"system": "SYS", "user": "USER-PROMPT", "title": "T", "keyword": "k"}},
          "seo_grounding": {"ok": True, "data": {"grounding": "GSC ROWS"}}}
    system, user = dune.GENERATE_ARTICLE.build_prompt(brief, {"feedback": "add specifics"}, td)
    assert system == "SYS" and "USER-PROMPT" in user and "GSC ROWS" in user and "add specifics" in user
    assert dune.GENERATE_ARTICLE.max_tokens is not None and dune.GENERATE_ARTICLE.persist is not None


async def test_generate_article_persist_updates_in_place(db):
    from app.services.agents.skills import dune
    brief, art = await _brief_art(db)
    brief.runtime = {"provider": "anthropic", "model": "claude-opus-4-8", "api_key": "x",
                     "tier": "balanced", "inputs": {"article_id": str(art.id)}}
    raw = "META_TITLE: T\nMETA_DESCRIPTION: D\n---\n# T\n\nvegan protein body with enough words."
    with patch("app.services.agents.skills.dune.ensure_seo_quality",
               new=AsyncMock(return_value=("# T\n\nfinal body", 88.0))):
        res = await dune.GENERATE_ARTICLE.persist(raw, None, brief, db)
    assert res.ok and res.artifact_type == "article" and res.artifact_ids == [str(art.id)]
    await db.refresh(art)
    assert art.status == ArticleStatus.ready and art.seo_score == 88.0 and art.body_markdown == "# T\n\nfinal body"
    revs = (await db.execute(select(ArticleRevision).where(ArticleRevision.article_id == art.id))).scalars().all()
    assert len(revs) == 1 and revs[0].note == "Initial generation"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_article_skill.py -q`
Expected: FAIL — `AttributeError: module ... 'dune' has no attribute 'GENERATE_ARTICLE'`.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/app/services/agents/skills/dune.py`:

```python
import uuid as _uuid
from app.models.article import ArticleRevision
from app.services.llm_service import ARTICLE_MAX_TOKENS
from app.services.writing_service import ensure_seo_quality


def _generate_article_prompt(brief, inputs, td):
    ctx = (td.get("article_context") or {}).get("data") or {}
    system = ctx.get("system") or _build_system_prompt(None, brief.project_profile)
    user = ctx.get("user") or brief.goal
    grounding = (td.get("seo_grounding") or {}).get("data", {}).get("grounding", "")
    if grounding:
        user += ("\n\nREAL SEARCH DATA for this site - weave these naturally into headings, copy and the "
                 "FAQ where they fit the topic (never stuff):\n" + grounding)
    user += feedback_block(inputs)
    return system, user


async def _persist_generated_article(raw_markdown, campaign, brief, db):
    rt = brief.runtime or {}
    aid = (rt.get("inputs") or {}).get("article_id")
    article = await db.get(Article, aid if not isinstance(aid, str) else _uuid.UUID(aid)) if aid else None
    if article is None:
        return AgentResult(ok=False, error="Article not found for generation.")
    parsed = _parse_llm_response(raw_markdown, article.title)
    body_md, seo_score = await ensure_seo_quality(
        rt.get("provider"), rt.get("model"), rt.get("api_key"),
        article.title, article.target_keyword, parsed["body_markdown"], parsed["meta_description"], brief.locale,
    )
    article.body_markdown = body_md
    article.body_html = _markdown_to_html(body_md)
    article.meta_title = parsed["meta_title"]
    article.meta_description = parsed["meta_description"]
    article.word_count = len(body_md.split())
    article.seo_score = seo_score
    article.status = ArticleStatus.ready
    article.error = None
    db.add(ArticleRevision(article_id=article.id, body_markdown=body_md,
                           word_count=article.word_count, note="Initial generation"))
    await db.commit()
    return AgentResult(ok=True, summary=f"Article: {article.title}", artifact_type="article",
                       artifact_ids=[str(article.id)],
                       structured={"article_id": str(article.id), "seo_score": seo_score,
                                   "word_count": article.word_count})


GENERATE_ARTICLE = Skill(
    key="dune.generate_article", agent_id="dune", weight="heavy",
    tools=["article_context", "seo_grounding"], build_prompt=_generate_article_prompt,
    output="markdown", parse=lambda raw: raw, persist=_persist_generated_article,
    max_tokens=ARTICLE_MAX_TOKENS, label="Generate the article",
    description="Generate an existing article in place with SEO grounding + quality repair.",
)
```

Register in `apps/api/app/services/agents/registry.py`: add `dune.GENERATE_ARTICLE` to the `_ALL` list (after `dune.PRODUCT_COPY`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_agents_article_skill.py tests/test_agents_skills.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/skills/dune.py apps/api/app/services/agents/registry.py apps/api/tests/test_agents_article_skill.py
git commit -m "feat(agents): dune.GENERATE_ARTICLE in-place skill (grounding + ensure_seo_quality + revision)"
```

---

### Task 5: Delegate `generate_article_task` to the agent core

**Files:**
- Modify: `apps/api/app/workers/tasks/article_tasks.py` (`generate_article_task` body)
- Test: manual golden run (integration seam; `_build_*`/`_parse_*` helpers stay for the tools/skill to import)

**Interfaces:**
- Consumes: `run_standalone` (Task 2), `dune.GENERATE_ARTICLE`.
- Produces: `generate_article_task(ctx, article_id, org_id, provider_override=None, model_override=None)` — loads the article, sets `failed` if missing keys / no article, else calls `run_standalone(dune.GENERATE_ARTICLE, article.project_id, org_id, goal, db, inputs={"article_id": article_id}, provider_override=…, model_override=…)`; on `not ok` sets `Article.status = failed` + `error`.

- [ ] **Step 1: Replace the body of `generate_article_task`**

```python
# apps/api/app/workers/tasks/article_tasks.py
async def generate_article_task(ctx, article_id, org_id, provider_override=None, model_override=None):
    """ARQ task: generate an article in place via the agent core (dune.GENERATE_ARTICLE)."""
    article_id_uuid = uuid.UUID(article_id)
    org_id_uuid = uuid.UUID(org_id)
    from app.services.agents.skills.dune import GENERATE_ARTICLE
    from app.services.agents.standalone import run_standalone

    async with async_session_factory() as db:
        article = await db.get(Article, article_id_uuid)
        if article is None:
            return
        org_keys = await get_org_llm_keys(org_id_uuid, db)
        if not org_keys:
            article.status = ArticleStatus.failed
            article.error = "No LLM API keys configured. Add keys in Settings."
            await db.commit()
            return
        project_id = article.project_id
        goal = f"Write the article: {article.title}"

        result = await run_standalone(
            GENERATE_ARTICLE, project_id, org_id_uuid, goal, db,
            inputs={"article_id": article_id},
            provider_override=provider_override, model_override=model_override,
        )
        if not result.ok:
            art = await db.get(Article, article_id_uuid)
            if art is not None:
                art.status = ArticleStatus.failed
                art.error = result.error or "Generation failed."
                await db.commit()
```

Leave `_build_system_prompt`, `_build_user_prompt`, `_parse_llm_response` defined in the module (the tools/skill import them). Remove now-unused imports in the task body only if the import-sanity check flags them; keep the helper functions.

- [ ] **Step 2: Verify the worker module imports cleanly**

Run: `cd apps/api && python -c "import app.workers.tasks.article_tasks; from app.services.agents.skills.dune import GENERATE_ARTICLE; print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Full agent + article suite green**

Run: `cd apps/api && pytest tests/test_agents_runner.py tests/test_agents_article_skill.py tests/test_agents_skills.py tests/test_agents_director.py tests/test_campaigns.py -q`
Expected: PASS (no regressions in campaigns/runner).

- [ ] **Step 4: Golden run (manual, with an AI key)**

Create an article, `POST /articles/{id}/generate` (with and without a `provider`/`model` override). Confirm: status goes `generating → ready`, the body is grounded and SEO-scored, one `ArticleRevision` noted "Initial generation" exists, and an override actually changes the model used. Note results in the PR description.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/workers/tasks/article_tasks.py
git commit -m "feat(agents): article generation worker runs on dune.GENERATE_ARTICLE"
```

---

### Task 6: Full-suite verification

- [ ] **Step 1: Import sanity**

Run: `cd apps/api && python -c "import app.services.agents.runner, app.services.agents.tools, app.services.agents.skills.dune, app.services.agents.registry, app.workers.tasks.article_tasks; print('ok')"`
Expected: `ok`.

- [ ] **Step 2: Full suite**

Run: `cd apps/api && pytest -q`
Expected: all Phase 1/2/2b tests pass; only the three pre-existing unrelated failures (`test_edit_model.py::test_generated_image_has_source_image_id_column`, `test_images.py::test_delete_image`, `test_storage.py::test_upload_bytes_calls_put_object`) remain. No new failures.

- [ ] **Step 3: Commit (empty allowed for a verification checkpoint)**

```bash
git commit --allow-empty -m "chore(agents): Phase 2b verification"
```

---

## Self-Review

**Spec coverage (the deferred Phase 2 item: article generation onto the runner):**
- Long-form budget → Task 1 (`Skill.max_tokens = ARTICLE_MAX_TOKENS`). ✅
- Provider/model overrides + model context for follow-up calls → Task 2 (overrides + `brief.runtime`). ✅
- Real-search grounding → Task 3 (`seo_grounding` tool) + Task 4 (appended to the prompt). ✅
- `ensure_seo_quality` repair loop → Task 4 persist (uses `brief.runtime` provider/model/key). ✅
- In-place update + `ArticleRevision` → Task 4 persist. ✅
- Worker seam preserved (endpoint + arq contract unchanged) → Task 5. ✅

**Backward-compat guardrails:** `Skill.max_tokens` and `Brief.runtime` default to no-op; `AgentRunner.run` overrides default `None`; existing persists never read `brief.runtime`. Tasks 1-2 explicitly re-run the Phase 1/2 suites (`test_agents_director`, `test_agents_standalone`, `test_campaigns`) to prove no regression before the article skill is added.

**Model routing note:** the old task used `LLMRouter(TaskType.LONG_FORM_ARTICLE)` for default model choice; Phase 2b intentionally replaces that with the org's `agent_tier` (heavy weight → premium) so article generation obeys the same tier control as every other agent. Explicit `provider`/`model` overrides from the endpoint are still honored verbatim (Task 2). This is a deliberate behavior change, called out for the golden run.

**Placeholder scan:** none — every step ships real code; the `__import__("uuid")` in Task 3 is a deliberate inline to keep the tool self-contained. **Type consistency:** `run_standalone(..., provider_override, model_override)` matches its caller in Task 5; `brief.runtime` keys (`provider/model/api_key/tier/inputs`) written in Task 2 match the reads in Task 4; `ensure_seo_quality` positional args match its real signature.
```
