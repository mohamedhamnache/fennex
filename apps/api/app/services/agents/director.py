import re, json, logging
from app.services.agents.registry import SKILLS, catalog_text
from app.services.agents.tiers import resolve_model
from app.services.llm_service import call_llm

logger = logging.getLogger(__name__)

_FLOWS = {
    "creator":   ["zerda.pick_angle", "dune.write_article", "sirocco.generate_visual", "sirocco.multi_network_social"],
    "ecommerce": ["oasis.market_report", "zerda.pick_angle", "dune.write_article", "sirocco.generate_visual", "sirocco.multi_network_social"],
    "freelancer":["oasis.define_icp", "zerda.pick_angle", "dune.write_article", "sirocco.multi_network_social"],
    "company":   ["oasis.market_report", "zerda.pick_angle", "dune.write_article", "sirocco.generate_visual", "sirocco.multi_network_social", "sable.competitor_scan"],
}
_CREATE = {"dune.write_article", "sirocco.generate_visual", "mirage.product_shot"}
_DISTRIBUTE = {"sirocco.multi_network_social", "nomad.outreach_plan"}


def _persona_flow(persona: str) -> list[str]:
    return [k for k in _FLOWS.get(persona, _FLOWS["creator"]) if k in SKILLS]


def _has_create_and_distribute(steps) -> bool:
    keys = {s["skill"] for s in steps}
    return bool(keys & _CREATE) and bool(keys & _DISTRIBUTE)


def _fallback(persona: str) -> list[dict]:
    return [{"skill": k, "why": SKILLS[k].label, "inputs": {}} for k in _persona_flow(persona)]


async def plan(brief, tier, keys, db) -> list[dict]:
    available = list((keys or {}).keys())
    if not available:
        return _fallback(brief.persona)
    provider, model = resolve_model(tier, "light", available)
    recommended = " -> ".join(_persona_flow(brief.persona))
    system = (
        "You are the campaign director leading a squad. Design a COMPLETE campaign for the GOAL: research/target "
        "-> angle -> create -> distribute, using a VARIETY of agents and ending with a distribution step. "
        "Order matters (earlier outputs feed later steps). Pick ONLY skill keys from the CATALOG. Aim for 5-7 "
        'steps. Respond with ONLY JSON: {"steps": [{"skill": key, "why": str}]}.\n\n'
        f"RECOMMENDED SHAPE for {brief.persona}: {recommended}\n\nCATALOG:\n{catalog_text()}"
    )
    user = f"GOAL: {brief.goal}\nPERSONA: {brief.persona}" + (f"\nPROFILE: {brief.project_profile}" if brief.project_profile else "")
    try:
        raw = await call_llm(provider, model, keys[provider], system, user, locale=brief.locale)
        parsed = json.loads(re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip()))
        steps = [{"skill": s["skill"], "why": str(s.get("why", ""))[:300], "inputs": {}}
                 for s in parsed.get("steps", []) if s.get("skill") in SKILLS][:8]
    except Exception:
        return _fallback(brief.persona)
    if not steps or not _has_create_and_distribute(steps):
        return _fallback(brief.persona)
    return steps
