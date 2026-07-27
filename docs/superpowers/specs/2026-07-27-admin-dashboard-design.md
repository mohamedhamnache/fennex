# Fennex Admin Console — Design Spec

> Internal, staff-only operations console for Fennex (the solution owner). Full
> operational visibility into customers, AI/SEO usage, cost, margin,
> subscriptions, providers, and platform health.

**Status:** Approved design (2026-07-27). Next step: implementation plan.

## Locked decisions

| Decision | Choice |
|---|---|
| App placement | New `apps/admin` (Next.js 14) in the monorepo, reusing `packages/ui` + `packages/types` |
| Data access | Approach A — RBAC-gated `/api/v1/admin/*` routers in the existing `apps/api`; heavy metrics from pre-aggregated rollups |
| Tenant model | Admin "Application" = existing customer **Organization** (`org_id`). No new tenant entity. Projects stay nested under org |
| Infrastructure monitoring (§11) | **Deferred entirely** (Grafana/Prometheus/Sentry later; deep-link when built) |
| Phase 1 depth | **Full breadth, shallow depth** — a real-but-shallow page per section, deepened later |
| Charts | **Tremor** (purpose-built for this Stripe/Vercel dashboard look) |
| Staff auth | **Separate `admin_user` + RBAC tables**, isolated from customer `user` |
| Audience | Single solution owner today; RBAC designed for a growing internal team |

## Naming

The prompt's "Applications" = Fennex **Organizations** (customer workspaces/tenants).
Throughout this console the tenant object is labelled **Organization** in the UI
to match the existing product and DB. "Application" is not introduced as a new entity.

---

## 1. Information Architecture

Two-level IA: **Groups → Sections → (Detail pages)**. Section 11 (Infrastructure)
is out of scope for this build. Everything is read-first; a small set of
guarded write actions is called out per section.

```
Overview
  • Executive Dashboard              §1
Customers
  • Organizations (tenants)          §2   ← prompt "Applications"
  • Users                            §3
  • Support (shallow / link-out)     §3
Revenue
  • Billing                          §4
  • Subscription Plans               §15
AI & SEO
  • AI Providers                     §5
  • Model Analytics                  §6
  • DataForSEO                       §7
  • Usage Analytics                  §8
Operations
  • Queue Monitoring                 §9   (app-level, from arq/jobs — not infra)
  • API Monitoring                   §10  (shallow, from access log)
  • Feature Flags                    §14
Trust
  • Security                         §12
  • Audit Logs                       §17
  • Integrations                     §16
Settings
  • Notifications & Alerts           §13
  • System Settings                  §18

Cross-cutting: Global Search (⌘K), Saved Views, Export (CSV/XLSX/PDF),
Impersonation, Light/Dark, Keyboard shortcuts, Real-time (SSE) for live KPIs.
```

### Data provenance (why this is mostly frontend + aggregation)

| Section | Primary existing source | Net-new needed |
|---|---|---|
| Executive | `usage_daily` (new rollup), `billing`, `org_usage`, `usage_event` | rollup job |
| Organizations | `organization`, `project`, `org_usage`, `provider_account` | health calc |
| Users | `user`, `auth` sessions, `org_usage` | LTV calc |
| Billing | `billing`, Stripe | Stripe sync read |
| Plans | `billing` plan config, `model_catalog` | plan editor |
| AI Providers | `provider_account`, `usage_event`, `model_catalog` | provider probe |
| Model Analytics | `usage_event`, `cost_rate`, `model_catalog` | per-model rollup |
| DataForSEO | `usage_event (kind=seo)`, `cost_rate` | — |
| Usage | `usage_event`, `usage_daily`, `org_usage` | dimensions |
| Queue | arq (Redis) + `jobs` router | worker heartbeat |
| API | access/audit log | request metrics source |
| Feature Flags | — | `feature_flag*` tables |
| Security | `auth` events, `api_key`, `audit` | blocked-IP store |
| Audit | `audit` router/model | `admin_audit_log` |
| Integrations | `connector`, `shopify`, `woocommerce`, `webhooks` | health probe |
| Notifications | `monitoring` (alerts groundwork) | `alert_rule*`, channels |
| System | `provider_account`, config, secrets | settings surface |

