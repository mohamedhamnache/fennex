"""Run a single Skill outside a campaign — the standalone-endpoint seam.

Same path as the director (resolve tier -> build brief -> AgentRunner.run), minus
the plan/review loop. Endpoints stay thin: call run_standalone, map the AgentResult."""
from app.models.organization import Organization
from app.models.project import Project
from app.services.agents.brief import build_brief
from app.services.agents.runner import AgentRunner


async def org_tier(org_id, db) -> str:
    org = await db.get(Organization, org_id)
    return org.agent_tier if org and org.agent_tier else "balanced"


async def run_standalone(skill, project_id, org_id, goal: str, db, inputs=None, persona=None,
                         provider_override=None, model_override=None):
    if persona is None:
        proj = await db.get(Project, project_id)
        persona = getattr(proj, "persona", None) or "creator"
    tier = await org_tier(org_id, db)
    brief = await build_brief(project_id, org_id, goal, persona, db)
    return await AgentRunner.run(skill, brief, inputs or {}, tier, db,
                                 provider_override=provider_override, model_override=model_override)
