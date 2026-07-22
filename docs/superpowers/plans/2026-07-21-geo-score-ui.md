# GEO Score in Article Studio (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the already-shipped backend GEO score in the Article Studio editor, mirroring the SEO score UI — a live client-side "GEO" chip in the stats bar plus a 6-signal breakdown checklist and a stored-hybrid note in the meta panel.

**Architecture:** Add `apps/web/lib/geo-score.ts` (a faithful TS port of the backend `compute_geo_core`, 0-70) used exactly like `lib/seo-score.ts`; a `useMemo` in `articles/page.tsx` computes it live and feeds a new GEO chip in `StatsBar` and a new GEO breakdown block in `MetaTab` (threaded through `DuneDock`). The stored hybrid `article.geo_score` (with the +30 AI-answer judgment) is shown as a secondary note. Frontend-only — no backend changes.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind (CSS variables), react-i18next. No frontend test framework — verify with `npm run typecheck` (from `apps/web`) + visual browser testing (per CLAUDE.md).

## Global Constraints

- Mirror the existing SEO surface and its conventions: `lib/seo-score.ts` (client-side scorer), `StatsBar` chip, `MetaTab` "Ranking signals" checklist. Follow the same markup/props patterns.
- Styling uses Tailwind CSS variables / existing utility classes only — never hard-code colors (per CLAUDE.md).
- All user-visible strings go through `t("key")`; new keys added to `apps/web/public/locales/*/common.json` (per CLAUDE.md i18n rule). Signal-name labels may use the `t(key, { defaultValue })` fallback pattern the SEO signals already use.
- The TS `computeGeoCore` MUST match the backend `apps/api/app/services/geo_service.py::compute_geo_core` exactly (same 6 signals, weights, thresholds). Reference numbers for the parity check: the backend scores a rich sample at **70/70** and a bare sample at **25/70**.
- Verification for every task: `cd apps/web && npm run typecheck` passes; UI tasks additionally get a visual check.
- No backend changes; `ArticleOut.geo_score` and `GET /articles/{id}/geo-score` already exist.

---

## File Structure

```
apps/web/lib/geo-score.ts                                # NEW: computeGeoCore (TS port of compute_geo_core)
apps/web/lib/api.ts                                      # MODIFY: Article interface gains geo_score
apps/web/components/articles/studio/StatsBar.tsx         # MODIFY: geoScore prop + GEO chip + geoColor
apps/web/components/articles/studio/MetaTab.tsx          # MODIFY: geoBreakdown + geoScore props; GEO ring/checklist/note
apps/web/components/articles/studio/DuneDock.tsx         # MODIFY: thread geoBreakdown + geoScore to MetaTab
apps/web/app/(dashboard)/[projectId]/articles/page.tsx   # MODIFY: geo useMemo; pass props to StatsBar + DuneDock
apps/web/public/locales/{en,fr,es,de,pt,ar}/common.json  # MODIFY: geoScore, geoJudgmentNote (+ geoSignalNames en)
```

---

### Task 1: `lib/geo-score.ts` — TS port of the backend GEO core

**Files:**
- Create: `apps/web/lib/geo-score.ts`

**Interfaces:**
- Produces: `computeGeoCore(title: string, body: string, metaDescription: string | null) -> { score: number; breakdown: Record<string, number> }` — the deterministic core (0-70) with keys `answer_up_top, qa_structure, extractable_format, statistics, citations, concise_paragraphs`.

- [ ] **Step 1: Create the file**

