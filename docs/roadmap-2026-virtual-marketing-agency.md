# Fennex Roadmap — The Virtual Marketing Agency

> **North Star:** an enterprise marketing operations platform fused with an AI SEO content studio — a *virtual agency of AI experts* that helps enterprises and individuals create great content (text, image, and soon video), build their brand, and distribute it to social and the web, all **guided by SEO and ranking**. The product proposes the right tools for each project and each persona.

---

## 1. The one-line strategy

> **"Tell Fennex your goal and who you are — it assembles the right expert agents and tools, produces content that ranks and converts, and publishes it where your audience is."**

Fennex already sits between two markets — Jasper-style marketing operations and Surfer/Semrush-style SEO — and our wedge is combining them with **honest, real-data grounding** and an **agent team (the Pack)** that *executes* the work. This roadmap turns that wedge into a full "virtual agency."

---

## 2. Where we are today (the foundation is real)

Already built and shipping:

| Capability | Status |
|---|---|
| **The Fennex Pack** — 7 named agents (Zerda, Sirocco, Dune, Mirage, Sable, Oasis, Nomad) | ✅ Live |
| **Article Studio** — agentic Dune, streaming generation, live SEO scoring + auto-repair, revisions, internal linking, templates, checks/plagiarism | ✅ Live |
| **SEO suite** — keyword research, SERP rank tracking (DataForSEO), site audit, competitor intel, content scoring, GSC analytics | ✅ Live |
| **Images** — generation, Mirage natural-language editing, product shots, marketing banners, folders/collections, image scoring | ✅ Live |
| **Social** — multi-platform post studio + content calendar | ✅ Live (posts) · ⚠ real OAuth publishing pending |
| **Platform** — multi-tenant orgs/projects, Stripe billing, brand kit & voice, i18n (6 languages, incl. RTL), WordPress publishing | ✅ Live |
| **Personas** — `creator / ecommerce / freelancer` concept + per-agent `personaFit` | ◐ Partial (data model exists; experience not fully wired) |

**Implication:** we don't start from zero. The roadmap is mostly about (a) **wiring personas to tailored experiences**, (b) **distribution integrations**, (c) an **orchestration layer** that makes it feel like an agency, and (d) **new formats** (video) and **GEO**.

---

## 3. The audience → the right tools for each project

The core UX promise ("propose the right tools for each project") is a **persona-driven workspace**: onboarding detects the persona and goal, then surfaces a tailored home, a recommended agent squad, and pre-shaped workflows.

| Persona | Primary goal | Expert squad (agents) | Signature tools | North-star metric |
|---|---|---|---|---|
| **Social influencer / creator** | Grow audience with great content | **Sirocco** (creative director) · **Mirage** (images) · **Dune** (captions/scripts) | Image studio, trends, social studio + calendar, hooks/caption generator | Reach & engagement per post |
| **E-commerce seller** (Shopify / WooCommerce) | Product content that sells & ranks | **Mirage** (product shots) · **Dune** (product descriptions) · **Zerda** (SEO) | Store sync, product-image studio, SEO product descriptions, collection pages, review-to-content | Product-page conversions & organic traffic |
| **Freelancer** | Find clients on LinkedIn / the web | **Nomad** (outreach) · **Oasis** (market research) · **Dune** (personal brand content) | LinkedIn post planner, DM/connection templates, market reports, portfolio/case-study builder | Qualified leads & reply rate |
| **Company / brand** | Own the brand's search & social presence | **All + Sirocco** orchestrating | Article Studio, campaigns/autopilot, brand kit & voice, rank tracking, multi-channel calendar | Rankings, share of voice, pipeline |

Each persona gets a **"Start a project" flow** → picks a goal → Fennex proposes a plan (which agents, which assets, in which order) → one click assembles the workspace.

---

## 4. Strategic pillars

1. **Persona-first experience** — the right home, squad and workflows per audience.
2. **The Virtual Agency** — an orchestration layer that turns *one goal* into a coordinated multi-agent, multi-asset plan (brief → assets → review → publish → measure).
3. **SEO/GEO as the guidance layer** — every asset is optimized for classic search *and* AI answer engines; ranking is the compass.
4. **Multi-format content** — text → image → **video** (and audio/short-form) from the same brief.
5. **Distribution & integrations** — Shopify/Woo, real social OAuth publishing, CMS, CRM; a pluggable connector framework.
6. **Branding & governance** — brand kit, voice, style/visual guidelines, compliance — applied automatically.
7. **Enterprise readiness** — SSO, roles, audit, API, usage governance, SOC 2 track.

---

## 5. The roadmap (phased, sequenced by dependency & ROI)

Phases are ordered so each unlocks the next. Sizing is **S / M / L / XL** effort, not calendar dates.

### Phase 1 — Persona-guided platform + Integration Hub *(foundation)* · **L**
The two things everything else depends on.
- **Persona onboarding & tailored home** — detect persona + goal; per-persona dashboard, recommended squad, curated tool rail. (Wires the existing `personaFit`.)
- **Integration Hub + connector framework** — one place to connect destinations; a pluggable connector model (WordPress, social, Shopify, custom HTTP/webhook). *Unblocks Phases 2–4.*
- **"Start a project" flow** — goal → proposed plan → assembled workspace (thin v1 of the orchestration layer).
- *Serves:* everyone. *Depends on:* nothing new.