---

## 2. Navigation Hierarchy

Left rail, collapsible, grouped as in §1. Top bar: global search (⌘K), env
badge (prod/staging), impersonation banner when active, notifications bell,
theme toggle, admin avatar/role.

```
┌───────────────────────────────────────────────────────────────────────┐
│  Fennex Admin   [⌘K Search…]              prod   🔔   ☾   ⟳  (Owner ▾) │
├────────────┬──────────────────────────────────────────────────────────┤
│ Overview   │                                                           │
│  Executive │                     <page content>                        │
│ Customers  │                                                           │
│  Orgs      │                                                           │
│  Users     │                                                           │
│ Revenue    │                                                           │
│  Billing   │                                                           │
│  Plans     │                                                           │
│ AI & SEO   │                                                           │
│  Providers │                                                           │
│  Models    │                                                           │
│  DataForSEO│                                                           │
│  Usage     │                                                           │
│ Operations │                                                           │
│  Queue     │                                                           │
│  API       │                                                           │
│  Flags     │                                                           │
│ Trust      │                                                           │
│  Security  │                                                           │
│  Audit     │                                                           │
│  Integr.   │                                                           │
│ Settings   │                                                           │
│  Alerts    │                                                           │
│  System    │                                                           │
└────────────┴──────────────────────────────────────────────────────────┘
```

