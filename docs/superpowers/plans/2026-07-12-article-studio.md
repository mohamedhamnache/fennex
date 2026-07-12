# Article Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Articles page into a three-pane writing studio (documents rail, writing canvas, Dune dock) with selection-aware rewriting, a Dune chat co-writer, and an honest Checks suite (SEO checklist, AI-pattern score + Humanize, SERP-based plagiarism scan).

**Architecture:** Two new backend services (`writing_service` for LLM transforms + chat, `checks_service` for deterministic checks + SERP plagiarism) exposed via four article-scoped endpoints; the frontend page is restructured into studio components while preserving all existing editor behavior (autosave, publish, model picker, Optimize panel, image suggestions).

**Tech Stack:** FastAPI + `call_llm` (locale-aware) + DataForSEO provider (existing, key-gated); Next.js 14 + TanStack Query + react-i18next. No new dependencies.

Spec: `docs/superpowers/specs/2026-07-12-article-studio-design.md`
Branch: `feat/article-studio` (off main, already created; E1 SERP Intelligence is merged).

## Global Constraints

- **NO EMOJI** anywhere. Tailwind CSS variables only (no hex in TSX). Every visible string via `t()` with **native translations in all six locales** (en/fr/es/de/pt/ar), key parity; copywriter-grade en copy. "Pack"/"Dune" stay untranslated.
- **Honesty:** plagiarism is provider-gated (409 `{"detail":{"code":"no_seo_provider"}}` → connect state; never fake). AI-pattern score is labeled heuristic. LLM features error with the standard no-AI-key message; deterministic checks always work.
- Backend tests: `docker compose exec -T api pytest tests/test_article_studio.py -v` (LLM + SERP provider patched; no network). Frontend: `cd apps/web && npm run typecheck` → exit 0. Commit style `feat(studio): ...`.
- Transform modes exactly: `rephrase | simplify | expand | shorten | humanize`. Limits: transform text 1..6000 chars (400/413), chat history capped at 8 turns, plagiarism samples <= 8 sentences.
- Existing editor behavior MUST survive: autosave, save revision, regenerate + model picker, publish modal, Edit/Preview tabs, SEO score/breakdown data, OptimizePanel, ImageSuggestionsPanel (kept reachable).
- Article ownership on every endpoint (org-scoped 404, same idiom as existing article routes).

---

### Task 1: `writing_service` — transform + Dune chat

**Files:**
- Create: `apps/api/app/services/writing_service.py`
- Test: `apps/api/tests/test_article_studio.py` (new; SQLite harness copied from `tests/test_seo_intel.py` — tables: `projects, gsc_connections, api_keys, articles, gsc_query_stats`)

**Interfaces:**
- Consumes: `call_llm`, `get_org_llm_keys`, `project_locale` from `app/services/llm_service.py` (verify signatures); `agent_persona("dune")` from `app.agents.registry` (verify it exists — campaigns director uses `agent_persona("sirocco")`); `Article` model fields `title, target_keyword, body_markdown`.
- Produces:

```python
MODES = {"rephrase", "simplify", "expand", "shorten", "humanize"}
TRANSFORM_MAX_CHARS = 6000
class TextTooLong(Exception): ...
async def transform(project, mode: str, text: str, db) -> str          # raises ValueError on bad mode/empty, TextTooLong over limit, RuntimeError("no_ai_key")
async def chat(project, article, question: str, history: list[dict], db) -> dict  # {"answer": str, "insertable": str | None}; RuntimeError("no_ai_key") when keyless
```

