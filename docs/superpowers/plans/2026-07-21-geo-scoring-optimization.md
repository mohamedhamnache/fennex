# GEO Scoring & Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Articles a GEO ("answer-engine readiness") score with the same touchpoints the SEO score has — a deterministic core + one LLM judgment, auto-enforced to a floor during article generation, recomputed on manual edits, and exposed via `GET /articles/{id}/geo-score`.

**Architecture:** A new `app/services/geo_service.py` (parallels `writing_service.py`) holds a pure deterministic `compute_geo_core` (0-70), an async `geo_llm_judgment` (0-30, never raises), a hybrid `compute_geo_score`, and an `ensure_geo_quality` repair loop (gates on the deterministic core; one targeted LLM repair pass when below floor; never raises). A new nullable `articles.geo_score` column stores it. Generation runs `ensure_geo_quality` right after `ensure_seo_quality` inside `dune.GENERATE_ARTICLE`'s persist; the article update endpoint recomputes the core; a new endpoint exposes score + live breakdown.

**Tech Stack:** Python 3.11 async, SQLAlchemy 2 (asyncpg), Alembic, Anthropic/OpenAI via `app.services.llm_service.call_llm`, pytest (`asyncio_mode = "auto"`).

## Global Constraints

- Score is on 0-100: up to **70** is the deterministic structural core (recomputed anywhere), up to **30** is the AI-answer LLM judgment (added **only during generation**). After a manual edit the stored `geo_score` is core-only (≤70) until the next generation.
- LLM calls go through `call_llm(provider, model, api_key, system_prompt, user_prompt, locale=..., max_tokens=...)` (`app.services.llm_service`). Never call SDKs directly.
- Every LLM-dependent GEO function degrades safely and **never raises**: `geo_llm_judgment` → `(0.0, "")` on failure; `ensure_geo_quality` repair failure → original body. A GEO problem never fails article generation.
- Scope: **Articles only**. No product-copy/social GEO, no brand-citation tracking, no brand governance, no manual "optimize" button. No change to `compute_seo_score` / `ensure_seo_quality`.
- Tests in `apps/api/tests/`, run `cd apps/api && pytest -q`. Migration applied with `docker compose exec -T api alembic upgrade head`.
- `GEO_CORE_FLOOR = 45` (out of 70).

---

## File Structure

```
apps/api/app/services/geo_service.py            # NEW: compute_geo_core, geo_llm_judgment, compute_geo_score, ensure_geo_quality, GEO_CORE_FLOOR
apps/api/app/models/article.py                  # MODIFY: geo_score column
apps/api/alembic/versions/<rev>_article_geo_score.py  # NEW migration
apps/api/app/services/agents/skills/dune.py     # MODIFY: GENERATE_ARTICLE persist runs ensure_geo_quality
apps/api/app/api/v1/routers/articles.py         # MODIFY: ArticleOut.geo_score; update-endpoint core recompute; GET /{id}/geo-score
apps/api/tests/test_geo_service.py              # NEW
apps/api/tests/test_agents_article_skill.py     # MODIFY: assert geo_score set on generation
apps/api/tests/test_articles_geo.py             # NEW: endpoint + update recompute
```

---

### Task 1: `compute_geo_core` (deterministic 0-70)

**Files:**
- Create: `apps/api/app/services/geo_service.py`
- Test: `apps/api/tests/test_geo_service.py`

**Interfaces:**
- Produces: `compute_geo_core(title: str, body_markdown: str | None, meta_description: str | None) -> tuple[float, dict]` — returns `(core_score 0-70, breakdown)` where `breakdown` has keys `answer_up_top, qa_structure, extractable_format, statistics, citations, concise_paragraphs` (each the earned points).

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_geo_service.py
from app.services.geo_service import compute_geo_core

_RICH = (
    "# Best vegan protein\n\n"
    "The best vegan protein for runners is pea-rice blend at 25g per serving, taken within "
    "30 minutes post-run for recovery and steady daily intake across training weeks here.\n\n"
    "## What is the best option?\n\n"
    "According to a 2023 study, 80% of runners improved recovery. See [the report](https://example.com/report).\n\n"
    "- Pea protein\n- Rice protein\n- Hemp protein\n\n"
    "## FAQ\n\nShort answer here.\n"
)