Keyboard: `⌘K` search, `g` then section key (e.g. `g o` Orgs, `g b` Billing),
`⌘\` toggle rail, `⌘.` theme, `[`/`]` prev/next row in tables, `e` export,
`?` shortcut cheatsheet.

---

## 3. Page-by-Page Specifications

Each page below lists **widgets/KPIs**, a **wireframe**, and **actions**.
"Shallow (P1)" marks the first-cut depth; "Deepen (P2/P3)" notes what's later.

### §1 Executive Dashboard

**KPIs (stat cards):** Total Orgs, Active Orgs, Total Users, Active Users Today,
New Signups (24h/7d), MRR, Monthly Cost (COGS), Gross Margin %, Profit,
AI Tokens (24h), DataForSEO credits (24h), API Requests (24h), Queue depth,
Error rate, Active jobs, Active AI providers, Active integrations.
(Storage/Avg response time show "n/a — deferred" until a source exists.)

**Charts (Tremor):** Revenue over time, Cost over time, Margin over time (dual
axis), Daily Active Users, Token consumption, API requests, Job throughput,
Error trend. Range selector (24h/7d/30d/90d/custom). All from `usage_daily`.

```
Executive ─ range: [30d ▾]                         export ▾  save view ▾
┌─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐
│ MRR     │ Cost    │ Margin% │ Profit  │ Active  │ Signups │
│ $12.4k  │ $2.1k   │ 83%     │ $10.3k  │ Orgs 142│ 7d: 23  │
│ ▲ 8%    │ ▲ 3%    │ ▲ 1pt   │ ▲ 9%    │         │         │
└─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘
┌───────────────────────────┐ ┌───────────────────────────┐
│ Revenue vs Cost (area)    │ │ Gross margin % (line)     │
│  ╱‾‾‾‾‾‾ revenue          │ │        ___________        │
│ ╱____ cost                │ │  _____/                   │
└───────────────────────────┘ └───────────────────────────┘
┌─────────────┬─────────────┬─────────────┬───────────────┐
│ DAU         │ Tokens/day  │ API req/day │ Error trend   │
└─────────────┴─────────────┴─────────────┴───────────────┘
```

Actions: export (CSV/XLSX/PDF), save custom view, drill any card → its section.

### §2 Organizations  *(prompt "Applications")*

**Table columns:** Name, Owner, Status (trial/active/past_due/suspended/disabled),
Plan, Primary AI provider, DataForSEO configured (byok?), Monthly cost, Monthly
revenue, Usage (tokens/serp sparkline), Quota %, Health (green/amber/red),
Created. Filters: status, plan, provider, byok_enabled, health, created range.

**Detail page tabs:** Overview (KPIs + usage charts), Projects, Usage, Billing,
Providers/keys (masked), Quotas, Activity, Audit. Health = f(quota%, error rate,
payment status, last activity).

```
Organizations                         filter ▾   [⌘K]        export ▾
┌───────────────┬────────┬───────┬──────────┬───────┬──────┬────────┐
│ Org           │ Owner  │ Status│ Plan     │ Cost  │ Rev  │ Health │
├───────────────┼────────┼───────┼──────────┼───────┼──────┼────────┤
│ Pure Saveur   │ marie  │ active│ Pro      │ $41   │ $99  │ ●      │
│ Acme SEO      │ john   │ trial │ —        │ $6    │ $0   │ ◐      │
│ Nomad Goods   │ dana   │ p.due │ Agency   │ $180  │ $299 │ ○      │
└───────────────┴────────┴───────┴──────────┴───────┴──────┴────────┘
bulk: [Suspend] [Reset quotas] [Export]        row → detail / Impersonate
```

Actions (RBAC-gated, audited): Suspend, Disable, Upgrade/Downgrade plan, Reset
quotas, View logs, **Impersonate owner** (time-boxed, banner, fully audited).

### §3 Users / Customers

**Table:** Name/email, Company (org), Role, Subscription, Payment status,
#Applications(orgs), Last login, LTV, Support tickets, API usage (30d).
**Detail:** profile, orgs & roles, activity timeline, sessions/devices, API keys,
LTV breakdown, tickets (shallow: count + link to helpdesk). Actions: reset
password (trigger email), revoke sessions, impersonate, deactivate.

### §4 Billing

**KPIs:** MRR, ARR, Churn %, ARPU, LTV, CAC (manual input P1), Revenue/customer,
Revenue/org, Refunds, Failed payments, Outstanding, Taxes collected.
**Widgets:** MRR movement (new/expansion/contraction/churn waterfall), revenue by
plan, invoices table, failed-payment queue, coupons, refunds. Source: `billing`
+ Stripe (read sync). Deepen (P2): cohort retention, churn prediction.

```
Billing                                                    export ▾
┌────────┬────────┬────────┬────────┬────────┬────────┐
│ MRR    │ ARR    │ Churn  │ ARPU   │ LTV    │ Failed │
│ $12.4k │ $149k  │ 2.1%   │ $87    │ $1.9k  │ 3      │
└────────┴────────┴────────┴────────┴────────┴────────┘
┌─────────────────────────────┐ ┌─────────────────────┐
│ MRR movement (waterfall)    │ │ Revenue by plan     │
└─────────────────────────────┘ └─────────────────────┘
Invoices  [status ▾] ────────────────────────────────────
# INV-1042  Pure Saveur  $99  paid   2026-07-01   [view]
```

Actions (Finance/Super Admin): issue refund, apply/create coupon, retry failed
payment, void invoice — all deep-link to Stripe for the actual charge action,
recorded in `admin_audit_log`.

### §15 Subscription Plans

Editor for plans and their limits/quotas. Fields: name, price (monthly/annual),
features (bool set), AI token quota, DataForSEO quota, storage, users, projects,
rate limits, overage pricing, trial length (7-day no-card per billing spec).
Table of plans + "customers on plan" count; guarded plan editor writes to
`billing` plan config with an audit entry and a "N orgs affected" confirm.

### §5 AI Providers

Per provider (OpenAI, Anthropic, Google Gemini, AWS Bedrock, Ollama, OpenRouter,
Azure OpenAI): Status (up/degraded/down via probe), API latency (p50/p95),
Requests (24h), Tokens, Cost, Errors/error-rate, Rate-limit headroom, Model
availability. Source: `provider_account` + `usage_event` + a lightweight health
probe. Card grid + per-provider drill (time series, recent errors).

```
AI Providers
┌────────────┬────────┬────────┬────────┬────────┬────────┐
│ Provider   │ Status │ p95 ms │ Req 24h│ Cost   │ Errors │
│ OpenAI     │ ● up   │ 820    │ 12,400 │ $38    │ 0.2%   │
│ Anthropic  │ ● up   │ 1,150  │ 3,100  │ $22    │ 0.1%   │
│ Gemini     │ ◐ deg  │ 2,400  │ 210    │ $1     │ 3.1%   │
│ Bedrock    │ ○ off  │ —      │ 0      │ $0     │ —      │
└────────────┴────────┴────────┴────────┴────────┴────────┘
```

### §6 Model Analytics

Per LLM (from `model_catalog` × `usage_event`): Requests, Input tokens, Output
tokens, Avg latency, Cost, Success %, Failure %, Avg response length. **Compare**
view (pick 2–4 models, side-by-side cost/latency/quality). **Cheaper-alternative
recommender** (P2): for each high-spend model, suggest a lower-band model with
projected monthly saving, using `cost_rate` bands (ties into Phase 1b cost-first
routing). Table + compare + recommendation cards.

### §7 DataForSEO Monitoring

Requests, Credits consumed, Cost, Failed requests, Avg latency, Endpoints used
(serp/keyword_ideas/…), Customer usage, Top consumers (leaderboard). Source:
`usage_event (kind=seo)` + `cost_rate`. Cost-control callouts (SERP depth,
keyword caps) surfaced from discovery settings.

### §8 Usage Analytics

Unified explorer. **Metrics:** AI tokens, SEO credits, API calls, Projects,
Users, Exports, Imports, Jobs, Storage (n/a until sourced), Bandwidth (n/a).
**Dimensions (group/filter by):** customer, organization, subscription/plan,
country, provider. Pivot-style table + stacked charts + top-N. Backbone:
`usage_daily`. This is the analyst's swiss-army page.

### §9 Queue Monitoring  *(app-level, not infra)*

Background jobs (arq): pending/active/completed/failed counts, per-queue depth,
retries, dead-letter jobs, avg processing time, success/failure rate, worker
health (last heartbeat). Source: arq (Redis) + existing `jobs` router. Actions:
retry job, purge dead job, drain queue (Operations/Super Admin, audited).

```
Queue                                            live ●  ⟳ 5s
depth: default 12  │ discovery 3 │ images 0     workers: 2/2 ●
┌──────────┬───────┬────────┬───────┬─────────┬──────────┐
│ Queue    │ Pend. │ Active │ Done  │ Failed  │ Avg ms   │
│ default  │ 12    │ 2      │ 8,431 │ 14      │ 340      │
│ discovery│ 3     │ 1      │ 512   │ 2       │ 9,200    │
└──────────┴───────┴────────┴───────┴─────────┴──────────┘
Dead letters (2)  [retry] [purge]
```

### §10 API Monitoring  *(shallow)*

Requests/sec, Avg latency, 4xx, 5xx, Auth failures, Rate-limited, Top endpoints,
Top customers, Slowest endpoints. **P1 depends on a request-metrics source** — if
no access-log/APM exists, ship a thin version from the audit/access log and mark
the rest "needs APM (Sentry/OTel) — deferred." Honest stub, not fake numbers.

### §14 Feature Flags

Manage flags: experimental features, % rollouts, beta cohorts (per-org/user
targeting), canary, A/B tests (ties to existing `ab_test`). New `feature_flag`
+ `feature_flag_assignment` tables. Toggle/rollout writes are audited. The
customer app reads flags via a cached `/flags` endpoint.

### §12 Security

Failed logins (rate + recent), Blocked IPs (list + manual block/unblock),
Suspicious activity feed, Audit-log link, Permission changes, API-key usage &
last-used, Secrets inventory (names + rotation age, never values), Token
expirations, MFA adoption %. Sources: `auth` events, `api_key`, `audit`; new
blocked-IP store. Deepen (P2): anomaly rules feeding §13 alerts.

### §17 Audit Logs

Every admin action: Who, When, IP, Action, Resource, Before, After (JSON diff),
Result. Powered by new `admin_audit_log` (customer-facing `audit` stays separate).
Filter by actor/action/resource/date; export; immutable (append-only, no edit/delete).

```
Audit Logs                      actor ▾  action ▾  date ▾   export ▾
2026-07-27 09:12  owner  10.0.0.4  org.suspend  Pure Saveur
  before {status:active}  after {status:suspended}          [diff]