```ts
// apps/web/lib/geo-score.ts
/**
 * Client-side mirror of the backend `compute_geo_core`
 * (apps/api/app/services/geo_service.py). Kept in sync so the editor can
 * recompute the GEO core (answer-engine readiness, 0-70) live as the user
 * types - no server round-trip. The server stays the source of truth for the
 * persisted hybrid score (core + the +30 LLM judgment added on generation).
 */

export interface GeoScore {
  score: number;
  breakdown: Record<string, number>;
}

export function computeGeoCore(
  title: string,
  body: string,
  metaDescription: string | null,
): GeoScore {
  const b = body ?? "";
  const breakdown: Record<string, number> = {};
  let score = 0;

  // 1. answer_up_top (+15): a plain paragraph (25-120 words) before the first H2.
  const beforeH2 = b.split(/(?:^|\n)##\s/)[0];
  let answer = 0;
  for (const para of beforeH2.split(/\n\s*\n/)) {
    const p = para.trim();
    if (!p || /^[#\-*>|]/.test(p) || /^\d+\./.test(p)) continue;
    const wc = p.split(/\s+/).filter(Boolean).length;
    if (wc >= 25 && wc <= 120) {
      answer = 15;
      break;
    }
  }
  breakdown.answer_up_top = answer;
  score += answer;

  // 2. qa_structure (+12): a heading line with '?' or an FAQ heading.
  let qa = 0;
  for (const ln of b.split("\n")) {
    const s = ln.trim();
    if (s.startsWith("#") && (s.includes("?") || /\bfaq\b|frequently asked/i.test(s))) {
      qa = 12;
      break;
    }
  }
  breakdown.qa_structure = qa;
  score += qa;

  // 3. extractable_format (+12): a markdown list or table.
  const hasList = /^\s*(?:[-*]\s+|\d+\.\s+)/m.test(b);
  const hasTable = /\S \| \S/.test(b);
  const ef = hasList || hasTable ? 12 : 0;
  breakdown.extractable_format = ef;
  score += ef;

  // 4. statistics (+10 / +5): count digit characters.
  const nums = (b.match(/\d/g) ?? []).length;
  const stat = nums >= 6 ? 10 : nums >= 3 ? 5 : 0;
  breakdown.statistics = stat;
  score += stat;

  // 5. citations (+11): a markdown http link or a citation phrase.
  const cite =
    /\[[^\]]+\]\(https?:\/\//.test(b) || /according to|source:|\bstudy\b|\breport\b/i.test(b) ? 11 : 0;
  breakdown.citations = cite;
  score += cite;

  // 6. concise_paragraphs (+10 / +5): median plain-paragraph sentence count <= 4.
  const paras = b
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !/^[#\-*|>]/.test(p));
  let conc = 0;
  if (paras.length) {
    const counts = paras
      .map((p) => Math.max(1, (p.match(/[.!?]+/g) ?? []).length))
      .sort((x, y) => x - y);
    const median = counts[Math.floor(counts.length / 2)];
    conc = median <= 4 ? 10 : median <= 6 ? 5 : 0;
  }
  breakdown.concise_paragraphs = conc;
  score += conc;

  return { score: Math.round(score * 10) / 10, breakdown };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: passes (no errors introduced).

- [ ] **Step 3: Parity check against the backend**

Confirm the port matches the Python scorer on the two reference documents the backend test uses. Run the backend once to get the reference (already known: **70** and **25**):
```bash
cd /home/mhamnache/Startup/AI/claude/fennex
docker compose exec -T api python -c "from app.services.geo_service import compute_geo_core; print(compute_geo_core('T', open('/dev/stdin').read(), 'm')[0])" <<'MD'
# T

The best vegan protein for runners is a pea-rice blend at about 25g per serving, taken within 30 minutes post-run to support recovery and steady daily intake here now.

## What should runners look for?

