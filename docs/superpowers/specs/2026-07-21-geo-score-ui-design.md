# GEO Score in Article Studio (UI) — Design

> Surfaces the already-shipped backend GEO score (Phase 7) in the Article Studio editor, mirroring the existing SEO score UI. Frontend-only; no backend changes.

## Problem

Phase 7 shipped a backend GEO ("answer-engine readiness") score for articles: the `articles.geo_score` column, auto-enforcement during generation, and `GET /articles/{id}/geo-score`. None of it is visible in the UI — `grep` for `geo` in `apps/web` returns nothing. Users can't see or act on their GEO score.

## Goal

Show the GEO score in Article Studio the same way the SEO score is shown: a live chip in the stats bar + a signal breakdown checklist, so writers get instant answer-engine-readiness feedback as they edit. Scope: Article Studio editor only. Frontend-only.

## Decisions (from brainstorming)

- **Live core chip + stored hybrid note.** The GEO chip shows the deterministic core (0-70) computed **client-side** as the user types (mirroring how SEO is computed via `lib/seo-score.ts`). The stored hybrid `article.geo_score` (which includes the +30 AI-answer judgment, refreshed only on generation) is shown as a small secondary line in the breakdown panel.
- **Mirror the SEO surface** — same components (`StatsBar` chip, `MetaTab` breakdown inside `DuneDock`), same data-flow (a `useMemo` in `articles/page.tsx`), same styling conventions.
- **No backend changes** — `geo_score` field and `/geo-score` endpoint already exist.

## Existing SEO pattern (the mirror target)

- `lib/seo-score.ts` — pure `computeSeoScore(title, body, keyword, meta) → { score, breakdown }`, computed client-side.
- `articles/page.tsx:829` — `const { score: seoScore, breakdown } = useMemo(() => computeSeoScore(...), [...])`.
- `StatsBar.tsx` — compact `SEO {score}` chip, colored by threshold (`seoColor`).
- `MetaTab.tsx` (rendered inside `DuneDock`) — the ranking-signal breakdown (`Object.entries(breakdown)`).

## Architecture

**New unit — `apps/web/lib/geo-score.ts`:**

```ts
export interface GeoScore { score: number; breakdown: Record<string, number>; }
export function computeGeoCore(title: string, body: string, metaDescription: string | null): GeoScore
```

A faithful TypeScript port of the backend `app/services/geo_service.py::compute_geo_core` — same 6 signals, same weights, same detection thresholds, returning the core score (0-70) and a `breakdown` keyed by the same signal names (`answer_up_top, qa_structure, extractable_format, statistics, citations, concise_paragraphs`). Pure function; no I/O.

**Signal parity (must match the Python exactly):**
| Signal | Pts | Detection |
|---|---|---|
| `answer_up_top` | 15 | a plain paragraph of 25-120 words before the first `##` H2 (skip headings/lists/tables/blockquotes) |
| `qa_structure` | 12 | a heading line (`#…`) containing `?` or matching `faq`/`frequently asked` (case-insensitive) |
| `extractable_format` | 12 | a markdown list (`- `, `* `, or `N. ` at line start) OR a table (a `\S \| \S` cell separator) |
| `statistics` | 10 / 5 | count of digit chars: ≥6 → 10, 3-5 → 5, else 0 |
| `citations` | 11 | a markdown http link `[..](http…)` OR a phrase in {according to, source:, study, report} (case-insensitive) |
| `concise_paragraphs` | 10 / 5 | median plain-paragraph sentence count (`[.!?]+`, min 1) ≤4 → 10, ≤6 → 5, else 0 |

**Wiring:**
- `articles/page.tsx` — add `const { score: geoScore, breakdown: geoBreakdown } = useMemo(() => computeGeoCore(title, body, metaDesc), [title, body, metaDesc])`; pass `geoScore` to `StatsBar`, and `geoBreakdown` + the article's stored `geo_score` down through `DuneDock` → `MetaTab`.
- `StatsBar.tsx` — new `geoScore: number | null` prop; render a `GEO {geoScore}` chip beside the SEO chip with a `geoColor(score)` helper tuned to the 0-70 core (≥50 emerald, ≥35 amber, else muted); label via `t("articles.editor.geoScore")`.
- `MetaTab.tsx` — new `geoBreakdown: Record<string, number>` and `geoScore: number | null` (stored hybrid) props; render the GEO breakdown checklist (labels via `t`) beneath the SEO one, plus a secondary line when the stored hybrid is present: `t("articles.editor.geoJudgmentNote", { score })` → "AI-answer judgment: {score}/100 — refreshes on generate."
- `DuneDock.tsx` — thread the two new props through from `page.tsx` to `MetaTab` (it already threads `breakdown`).
- **Frontend `Article` type** — add `geo_score?: number | null` to the TypeScript `Article` interface (wherever `seo_score` is declared — `lib/api.ts` or `packages/types`), so the loaded article carries the stored hybrid; the backend `ArticleOut` already returns it.

## Data flow

`title/body/metaDesc` (editor state) → `computeGeoCore` (client, live) → `geoScore`/`geoBreakdown` → `StatsBar` chip + `MetaTab` checklist. The stored hybrid comes from the loaded `article.geo_score` (already in the article payload via `ArticleOut.geo_score`) → `MetaTab` secondary note. No fetch, no backend call for display.

## i18n

Per CLAUDE.md, every user-visible string goes through `t("key")`. Add keys mirroring the SEO ones to every `public/locales/<lang>/` file already shipping SEO labels:
- `articles.editor.geoScore` — chip label.
- 6 signal labels `articles.editor.geoSignals.<key>` (answer_up_top, qa_structure, extractable_format, statistics, citations, concise_paragraphs).
- `articles.editor.geoJudgmentNote` — the stored-hybrid secondary line (with an `{{score}}` interpolation).

## Error handling / edge cases

- Empty/short body → `computeGeoCore` returns a low score with all-zero-ish breakdown (pure function, no throw), exactly like `computeSeoScore`.
- `article.geo_score` null (never generated) → the secondary hybrid note is hidden; only the live core chip + breakdown show.
- No new failure modes; nothing async.

## Testing

Per CLAUDE.md there is no frontend test framework — verify with `npm run typecheck` (from `apps/web`) and visual browser testing. Additionally, a **parity check**: run the Python `compute_geo_core` and the TS `computeGeoCore` on 2-3 sample markdown docs and confirm identical `score` and `breakdown` — the TS port is only correct if it matches the backend scorer.

## Non-goals

- No backend changes (score/endpoint already exist).
- No GEO surface outside the Article Studio editor (no overview cards, no list badges) in v1.
- No client-side computation of the LLM judgment (+30) — it is backend-only and shown from the stored value.
- No "optimize for GEO" button (optimization is auto-enforced during generation, per Phase 7).