2026-07-27 09:05  owner  10.0.0.4  plan.update  Pro
  before {price:9900}     after {price:11900}   (142 orgs)  [diff]
```

### §16 Integrations

Per integration type (WordPress, Shopify, WooCommerce, Google Search Console,
Google Analytics, Slack, Discord, Zapier, Webhooks, API Keys, OAuth): connected
count, health (last sync ok/fail), error rate, tokens expiring soon. Sources:
`connector`, `shopify`, `woocommerce`, `webhooks`, `api_key`. Drill → orgs using
it + recent failures. Actions: disable an integration globally, force re-auth
prompt (audited).

### §13 Notifications & Alerts

**Channels:** Email, Slack, Discord, Webhook, SMS (P3). **Alert rules engine:**
condition → threshold → channel(s) → severity. Prebuilt rules: High AI cost
(org or platform), High DataForSEO usage, Provider outage/degraded, Payment
failure, Quota exceeded, Error-rate spike. New `alert_rule`, `alert_event`,
`notification_channel` tables (builds on existing `monitoring` groundwork). Rule
builder UI + firing history + mute/snooze.

### §18 System Settings

AI providers & SEO providers (surface the existing `provider_account` admin CRUD),
Email, Storage, Authentication, OAuth apps, Payments (Stripe keys — masked),
Feature flags defaults, Branding, Environment variables (names + masked), Secrets
(rotation age, never values). Everything write here is Super Admin + audited.

---

## 4. Database Schema (new tables only)

Reused unchanged: `organization`, `user`, `project`, `billing`/`org_usage`,
`usage_event`, `cost_rate`, `provider_account`, `model_catalog`, `audit`,
`api_key`, `connector`, `ab_test`, `monitoring`, `shopify`, `woocommerce`,
`webhooks`.

```sql
-- Staff identity + RBAC (isolated from customer `user`)
admin_user(id pk, email unique, name, password_hash|null, sso_subject|null,
           is_active bool, mfa_enabled bool, last_login_at, created_at)
