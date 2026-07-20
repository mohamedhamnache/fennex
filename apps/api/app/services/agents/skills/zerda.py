from app.agents.registry import agent_persona
from app.services.agents.spec import Skill
from app.services.agents.skills._common import brief_block, feedback_block, parse_json


def _pick_angle_prompt(brief, inputs, td):
    opp = (td.get("gsc_opportunities") or {}).get("data") or {}
    lines = [f'- "{q["query"]}" pos {q.get("position")}, +{q.get("potential")} potential'
             for q in opp.get("queries", [])]
    system = (
        agent_persona("zerda")
        + " Scope ONE content piece for THIS campaign.\n"
        "1. The GOAL defines the subject — derive a specific, opinionated ANGLE (a question, use-case, "
        "comparison or audience cut), not a restatement of the goal.\n"
        "2. Use OPPORTUNITY KEYWORDS only as supporting targets when one genuinely fits.\n"
        "3. Do NOT repeat or lightly reword any EXISTING CONTENT — pick a clearly different angle.\n"
        'Respond with ONLY JSON: {"topic": specific angle/title, "keyword": target keyword, '
        '"intent": informational|commercial|transactional|navigational, '
        '"rationale": one sentence on why it wins and how it differs}.'
    )
    user = (brief_block(brief) + "\n\nOPPORTUNITY KEYWORDS:\n" + ("\n".join(lines) or "- (none yet)")
            + feedback_block(inputs))
    return system, user


PICK_ANGLE = Skill(
    key="zerda.pick_angle", agent_id="zerda", weight="light",
    tools=["gsc_opportunities", "market_insights"], build_prompt=_pick_angle_prompt,
    output="json", parse=parse_json, label="Pick the angle",
    description="Choose one specific, fresh content angle from the goal + real demand.",
)


def _keyword_targets_prompt(brief, inputs, td):
    tracked = (td.get("tracked_keywords") or {}).get("data", {}).get("keywords", [])
    opp = (td.get("gsc_opportunities") or {}).get("data", {}).get("queries", [])
    angle = (inputs or {}).get("angle") or brief.goal
    system = (
        agent_persona("zerda")
        + ' For the ANGLE, choose one primary keyword and 3-6 supporting keywords from real demand. '
        'Respond with ONLY JSON: {"primary": str, "secondary": [str, ...]}.'
    )
    user = (f"ANGLE: {angle}\n" + brief_block(brief)
            + f"\nTRACKED KEYWORDS: {', '.join(tracked) or 'none'}\n"
            + "OPPORTUNITIES: " + ", ".join(q["query"] for q in opp) + feedback_block(inputs))
    return system, user


KEYWORD_TARGETS = Skill(
    key="zerda.keyword_targets", agent_id="zerda", weight="light",
    tools=["tracked_keywords", "gsc_opportunities"], build_prompt=_keyword_targets_prompt,
    output="json", parse=parse_json, label="Keyword targets",
    description="Primary + supporting keywords for the chosen angle.",
)
