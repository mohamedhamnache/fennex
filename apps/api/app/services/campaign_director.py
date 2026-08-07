"""Sirocco, the campaign director — designs a plan over the fixed action catalog."""
import json
import logging
import re

from app.agents.registry import agent_persona
from app.services.ai_analytics_service import project_profile
from app.services.campaign_catalog import ACTIONS
from app.services.llm_service import call_llm, get_org_llm_keys, project_locale

logger = logging.getLogger(__name__)

_PROVIDERS = [("anthropic", "claude-opus-4-8"), ("openai", "gpt-4o")]
_MAX_STEPS = 8

# A complete campaign researches, sets the angle, creates the core asset, adds a
# visual, and distributes across networks — using a variety of agents. These are
# the recommended shapes per persona; also used as the fallback if the LLM fails.
_PERSONA_FLOWS: dict[str, list[str]] = {
    "creator": [
        "zerda.pick_angle", "dune.write_article",
        "sirocco.generate_visual", "sirocco.multi_network_social",
    ],
    "ecommerce": [
        "souk.store_audit", "zerda.pick_angle", "dune.write_article",
        "sirocco.generate_visual", "sirocco.multi_network_social",
    ],
    "freelancer": [
        "oasis.define_icp", "zerda.pick_angle", "dune.write_article",
        "sirocco.multi_network_social",
    ],
    "company": [
        "oasis.market_report", "zerda.pick_angle", "dune.write_article",
        "sirocco.generate_visual", "sirocco.multi_network_social", "sable.competitor_scan",
    ],
}
_DEFAULT_FLOW = _PERSONA_FLOWS["creator"]


def _catalog_text() -> str:
    lines = []
    for a in ACTIONS.values():
        params = ", ".join(f"{k}: {v}" for k, v in a.params.items()) or "none"
        lines.append(f"- {a.key} ({a.agent} — {a.label}): {a.description} Params: {params}")
    return "\n".join(lines)


def _flow_for(persona: str) -> list[str]:
    return [k for k in _PERSONA_FLOWS.get(persona, _DEFAULT_FLOW) if k in ACTIONS]


def _plan_from_keys(keys: list[str], summary: str) -> dict:
    steps = [{"agent": ACTIONS[k].agent, "action": k, "brief": {}, "why": ACTIONS[k].label}
             for k in keys if k in ACTIONS]
    return {"summary": summary, "steps": steps[:_MAX_STEPS]}


def _fallback_plan(persona: str) -> dict:
    return _plan_from_keys(_flow_for(persona), "A complete campaign: research, angle, content, visual and distribution.")