According to a 2023 study, 80% improved recovery. See [the report](https://example.com).

- Pea protein
- Rice protein

## FAQ

Short answer.
MD
```
Expected: `70.0`. A bare doc (`# T\n\nOne short line.`) scores well under the 45 floor. The TS `computeGeoCore` on the same inputs must produce the same numbers — verify visually in Task 4's browser check (rich draft → GEO chip ~70; thin draft → low). The port's structure and thresholds match `compute_geo_core` line-for-line.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/geo-score.ts
git commit -m "feat(geo-ui): client-side GEO core scorer (TS port of compute_geo_core)"
```

---

### Task 2: `Article` type + i18n keys

**Files:**
- Modify: `apps/web/lib/api.ts` (Article interface, ~line 488)
- Modify: `apps/web/public/locales/{en,fr,es,de,pt,ar}/common.json`

**Interfaces:**
- Produces: `Article.geo_score: number | null` on the frontend type; i18n keys `articles.editor.geoScore`, `articles.editor.geoJudgmentNote`, and `articleStudio.meta.geoSignalNames.*` (English).

- [ ] **Step 1: Add `geo_score` to the Article interface**

In `apps/web/lib/api.ts`, in the main `Article` interface, add directly after `seo_score: number | null;` (line ~488):

```ts
  geo_score: number | null;
```

- [ ] **Step 2: Add i18n keys (English source)**

In `apps/web/public/locales/en/common.json`, add under the existing `articles.editor` object:

```json
"geoScore": "GEO score (answer-engine readiness)",
"geoJudgmentNote": "AI-answer judgment: {{score}}/100 — refreshes on generate"
```

and under the existing `articleStudio.meta` object, add a `geoSignalNames` map and a `geoScoreLabel`:

```json
"geoScoreLabel": "GEO score",
"geoSignals": "Answer-engine signals",
"geoSignalNames": {
  "answer_up_top": "Direct answer up top",
  "qa_structure": "Question / FAQ structure",
  "extractable_format": "Lists or tables",
  "statistics": "Statistics & specifics",
  "citations": "Citations / sources",
  "concise_paragraphs": "Concise paragraphs"
}
```

- [ ] **Step 3: Add the two headline keys to the other 5 locales**

In each of `apps/web/public/locales/{fr,es,de,pt,ar}/common.json`, add `articles.editor.geoScore` and `articles.editor.geoJudgmentNote` (translate the value; keep the `{{score}}` placeholder intact). The `geoSignalNames`/`geoScoreLabel`/`geoSignals` fall back to the English source via i18next fallback + the `defaultValue` used at call sites, so they are optional in non-English files (matching how SEO `signalNames` degrade). Example for `fr`:

```json
"geoScore": "Score GEO (lisibilité par les moteurs de réponse)",
"geoJudgmentNote": "Jugement réponse IA : {{score}}/100 — actualisé à la génération"
```
(Use natural translations per locale; `ar` is RTL — value text only, no layout change.)

- [ ] **Step 4: Typecheck + JSON validity**

Run: `cd apps/web && npm run typecheck` (passes) and confirm each edited `common.json` is valid JSON (`node -e "require('./public/locales/en/common.json')"` etc., or the editor's linter).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/api.ts apps/web/public/locales
git commit -m "feat(geo-ui): Article.geo_score type + GEO i18n keys"
```

---

### Task 3: GEO chip + breakdown + full wiring (lands green end-to-end)

**Files:**
- Modify: `apps/web/components/articles/studio/StatsBar.tsx`
- Modify: `apps/web/components/articles/studio/MetaTab.tsx`
- Modify: `apps/web/components/articles/studio/DuneDock.tsx`
- Modify: `apps/web/app/(dashboard)/[projectId]/articles/page.tsx`

**Why one task:** the new props are required, so the component edits and the call-site wiring must land together for `npm run typecheck` to pass — splitting them would leave an intermediate red state.

**Interfaces:**
- Consumes: `computeGeoCore` (Task 1), `Article.geo_score` + i18n keys (Task 2).
- Produces: `StatsBar.geoScore`, `MetaTab.geoBreakdown`/`geoScore`, `DuneDock.geoBreakdown`/`geoScore`, all supplied end-to-end from `page.tsx`.

- [ ] **Step 1: StatsBar — add the GEO chip**

In `StatsBar.tsx`, add a `geoColor` helper beside `seoColor` (tuned to the 0-70 core):

```tsx
function geoColor(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 50) return "text-emerald-500";
  if (score >= 35) return "text-amber-500";
  return "text-red-500";
}
```

Add `geoScore` to the props interface and destructuring:

```tsx
interface StatsBarProps {
  wordCount: number;
  wordTarget?: number | null;
  seoScore: number | null;
  geoScore: number | null;
  saveState: "idle" | "saving" | "saved";
}
```
```tsx
export function StatsBar({ wordCount, wordTarget, seoScore, geoScore, saveState }: StatsBarProps) {
```

Immediately after the existing SEO chip `<span>…SEO…</span>` block, add the GEO chip (same markup):

```tsx
      <span
        title={t("articles.editor.geoScore")}
        className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 transition-colors"
      >
        {geoScore !== null ? (
          <span className={`font-semibold tabular-nums ${geoColor(geoScore)}`}>GEO {geoScore}</span>
        ) : (
          <span className="text-muted-foreground">GEO</span>
        )}
      </span>
```

- [ ] **Step 2: MetaTab — add GEO props + render block**

In `MetaTab.tsx`, add to `MetaTabProps`:

```tsx
  geoBreakdown: Record<string, number>;
  geoScore: number | null;
```

Add them to the destructured params (after `breakdown`):

```tsx
  breakdown,
  geoBreakdown,
  geoScore,
```

After the existing "Ranking signals" block (the SEO `entries.map(...)` block near the end of the returned JSX), add the GEO block:

```tsx
      {/* Answer-engine (GEO) signals */}
      {Object.keys(geoBreakdown).length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {t("articleStudio.meta.geoSignals", { defaultValue: "Answer-engine signals" })}
            </p>
            <span className="text-[11px] font-semibold tabular-nums text-foreground">
              {t("articleStudio.meta.geoScoreLabel", { defaultValue: "GEO score" })}{" "}
              {Math.round(Object.values(geoBreakdown).reduce((s, v) => s + v, 0))}/70
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {Object.entries(geoBreakdown).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between rounded-lg bg-muted/30 px-2.5 py-1.5 text-xs">
                <span className="flex items-center gap-1.5 text-foreground">
                  {val > 0 ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-destructive" />
                  )}
                  {t(`articleStudio.meta.geoSignalNames.${key}`, { defaultValue: key.replace(/_/g, " ") })}
                </span>
                <span className={`tabular-nums font-semibold ${val > 0 ? "text-success" : "text-muted-foreground"}`}>
                  +{val}
                </span>
              </div>
            ))}
          </div>
          {geoScore !== null && (
            <p className="text-[10px] text-muted-foreground">
              {t("articles.editor.geoJudgmentNote", {
                score: geoScore,
                defaultValue: `AI-answer judgment: ${geoScore}/100 — refreshes on generate`,
              })}
            </p>
          )}
        </div>
      )}
```

(`CheckCircle2` and `XCircle` are already imported in `MetaTab.tsx`.)

- [ ] **Step 3: page.tsx — compute the GEO core live**

In `apps/web/app/(dashboard)/[projectId]/articles/page.tsx`, add the import beside the SEO one:

```ts
import { computeGeoCore } from "@/lib/geo-score";
```

Right after the existing SEO `useMemo` (`const { score: seoScore, breakdown } = useMemo(() => computeSeoScore(...), [...])`, ~line 829), add:

```ts
  const { score: geoScore, breakdown: geoBreakdown } = useMemo(
    () => computeGeoCore(title, body, metaDesc),
    [title, body, metaDesc],
  );
```

- [ ] **Step 4: page.tsx — pass the props**

In the `<StatsBar .../>` call (~line 1031), add `geoScore={geoScore}`:

```tsx
        <StatsBar
          wordCount={wordCount}
          wordTarget={article.word_count_target}
          seoScore={seoScore}
          geoScore={geoScore}
          saveState={saveState}
        />
```

In the `<DuneDock .../>` call (the one already passing `breakdown={breakdown}`), add:

```tsx
        breakdown={breakdown}
        geoBreakdown={geoBreakdown}
        geoScore={article.geo_score}
```

- [ ] **Step 5: DuneDock — thread the props to MetaTab**

In `apps/web/components/articles/studio/DuneDock.tsx`, add to `DuneDockProps` (after `breakdown`):

```tsx
  geoBreakdown: Record<string, number>;
  geoScore: number | null;
```

Add to the destructured params (after `breakdown,`):

```tsx
  geoBreakdown,
  geoScore,
```

In the `<MetaTab .../>` render (already passing `breakdown={breakdown}`), add:

```tsx
            breakdown={breakdown}
            geoBreakdown={geoBreakdown}
            geoScore={geoScore}
```

- [ ] **Step 6: Typecheck (full green gate)**

Run: `cd apps/web && npm run typecheck`
Expected: passes with no errors (all new props now supplied end-to-end).

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/articles/studio/StatsBar.tsx apps/web/components/articles/studio/MetaTab.tsx apps/web/components/articles/studio/DuneDock.tsx "apps/web/app/(dashboard)/[projectId]/articles/page.tsx"
git commit -m "feat(geo-ui): live GEO chip + signals block wired through Article Studio"
```

---

### Task 4: Verification (typecheck + build + visual)

**Files:** none.

- [ ] **Step 1: Typecheck + lint + build**

Run: `cd apps/web && npm run typecheck && npm run lint && npm run build`
Expected: all pass (build compiles the article studio page with the new GEO wiring).

- [ ] **Step 2: Visual / parity check (manual)**

With the app running (`make dev`), open an article in the editor and confirm:
- The stats bar shows a **GEO** chip beside the SEO chip; it updates live as you type.
- A rich draft (direct answer up top, a `## Question?` or FAQ heading, a bullet list, some numbers, a link) drives the GEO chip toward **~70** and lights up all 6 signals in the meta panel; a thin draft scores low with most signals red — matching the backend (`70` vs `25`).
- After generating an article (which stores the hybrid `geo_score`), the meta panel shows the "AI-answer judgment: X/100 — refreshes on generate" note; editing the body updates the live core but the note stays until the next generate.
- Check one RTL locale (`ar`) renders the chip/labels without layout breakage.

- [ ] **Step 3: Commit (empty checkpoint if no fixes)**

```bash
git commit --allow-empty -m "chore(geo-ui): verification (typecheck/lint/build + visual)"
```

---

## Self-Review

**Spec coverage:**
- `lib/geo-score.ts` TS port with 6-signal parity → Task 1. ✅
- `StatsBar` live GEO chip (0-70, geoColor) → Task 3. ✅
- `MetaTab` breakdown checklist + stored-hybrid note → Task 3. ✅
- `page.tsx` `useMemo` + `DuneDock` threading → Task 3. ✅
- Frontend `Article.geo_score` type → Task 2. ✅
- i18n keys (all strings via `t`) → Task 2. ✅
- No backend changes → respected (no `apps/api` files touched). ✅
- Testing = typecheck + visual + parity (no FE framework) → Tasks 1, 4. ✅

**Placeholder scan:** none — every step has concrete code. Task 3 lands the components and their call-site wiring together so `npm run typecheck` is green within the task (no intermediate red state).

**Type consistency:** `computeGeoCore(title, body, metaDescription) -> {score, breakdown}` (Task 1) is called with `(title, body, metaDesc)` in Task 3. `StatsBar.geoScore`, `MetaTab.geoBreakdown`/`geoScore`, `DuneDock.geoBreakdown`/`geoScore` names/types are all defined and supplied within Task 3. `Article.geo_score: number | null` (Task 2) is what `page.tsx` passes as `geoScore={article.geo_score}` (Task 3). Signal keys (`answer_up_top` …) match the backend and the i18n `geoSignalNames` map.
```
