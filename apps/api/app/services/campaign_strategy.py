"""The strategy engine: read the store first, then propose the campaign.

"Never generate a campaign blindly" is the requirement, and the only way to
honour it is to make blindness impossible rather than discouraged. So the model
is handed a context built by `store_agent_context`, which splits the store into
two parts:

    measured      figures derived from real orders. Fair game for reasoning.
    unavailable   named, with the connector that would supply them, NO value.

A model given `"roas": 0` will build a strategy around cutting ad spend. A model
given no roas key at all, plus the sentence "you cannot see ROAS; Meta Ads is
not connected", says so instead. That difference is the whole design.

The same rule governs the output. Budget, expected revenue and audience size are
ESTIMATES and are returned in an `assumptions` block that names what each one
rests on. A recommended budget presented as a finding is a number a merchant
will spend against.
"""
from __future__ import annotations

import json
import logging
import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign, CampaignLearning
from app.models.store_product import StoreProduct
from app.services import campaign_channels as ch
from app.services import campaign_personas, campaign_team, store_agent_context
from app.services.agents.cascade import call_with_cascade, validators
from app.services.llm_service import get_org_llm_keys, project_locale

logger = logging.getLogger(__name__)

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")

# Objective briefs live in campaign_personas, which also decides which are
# OFFERED for a given persona. Re-exported here so existing callers keep
# working and the two tables cannot drift apart.
OBJECTIVE_BRIEFS = campaign_personas.OBJECTIVE_BRIEFS


async def _products(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession,
                    limit: int = 40) -> list[dict]:
    rows = (await db.execute(select(StoreProduct).where(
        StoreProduct.project_id == project_id, StoreProduct.org_id == org_id
    ).limit(limit))).scalars().all()
    return [{"id": p.external_id, "title": p.title, "price": p.price,
             "handle": p.handle, "status": p.status} for p in rows]


async def _learnings(project_id: uuid.UUID, db: AsyncSession, limit: int = 12) -> list[str]:
    """What earlier campaigns established for this store.

    Only non-dismissed rows, most recent first. This is the cumulative-learning
    loop: a strategy that ignores what the last campaign proved is a strategy
    that will repeat its mistakes.
    """
    rows = (await db.execute(select(CampaignLearning).where(
        CampaignLearning.project_id == project_id,
        CampaignLearning.dismissed.is_(False),
    ).order_by(CampaignLearning.created_at.desc()).limit(limit))).scalars().all()
    return [f"[{r.confidence} confidence] {r.statement}" for r in rows]


async def _past_campaigns(project_id: uuid.UUID, org_id: uuid.UUID,
                          db: AsyncSession, limit: int = 6) -> list[dict]:
    """Previous campaigns and what they actually earned.

    Measured through the same UTM join as everything else -- so a campaign that
    was never tagged reports zero attributed revenue, and the model is told that
    explicitly rather than concluding the campaign failed.
    """
    from app.services import campaign_metrics

    rows = (await db.execute(select(Campaign).where(
        Campaign.project_id == project_id, Campaign.org_id == org_id,
        Campaign.status.in_(("running", "completed")),
    ).order_by(Campaign.created_at.desc()).limit(limit))).scalars().all()

    out = []
    for c in rows:
        orders = await campaign_metrics.attributed_orders(c, db)
        revenue = round(sum(float(o.total_price or 0) for o in orders), 2)
        out.append({
            "name": c.name or c.goal[:80],
            "objective": c.objective,
            "status": c.status,
            "attributed_revenue": revenue,
            "attributed_orders": len(orders),
            "note": ("no orders carried this campaign's tag -- it may not have been "
                     "tagged, which is not the same as having failed") if not orders else "",
        })
    return out