### Phase 2 — E-commerce vertical (Shopify / WooCommerce) · **L**
Highest commercial ROI persona.
- **Store sync** — pull products, collections, images via the connector framework.
- **Product studio** — Mirage product photography + background/scene generation; Dune SEO product descriptions & collection copy; Zerda product-keyword targeting.
- **Publish back to store** — write optimized content & images back to Shopify/Woo.
- *Serves:* e-commerce sellers. *Depends on:* Integration Hub.

### Phase 3 — Social distribution & the Influencer Studio · **M/L**
Turn "posts" into real reach.
- **Real OAuth publishing** — Meta (FB/IG), X, LinkedIn, TikTok; replace token-paste with proper auth + scheduling.
- **Influencer Studio** — hook/caption generator, trend-driven ideation (Sable/Oasis), carousel & short-form image sets (Mirage), best-time scheduling, per-network variants.
- *Serves:* influencers/creators + companies' social. *Depends on:* Integration Hub.

### Phase 4 — Freelancer / outreach vertical · **M**
- **LinkedIn client-finding** — Nomad weekly post plan, connection & follow-up DM templates, ICP targeting from Oasis market research.
- **Personal brand & portfolio** — case-study/portfolio content, testimonial-to-content.
- *Serves:* freelancers. *Depends on:* social OAuth (LinkedIn) from Phase 3.

### Phase 5 — The Virtual Agency (orchestration) · **XL**
The differentiator that makes it feel like an agency, not a toolbox.
- **Campaign brain** — from one goal + persona, generate a full plan: which agents, which assets (articles, images, posts), sequence, and calendar.
- **Agent-to-agent handoffs** — e.g., Oasis (research) → Zerda (keywords) → Dune (article) → Mirage (images) → Sirocco (campaign packaging) → social/CMS publish, with human approval gates.
- **Project rooms** — a shared surface where the squad's work, status and approvals live (builds on existing campaigns/autopilot).
- *Serves:* companies + power users. *Depends on:* Phases 1–4 assets & connectors.

### Phase 6 — Video & multi-format · **XL**
- **Short-form video** — script (Dune) → scenes/storyboard (Mirage) → generated/edited video (provider integration) → captions & variants per network.
- **Repurposing** — one article/brief → blog + images + social posts + a short video, all on-brand.
- *Serves:* influencers, e-commerce, brands. *Depends on:* orchestration (Phase 5) for repurposing.

### Phase 7 — GEO + brand governance *(enterprise pull)* · **L**
Close the gap vs Jasper and lead on honesty.
- **GEO (Generative Engine Optimization)** — optimize content for AI answer engines; track brand citations/visibility in AI answers.
- **Brand governance at scale** — style guide & visual-guideline enforcement, brand-safety/compliance checks applied automatically across all assets.
- *Serves:* companies/enterprise. *Depends on:* brand kit/voice (exists).

### Phase 8 — Enterprise & ecosystem · **L/XL**
- **SSO, roles, audit logs, usage governance**, SOC 2 track.
- **Public API + webhooks + Zapier/MCP** and a small connector marketplace.
- *Serves:* enterprise & partners. *Depends on:* Integration Hub maturity.

---

## 6. Sequencing rationale

- **Integration Hub first** — Shopify, social publishing and CRM all sit on it; building it once avoids three bespoke integrations.
- **E-commerce before video** — clearer, faster ROI; product content is a proven willingness-to-pay.
- **Orchestration (Phase 5) after the verticals** — the agency layer is only compelling once there are enough assets and connectors to orchestrate.
- **Video late** — highest cost/complexity; most valuable once repurposing (orchestration) exists.
- **GEO + enterprise as the moat** — differentiates against both Jasper (SEO depth, honesty, control) and Surfer/Semrush (agentic creation + distribution).

---

## 7. What makes this win (defensible positioning)

- **Agentic + honest + grounded** — a team of expert agents that *execute*, grounded in the user's real GSC/store/market data, with transparent scoring. Not a prompt box.
- **SEO/GEO as the compass** — every asset is created to rank and to be cited, across classic and AI search.
- **One workflow, every format & channel** — research → write → design → (video) → publish → measure, without leaving the app.
- **Right tools per persona** — an influencer, a Shopify seller, a freelancer and a brand each get a purpose-built experience, not a generic canvas.
- **Ownership** — bring-your-own AI keys, self-hostable, transparent — control that enterprise buyers and agencies want.

---

## 8. Metrics & guardrails

- **North Star:** *ranked, published assets per active project* (content that actually ships and performs).
- **Per-persona activation:** first published asset within day 1; first ranking/engagement signal within week 2.
- **Guardrails (non-negotiable principles):** real-data grounding only (never fabricate metrics/URLs), deterministic transparent scoring, honest capability claims, human approval before anything is published externally, and per-tenant data isolation.

---

## 9. Immediate next step

Start **Phase 1**: persona onboarding + the Integration Hub connector framework, and a thin "Start a project → proposed plan" flow. It's the foundation the whole agency vision stands on, and it makes the "right tools for each project" promise real on day one.
