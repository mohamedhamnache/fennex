# Fennex — Coherence, Persona Interconnection & Market Differentiation

Strategy + roadmap plan. Captured 2026-07-05. Not a step-by-step implementation
plan — this is the product direction to draw the next implementation plans from.

## Context / current state

Fennex has the *pieces* of an AI marketing team but not yet the connective tissue:
- Tools: Analytics Studio, Articles, Social, Image/Product/Banner Studios.
- 7 agents (Fennex Pack): Zerda (SEO strategist), Sirocco (creative director),
  Dune (content writer), Mirage (image artisan), Sable (competitor scout),
  Oasis (market researcher), Nomad (outreach agent).
- Integrations: GSC (real search data), LinkedIn OAuth, WordPress/Shopify publishing,
  weekly digest email (arq cron), competitor crawler.
- Personas: creator / ecommerce / freelancer stored as `persona` + `persona_data`.

## The coherence problem (diagnosis)

Three gaps turn the current "toolbox" into something that doesn't feel like one product:

1. **Persona is stored, not wired.** It flavors some prompts + Mission Control, but every
   user sees every tool the same way. Persona doesn't shape the product.
2. **Agents are siloed.** Each owns a skill; they don't hand off to each other or share
   memory. There's no "team."
3. **The loop is open.** Find opportunity (Zerda/Oasis) -> create (Dune/Sirocco) ->
   publish -> nothing closes back. Nobody says "the article I suggested now ranks #6, +142 clicks."

Fixing these three is what turns the toolbox into a product.

## 1. Interconnect persona <-> tools (make persona the organizing principle)

- **Persona workspaces** — gate nav + agents hub by persona, each with a north-star metric:
  - Creator -> *audience growth* — Articles, Social, Image Studio, Dune + Sirocco.
  - Ecommerce -> *buyer-intent capture* — Product Studio, Banners, Market/Oasis, Sable.
  - Freelancer -> *leads/clients* — Nomad outreach, Oasis reports, competitor intel.
- **Persona home dashboard** oriented around that one metric (not a generic overview);
  everything else one click away but visually secondary.
- **Agents recommend the next action and route into the right tool pre-filled.** Extend the
  existing deep-link pattern (`?ws=`, `?copilot=1`, `?oasis=1`) so a Zerda recommendation
  becomes a "Write this article" button that opens Dune with topic + keyword loaded.
- **Formalize the agent->skill binding in `apps/api/app/agents/registry.py`** (add
  `skills`/`endpoints` fields) so the persona workspace renders "your team for this goal"
  from one source of truth instead of the hardcoded `agentActions()` switch.

## 2. The unique solution (positioning)

Differentiation is NOT any single feature — competitors win any single axis (Jasper=writing,
Surfer=SEO, Ahrefs=data, Canva=design). The moat is the **closed loop only Fennex can run
because it owns both ends** (GSC data + creation + publishing):

> Fennex is the AI marketing team that finds the opportunity in YOUR real search data,
> creates the asset, publishes it, and then tells you whether it worked — and what to do next.

No competitor closes that loop; they don't have GSC + creation + publishing under one roof.

## 3. The unique experience (make the Pack feel like a team briefed once)

- **An orchestrator** — one goal in ("get 3 new clients in the restaurant niche") -> the pack
  divides work: Oasis researches, Zerda prioritizes, Dune writes, Sirocco designs, Nomad
  distributes -> output is a coherent **campaign package**, not scattered assets.
- **Agents with memory + accountability** — reference past work and hold themselves to it:
  "Two weeks ago I suggested X. It now ranks #6. Here's the follow-up."
- **Weekly Pack standup** — extend the existing digest: what each agent did, found, and
  recommends, in their voices.

## High-value features (ranked)

1. **Closed-loop recommendation tracking** — highest moat, lowest new-data cost. Persist every
   agent recommendation; re-check GSC on the existing cron; surface "suggested -> done -> impact."
   The feature no competitor can ship.
2. **Orchestrated campaigns** — a `Campaign` object spanning tools; one brief -> multi-agent,
   multi-asset output. The "team" experience made real.
3. **Persona home + north-star dashboard + tool gating** — the coherence fix from section 1.
4. **Unified content calendar** — articles + social + banners on one schedule, wired to publish
   integrations. Turns point tools into a workflow.
5. **Autopilot mode** — the pack proposes a weekly plan you approve; opportunities auto-become
   drafts. Retention driver.
6. **Scheduled market/competitor monitoring** — Sable + Oasis on a cron, alerting when a
   competitor or your rankings move.

## Recommended first move

Ship **#1 (recommendation tracking) + #3 (persona home)** together: they deliver the loop and
the coherence, and mostly reuse existing infra (GSC sync, agents, arq cron, deep links) — high
value, contained scope. Start by brainstorming #1, since it creates the moat.

## Reusable infra to build on

- GSC sync + `AnalyticsSnapshot` / `GscQueryStat` (impact re-checks).
- arq cron worker (`apps/api/app/workers/worker.py`) — already runs the weekly digest.
- Agent registry (`apps/api/app/agents/registry.py` + `apps/web/lib/agents.ts`).
- Deep-link routing in analytics (`?ws=`, `?copilot=1`) + agents hub `agentActions()`.
- Digest composer (`apps/api/app/services/digest_service.py`) for the Pack standup.
- Publishing (`publish_service.py`) + LinkedIn OAuth (social router) for the loop's "publish" end.
