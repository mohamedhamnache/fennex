# Article Studio — Design Spec

Date: 2026-07-12
Full redesign of the Articles page into a writing studio with Dune as the resident agent.
User directive: proceed without interactive gates; design decisions below are final.

## Purpose

Turn the functional article editor into a **Jasper-class writing studio** with unique, honest
value: a focused writing canvas, Dune as a conversational co-writer, selection-aware rewriting,
and a Checks suite (SEO checklist, AI-pattern score + Humanize, SERP-based plagiarism scan) that
no competitor combines with real search data.

## Honesty decisions (final)

- **Plagiarism scan** runs on the org's DataForSEO SERP provider (exact-phrase searches of the
  article's most distinctive sentences; matches reported with URLs). Key-gated like SERP
  Intelligence: no provider → connect state, never a fake score.
- **"Anti-AI detection"** ships as an **AI-pattern score** — deterministic stylometry
  (sentence-length burstiness, repeated sentence openers, AI-cliché phrases, uniformity) labeled
  as heuristic — plus a **Humanize** rewrite action. No "bypass detectors" claims.

## The experience

Route stays `/[projectId]/articles`. Three-pane **studio**:

1. **Documents rail** (left, slim): searchable article list (status dot, title, updated),
   New Article button. Collapses on small screens.
2. **Writing canvas** (center): clean chrome — editable title, a stats bar (words, reading
   time, live SEO score chip, autosave state), the markdown editor with Edit/Preview as today,
   and a **selection bar**: when text is selected in the editor, action chips activate —
   Rephrase, Simplify, Expand, Shorten, **Humanize**. Each calls Dune and shows the suggestion
   in a compare card (original vs suggestion) with Replace / Discard.
3. **Dune dock** (right): four tabs
   - **Assistant** — chat with Dune: human-like conversation grounded in the project (profile,
     locale, the open draft). Answers questions, researches angles from your real GSC data,
     drafts sections. When a reply contains usable draft text the UI offers **Insert at cursor**.
     Suggestion chips seed the conversation (outline this article, find statistics to cite,
     write a stronger intro, turn this into a listicle).
   - **Optimize** — the existing SERP content scorer (moved into the dock).
   - **Checks** — one Run checks action → SEO checklist (deterministic on-page checks) +
     AI-pattern score with flagged sentences (each with a one-click Humanize) + Plagiarism scan
     (provider-gated, per-sentence matches with source URLs).
   - **Meta** — the existing SEO title/description/keyword fields (moved).

Dune attribution everywhere (icon + name). Full i18n (en/fr/es/de/pt/ar), copy written
copywriter-grade in en and natively translated. NO EMOJI. Tailwind vars only.

## Backend

### `writing_service.py` (new)
- `async transform(project, article, mode, text, db) -> str` — modes
  `rephrase | simplify | expand | shorten | humanize`; one locale-aware `call_llm` with a
  mode-specific system prompt (Dune persona); returns transformed text only. 400 on empty
  text, 413 over 6000 chars.
- `async chat(project, article, question, history, db) -> dict` — Dune chat grounded in:
  project profile, article title/keyword + first 3000 chars of the draft, and (when available)
  top GSC queries. Returns `{answer, insertable}` where `insertable` is non-null when the
  answer's dominant content is draft text (heuristic: model instructed to wrap insertable
  content in `<draft>...</draft>`; service extracts it). Mirrors `ai_analytics_service.answer`
  provider-fallback shape; locale-aware.

### `checks_service.py` (new)
- `def seo_checklist(article, keyword) -> list[{id, status: pass|warn|fail, detail}]` —
  deterministic: title length 15-65; meta description 50-160; keyword present in title / first
  paragraph / at least one heading; keyword density 0.3-2.5%; >= 3 headings; intro <= 60 words;
  at least 2 internal or external links; image alt coverage in markdown; paragraph length
  (no wall > 120 words).
- `def ai_patterns(text, lang) -> {score 0-100, signals: [{id, severity, detail}], flagged:
  [{sentence, reason}]}` — burstiness (stddev of sentence lengths; low variance = robotic),
  repeated sentence openers (>= 3 same first word), AI-cliché list per language (en/fr seeded,
  e.g. "delve", "in today's fast-paced world", "il est important de noter"), uniform paragraph
  lengths, em-dash/list overuse. Score = weighted signals; HIGHER = more human. Labeled
  heuristic in the UI.
- `async plagiarism_scan(project, article, db) -> {checked, matches: [{sentence, urls[]}]}` —
  picks up to 8 distinctive sentences (10-20 words, no keyword-stuffed/heading lines), runs
  quoted exact-phrase SERP queries via `get_seo_provider_for_org` (`serp(keyword=f'"{s}"')`),
  a sentence "matches" when the SERP returns >= 1 organic item whose domain differs from the
  project's; raises `NoProvider` when provider-less.

### Router additions (`routers/articles.py` or a new `articles_studio.py`)
- `POST /articles/{id}/transform` {mode, text} → {text} (org-scoped, article ownership).
- `POST /articles/{id}/chat` {question, history} → {answer, insertable}.
- `POST /articles/{id}/checks` → {seo: [...], ai: {...}} (deterministic, no provider needed).
- `POST /articles/{id}/plagiarism` → scan result | 409 `{"code": "no_seo_provider"}`.

## Frontend

- `components/articles/studio/` — `DocumentsRail.tsx`, `StatsBar.tsx`, `SelectionBar.tsx`
  (+ compare card), `DuneDock.tsx` (tab shell), `AssistantTab.tsx`, `ChecksTab.tsx`
  (MetaTab content = moved existing fields; Optimize reuses `OptimizePanel`).
- `articles/page.tsx` is restructured into the studio layout; existing queries/mutations,
  autosave, publish flow, model picker, ImageSuggestionsPanel are preserved (ImageSuggestions
  moves into the dock under Assistant as a secondary section or stays accessible via the
  canvas toolbar — implementer keeps it reachable).
- Selection detection via the textarea's `selectionStart/End` (state on select/keyup); the
  SelectionBar is disabled with a hint when nothing is selected.
- api.ts: `transformText`, `duneChat`, `runArticleChecks`, `runPlagiarismScan` + types.
- i18n block `articleStudio.*` in all six locales.

## Errors

- Transform/chat with no AI key → 400 with the standard "no AI key" message (same as article
  generation today); UI toasts it.
- Plagiarism without DataForSEO → 409 code → connect-state in the Checks tab (same gate as
  the SEO hub). Checks (deterministic) always work.
- Selection > 6000 chars → 413 toasted. Chat history capped at 8 turns.
- All new LLM calls are locale-aware (existing `call_llm` locale param).

## Testing

Backend (pytest, `tests/test_article_studio.py`, LLM/provider patched): transform mode
prompts + 400/413; chat returns answer + extracts `<draft>`; seo_checklist statuses on a
fixture article (each rule pass/warn/fail reachable); ai_patterns signals (low burstiness,
repeated openers, clichés) + score bounds; plagiarism sentence sampling + match logic +
NoProvider; router endpoints incl. ownership + 409 code. Frontend: typecheck + smoke; both
themes.

## Phasing (one plan)

A: backend services + endpoints + client. B: studio shell (rail/canvas/dock/meta move).
C: selection bar + transforms, Checks tab, Assistant tab. i18n throughout.
