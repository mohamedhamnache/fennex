# GEO Scoring & Optimization — Design

> Roadmap Phase 7 (first sub-project). Sibling sub-projects — **brand-citation tracking** and **brand governance** — are deferred to their own specs.

## Problem

Fennex optimizes content for classic search (deterministic on-page SEO score + an auto-repair loop). It does nothing for **AI answer engines** (ChatGPT, Perplexity, Google AI Overviews), which increasingly intercept the queries our users want to win. Content that ranks in classic search is not automatically *quotable* by an answer engine — that needs a direct answer up top, extractable structure, specifics, and citations.

## Goal

Give Articles a **GEO score** ("answer-engine readiness", 0-100) with the same rigor and touchpoints the SEO score already has, and **auto-enforce a GEO floor during article generation** so every generated article is answer-engine-ready by design. Scope: **Articles only**. Optimize during generation (not a manual button).

## Decisions (from brainstorming)

- **Hybrid score:** a fast deterministic core (0-70) + one light-tier LLM judgment (0-30).
- **Auto-enforce during generation:** like `ensure_seo_quality`, a bounded GEO repair pass runs in the generation pipeline; no separate "optimize" button in v1.
- **Full SEO parity, Articles only:** auto-enforce in generation + recompute on manual save + `GET /articles/{id}/geo-score` + `ArticleOut.geo_score` + a Studio panel.
- **Cost control:** the auto-repair floor gates on the *deterministic core* (no LLM to decide). At most ~2 added LLM calls per **generation** (one repair pass + one judgment); **zero** on manual saves or score views.
- **Never blocks:** every LLM-dependent GEO function degrades safely (repair failure returns the original; judgment failure returns 0) — a GEO problem never fails article generation.

## The GEO rubric

`compute_geo_core(title, body_markdown, meta_description) -> (core_score: float 0-70, breakdown: dict)` — pure, deterministic, synchronous (mirrors `compute_seo_score` in `app/services/article_service.py`).

| Signal | Key | Pts | Detected by (deterministic) |
|---|---|---|---|
| Direct answer up top | `answer_up_top` | 15 | a concise answer paragraph (~40-80 words, not a heading/list) between the H1 and the first `##` H2 |
| Question / FAQ structure | `qa_structure` | 12 | at least one `##`/`###` heading containing `?`, or an "FAQ"/"Frequently asked" heading |
| Extractable formatting | `extractable_format` | 12 | presence of a markdown list (`- `, `* `, or `1.`) and/or a table (a line containing ` \| `) |
| Statistics & specifics | `statistics` | 10 | ≥ 3 occurrences of digits/percentages/years (regex `\d`), scaled: ≥6 → full, 3-5 → half |
| Citations / sources | `citations` | 11 | ≥ 1 markdown link `[..](http..)` or a phrase in {"according to", "source:", "study", "report"} |
| Concise paragraphs | `concise_paragraphs` | 10 | median paragraph ≤ 4 sentences (partial 5 if ≤ 6) |

Core = sum (0-70). Each signal stores its earned points in `breakdown`.

`async geo_llm_judgment(provider, model, api_key, title, body_markdown, locale) -> (judge: float 0-30, feedback: str)` — one light-tier `call_llm` returning JSON `{score: 0-30, feedback: str}`; on any error returns `(0.0, "")`. Judges: is there a genuine, self-contained, *quotable* answer an AI engine could extract correctly; factual/authoritative tone; directness.

`async compute_geo_score(provider, model, api_key, title, body, meta, locale) -> (score: float 0-100, breakdown: dict)` — `core, breakdown = compute_geo_core(...)`; `judge, feedback = await geo_llm_judgment(...)`; `breakdown["llm_judgment"] = judge`, `breakdown["llm_feedback"] = feedback`; returns `(round(core + judge, 1), breakdown)`.

## Architecture

New file **`app/services/geo_service.py`** (one responsibility; parallels `writing_service.py`). Exports: `compute_geo_core`, `geo_llm_judgment`, `compute_geo_score`, `ensure_geo_quality`, `GEO_CORE_FLOOR`.

