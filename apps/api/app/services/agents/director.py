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


from datetime import datetime, timezone
from sqlalchemy import select, delete
from app.models.campaign import Campaign, CampaignStep
from app.services.agents.brief import build_brief
from app.services.agents.runner import AgentRunner
from app.services.agents.reviewer import review
from app.services.llm_service import get_org_llm_keys

_MAX_RETRIES = 2


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _prior_angle(brief) -> dict:
    for a in reversed(brief.artifacts):
        st = a.get("structured") or {}
        if st.get("topic") or st.get("keyword"):
            return {"angle": st.get("topic"), "keyword": st.get("keyword"), "rationale": st.get("rationale")}
    return {}


async def run_campaign(campaign, db, tier: str | None = None) -> None:
    resolved_tier = tier or "balanced"   # Task 13 upgrades this to read org.agent_tier
    keys = await get_org_llm_keys(campaign.org_id, db)
    brief = await build_brief(campaign.project_id, campaign.org_id, campaign.goal, campaign.persona, db)

    campaign.status = "running"
    await db.commit()
    steps_plan = await plan(brief, resolved_tier, keys, db)

    # Reset steps to the fresh plan.
    await db.execute(delete(CampaignStep).where(CampaignStep.campaign_id == campaign.id))
    order = 0
    for p in steps_plan:
        db.add(CampaignStep(campaign_id=campaign.id, order=order, agent=SKILLS[p["skill"]].agent_id,
                            action=p["skill"], why=p.get("why", ""), status="pending"))
        order += 1
    await db.commit()

    rows = (await db.execute(select(CampaignStep).where(CampaignStep.campaign_id == campaign.id)
            .order_by(CampaignStep.order))).scalars().all()

    for step in rows:
        await db.refresh(campaign)
        if campaign.cancel_requested:
            break
        skill = SKILLS.get(step.action)
        if skill is None:
            step.status = "skipped"; step.error = "Unknown skill."; await db.commit(); continue
        step.status = "running"; step.started_at = _now(); await db.commit()

        inputs = dict(_prior_angle(brief))
        result = None; rev = {"passed": True, "score": 75, "feedback": ""}
        for attempt in range(_MAX_RETRIES + 1):
            result = await AgentRunner.run(skill, brief, inputs, resolved_tier, db,
                                           keys=keys, campaign=campaign)
            rev = await review(brief, skill, result, resolved_tier, keys, db)
            if rev["passed"] or not result.ok:
                break
            inputs = {**inputs, "feedback": rev["feedback"]}   # retry with feedback

        step.finished_at = _now()
        if result and result.ok:
            step.status = "completed"
            step.summary = result.summary
            step.artifact_type = result.artifact_type
            step.artifact_ids = result.artifact_ids or None
            step.structured = {**(result.structured or {}), "review": rev}
            brief.add_artifact(result, skill.agent_id, skill.key)
        else:
            step.status = "failed"
            step.error = (result.error if result else "no result")
        await db.commit()

    await db.refresh(campaign)
    if not campaign.cancel_requested:
        campaign.status = "completed"
    else:
        campaign.status = "cancelled"
    await db.commit()
