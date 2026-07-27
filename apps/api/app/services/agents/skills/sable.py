from app.agents.registry import agent_persona
from app.services.agents.spec import Skill
from app.services.agents.skills._common import brief_block, feedback_block, parse_json


def _scan_prompt(brief, inputs, td):
    analysis = (td.get("crawl_competitor") or {}).get("data", {}).get("analysis", {})
    url = str((inputs or {}).get("competitor_url") or analysis.get("url") or "")
    system = (
        agent_persona("sable")
        + " Compare competitors to our demand and name the gaps worth striking first.\n\n"
        "FIND THE RIGHT ONES. A competitor is a site competing with THIS project on "
        "ITS topics -- not whoever happens to rank for a term you thought of. If no "
        "competitor URL is given:\n"
        "1. list the competitors already tracked for this project;\n"
        "2. if none are tracked, use the discovery tool, which derives them from the "
        "topics this project actually ranks for and excludes our own site. Prefer "
        "domains competing on more than one of our topics;\n"
        "3. only search manually if discovery returns nothing, and then search a topic "
        "this project genuinely targets;\n"
        "4. crawl the top one or two before judging them.\n"
        "JUDGE THEM AGAINST WHAT THIS PROJECT IS. The brief says what kind of site "
        "this is; a candidate of a different kind is not a competitor even when it "
        "ranks for the same terms. A recipe blog competes with other recipe blogs, "
        "not with a supermarket, a marketplace, an encyclopaedia or a video platform "
        "that happens to appear for an ingredient. Name what you rejected and why, "
        "briefly, so the user can see you looked. Never report finding nothing "
        "without having looked.\n\n"
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
    # This IS a competitor gap analysis -- the policy key names exactly what
    # the skill does, down to the "gaps" field in its own JSON schema. No
    # max_tokens override existed (default 4096); competitor_gap's ceiling is
    # also 4096, so this is unchanged, not a raise.
    feature="competitor_gap",
)