admin_role(id pk, key unique, name, description)          -- 7 seeded roles
admin_role_assignment(admin_user_id fk, role_id fk, granted_by fk, granted_at,
                      pk(admin_user_id, role_id))

-- Daily rollup backbone (nightly arq job; powers all trend charts/KPIs)
usage_daily(day date, org_id fk, provider text, model text default '',
            unit text, requests bigint, input_tokens bigint, output_tokens bigint,
            cache_read_tokens bigint, seo_count bigint,
            cost_micros bigint, revenue_micros bigint,
            pk(day, org_id, provider, model, unit),
            index(day), index(org_id, day))

-- Feature flags
feature_flag(id pk, key unique, name, description, enabled bool,
             rollout_pct int default 0, created_at, updated_at)
feature_flag_assignment(flag_id fk, org_id fk|null, user_id fk|null,
                        variant text default 'on', pk(flag_id, org_id, user_id))

-- Alerting + notifications
notification_channel(id pk, kind text, config_json jsonb, is_active bool, created_at)
alert_rule(id pk, key, name, metric text, comparator text, threshold numeric,
           window_seconds int, severity text, scope text,   -- platform|org
           channel_ids int[], is_active bool, created_at)
alert_event(id pk, rule_id fk, fired_at, resolved_at|null, org_id fk|null,
            value numeric, payload_json jsonb, status text)  -- firing|resolved|muted

-- Admin ergonomics + immutable audit
admin_saved_view(id pk, admin_user_id fk, section text, name, query_json jsonb, created_at)
admin_audit_log(id pk, actor_admin_id fk, action text, resource_type text,
                resource_id text, before_json jsonb, after_json jsonb,
                ip inet, result text, created_at, index(created_at),
                index(actor_admin_id), index(resource_type, resource_id))