async def build_context(project_id: uuid.UUID, org_id: uuid.UUID,
                        db: AsyncSession, persona: str = "") -> dict:
    """Everything a strategy may rest on, with the blanks named as blanks."""
    try:
        store = await store_agent_context.build(project_id, org_id, db)
    except Exception:  # noqa: BLE001 - a store with no orders is normal
        logger.exception("store context failed for %s", project_id)
        store = {"measured": {}, "unavailable": []}

    available = await ch.connected_apps(project_id, org_id, db)
    # Channels this persona actually has. Offering a store channel to someone
    # with no store is a dead option that makes the whole list untrustworthy.
    profile = campaign_personas.profile(persona)
    catalogue = [c for c in ch.catalogue(available) if c["key"] in profile.channels]
    return {
        "persona": profile,
        "store": store,
        "products": await _products(project_id, org_id, db),
        "learnings": await _learnings(project_id, db),
        "past_campaigns": await _past_campaigns(project_id, org_id, db),
        "channels": catalogue,
        "connected_apps": sorted(a for a, ok in available.items() if ok),
        "roster": campaign_team.roster_prompt(),
    }


def _context_prompt(ctx: dict) -> str:
    store = ctx["store"]
    profile = ctx.get("persona")
    lines_head = []
    if profile is not None:
        lines_head.append(f"WHO THIS IS FOR: {profile.brief}")
        if profile.outcome != "revenue":
            lines_head.append(
                "This project is NOT judged on orders or attributed revenue. "
                f"Success here is measured by {campaign_personas.OUTCOME_MEASURED_BY[profile.outcome]}. "
                "Do not set a revenue target, do not promise a return on spend, "
                "and do not write a plan that only makes sense for a shop.")
        lines_head.append("")

    window = store.get("window") or {}
    lines = lines_head + [
        f"WHAT YOU CAN SEE (measured from real orders, last {window.get('days', 30)} days):"]
    measured = store.get("measured") or {}
    if measured:
        for k, v in measured.items():
            # `measured` values are {value, change_pct, previous}; change_pct is
            # None when the comparison would be noise, and that None must not be
            # rendered as a change of zero.
            change = v.get("change_pct") if isinstance(v, dict) else None
            value = v.get("value") if isinstance(v, dict) else v
            trend = f" ({change:+.1f}% vs previous period)" if isinstance(change, (int, float)) else ""
            lines.append(f"  {k}: {value}{trend}")
    else:
        lines.append("  Nothing. No orders have been synced for this store.")

    for name, rows in (store.get("revenue_by") or {}).items():
        lines.append(f"\nREVENUE BY {name.upper()}:")
        lines += [f"  {r['label']}: {r['revenue']} ({r['share_pct']}%, {r['orders']} orders)"
                  for r in rows]

    if store.get("observations"):
        lines.append("\nWHAT THE NUMBERS ALREADY SHOW:")
        lines += [f"  {o}" for o in store["observations"]]

    unavailable = store.get("unavailable") or []
    if unavailable:
        lines.append("\nWHAT YOU CANNOT SEE. Do not estimate these, do not "
                     "assume a value, and do not build a recommendation that "
                     "depends on one. Name the missing connector instead:")
        for u in unavailable:
            name = u.get("metric") if isinstance(u, dict) else str(u)
            needs = u.get("needs", "") if isinstance(u, dict) else ""
            lines.append(f"  {name} -- needs {needs}")

    if ctx["products"]:
        lines.append("\nPRODUCTS (use these exact titles; never invent one):")
        for p in ctx["products"][:25]:
            lines.append(f"  {p['title']} — {p.get('price') or 'no price'} [{p['id']}]")
    else:
        lines.append("\nPRODUCTS: none synced. Do not name any product. Refer to "
                     "'your product' and tell the merchant to connect the store.")

    if ctx["past_campaigns"]:
        lines.append("\nPREVIOUS CAMPAIGNS:")
        for c in ctx["past_campaigns"]:
            lines.append(f"  {c['name']} ({c['objective'] or 'no objective'}): "
                         f"{c['attributed_orders']} orders, {c['attributed_revenue']} attributed. "
                         f"{c['note']}")

    if ctx["learnings"]:
        lines.append("\nWHAT THIS STORE HAS ALREADY LEARNED (weigh these heavily):")
        lines += [f"  {line}" for line in ctx["learnings"]]

    lines.append("\nTHE TEAM you are assigning work to:")
    lines.append(ctx["roster"])

    executable = [c["key"] for c in ctx["channels"] if c["executable"]]
    planned_only = [c["key"] for c in ctx["channels"] if not c["executable"]]
    lines.append("\nCHANNELS Fennex can execute today: " + (", ".join(executable) or "none"))
    lines.append("CHANNELS that can be planned and written, but NOT published "
                 "(no connector): " + (", ".join(planned_only) or "none"))
    return "\n".join(lines)