def test_core_rewards_all_signals():
    score, b = compute_geo_core("Best vegan protein", _RICH, "meta")
    assert b["answer_up_top"] == 15
    assert b["qa_structure"] == 12
    assert b["extractable_format"] == 12
    assert b["statistics"] == 10
    assert b["citations"] == 11
    assert b["concise_paragraphs"] == 10
    assert score == 70.0


def test_core_zero_for_bare_content():
    score, b = compute_geo_core("T", "# T\n\nOne short line.", None)
    assert b["qa_structure"] == 0 and b["extractable_format"] == 0 and b["citations"] == 0
    assert score <= 25  # maybe answer/concise partials only


def test_core_never_exceeds_70():
    score, _ = compute_geo_core("T", _RICH * 3, "m")
    assert 0 <= score <= 70
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_geo_service.py -q`
Expected: FAIL — `ModuleNotFoundError: app.services.geo_service`.

- [ ] **Step 3: Write minimal implementation**

```python
# apps/api/app/services/geo_service.py
"""GEO (Generative Engine Optimization) scoring & repair — answer-engine readiness.

Parallels writing_service.py's SEO score/repair. The deterministic core (0-70) is the
single source of truth recomputed anywhere; the LLM judgment (0-30) is added only during
generation. Every LLM path degrades safely and never raises."""
import re

GEO_CORE_FLOOR = 45   # out of 70; below this, generation runs one repair pass


