from app.agents.registry import agent_persona
from app.services.agents.spec import Skill
from app.services.agents.skills._common import brief_block, feedback_block, parse_json


def _scan_prompt(brief, inputs, td):
    analysis = (td.get("crawl_competitor") or {}).get("data", {}).get("analysis", {})
    url = str((inputs or {}).get("competitor_url") or analysis.get("url") or "")
    system = (
        agent_persona("sable")
        + " Compare competitors to our demand and name the gaps worth striking first.\n\n"
        "FIND THEM FIRST. If no competitor URL is given:\n"
        "1. list the competitors already tracked for this project;\n"
        "2. if none are tracked, search a topic this project targets and treat the "
        "domains that rank as the competitors;\n"
        "3. crawl the most relevant one or two before judging them.\n"
        "Never report that you found nothing without having searched. If a crawl "
        "fails, say which domain failed and work from the search results instead.\n\n"
        'Return ONLY JSON: {"competitors": [str], "scorecard": {...}, '
        '"gaps": [str], "insights": str}. Write every human-readable value in the '
        "project's language; keep the field names exactly as given."
    )
    user = f"COMPETITOR URL: {url}\nCOMPETITOR ANALYSIS: {analysis}\n" + brief_block(brief) + feedback_block(inputs)
    return system, user


COMPETITOR_SCAN = Skill(
    key="sable.competitor_scan", agent_id="sable", weight="heavy",
    tools=["crawl_competitor", "our_demand"], build_prompt=_scan_prompt, output="json", parse=parse_json,
    label="Scan a competitor", description="Score a competitor and find the gap to strike.",
)