```python
GEO_CORE_FLOOR = 45   # out of 70; below this, one repair pass runs during generation

async def ensure_geo_quality(provider, model, api_key, title, keyword, body_md, meta, locale
                             ) -> tuple[str, float, dict]:
    """Guarantee answer-engine readiness 'by design': score the deterministic core; if it
    falls short, run ONE targeted repair pass that adds only the missing GEO signals WITHOUT
    harming SEO/keyword usage. Then compute the full hybrid score. Never raises."""
    core, _ = compute_geo_core(title, body_md, meta)
    if core < GEO_CORE_FLOOR:
        # one repair pass: prompt lists the specific missing signals (from the breakdown),
        # asks to add a direct answer up top, a question/FAQ block, a list/table, a source,
        # and tighten paragraphs, preserving the primary keyword and meaning. On failure,
        # keep the original body (never raises).
        body_md = await _repair_geo(provider, model, api_key, title, keyword, body_md, meta, locale) or body_md
    score, breakdown = await compute_geo_score(provider, model, api_key, title, body_md, meta, locale)
    return body_md, score, breakdown
```

### Integration points (mirror SEO exactly)

1. **Generation** — in `dune.GENERATE_ARTICLE`'s `persist` (`app/services/agents/skills/dune.py`), after `ensure_seo_quality` produces `body_md`, call `ensure_geo_quality(...)` on that SEO-cleared body (SEO first — keyword/density/structure; GEO second — additive answer-blocks/FAQ/citations). Store `article.geo_score`. Provider/model/key come from `brief.runtime` (already populated by the runner, Phase 2b). GEO failure never blocks: `ensure_geo_quality` never raises and the article still saves with its SEO body.
2. **Manual edit/save** — in `app/api/v1/routers/scoring.py`, where `record.seo_score` is recomputed on a content update, also set `record.geo_score = compute_geo_core(...)[0]` (the deterministic core, 0-70 — fast, free, no per-save LLM call).

**Score semantics (single scale, both paths):** `geo_score` is on 0-100 where up to **70** is the deterministic structural core (recomputed anywhere — generation, manual save, on demand) and up to **30** is the AI-answer LLM judgment, which is added **only during generation** (and future explicit optimize). So a freshly generated article scores up to 100; after a manual edit the stored score reflects structure only (≤ 70) until the next generation refreshes the judgment. This is intended and shown in the UI ("+30 AI-answer judgment refreshes on generate"), and keeps the same body from scoring differently by accident: the core is identical across paths.
3. **Advisory endpoint** — `GET /articles/{id}/geo-score` (in `app/api/v1/routers/articles.py`, beside `/seo-score`) returns `{ "geo_score": <stored float|null>, "breakdown": compute_geo_core(...)[1] }` — deterministic breakdown computed live; no LLM on view.

## Data model

- New column `articles.geo_score: Mapped[float | None] = mapped_column(Float)` (mirrors `seo_score`), plus an Alembic migration `ALTER TABLE articles ADD COLUMN geo_score DOUBLE PRECISION` (nullable, no backfill).
- `ArticleOut` response schema gains `geo_score: Optional[float]`.
- No breakdown column — recomputed on demand (SEO parity).

## Error handling

- `geo_llm_judgment` → `(0.0, "")` on any exception; never raises.
- `ensure_geo_quality` repair → returns original body on any failure; never raises.
- Generation: GEO is wrapped so a failure leaves the article `ready` with its SEO body and `geo_score` = whatever the core scored (judgment 0). GEO never regresses article generation.
- No AI key: article generation already errors before the skill runs; GEO code is never reached.

## Testing

Pure-function pytest (no LLM) is the backbone; LLM paths are mocked.

- **`compute_geo_core`** — crafted markdown asserting each signal fires and doesn't (answer-up-top present/absent, question heading, list, table, stats threshold, citation, paragraph length), and that the total stays within 0-70.
- **`ensure_geo_quality`** (mock `call_llm`/`_repair_geo`): (a) core ≥ floor → no repair call, returns hybrid score; (b) core < floor → exactly one repair call, body replaced; (c) repair raises → original body, never propagates.
- **`geo_llm_judgment`** — mocked JSON parses to `(score, feedback)`; malformed/exception → `(0.0, "")`.
- **Integration** — extend the `dune.GENERATE_ARTICLE` persist test to assert `article.geo_score` is set (mock both `ensure_seo_quality` and `ensure_geo_quality`).
- **Endpoint** — `GET /articles/{id}/geo-score` returns the stored score + a live breakdown (in-memory sqlite, like the other router tests).

## Non-goals

- No brand-citation tracking and no brand-governance in this spec (separate Phase 7 sub-projects).
- No GEO for product copy or social posts (Articles only in v1).
- No manual "GEO optimize" button (optimization is auto-enforced during generation).
- No new LLM provider; uses the org's existing keys via the agent core / `call_llm`.
- No change to the SEO score or `ensure_seo_quality`.