def compute_geo_core(title, body_markdown, meta_description) -> tuple[float, dict]:
    body = body_markdown or ""
    breakdown: dict = {}
    score = 0.0

    # 1. answer_up_top (+15): a plain paragraph (~30-120 words) before the first H2.
    before_h2 = re.split(r"(?m)^##\s", body, maxsplit=1)[0]
    answer = 0
    for para in re.split(r"\n\s*\n", before_h2):
        p = para.strip()
        if not p or p.startswith("#") or p.startswith(("-", "*", ">", "|")) or re.match(r"^\d+\.", p):
            continue
        if 30 <= len(p.split()) <= 120:
            answer = 15
            break
    breakdown["answer_up_top"] = answer; score += answer

    # 2. qa_structure (+12): a heading containing '?' or an FAQ heading.
    qa = 0
    for ln in body.splitlines():
        s = ln.strip()
        if s.startswith("#") and ("?" in s or re.search(r"\bfaq\b|frequently asked", s, re.I)):
            qa = 12; break
    breakdown["qa_structure"] = qa; score += qa

    # 3. extractable_format (+12): a markdown list or table.
    has_list = bool(re.search(r"(?m)^\s*(?:[-*]\s+|\d+\.\s+)", body))
    has_table = bool(re.search(r"\S \| \S", body))
    ef = 12 if (has_list or has_table) else 0
    breakdown["extractable_format"] = ef; score += ef

    # 4. statistics (+10 / +5): count digit characters.
    nums = len(re.findall(r"\d", body))
    stat = 10 if nums >= 6 else (5 if nums >= 3 else 0)
    breakdown["statistics"] = stat; score += stat

    # 5. citations (+11): a markdown http link or a citation phrase.
    cite = 11 if (re.search(r"\[[^\]]+\]\(https?://", body)
                  or re.search(r"according to|source:|\bstudy\b|\breport\b", body, re.I)) else 0
    breakdown["citations"] = cite; score += cite

    # 6. concise_paragraphs (+10 / +5): median paragraph <= 4 sentences.
    paras = [p.strip() for p in re.split(r"\n\s*\n", body)
             if p.strip() and not p.strip().startswith(("#", "-", "*", "|", ">"))]
    conc = 0
    if paras:
        counts = sorted(max(1, len(re.findall(r"[.!?]+", p))) for p in paras)
        median = counts[len(counts) // 2]
        conc = 10 if median <= 4 else (5 if median <= 6 else 0)
    breakdown["concise_paragraphs"] = conc; score += conc

    return round(score, 1), breakdown
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_geo_service.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/geo_service.py apps/api/tests/test_geo_service.py
git commit -m "feat(geo): deterministic GEO core score (answer-engine readiness)"
```

---

### Task 2: `geo_llm_judgment` + `compute_geo_score` (hybrid)

**Files:**
- Modify: `apps/api/app/services/geo_service.py`
- Test: `apps/api/tests/test_geo_service.py` (append)

**Interfaces:**
- Consumes: `compute_geo_core` (Task 1); `call_llm` (`app.services.llm_service`).
- Produces:
  - `async geo_llm_judgment(provider, model, api_key, title, body_markdown, locale) -> tuple[float, str]` — one light call; returns `(score 0-30, feedback)`; `(0.0, "")` on any error.
  - `async compute_geo_score(provider, model, api_key, title, body_markdown, meta_description, locale) -> tuple[float, dict]` — `core + judgment` (0-100), breakdown includes `llm_judgment` and `llm_feedback`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_geo_service.py  (append)
import pytest
from unittest.mock import AsyncMock, patch
from app.services import geo_service as G


async def test_judgment_parses_json():
    with patch("app.services.geo_service.call_llm",
               new=AsyncMock(return_value='{"score": 24, "feedback": "clear answer"}')):
        score, fb = await G.geo_llm_judgment("anthropic", "m", "k", "T", "body", "en")
    assert score == 24.0 and fb == "clear answer"


async def test_judgment_clamps_and_survives_bad_output():
    with patch("app.services.geo_service.call_llm", new=AsyncMock(return_value="not json")):
        assert await G.geo_llm_judgment("anthropic", "m", "k", "T", "b", "en") == (0.0, "")
    with patch("app.services.geo_service.call_llm", new=AsyncMock(return_value='{"score": 999}')):
        score, _ = await G.geo_llm_judgment("anthropic", "m", "k", "T", "b", "en")
    assert score == 30.0  # clamped to max


async def test_compute_geo_score_is_core_plus_judgment():
    with patch("app.services.geo_service.geo_llm_judgment", new=AsyncMock(return_value=(20.0, "ok"))):
        score, b = await G.compute_geo_score("anthropic", "m", "k", "Best vegan protein", _RICH, "meta", "en")
    assert score == 90.0 and b["llm_judgment"] == 20.0 and b["answer_up_top"] == 15
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_geo_service.py -k "judgment or compute_geo_score" -q`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/app/services/geo_service.py`:

```python
import json
from app.services.llm_service import call_llm

_JUDGE_SYSTEM = (
    "You rate how ready a piece of content is to be quoted by an AI answer engine "
    "(ChatGPT, Perplexity, Google AI Overviews). Judge ONLY: is there a genuine, "
    "self-contained, quotable answer an engine could extract and trust; is the tone "
    "factual and authoritative; is it direct. Return ONLY JSON: "
    '{"score": 0-30, "feedback": one short actionable sentence}. No prose, no fences.'
)


async def geo_llm_judgment(provider, model, api_key, title, body_markdown, locale) -> tuple[float, str]:
    user = f"TITLE: {title}\n\nCONTENT:\n{(body_markdown or '')[:6000]}"
    try:
        raw = await call_llm(provider, model, api_key, _JUDGE_SYSTEM, user, locale=locale)
        data = json.loads(re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip()))
        score = float(data.get("score", 0))
        score = max(0.0, min(30.0, score))
        return score, str(data.get("feedback", ""))
    except Exception:
        return 0.0, ""


