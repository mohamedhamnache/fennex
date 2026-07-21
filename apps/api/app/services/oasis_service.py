"""Oasis — Market Researcher. Standalone endpoints now run on the agent core:
the market report and ICP skills carry the specialized prompts + grounding, and
these functions stay thin wrappers that keep their existing return shapes."""
from datetime import date

from app.models.project import Project
from app.services.agents.skills import oasis as oasis_skills
from app.services.agents.standalone import run_standalone


async def generate_market_report(project_id, org_id, db) -> dict:
    project = await db.get(Project, project_id)
    name = project.name if project else "Project"
    goal = f"Produce a client-ready market report for {name}."
    result = await run_standalone(oasis_skills.MARKET_REPORT, project_id, org_id, goal, db)
    if not result.ok:
        return {"ok": False, "error": result.error or "Could not generate the market report."}
    return {"ok": True, "title": f"{name} — Market Report",
            "markdown": str(result.content or "").strip(), "generated_at": date.today().isoformat()}


async def generate_icp(project_id, org_id, db) -> dict:
    """Oasis defines the ideal customer profile segments for outreach targeting."""
    result = await run_standalone(oasis_skills.DEFINE_ICP, project_id, org_id,
                                  "Define the ideal client segments to target.", db)
    if not result.ok:
        return {"ok": False, "error": result.error or "provider_unreachable"}
    segments = []
    for s in (result.content or {}).get("segments", [])[:4]:
        if not isinstance(s, dict):
            continue
        nm = str(s.get("name", "")).strip()
        desc = str(s.get("description", "")).strip()
        if not nm or not desc:
            continue
        segments.append({
            "name": nm[:80], "description": desc[:400],
            "pains": [str(p).strip() for p in (s.get("pains") or []) if str(p).strip()][:4],
            "channels": [str(c).strip() for c in (s.get("channels") or []) if str(c).strip()][:3],
            "angle": str(s.get("angle", "")).strip()[:300],
        })
    if not segments:
        return {"ok": False, "error": "bad_format"}
    return {"ok": True, "segments": segments}
