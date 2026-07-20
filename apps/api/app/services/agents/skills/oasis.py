from app.agents.registry import agent_persona
from app.services.agents.spec import Skill, AgentResult
from app.services.agents.skills._common import brief_block, feedback_block, parse_json


def _report_prompt(brief, inputs, td):
    data = (td.get("market_data") or {}).get("data") or {}
    system = (
        agent_persona("oasis")
        + " Produce a client-ready MARKET REPORT in Markdown with sections: Executive summary, Market demand, "
        "Topic landscape, Opportunity analysis, Risks & gaps, Recommendations. Cite ONLY numbers in DATA — "
        "never invent figures. No emoji. ~500-700 words."
    )
    user = brief_block(brief) + f"\n\nDATA:\n{data}" + feedback_block(inputs)
    return system, user


MARKET_REPORT = Skill(
    key="oasis.market_report", agent_id="oasis", weight="heavy", tools=["market_data"],
    build_prompt=_report_prompt, output="markdown", parse=lambda raw: raw,
    label="Market report", description="Client-ready market report from real GSC data.",
)


def _icp_prompt(brief, inputs, td):
    system = (
        agent_persona("oasis")
        + ' Define 3 ideal client segments. Return ONLY JSON: {"segments": [{"name", "description", '
        '"pains": [..], "channels": [..], "angle"}]}. Be specific to the niche; no emoji.'
    )
    user = brief_block(brief) + feedback_block(inputs)
    return system, user


DEFINE_ICP = Skill(
    key="oasis.define_icp", agent_id="oasis", weight="light", tools=["market_insights"],
    build_prompt=_icp_prompt, output="json", parse=parse_json,
    label="Define ideal client", description="Ideal client segments to target.",
)
