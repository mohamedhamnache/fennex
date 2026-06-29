# Fennex "Aurora" Redesign — Design Spec

**Date:** 2026-06-27
**Status:** Approved (direction: Aurora dark-first; scope: new design + restructured UX/IA)

## Goal

A major visual + UX refactor giving Fennex a distinctive, premium "AI product"
identity: a dark-first, vivid, glassmorphic interface ("Aurora") with a
restructured navigation and a command-center dashboard.

## Direction

- **Aesthetic:** Aurora — dark-first, deep navy canvas, indigo→violet→fuchsia
  gradient accents, glassmorphic surfaces, glow-based depth, neon data-viz.
- **Scope:** new visual system + restructured navigation/IA + redesigned
  dashboard, rolled out flagship-screen-first then across all pages.

## 1. Visual system

### Color (dark = default/primary)
- Canvas: `--background: 224 64% 3%` (near-black navy).
- Foreground: `213 31% 94%`.
- Surface base (rarely used directly; prefer glass): `224 44% 7%`.
- Border / hairline: `222 30% 14%` and glass `white/[0.07]`.
- Brand gradient: `#6366f1 → #8b5cf6 → #d946ef` (indigo → violet → fuchsia).
- Primary: `256 92% 66%`. Ring: same.
- Semantic tones (success/warning/danger/info) retained, tuned for dark.
- Light mode retained as a clean secondary adaptation; `defaultTheme="dark"`.

### Surfaces & depth
- `.glass`: `bg-white/[0.03]`, `backdrop-blur`, `border-white/[0.07]`, faint
  top inner highlight.
- `.glass-hover`: lift + **colored glow** (indigo) on hover, not black shadow.
- `.aurora-field`: fixed full-viewport background with 2–3 slow-drifting
  gradient blobs at ~6% opacity behind all content.
- Glow shadows: colored (`primary/…`) rather than neutral black.

### Type
- Display: Plus Jakarta Sans (page titles ~28–32px, tight tracking).
- Body: Inter. Higher heading/body contrast.
- Tabular figures for metrics; subtle count-up on KPI mount.

### Data-viz
- Neon line strokes over gradient-glow area fills; glowing sparklines and
  gauges. Recharts theming uses the brand gradient + glow.

### Motion (all behind `prefers-reduced-motion`)
- Drifting aurora blobs, hover lift+glow, KPI count-up, page fade/slide,
  palette/menu scale-in.

## 2. Navigation / IA

- **Icon rail (72px)** replaces the fixed sidebar; icons always visible.
  Hover or pin to expand to a 240px labeled panel; pinned state persists
  (localStorage/zustand).
- **Workspace switcher** at the top of the rail (project + org context).
- Nav grouped by workflow: **Research · Create · Grow**, with a contextual
  sub-panel for sections that have sub-views.
- **Slim glass top bar:** breadcrumbs + project context, global ⌘K,
  notifications, avatar menu. Sticky + blurred.
- Responsive: rail collapses to a drawer under `lg`.

## 3. Command-center dashboard (bento)

A modular bento grid replacing the current vertical stack:
- **Hero tile:** organic-traffic trend (glow area chart) + headline KPI.
- Tiles: keywords tracked, articles published, **audit score gauge**,
  **setup/onboarding progress ring**, recent activity feed, quick actions.
- Live data; every tile has a designed empty state.

## 4. Page layouts

- Glass `PageHeader` with aurora glow + breadcrumb + contextual actions.
- Multi-pane where it earns its keep: Articles (list + editor), Keywords
  (table + cluster panel), Analytics (sticky filter rail + content).
- Dark tables: hairline rows, hover glow, sticky headers, inline actions.

## 5. Components

Gradient/glow primary buttons; glass secondary/ghost; dark glass inputs with
gradient focus ring; neon-tinted badges (reuse tone system); segmented
controls; pill/underline tabs with glow; gauges; restyled ⌘K palette, toasts,
popovers (glass + glow). New: `Gauge`, `ProgressRing`, `BentoTile`,
`AuroraBackground`.

## Execution (de-risked, flagship-first)

1. Foundation: tokens + glass/glow utilities, `AuroraBackground`, restyled
   shared primitives, icon-rail sidebar, slim glass top bar.
2. Flagship: command-center dashboard.
3. Restart web container → review live on :3001.
4. Roll out across remaining pages (overview, analytics, keywords, articles,
   then the rest), each adopting the new primitives + multi-pane where useful.

## Non-goals (this phase)

- No backend/API changes. No new product features beyond UI/UX.
- Light mode is adapted, not separately art-directed.