_SYSTEM = """You are a senior ecommerce growth strategist working inside Fennex.

You design one campaign at a time, grounded in what this specific store's
numbers show. You are precise about the line between measurement and estimate.

HARD RULES:
1. Never state a figure you were not given. If you were told you cannot see
   ROAS, CAC, conversion rate or spend, you cannot -- say which connector is
   missing instead of guessing.
2. Never name a product that is not in the PRODUCTS list. An article title is
   not a product. If no products are listed, do not name one.
3. Budget, expected revenue and audience size are ESTIMATES. Every one you give
   goes in "assumptions" with the reasoning behind it. Never present an estimate
   as a measurement.
4. Only recommend channels from the two lists you are given. Prefer executable
   channels; if a plan-only channel is genuinely the right call, say plainly
   that it will be written but not published.
5. If the store has no synced orders, say the strategy is un-grounded and keep
   recommendations generic rather than inventing specifics.
6. This campaign is work done by a TEAM OF AGENTS. Assign every channel and
   every timeline step to one agent by its id, chosen from THE TEAM list for
   what that agent actually produces. Never invent an agent id.

Respond with ONLY a JSON object:
{
  "name": "short campaign name",
  "summary": "one or two sentences: what this campaign does and the constraint it respects",
  "audience": {"label": "...", "definition": "who they are, in plain words",
               "rule": "the filter that would build this list", "why": "..."},
  "offer": {"type": "discount|bundle|free_shipping|gift|none", "value": "...",
            "description": "...", "why": "..."},
  "channels": [{"channel": "<key from the lists>", "role": "prospecting|retargeting|announce|reminder",
                "owner": "<agent id from THE TEAM>", "budget_share": 0-100, "why": "..."}],
  "primary_kpi": "revenue|orders|aov|new_customers|reach",
  "secondary_kpis": ["..."],
  "targets": {"<only metrics this project is judged on>": number},
  "budget": {"amount": number, "currency": "EUR", "basis": "how you arrived at it"},
  "timeline": [{"day_offset": -7, "title": "...", "owner": "<agent id from THE TEAM>", "channel": "..."}],
  "content_plan": [{"channel": "...", "kinds": ["headline","primary_text"], "angle": "..."}],
  "assumptions": [{"claim": "...", "rests_on": "..."}],
  "cannot_see": ["metric names you were told you cannot see and that limited this plan"]
}"""