-- append-only: no UPDATE/DELETE grants
```

Money stays integer **micro-dollars** (matches the reseller-billing spec). Rates
in `cost_rate.micro_dollars_per_unit` are FLOAT per token; `revenue_micros` on
`usage_daily` lets margin be computed per dimension.

---

## 5. API Endpoint Design

Prefix `/api/v1/admin`, every route behind `require_admin(min_role)` (server-side
RBAC). List endpoints share a convention: `?q=&status=&plan=&from=&to=&sort=&page=&
page_size=&export=csv|xlsx`. Mutations require the role AND write `admin_audit_log`.

```
Auth/session
  POST   /admin/auth/login                 (staff, separate from customer auth)
  POST   /admin/auth/logout
  GET    /admin/me                          role + permissions

Overview
  GET    /admin/overview/kpis?range=
  GET    /admin/overview/series?metric=&range=
  GET    /admin/search?q=                   global search (orgs/users/…)

Organizations
  GET    /admin/orgs                        list+filter+export
  GET    /admin/orgs/{id}                   detail
  GET    /admin/orgs/{id}/usage?range=
  POST   /admin/orgs/{id}/suspend|disable|enable
  POST   /admin/orgs/{id}/reset-quotas
  POST   /admin/orgs/{id}/plan              upgrade/downgrade
  POST   /admin/orgs/{id}/impersonate       → time-boxed token (audited)

Users
  GET    /admin/users                       list+filter+export
  GET    /admin/users/{id}
  POST   /admin/users/{id}/revoke-sessions|reset-password|deactivate

Billing / Plans
  GET    /admin/billing/kpis
  GET    /admin/billing/invoices
  GET    /admin/billing/failed-payments
  POST   /admin/billing/invoices/{id}/refund|retry|void
  GET/PUT/POST/DELETE /admin/plans[/{id}]

AI/SEO
  GET    /admin/providers                   status+metrics (probe cached)
  GET    /admin/providers/{key}
  GET    /admin/models                       per-model analytics + compare
  GET    /admin/models/recommendations       cheaper-alternative (P2)
  GET    /admin/dataforseo                    credits/cost/top-consumers
  GET    /admin/usage?metric=&group_by=&range=   analytics explorer

Operations
  GET    /admin/queue                        counts + workers
  GET    /admin/queue/live                   SSE (depth/active/errors)
  POST   /admin/queue/jobs/{id}/retry|purge
  GET    /admin/api-metrics                  shallow (or 'needs APM')
  GET/POST/PUT /admin/flags[/{id}]           feature flags

Trust
  GET    /admin/security/overview
  GET    /admin/security/blocked-ips ; POST .../block ; DELETE .../{ip}
  GET    /admin/audit                         admin_audit_log list+export
  GET    /admin/integrations                  health per type

