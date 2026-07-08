"""Sirocco, the campaign director — designs a plan over the fixed action catalog."""
import json
import re

from app.agents.registry import agent_persona
from app.services.ai_analytics_service import project_profile
from app.services.campaign_catalog import ACTIONS
from app.services.llm_service import call_llm, get_org_llm_keys

_PROVIDERS = [("anthropic", "claude-opus-4-8"), ("openai", "gpt-4o")]
_MAX_STEPS = 8
_FALLBACK = ["zerda.pick_angle", "dune.write_article"]


def _catalog_text() -> str:
    lines = []
    for a in ACTIONS.values():
        params = ", ".join(f"{k}: {v}" for k, v in a.params.items()) or "none"
        lines.append(f"- {a.key} ({a.agent} — {a.label}): {a.description} Params: {params}")
    return "\n".join(lines)


def _fallback_plan() -> dict:
    return {"summary": "Default content campaign.",
            "steps": [{"agent": ACTIONS.get(k).agent if k in ACTIONS else k.split('.')[0],
                       "action": k, "brief": {}, "why": "core step"} for k in _FALLBACK]}


async def draft_plan(project_id, org_id, goal: str, persona: str, db) -> dict:
    keys = await get_org_llm_keys(org_id, db)
    pm = next(((p, m) for p, m in _PROVIDERS if p in keys), None)
    if pm is None:
        raise ValueError("No AI key configured. Add an Anthropic or OpenAI key in Settings.")
    profile = await project_profile(project_id, db)
    system = agent_persona("sirocco") + (
        "You are the campaign director. Design a coherent campaign for the GOAL by selecting and "
        "ordering steps ONLY from the ACTION CATALOG. Each step: {agent, action, brief, why}. Order "
        "matters — earlier outputs feed later steps (pick the angle before writing/creating). Respond "
        "with ONLY JSON: {\"summary\": str, \"steps\": [...]}. Max 8 steps.\n\nACTION CATALOG:\n" + _catalog_text()
    )
    user = f"GOAL: {goal}\nPERSONA: {persona}" + (f"\nCLIENT PROFILE: {profile}" if profile else "")
    raw = await call_llm(pm[0], pm[1], keys[pm[0]], system, user)
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    try:
        parsed = json.loads(cleaned)
        steps_in = parsed.get("steps", [])
    except Exception:
        return _fallback_plan()

    steps = []
    for s in steps_in:
        action = str(s.get("action", ""))
        if action not in ACTIONS:
            continue
        adef = ACTIONS[action]
        brief_in = s.get("brief") or {}
        brief = {k: brief_in[k] for k in adef.params if k in brief_in} if isinstance(brief_in, dict) else {}
        steps.append({"agent": adef.agent, "action": action, "brief": brief, "why": str(s.get("why", ""))[:300]})
        if len(steps) >= _MAX_STEPS:
            break
    if not steps:
        return _fallback_plan()
    return {"summary": str(parsed.get("summary", ""))[:600], "steps": steps}