async def compute_geo_score(provider, model, api_key, title, body_markdown, meta_description, locale
                            ) -> tuple[float, dict]:
    core, breakdown = compute_geo_core(title, body_markdown, meta_description)
    judge, feedback = await geo_llm_judgment(provider, model, api_key, title, body_markdown, locale)
    breakdown["llm_judgment"] = judge
    breakdown["llm_feedback"] = feedback
    return round(core + judge, 1), breakdown
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_geo_service.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/geo_service.py apps/api/tests/test_geo_service.py
git commit -m "feat(geo): LLM judgment + hybrid geo score"
```

---

### Task 3: `ensure_geo_quality` (gate + one repair pass, never raises)

**Files:**
- Modify: `apps/api/app/services/geo_service.py`
- Test: `apps/api/tests/test_geo_service.py` (append)

**Interfaces:**
- Consumes: `compute_geo_core`, `compute_geo_score`, `GEO_CORE_FLOOR`, `call_llm`.
- Produces: `async ensure_geo_quality(provider, model, api_key, title, keyword, body_markdown, meta_description, locale) -> tuple[str, float, dict]` — gates on `compute_geo_core`; if `core < GEO_CORE_FLOOR`, runs one `_repair_geo` pass (never raises — original body on failure); returns `(body_markdown, hybrid_score, breakdown)`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_geo_service.py  (append)
async def test_ensure_skips_repair_when_core_ok():
    calls = AsyncMock(return_value='{"score": 25, "feedback": "ok"}')  # only the judgment call
    with patch("app.services.geo_service.call_llm", new=calls):
        body, score, b = await G.ensure_geo_quality("anthropic", "m", "k", "Best vegan protein",
                                                     "vegan protein", _RICH, "meta", "en")
    assert body == _RICH and score == 95.0 and calls.call_count == 1  # judgment only, no repair


async def test_ensure_runs_one_repair_when_core_low():
    thin = "# T\n\nx."
    seq = AsyncMock(side_effect=["# T\n\nRepaired answer with structure.", '{"score": 10, "feedback": "better"}'])
    with patch("app.services.geo_service.call_llm", new=seq):
        body, score, b = await G.ensure_geo_quality("anthropic", "m", "k", "T", "kw", thin, "meta", "en")
    assert body == "# T\n\nRepaired answer with structure." and seq.call_count == 2  # repair + judgment


async def test_ensure_never_raises_on_repair_failure():
    thin = "# T\n\nx."
    async def boom(*a, **k):
        raise RuntimeError("provider down")
    with patch("app.services.geo_service.call_llm", new=boom):
        body, score, b = await G.ensure_geo_quality("anthropic", "m", "k", "T", "kw", thin, "meta", "en")
    assert body == thin and score >= 0  # original body kept, judgment degraded to 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_geo_service.py -k ensure -q`
Expected: FAIL — `ensure_geo_quality` not defined.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/app/services/geo_service.py`:

```python
_REPAIR_SYSTEM = (
    "You improve an article so AI answer engines will quote it, WITHOUT harming its SEO. "
    "Keep the primary keyword usage, meaning, length and Markdown structure. Add ONLY what is "
    "missing: a concise direct answer (~40-70 words) right after the H1; at least one question-"
    "style H2 or a short FAQ; a bulleted list or table where it fits; one credible source/citation; "
    "and tighten long paragraphs. Return ONLY the full revised article in Markdown, nothing else."
)


async def _repair_geo(provider, model, api_key, title, keyword, body_md, meta, locale) -> str | None:
    user = (f"TITLE: {title}\nPRIMARY KEYWORD: {keyword or title}\n\nARTICLE:\n{body_md}")
    try:
        from app.services.llm_service import ARTICLE_MAX_TOKENS
        out = (await call_llm(provider, model, api_key, _REPAIR_SYSTEM, user,
                              locale=locale, max_tokens=ARTICLE_MAX_TOKENS)).strip()
        return out or None
    except Exception:
        return None