Settings
  GET/POST/PUT/DELETE /admin/alerts/rules[/{id}]
  GET/POST/PUT/DELETE /admin/alerts/channels[/{id}]
  GET    /admin/alerts/events
  GET/PUT /admin/settings/*                   system settings (Super Admin)
  (provider CRUD reuses existing /admin/provider-accounts)

Live (SSE): /admin/queue/live, /admin/overview/live (error rate, active jobs)
```

---

## 6. Component Hierarchy (apps/admin)

```
apps/admin/
  app/
    (auth)/login/page.tsx
    (console)/layout.tsx            AdminShell (rail + topbar + CommandPalette)
      overview/page.tsx
      orgs/page.tsx  orgs/[id]/page.tsx
      users/page.tsx users/[id]/page.tsx
      billing/page.tsx  plans/page.tsx
      providers/page.tsx  models/page.tsx  dataforseo/page.tsx  usage/page.tsx
      queue/page.tsx  api/page.tsx  flags/page.tsx
      security/page.tsx  audit/page.tsx  integrations/page.tsx
      alerts/page.tsx  system/page.tsx
  components/
    shell/  AdminShell, NavRail, TopBar, CommandPalette(cmdk), ImpersonationBanner
    kpi/    StatCard, TrendStat, KpiGrid
    charts/ AreaTrend, LineTrend, BarTrend, Waterfall, Sparkline  (Tremor wrappers)
    table/  DataTable (filter/sort/paginate/bulk/export), FilterBar, ColumnMenu
    common/ StatusPill, HealthDot, MoneyCell, RoleGate, ExportButton, SavedViewMenu
    forms/  PlanEditor, AlertRuleBuilder, FlagEditor, ChannelForm
  lib/
    api.ts        admin apiClient (mirrors web lib/api.ts pattern)
    rbac.ts       role→permission map, <RoleGate>
    query.ts      TanStack Query client + keys
    format.ts     money(micros), pct, compactNumber
    sse.ts        useLiveMetric(endpoint)
  store.ts        Zustand: theme, rail, impersonation, savedViews
```

Reuses `packages/ui` primitives (Button, Dialog, Input, DropdownMenu, Tabs) and
`packages/types` (shared org/user/usage types). Styling matches the web app:
Tailwind + CSS variables, `.popover`, `animate-scale-in`/`animate-fade-in`.

---

## 7. Permissions (RBAC)

Seven seeded roles. Enforced **server-side** (`require_admin`) and mirrored in the
UI (`<RoleGate>` hides disallowed controls). Read is broad; mutations are narrow.

| Capability | Super Admin | Support | Finance | Marketing | Operations | Developer | Auditor |
|---|---|---|---|---|---|---|---|
| View all sections | ✓ | ✓ | ✓ (billing focus) | ✓ | ✓ | ✓ | ✓ (read-only) |
| Impersonate | ✓ | ✓ | — | — | — | — | — |
| Suspend/disable org | ✓ | ✓ | — | — | ✓ | — | — |
| Reset quotas | ✓ | ✓ | — | — | ✓ | — | — |
| Change plan/price | ✓ | — | ✓ | — | — | — | — |
| Refund/coupon/invoice | ✓ | — | ✓ | — | — | — | — |
| Queue actions | ✓ | — | — | — | ✓ | ✓ | — |
| Feature flags | ✓ | — | — | — | ✓ | ✓ | — |
| Alert rules/channels | ✓ | — | — | — | ✓ | ✓ | — |
| Providers/System settings | ✓ | — | — | — | — | ✓ | — |
| Any mutation | ✓ | scoped | scoped | — | scoped | scoped | **never** |

Impersonation issues a short-lived, clearly-scoped token; a persistent banner
shows the active session; entry and exit are both audited.

---

## 8. KPIs by Function

- **Business:** MRR, ARR, Gross margin %, Profit, Active orgs, Net revenue retention.
- **Finance:** Churn %, ARPU, LTV, CAC, Failed-payment $, Outstanding, Refund rate.
- **Engineering:** Error rate, p95 latency, Job failure %, Dead-letter count, Deploy health (P3).
- **Infrastructure (deferred):** CPU/mem/disk/DB/Redis — via Grafana later.
- **Customer Success:** Active users, Feature adoption, Support ticket volume, Time-to-first-value (onboarding→first content), At-risk orgs (health red).
- **Sales:** New signups, Trial→paid conversion %, Expansion revenue, Pipeline (manual P1).
- **AI Usage:** Tokens/day, Cost/day, Cost per org, Cost per 1k tokens by model, Cache-hit %, Margin by model.
- **SEO Usage:** DataForSEO credits/day, Cost/day, Top consumers, Cost per SERP.

---

## 9. Monitoring Strategy

Two planes, kept separate:
- **Business/product/cost telemetry (this console):** sourced from the app DB and
  `usage_daily` rollups; nightly rollup + near-real-time counters (`org_usage`,
  queue) via SSE. This is the console's job.
- **System/infra observability (deferred, buy-not-build):** Sentry (errors/traces),
  Grafana+Prometheus (host/DB/Redis), structured logs. The console **deep-links**
  to these rather than reimplementing them. Section 11 lands when this exists.

Rollup job: nightly arq task aggregates `usage_event` → `usage_daily`
(idempotent, re-runnable per day). Live counters read `org_usage` + arq/Redis.

---

## 10. Alerting Strategy

Rule model: `metric` + `comparator` + `threshold` + `window` + `scope`
(platform|org) + `severity` + `channels`. Evaluated by a periodic arq job against
rollups/live counters; firing writes `alert_event` and fans out to channels;
auto-resolves when the condition clears. Prebuilt rules seeded: high AI cost
(platform + per-org), high DataForSEO usage, provider outage/degraded, payment
failure, quota exceeded, error-rate spike. Dedup + snooze/mute to avoid noise.

---

## 11. Cost Monitoring Strategy (reseller margin)

Fennex resells AI+SEO, so margin visibility is the console's reason to exist.
- **Every unit is priced** at capture (`usage_event.cost_micros` via `cost_rate`)
  and rolled into `usage_daily.cost_micros`; `revenue_micros` is derived from plan
  price allocation, so **margin = revenue − cost** is computable per org, plan,
  provider, model, country, and day.
- **Guardrails:** the 400% min-margin target and cost-first routing (from the
  reseller-billing + Phase 1b specs) surface here as: margin-by-model table,
  cheaper-alternative recommendations, per-org cost anomaly alerts, and a
  "negative-margin orgs" watchlist on the Executive page.
- **Provider budget tracking:** `provider_account.monthly_budget_cents` vs
  month-to-date spend, with an alert as budgets approach.
- **Trial cost control:** 7-day no-card trials get a cost cap; the console shows
  trial COGS and flags trials exceeding cap (abuse signal).

---

## 12. Future Roadmap

- **P1 — Foundations + shallow breadth:** `apps/admin` shell, staff auth + RBAC,
  `usage_daily` rollup job, Executive dashboard, a real-but-shallow page per
  section, core guarded actions (suspend, reset quotas, impersonate, toggle flag),
  global search, CSV/XLSX export, light/dark, command palette.
- **P2 — Depth where money lives:** deepen Providers/Models/DataForSEO/Usage/
  Billing (drill-downs, cheaper-model recs, cohort/churn), live alert-rule engine,
  blocked-IP + security anomalies, PDF export.
- **P3 — Trust & scale:** saved custom dashboards, SMS/Discord channels, SSO for
  staff, deploy-health, Support-ticket integration, richer A/B analytics.
- **Deferred:** §11 Infrastructure (Grafana/Prometheus/Sentry embed), storage &
  bandwidth metrics (need a source), full APM for §10.

---

## 13. Best Practices (enterprise admin platform)

- **Least privilege by default:** deny-first RBAC, server-enforced; UI gating is
  cosmetic, never the control.
- **Everything mutating is audited:** append-only `admin_audit_log` with
  before/after; audit is immutable (no update/delete grants).
- **Impersonation is sacred:** time-boxed, banner-visible, double-audited, and
  never allowed for read-only/finance/marketing roles.
- **Secrets are never shown:** display names + rotation age only; values live in
  the vault; masked everywhere.
- **Reads scale via rollups, not live scans:** trend/KPI endpoints hit
  `usage_daily`; live endpoints are few and cheap.
- **Separation of planes:** business telemetry in-app; infra/errors in
  Sentry/Grafana (deep-linked) — don't rebuild observability.
- **Honest empty states:** where a data source doesn't exist yet (storage,
  bandwidth, APM), show "not yet instrumented — deferred," never fabricated numbers.
- **Blast-radius isolation:** staff identity (`admin_user`) is separate from
  customer `user`; the admin app is a separate deploy with its own auth.
- **Idempotent jobs:** rollup + alert-eval jobs are safely re-runnable.
- **Money is integer micro-dollars** end to end; format only at the edge.
- **Follow existing conventions:** `apiClient` pattern, i18n via `t()`, Tailwind
  CSS variables, `cn()`, TanStack Query + Zustand — the admin app should feel like
  a sibling of `apps/web`, not a foreign codebase.

---

## Open items to confirm at plan time

- Request-metrics source for §10 (audit/access log vs. deferring to APM).
- Whether `revenue_micros` allocation is per-usage or plan-flat proration for margin.
- Staff SSO vs. email/password for P1 (spec assumes email/password + optional MFA).