- [ ] **Step 1: harness + failing tests.** Create the test file (copy `db_session`/`SQLITE_COMPATIBLE_TABLES`/`FAKE_ORG_ID`/`_mk_project` idiom from `tests/test_seo_intel.py`; `_mk_article(db, project, title="Menu digital", keyword="menu digital", body="...")` helper creating an `Article` — check the model's required fields/status enum). Tests:

```python
@pytest.mark.asyncio
async def test_transform_modes_and_limits(db_session):
    from app.services import writing_service as ws
    p = await _mk_project(db_session)
    with patch.object(ws, "get_org_llm_keys", new=AsyncMock(return_value={"anthropic": "k"})), \
         patch.object(ws, "call_llm", new=AsyncMock(return_value="  Texte reformule.  ")) as m:
        out = await ws.transform(p, "humanize", "Un texte robotique.", db_session)
    assert out == "Texte reformule."
    sys_prompt = m.call_args.args[3]
    assert "human" in sys_prompt.lower()
    with pytest.raises(ValueError):
        await ws.transform(p, "unknown", "x", db_session)
    with pytest.raises(ValueError):
        await ws.transform(p, "rephrase", "   ", db_session)
    with pytest.raises(ws.TextTooLong):
        await ws.transform(p, "rephrase", "x" * 6001, db_session)
    with patch.object(ws, "get_org_llm_keys", new=AsyncMock(return_value={})):
        with pytest.raises(RuntimeError):
            await ws.transform(p, "rephrase", "ok", db_session)


@pytest.mark.asyncio
async def test_chat_grounds_and_extracts_insertable(db_session):
    from app.services import writing_service as ws
    p = await _mk_project(db_session)
    art = await _mk_article(db_session, p)
    reply = "Here is a section.\n<draft>## Pourquoi un menu digital\nLe contenu...</draft>"
    with patch.object(ws, "get_org_llm_keys", new=AsyncMock(return_value={"anthropic": "k"})), \
         patch.object(ws, "call_llm", new=AsyncMock(return_value=reply)) as m:
        res = await ws.chat(p, art, "Write the section", [{"role": "user", "content": "hi"}] * 12, db_session)
    assert res["insertable"].startswith("## Pourquoi")
    assert "<draft>" not in res["answer"]
    user_prompt = m.call_args.args[4]
    assert "Menu digital" in user_prompt            # grounded in the article
    assert user_prompt.count("user:") <= 8          # history capped
```

- [ ] **Step 2: run → fail.**
- [ ] **Step 3: implement** `writing_service.py`:

```python
"""Dune's writing tools: selection transforms and the studio chat co-writer."""
import logging
import re

from app.agents.registry import agent_persona
from app.services.llm_service import call_llm, get_org_llm_keys

logger = logging.getLogger(__name__)

MODES = {"rephrase", "simplify", "expand", "shorten", "humanize"}
TRANSFORM_MAX_CHARS = 6000
_PROVIDERS = [("anthropic", "claude-haiku-4-5-20251001"), ("openai", "gpt-4o-mini")]

_MODE_BRIEFS = {
    "rephrase": "Rephrase the text with fresh wording. Preserve meaning, tone and approximate length.",
    "simplify": "Rewrite the text in plain, clear language a 14-year-old understands. Shorter sentences.",
    "expand": "Expand the text with concrete detail, examples or evidence. Up to double the length.",
    "shorten": "Tighten the text to roughly half its length. Keep every essential fact.",
    "humanize": "Rewrite so it reads like a skilled human wrote it: vary sentence lengths, cut cliches and filler, use concrete verbs, allow personality. Never mention AI.",
}


class TextTooLong(Exception): ...


def _pick(keys: dict):
    return next(((p, m) for p, m in _PROVIDERS if p in keys), None)


async def transform(project, mode: str, text: str, db) -> str:
    if mode not in MODES:
        raise ValueError(f"unknown mode: {mode}")
    body = (text or "").strip()
    if not body:
        raise ValueError("text required")
    if len(body) > TRANSFORM_MAX_CHARS:
        raise TextTooLong()
    keys = await get_org_llm_keys(project.org_id, db)
    pm = _pick(keys)
    if pm is None:
        raise RuntimeError("no_ai_key")
    system = (agent_persona("dune") +
              f"You are editing a fragment of a larger article. {_MODE_BRIEFS[mode]} "
              "Return ONLY the rewritten fragment - no preamble, no quotes, no markdown fences.")
    out = await call_llm(pm[0], pm[1], keys[pm[0]], system, body, locale=project.locale)
    return out.strip()


_DRAFT_RE = re.compile(r"<draft>(.*?)</draft>", re.S)


async def chat(project, article, question: str, history: list[dict], db) -> dict:
    keys = await get_org_llm_keys(project.org_id, db)
    pm = _pick(keys)
    if pm is None:
        raise RuntimeError("no_ai_key")
    from app.services.ai_analytics_service import project_profile
    profile = await project_profile(project.id, db)
    excerpt = (article.body_markdown or "")[:3000]
    system = (agent_persona("dune") +
              "You are the writing co-pilot inside the article studio. Converse naturally: "
              "answer questions, research angles from the provided data, and draft content on request. "
              "When your reply contains text meant to be inserted into the article, wrap exactly that "
              "text in <draft></draft> tags (markdown inside). Keep answers tight.")
    convo = "".join(f"{t.get('role', 'user')}: {t.get('content', '')}\n" for t in (history or [])[-8:])
    user = (f"PROJECT: {project.name}" + (f"\nPROFILE: {profile}" if profile else "") +
            f"\nARTICLE: {article.title} (keyword: {article.target_keyword or '-'})\n"
            f"DRAFT EXCERPT:\n{excerpt}\n\n{convo}user: {question.strip()}")
    raw = await call_llm(pm[0], pm[1], keys[pm[0]], system, user, locale=project.locale)
    m = _DRAFT_RE.search(raw)
    insertable = m.group(1).strip() if m else None
    answer = _DRAFT_RE.sub("", raw).strip() or (insertable[:200] if insertable else raw.strip())
    return {"answer": answer, "insertable": insertable}
```

(Verify `agent_persona` exists in `app.agents.registry` and takes an agent id; if the helper is named differently, adapt and note it. Verify `project_profile` import path from how `campaign_director.py` uses it.)

- [ ] **Step 4: run → pass. Step 5: commit** `feat(studio): writing service - selection transforms and Dune chat`

---

### Task 2: `checks_service` — SEO checklist + AI-pattern score

**Files:**
- Create: `apps/api/app/services/checks_service.py`
- Test: `apps/api/tests/test_article_studio.py` (append)

**Interfaces:**
- Produces:

```python
def seo_checklist(article, keyword: str | None) -> list[dict]   # [{id, status: "pass"|"warn"|"fail", detail}]
def ai_patterns(text: str, lang: str) -> dict                    # {"score": int 0-100 (higher = more human), "signals": [{id, severity: "info"|"warn", detail}], "flagged": [{"sentence", "reason"}]}
```

- Checklist rule ids (exact): `title_length, meta_length, kw_in_title, kw_in_intro, kw_in_heading, kw_density, headings_count, intro_length, links, image_alts, paragraph_length`. Rules per spec: title 15-65 chars; meta 50-160; keyword in title / first paragraph / any heading; density 0.3-2.5% (warn outside, fail 0 occurrences when keyword set; all kw_ rules return `warn` "no keyword set" when keyword is None); >= 3 markdown headings; intro (first paragraph) <= 60 words; >= 2 markdown links `[..](..)`; images `![alt](..)` must all have non-empty alt (pass when no images); no paragraph > 120 words (warn listing the count).
- ai_patterns signals (exact ids): `burstiness` (stddev of sentence word-counts < 4 with >= 8 sentences → warn), `repeated_openers` (any first-word used by >= 3 sentences → warn, detail names the word), `cliches` (per-language list hit; en seeds: "delve", "in today's fast-paced world", "unlock the power", "it's important to note", "in conclusion", "game-changer", "furthermore"; fr seeds: "il est important de noter", "dans le monde d'aujourd'hui", "en conclusion", "de plus en plus", "un veritable atout"), `uniform_paragraphs` (>= 4 paragraphs with word counts within +/-10% of each other → info), `formatting_overuse` (> 30% of non-empty lines are list items → info). Score = 100 - (25 per warn + 10 per info), floor 5, and 100 when < 8 sentences and no signals. `flagged` = up to 10 sentences containing a cliché or sharing a repeated opener, each with a reason string.

- [ ] **Step 1: failing tests** (append):

```python
def test_seo_checklist_statuses():
    from app.services.checks_service import seo_checklist
    art = types.SimpleNamespace(
        title="Menu digital restaurant: le guide",           # 32 chars -> pass
        meta_description="Trop court",                        # fail
        body_markdown=(
            "Le menu digital change tout pour votre restaurant.\n\n"  # intro w/ kw -> pass
            "## Pourquoi le menu digital\n\ncontenu " + ("mot " * 130) + "\n\n"  # long paragraph -> warn
            "## Prix\n\nVoir [tarifs](https://x.fr) et [demo](https://y.fr).\n\n"
            "![](https://img.fr/a.png)\n"                     # empty alt -> fail
        ),
    )
    res = {c["id"]: c["status"] for c in seo_checklist(art, "menu digital")}
    assert res["title_length"] == "pass" and res["kw_in_title"] == "pass"
    assert res["meta_length"] == "fail"
    assert res["kw_in_intro"] == "pass" and res["kw_in_heading"] == "pass"
    assert res["headings_count"] == "fail"      # only 2 headings
    assert res["links"] == "pass"
    assert res["image_alts"] == "fail"
    assert res["paragraph_length"] == "warn"
    res2 = {c["id"]: c["status"] for c in seo_checklist(art, None)}
    assert res2["kw_in_title"] == "warn"


def test_ai_patterns_signals_and_score():
    from app.services.checks_service import ai_patterns
    robotic = ("This is a sentence with seven words here. " * 5 +
               "This is another sentence counting seven words. " * 4 +
               "Furthermore, it's important to note the value. ")
    res = ai_patterns(robotic, "en")
    ids = {s["id"] for s in res["signals"]}
    assert "burstiness" in ids and "repeated_openers" in ids and "cliches" in ids
    assert res["score"] <= 40
    assert any("This" in f["reason"] or "cliche" in f["reason"].lower() for f in res["flagged"])
    human = ("Short one. Then a much longer sentence that wanders through several ideas before landing. "
             "Why? Because rhythm matters. People notice texture in writing, even when they cannot name it.")
    assert ai_patterns(human, "en")["score"] >= 80
```

(add `import types` to the test imports.)

- [ ] **Step 2: run → fail. Step 3: implement** the service with pure functions exactly per the rule/signal definitions above (regex sentence split on `[.!?]+\s`, markdown paragraph split on blank lines, heading lines `^#{1,6} `, links `\[[^\]]*\]\([^)]+\)`, images `!\[([^\]]*)\]\([^)]+\)`; keyword matching case-insensitive). Keep every threshold a module constant.
- [ ] **Step 4: run → pass. Step 5: commit** `feat(studio): deterministic seo checklist and ai-pattern heuristics`

---

### Task 3: plagiarism scan (SERP-based)

**Files:**
- Modify: `apps/api/app/services/checks_service.py` (append)
- Test: `apps/api/tests/test_article_studio.py` (append)

**Interfaces:**
- Consumes: `get_seo_provider_for_org` (import at module scope in checks_service, patchable), `serp_service.language_for_project/location_for_project`, `serp_service._project_domain`-equivalent (reuse `serp_service._norm_domain` or reimplement locally).
- Produces: `async plagiarism_scan(project, article, db) -> dict` — `{"checked": int, "matches": [{"sentence": str, "urls": [str]}]}`; raises `NoProvider` (module exception) when provider-less. Sentence sampling: split body into sentences; keep those with 10-20 words that aren't headings/list items; rank by count of words longer than 6 letters (distinctiveness) desc; take up to 8. A sentence matches when the quoted-phrase SERP (`provider.serp(f'"{sent}"', language, location)`) returns >= 1 organic item whose normalized domain differs from the project's; collect up to 3 such urls.

- [ ] **Step 1: failing tests** (append):

```python
@pytest.mark.asyncio
async def test_plagiarism_scan_matches_and_gate(db_session):
    from app.services import checks_service as cs
    p = await _mk_project(db_session)
    body = ("# T\n\n" + "Une phrase distinctive contenant plusieurs mots relativement caracteristiques ensemble. " * 3
            + "Court. " * 5)
    art = await _mk_article(db_session, p, body=body)

    class Prov:
        async def serp(self, kw, language_code="en", location_code=2840):
            return [{"type": "organic", "rank_absolute": 1, "domain": "copycat.com",
                     "url": "https://copycat.com/page", "title": "t"}]
    with patch.object(cs, "get_seo_provider_for_org", new=AsyncMock(return_value=Prov())):
        res = await cs.plagiarism_scan(p, art, db_session)
    assert res["checked"] >= 1
    assert res["matches"] and res["matches"][0]["urls"] == ["https://copycat.com/page"]

    class OwnProv:
        async def serp(self, kw, language_code="en", location_code=2840):
            return [{"type": "organic", "rank_absolute": 1, "domain": "pure-saveur.fr",
                     "url": "https://pure-saveur.fr/x", "title": "t"}]
    with patch.object(cs, "get_seo_provider_for_org", new=AsyncMock(return_value=OwnProv())):
        res = await cs.plagiarism_scan(p, art, db_session)
    assert res["matches"] == []                      # own domain doesn't count

    with patch.object(cs, "get_seo_provider_for_org", new=AsyncMock(return_value=None)):
        with pytest.raises(cs.NoProvider):
            await cs.plagiarism_scan(p, art, db_session)
```

- [ ] **Step 2: run → fail. Step 3: implement** per the Interfaces block (module-scope provider import; per-sentence try/except so one SERP failure skips that sentence, logged).
- [ ] **Step 4: run → pass. Step 5: commit** `feat(studio): serp-based plagiarism scan`

---

### Task 4: studio endpoints + frontend client

**Files:**
- Create: `apps/api/app/api/v1/routers/articles_studio.py` (register in `router.py` under the existing `/articles` prefix pattern — check how `articles_images.py` is registered and mirror it)
- Modify: `apps/web/lib/api.ts`
- Test: `apps/api/tests/test_article_studio.py` (append; copy the `client` fixture idiom already used in `tests/test_seo_intel.py`)

**Interfaces (backend):** all org-scoped via article lookup (`Article.id == id, Article.org_id == current_user.org_id` → 404) and the article's project loaded for locale/provider:
- `POST /articles/{article_id}/transform` {mode, text} → {text}; ValueError→400, TextTooLong→413, RuntimeError no_ai_key→400 message "No AI key configured. Add an Anthropic or OpenAI key in Settings."
- `POST /articles/{article_id}/chat` {question, history?} → {answer, insertable}.
- `POST /articles/{article_id}/checks` → {seo: [...], ai: {...}} (uses article.target_keyword; ai lang from project locale).
- `POST /articles/{article_id}/plagiarism` → scan | 409 {"code": "no_seo_provider"}.

**Interfaces (frontend `api.ts`):**

```typescript
export type TransformMode = "rephrase" | "simplify" | "expand" | "shorten" | "humanize";
export interface SeoCheck { id: string; status: "pass" | "warn" | "fail"; detail: string; }
export interface AiPatternReport { score: number; signals: { id: string; severity: string; detail: string }[]; flagged: { sentence: string; reason: string }[]; }
export interface PlagiarismReport { checked: number; matches: { sentence: string; urls: string[] }[]; }
export async function transformText(articleId: string, mode: TransformMode, text: string): Promise<{ text: string }>
export async function duneChat(articleId: string, question: string, history: { role: string; content: string }[]): Promise<{ answer: string; insertable: string | null }>
export async function runArticleChecks(articleId: string): Promise<{ seo: SeoCheck[]; ai: AiPatternReport }>
export async function runPlagiarismScan(articleId: string): Promise<PlagiarismReport>
```

- [ ] **Step 1: failing endpoint tests** — transform 200 (patched LLM) + 400 bad mode + 404 foreign article; checks 200 shape; plagiarism 409 code when provider None (patch `checks_service.get_seo_provider_for_org`).
- [ ] **Step 2: fail. Step 3: implement** router + registration + api.ts. **Step 4: pass + typecheck. Step 5: commit** `feat(studio): article studio endpoints and client`

---

### Task 5: Studio shell — rail, canvas, dock

**Files:**
- Create: `apps/web/components/articles/studio/DocumentsRail.tsx`, `StatsBar.tsx`, `DuneDock.tsx`, `MetaTab.tsx`
- Modify: `apps/web/app/(dashboard)/[projectId]/articles/page.tsx` (restructure)
- Modify: locales (partial `articleStudio.*`)

**Behavior (exact):**
- Read the whole current page first. PRESERVE: all queries/mutations, autosave/save-revision, regenerate + model picker, publish modal, Edit/Preview toggle, `["article-seo"]` scoring, OptimizePanel, ImageSuggestionsPanel (relocate its trigger into the canvas toolbar or dock — keep reachable), delete/regenerate list actions.
- Layout: `flex h-full` → DocumentsRail (w-60, searchable list: input filters client-side by title; status dot per article using the existing status→tone map; active item highlighted; New Article button on top opening the existing modal) | canvas (flex-1 min-w-0: title input, StatsBar, editor as today) | DuneDock (w-[340px], tabs `assistant | optimize | checks | meta` with icons, default `assistant`).
- StatsBar: words (from body), reading time (`Math.ceil(words/200)` + t key with {{min}}), SEO score chip (existing `["article-seo"]` query value), autosave state (existing saveState), revision + publish buttons relocated here.
- MetaTab: move the existing meta title/description/keyword inputs + SEO breakdown block into it unchanged (same handlers). Optimize tab renders the existing `OptimizePanel`.
- DuneDock header: Dune avatar (FENNEX_AGENTS.dune) + `t("articleStudio.dock.title")`.
- Empty editor state (no article selected): centered Dune hero + `t("articleStudio.emptyTitle")` / `emptyBody` + New Article CTA.
- i18n added this task: `articleStudio.dock.*` (title, tabs.assistant/optimize/checks/meta), `emptyTitle`, `emptyBody`, `search`, `readingTime` ("{{min}} min read"), `words` ("{{count}} words") — all 6 locales.
- Verify: typecheck; restart web → 200; all existing editor interactions still wired (grep for orphaned handlers).
- Commit: `feat(studio): three-pane article studio shell`

---

### Task 6: SelectionBar + transform compare card

**Files:**
- Create: `apps/web/components/articles/studio/SelectionBar.tsx`
- Modify: `apps/web/app/(dashboard)/[projectId]/articles/page.tsx` (mount above the editor; selection state)
- Modify: locales (`articleStudio.selection.*`)

**Behavior (exact):**
- Track selection via the editor textarea's `onSelect`/`onKeyUp`/`onMouseUp`: `{start, end}` state; selected text = `body.slice(start, end)`; bar shows 5 chips (Rephrase/Simplify/Expand/Shorten/Humanize; Humanize visually accented `text-primary`), disabled + hint `t("articleStudio.selection.hint")` when selection empty or > 6000 chars (`tooLong` hint).
- Chip click → `transformText(articleId, mode, selected)` (loading spinner on that chip) → compare card below the bar: two panels (original muted / suggestion highlighted `border-primary/40`), actions **Replace** (splice suggestion into body via the existing body change handler, preserving autosave; restore focus) and **Discard**. Errors toast `e.message`.
- Only one suggestion at a time; switching selection clears a pending card.
- i18n: `articleStudio.selection.{rephrase,simplify,expand,shorten,humanize,hint,tooLong,original,suggestion,replace,discard}` — 6 locales.
- Commit: `feat(studio): selection-aware rewriting with compare card`

---

### Task 7: ChecksTab + AssistantTab + final i18n

**Files:**
- Create: `apps/web/components/articles/studio/ChecksTab.tsx`, `AssistantTab.tsx`
- Modify: `DuneDock.tsx` mounts (checks/assistant tabs), locales (`articleStudio.checks.*`, `articleStudio.assistant.*`)

**ChecksTab (exact):**
- "Run checks" button → `runArticleChecks` → renders: SEO checklist (rows: pass=success check / warn=warning dot / fail=destructive x, id label via `t(\`articleStudio.checks.rules.${id}\`)`, detail below); AI-pattern section: score ring (ProgressRing, labeled `t("articleStudio.checks.aiScore")` + `t("articleStudio.checks.heuristic")` fine-print), signals list, flagged sentences each with a **Humanize** button → `transformText(articleId, "humanize", sentence)` → compare inline (Replace splices that sentence in the body via string replace of the exact sentence; Discard).
- Plagiarism section: "Scan originality" button → `runPlagiarismScan`; 409 no_seo_provider (check `e.status === 409`) → the provider connect-state (reuse the gate copy pattern: body + link to `/settings`); result: "{{checked}} passages checked" + matches list (sentence excerpt + source links, `target="_blank"`); zero matches → success state `t("articleStudio.checks.original")`.
- **AssistantTab (exact):** chat like `AiChatPanel` (message list, typing indicator, input with Enter-to-send). State: `history` in component; calls `duneChat(articleId, question, history)`; Dune-gradient avatar for assistant rows; suggestion chips before first message: `t("articleStudio.assistant.chips.{outline,stats,intro,listicle}")` (each sends a canned prompt from i18n `prompts.*`). When a reply has `insertable`: an **Insert at cursor** button on that message → inserts at the editor's tracked cursor (`selectionStart`, fallback append) via the body change handler + toast. Errors toast.
- i18n: full `articleStudio.checks.*` (incl. the 11 rule labels) + `articleStudio.assistant.*` (title tagline placeholder send chips.x4 prompts.x4 insert) — 6 locales, native.
- Verify: typecheck; JSON parity; restart web → 200; greps (no hardcoded strings/emoji/hex).
- Commit: `feat(studio): checks suite and Dune assistant chat`

---

## Final verification

- Backend: `docker compose exec -T api pytest tests/test_article_studio.py tests/test_seo_intel.py -v` all pass.
- Frontend typecheck clean; 6 locale JSONs valid with `articleStudio.*` parity.
- Live: open an article → studio renders (rail/canvas/dock); select text → rephrase → compare → replace; Checks tab: run checks (deterministic works keyless), plagiarism shows gate without provider; Assistant: chat renders (LLM answers require an AI key; verify 400 toast without). Both themes. Ledger updated.
