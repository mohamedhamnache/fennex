from app.agents.registry import agent_persona
from app.services.agents.spec import Skill
from app.services.agents.skills._common import brief_block, feedback_block, parse_json


def _scan_prompt(brief, inputs, td):
    analysis = (td.get("crawl_competitor") or {}).get("data", {}).get("analysis", {})
    url = str((inputs or {}).get("competitor_url") or analysis.get("url") or "")
    system = (
        agent_persona("sable")
        + ' Compare the competitor to our demand and name the gaps worth striking first. '
        'Return ONLY JSON: {"scorecard": {...}, "gaps": [str], "insights": str}.'
    )
    user = f"COMPETITOR URL: {url}\nCOMPETITOR ANALYSIS: {analysis}\n" + brief_block(brief) + feedback_block(inputs)
    return system, user


COMPETITOR_SCAN = Skill(
    key="sable.competitor_scan", agent_id="sable", weight="heavy",
    tools=["crawl_competitor", "our_demand"], build_prompt=_scan_prompt, output="json", parse=parse_json,
    label="Scan a competitor", description="Score a competitor and find the gap to strike.",
)