async def draft_plan(project_id, org_id, goal: str, persona: str, db,
                     *, campaign=None) -> dict:
    """Design the agent playbook.

    `campaign` is optional and is what stops every plan looking the same. The
    persona flow alone produced an identical five steps for every ecommerce
    campaign, because persona is the one input that does not change between
    them. The campaign's objective, channels, offer and audience do -- so when
    they are available the planner is told about them and the plan follows the
    work rather than the category.
    """
    keys = await get_org_llm_keys(org_id, db)
    pm = next(((p, m) for p, m in _PROVIDERS if p in keys), None)
    if pm is None:
        raise ValueError("No AI key configured. Add an Anthropic or OpenAI key in Settings.")
    profile = await project_profile(project_id, db)

    recommended = " -> ".join(_flow_for(persona))
    system = agent_persona("sirocco") + (
        "You are the campaign director leading a full squad of specialist agents. Design a COMPLETE, "
        "multi-agent campaign for the GOAL — never a single deliverable. A strong campaign moves through "
        "four stages, each handled by the RIGHT agent:\n"
        "  1. RESEARCH/TARGETING — understand the market or ideal client (Oasis), and/or scan a competitor (Sable).\n"
        "  2. ANGLE — Zerda picks the focus topic + keyword from real demand (do this before any creation).\n"
        "  3. CREATE — Dune writes the core article; Sirocco generates a supporting visual.\n"
        "  4. DISTRIBUTE — Sirocco adapts it into native multi-network social posts (and/or Nomad outreach).\n"
        "Rules: use a VARIETY of agents across the stages — do NOT stop after one article. Always finish with "
        "at least one DISTRIBUTION step so the work reaches an audience. Pick and ORDER steps ONLY from the "
        "ACTION CATALOG (earlier outputs feed later steps). Aim for 5-7 steps. Respond with ONLY JSON: "
        '{"summary": str, "steps": [{"agent", "action", "brief", "why"}]}. Max 8 steps.\n\n'
        "Design the plan for THIS campaign. Two campaigns with different "
        "objectives, channels or offers should not produce the same steps -- if "
        "they do, you have described the category instead of the work. Let the "
        "campaign's own channels decide what has to be produced.\n"
        f"A generic {persona} flow, for reference only, NOT a template to copy: "
        f"{recommended}\n\n"
        "ACTION CATALOG:\n" + _catalog_text()
    )
    user = f"GOAL: {goal}\nPERSONA: {persona}" + (f"\nCLIENT PROFILE: {profile}" if profile else "")
    if campaign is not None:
        details = []
        if campaign.objective:
            details.append(f"OBJECTIVE: {campaign.objective}")
        if campaign.brief_summary:
            details.append(f"STRATEGY: {campaign.brief_summary}")
        offer = campaign.offer or {}
        if offer.get("type") and offer["type"] != "none":
            details.append(f"OFFER: {offer.get('value', '')} {offer.get('description', '')}".strip())
        audience = campaign.audience or {}
        if audience.get("label"):
            details.append(f"AUDIENCE: {audience['label']} — {audience.get('definition', '')}")
        if campaign.product_ids:
            details.append(f"PRODUCTS IN SCOPE: {len(campaign.product_ids)} selected")
        channels = getattr(campaign, "_channel_keys", None)
        if channels:
            details.append("CHANNELS THIS CAMPAIGN RUNS ON: " + ", ".join(channels)
                           + ". Build steps that FEED these channels -- a step whose "
                             "output no selected channel can use is wasted work.")
        if details:
            user += "\n\nTHIS SPECIFIC CAMPAIGN:\n" + "\n".join(details)
    raw = await call_llm(pm[0], pm[1], keys[pm[0]], system, user,
                         locale=await project_locale(project_id, db),
                         feature="campaign_plan",
                         meter={"db": db, "org_id": org_id, "project_id": project_id,
                                "feature": "campaign_plan"})
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    try:
        parsed = json.loads(cleaned)
        steps_in = parsed.get("steps", [])
    except Exception:
        logger.warning("campaign director returned unparseable JSON; using the %s "
                       "fallback flow. First 200 chars: %s", persona, cleaned[:200])
        return _fallback_plan(persona)

    steps = []
    seen = set()
    for s in steps_in:
        action = str(s.get("action", ""))
        if action not in ACTIONS:
            continue
        adef = ACTIONS[action]
        brief_in = s.get("brief") or {}
        brief = {k: brief_in[k] for k in adef.params if k in brief_in} if isinstance(brief_in, dict) else {}
        steps.append({"agent": adef.agent, "action": action, "brief": brief, "why": str(s.get("why", ""))[:300]})
        seen.add(action)
        if len(steps) >= _MAX_STEPS:
            break

    # Guard against a thin plan: ensure the campaign both creates and distributes.
    has_create = any(a in seen for a in ("dune.write_article", "sirocco.generate_visual"))
    has_distribute = any(a in seen for a in ("sirocco.multi_network_social", "nomad.social_posts"))
    if not steps or not has_create or not has_distribute:
        logger.warning("campaign director plan rejected (steps=%d create=%s distribute=%s); "
                       "using the %s fallback flow", len(steps), has_create, has_distribute,
                       persona)
        return _fallback_plan(persona)

    return {"summary": str(parsed.get("summary", ""))[:600], "steps": steps}