async def draft(project_id: uuid.UUID, org_id: uuid.UUID, goal: str,
                objective: str, db: AsyncSession, *, hint: dict | None = None,
                persona: str = "") -> dict:
    # `hint` carries constraints the merchant already set -- budget, dates,
    # products. A strategy that ignores them proposes a plan against a budget
    # the campaign does not have, and the assumptions block then explains a
    # figure that appears nowhere on screen.
    """Design a campaign from the store's own numbers.

    Raises ValueError when no AI key is configured -- the caller turns that into
    a 400 rather than a half-built campaign.
    """
    keys = await get_org_llm_keys(org_id, db)
    if not keys:
        raise ValueError("No AI key configured. Add an Anthropic or OpenAI key in Settings.")

    ctx = await build_context(project_id, org_id, db, persona)
    brief = OBJECTIVE_BRIEFS.get(objective, OBJECTIVE_BRIEFS["custom"])

    user = (f"OBJECTIVE: {objective} — {brief}\n"
            f"WHAT THE MERCHANT ASKED FOR: {goal}\n")
    if hint:
        extras = "\n".join(f"  {k}: {v}" for k, v in hint.items() if v)
        if extras:
            user += ("CONSTRAINTS THEY ALREADY SET. Plan within these -- do not "
                     f"propose a different budget or different dates:\n{extras}\n")
    user += "\n" + _context_prompt(ctx)

    raw = await call_with_cascade(
        keys=keys, feature="campaign_strategy", system_prompt=_SYSTEM, user_prompt=user,
        tier="balanced", weight="medium",
        locale=await project_locale(project_id, db),
        validate=validators.json_object(("name", "channels")),
        meter={"db": db, "org_id": org_id, "project_id": project_id,
               "feature": "campaign_strategy"},
    )
    try:
        plan = json.loads(_FENCE.sub("", raw or ""))
    except ValueError:
        logger.warning("campaign strategy returned unparseable JSON")
        raise ValueError("The strategy could not be generated. Try again.")

    return _sanitise(plan, ctx)


def _sanitise(plan: dict, ctx: dict) -> dict:
    """Drop anything the model invented that the store cannot back.

    The prompt forbids inventing channels and products. This enforces it, because
    a prompt is a request and a filter is a guarantee.
    """
    valid_channels = {c["key"] for c in ctx["channels"]}
    channels = []
    for c in plan.get("channels") or []:
        key = str(c.get("channel", ""))
        if key not in valid_channels:
            logger.info("strategy proposed unknown channel %r, dropped", key)
            continue
        try:
            share = float(c.get("budget_share") or 0)
        except (TypeError, ValueError):
            share = 0.0
        channels.append({"channel": key, "role": str(c.get("role") or "")[:30],
                         # Falls back to the channel's natural owner rather than
                         # leaving the work unassigned. An invented agent id is
                         # dropped by owner_for, never displayed.
                         "owner": campaign_team.owner_for(key, c.get("owner")),
                         "budget_share": max(0.0, min(100.0, share)),
                         "why": str(c.get("why") or "")[:400]})
    plan["channels"] = channels

    timeline = []
    for t in plan.get("timeline") or []:
        try:
            offset = int(t.get("day_offset", 0))
        except (TypeError, ValueError):
            continue
        title = str(t.get("title") or "").strip()
        if not title:
            continue
        timeline.append({"day_offset": max(-60, min(60, offset)), "title": title[:200],
                         "owner": campaign_team.valid_owner(str(t.get("owner") or "")) or "",
                         "channel": str(t.get("channel") or "")[:30],
                         "detail": str(t.get("detail") or "")[:600]})
    if len(timeline) < 3:
        from app.services.campaign_templates import _LAUNCH_TIMELINE
        have = {t["title"].lower() for t in timeline}
        for offset, title, owner in _LAUNCH_TIMELINE:
            if title.lower() not in have:
                timeline.append({"day_offset": offset, "title": title,
                                 "owner": owner, "channel": "", "detail": ""})
    plan["timeline"] = sorted(timeline, key=lambda x: x["day_offset"])

    # The blanks the model was told about, echoed back so the UI can show what
    # this strategy could not take into account.
    plan.setdefault("cannot_see", [])
    unavailable = {u.get("metric") for u in (ctx["store"].get("unavailable") or [])
                   if isinstance(u, dict)}
    plan["cannot_see"] = [m for m in plan["cannot_see"] if m in unavailable] or sorted(
        m for m in unavailable if m)
    plan["grounded"] = bool(ctx["store"].get("measured"))
    return plan