async def ensure_geo_quality(provider, model, api_key, title, keyword, body_md, meta, locale
                             ) -> tuple[str, float, dict]:
    core, _ = compute_geo_core(title, body_md, meta)
    if core < GEO_CORE_FLOOR:
        repaired = await _repair_geo(provider, model, api_key, title, keyword, body_md, meta, locale)
        if repaired:
            body_md = repaired
    score, breakdown = await compute_geo_score(provider, model, api_key, title, body_md, meta, locale)
    return body_md, score, breakdown
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_geo_service.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/geo_service.py apps/api/tests/test_geo_service.py
git commit -m "feat(geo): ensure_geo_quality repair loop (gates on core, never raises)"
```

---

### Task 4: `articles.geo_score` column + migration + `ArticleOut`

**Files:**
- Modify: `apps/api/app/models/article.py` (add `geo_score`)
- Create: `apps/api/alembic/versions/u0j1k2l3m4n5_article_geo_score.py`
- Modify: `apps/api/app/api/v1/routers/articles.py` (`ArticleOut.geo_score`)
- Test: `apps/api/tests/test_articles_geo.py` (construction/response smoke)

**Interfaces:**
- Produces: `Article.geo_score: float | None`; `ArticleOut.geo_score: Optional[float]`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_articles_geo.py
import uuid, pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
from app.models.article import Article, ArticleStatus

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


async def test_article_geo_score_column(db):
    org = Organization(slug="o", name="O"); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="P", domain="p.com"); db.add(proj); await db.flush()
    art = Article(org_id=org.id, project_id=proj.id, title="T", status=ArticleStatus.ready, geo_score=63.0)
    db.add(art); await db.commit(); await db.refresh(art)
    assert art.geo_score == 63.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_articles_geo.py::test_article_geo_score_column -q`
Expected: FAIL — `TypeError: 'geo_score' is an invalid keyword argument for Article`.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/app/models/article.py`, after `seo_score`:

```python
    geo_score: Mapped[float | None] = mapped_column(Float)
```

Migration (head is `t9i0j1k2l3m4`):

```python
# apps/api/alembic/versions/u0j1k2l3m4n5_article_geo_score.py
from alembic import op

revision = "u0j1k2l3m4n5"
down_revision = "t9i0j1k2l3m4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE articles ADD COLUMN IF NOT EXISTS geo_score DOUBLE PRECISION")


def downgrade() -> None:
    op.execute("ALTER TABLE articles DROP COLUMN IF EXISTS geo_score")
```

In `apps/api/app/api/v1/routers/articles.py`, add to `ArticleOut` (after `seo_score`):

```python
    geo_score: Optional[float]
```

- [ ] **Step 4: Run test + apply migration**

Run: `cd apps/api && pytest tests/test_articles_geo.py -q` (PASS) and `docker compose exec -T api alembic upgrade head` (Running upgrade → article geo_score).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/models/article.py apps/api/alembic/versions/u0j1k2l3m4n5_article_geo_score.py apps/api/app/api/v1/routers/articles.py apps/api/tests/test_articles_geo.py
git commit -m "feat(geo): articles.geo_score column + ArticleOut field"
```

---

### Task 5: Enforce GEO during generation (`dune.GENERATE_ARTICLE`)

**Files:**
- Modify: `apps/api/app/services/agents/skills/dune.py` (`_persist_generated_article`)
- Test: `apps/api/tests/test_agents_article_skill.py` (extend the persist test)

**Interfaces:**
- Consumes: `ensure_geo_quality` (Task 3), `brief.runtime` (provider/model/api_key — already populated by the runner).
- Produces: `_persist_generated_article` sets `article.geo_score` (the GEO pass runs on the SEO-cleared body, after `ensure_seo_quality`).

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_agents_article_skill.py  (modify test_generate_article_persist_updates_in_place)
async def test_generate_article_persist_updates_in_place(db):
    from app.services.agents.skills import dune
    brief, art = await _brief_art(db)
    brief.runtime = {"provider": "anthropic", "model": "claude-opus-4-8", "api_key": "x",
                     "tier": "balanced", "inputs": {"article_id": str(art.id)}}
    raw = "META_TITLE: T\nMETA_DESCRIPTION: D\n---\n# T\n\nvegan protein body with enough words."
    with patch("app.services.agents.skills.dune.ensure_seo_quality",
               new=AsyncMock(return_value=("# T\n\nseo body", 88.0))), \
         patch("app.services.agents.skills.dune.ensure_geo_quality",
               new=AsyncMock(return_value=("# T\n\ngeo body", 79.0, {"answer_up_top": 15}))):
        res = await dune.GENERATE_ARTICLE.persist(raw, None, brief, db)
    assert res.ok and res.artifact_type == "article"
    await db.refresh(art)
    assert art.status == ArticleStatus.ready and art.seo_score == 88.0
    assert art.geo_score == 79.0 and art.body_markdown == "# T\n\ngeo body"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_agents_article_skill.py::test_generate_article_persist_updates_in_place -q`
Expected: FAIL — `dune` has no `ensure_geo_quality` / `art.geo_score` is None.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/app/services/agents/skills/dune.py`, add the import near the other writing imports:

```python
from app.services.geo_service import ensure_geo_quality
```

In `_persist_generated_article`, right after the `ensure_seo_quality` block sets `body_md, seo_score`, insert the GEO pass and store it (before `article.body_markdown = ...`), replacing the body with the GEO-cleared one:

```python
    rt = brief.runtime or {}
    body_md, geo_score, _ = await ensure_geo_quality(
        rt.get("provider"), rt.get("model"), rt.get("api_key"),
        article.title, article.target_keyword, body_md, parsed["meta_description"], brief.locale,
    )
    article.geo_score = geo_score
```

(`article.body_markdown`, `body_html`, `word_count` are then computed from the returned `body_md` as before — ensure those lines come after this block so they use the GEO-improved body.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_agents_article_skill.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/agents/skills/dune.py apps/api/tests/test_agents_article_skill.py
git commit -m "feat(geo): enforce GEO floor during article generation"
```

---

### Task 6: Manual-edit recompute + `GET /articles/{id}/geo-score`

**Files:**
- Modify: `apps/api/app/api/v1/routers/articles.py` (update endpoint core recompute; new GET endpoint)
- Test: `apps/api/tests/test_articles_geo.py` (append endpoint + update tests)

**Interfaces:**
- Consumes: `compute_geo_core` (Task 1), `_get_article_or_404` (existing in `articles.py`).
- Produces: article update endpoint sets `article.geo_score = compute_geo_core(...)[0]` (core, ≤70); `GET /articles/{article_id}/geo-score -> {"geo_score": <stored|null>, "breakdown": <live core breakdown>}`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_articles_geo.py  (append — reuses the httpx client pattern from tests/test_images.py)
import uuid
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.user import User, UserRole

ORG = uuid.uuid4(); PROJ = uuid.uuid4()
_user = User(id=uuid.uuid4(), org_id=ORG, email="t@f.ai", hashed_password="x", full_name="T",
             role=UserRole.OWNER, is_active=True)


@pytest.fixture
async def client():
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with _Session() as s:
        s.add(Organization(id=ORG, slug="o2", name="O"))
        s.add(Project(id=PROJ, org_id=ORG, name="P", domain="p.com"))
        await s.commit()
    app.dependency_overrides[get_current_user] = lambda: _user
    async def _od():
        async with _Session() as s:
            yield s
    app.dependency_overrides[get_db] = _od
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        yield c
    app.dependency_overrides.clear()
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def _make_article(body: str, geo: float | None = None) -> str:
    async with _Session() as s:
        art = Article(org_id=ORG, project_id=PROJ, title="Best vegan protein",
                      target_keyword="vegan protein", body_markdown=body,
                      status=ArticleStatus.ready, geo_score=geo)
        s.add(art); await s.commit()
        return str(art.id)


async def test_geo_score_endpoint_returns_stored_and_live_breakdown(client):
    aid = await _make_article("# T\n\n- a\n- b\n", geo=88.0)
    r = await client.get(f"/api/v1/articles/{aid}/geo-score")
    assert r.status_code == 200
    body = r.json()
    assert body["geo_score"] == 88.0 and body["breakdown"]["extractable_format"] == 12


async def test_update_recomputes_geo_core(client):
    aid = await _make_article("# T\n\nthin.", geo=None)
    r = await client.patch(f"/api/v1/articles/{aid}",
                           json={"body_markdown": "# T\n\n- one\n- two\n\n## Why?\n\nAccording to a 2023 report, 50% agree."})
    assert r.status_code == 200
    assert r.json()["geo_score"] is not None and r.json()["geo_score"] <= 70
```

(The update route is `PATCH /articles/{article_id}` → `update_article(body: UpdateArticleRequest)`, which accepts `body_markdown` — confirmed in `articles.py:148`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pytest tests/test_articles_geo.py -k "endpoint or recomputes" -q`
Expected: FAIL — 404 (no geo-score route) / `geo_score` stays None on update.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/app/api/v1/routers/articles.py`, add the import:

```python
from app.services.geo_service import compute_geo_core
```

In the article update endpoint, right after `article.seo_score = score`, add:

```python
    article.geo_score = compute_geo_core(article.title, article.body_markdown, article.meta_description)[0]
```

Add the endpoint (next to `get_seo_score`):

```python
@router.get("/{article_id}/geo-score")
async def get_geo_score(article_id: uuid.UUID, current_user: CurrentUser, db: DB):
    article = await _get_article_or_404(article_id, current_user.org_id, db)
    _, breakdown = compute_geo_core(article.title, article.body_markdown, article.meta_description)
    return {"geo_score": article.geo_score, "breakdown": breakdown}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && pytest tests/test_articles_geo.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/api/v1/routers/articles.py apps/api/tests/test_articles_geo.py
git commit -m "feat(geo): manual-edit core recompute + GET /articles/{id}/geo-score"
```

---

### Task 7: Full-suite verification

- [ ] **Step 1: Import sanity**

Run: `cd apps/api && python -c "import app.services.geo_service, app.services.agents.skills.dune, app.api.v1.routers.articles; print('ok')"`
Expected: `ok`.

- [ ] **Step 2: Full suite**

Run: `cd apps/api && pytest -q`
Expected: all GEO tests pass; no regressions. (If the pre-existing Postgres-only `test_edit_model.py` test fails locally, confirm it passes under `docker compose exec -T api pytest tests/test_edit_model.py -q`.)

- [ ] **Step 3: Golden run (manual, with an AI key)**

Generate an article; confirm `geo_score` is set (up to 100) and the body gained a direct answer / FAQ / list. `GET /articles/{id}/geo-score` returns the score + breakdown. Edit the body via `PATCH` and confirm `geo_score` recomputes (≤70). Note results in the PR description.

- [ ] **Step 4: Commit**

```bash
git commit --allow-empty -m "chore(geo): Phase 7 GEO scoring verification"
```

---

## Self-Review

**Spec coverage:**
- Hybrid score (core 0-70 + judgment 0-30) → Tasks 1, 2. ✅
- `ensure_geo_quality` auto-repair, gates on core, never raises → Task 3. ✅
- `articles.geo_score` column + migration + `ArticleOut` → Task 4. ✅
- Auto-enforce during generation (after SEO) → Task 5. ✅
- Manual-edit recompute (core only) + `GET /geo-score` advisory → Task 6. ✅
- Score-scale semantics (core anywhere; +30 only on generation) → enforced by Task 5 (hybrid via `compute_geo_score`) vs Task 6 (core only). ✅
- Never-blocks / safe degradation → Tasks 2, 3 (and generation still saves the SEO body). ✅
- Testing (pure core, mocked LLM, integration, endpoint) → every task. ✅
- Non-goals (Articles only, no citation tracking/governance/optimize button) → respected; no tasks touch them. ✅

**Spec correction folded in:** the spec named `scoring.py` for the manual-save recompute; the actual site is the article **update** endpoint in `articles.py` (where `seo_score` is already recomputed) — Task 6 targets that. `scoring.py` is image scoring and is untouched.

**Placeholder scan:** none — every step ships real code; migration revision id is concrete (`u0j1k2l3m4n5`, down_revision `t9i0j1k2l3m4`).

**Type consistency:** `compute_geo_core(...) -> (float, dict)` used identically in Tasks 1/2/3/6. `ensure_geo_quality(provider, model, api_key, title, keyword, body_md, meta, locale) -> (body, score, breakdown)` matches its Task 5 caller. `geo_llm_judgment`/`compute_geo_score` signatures consistent across Tasks 2/3. `brief.runtime` keys (`provider/model/api_key`) match Phase 2b.
```
