from app.agents.registry import agent_persona
from app.services.agents.spec import Skill, AgentResult
from app.services.llm_service import ARTICLE_MAX_TOKENS
from app.services.agents.skills._common import brief_block, feedback_block, parse_json


def _report_prompt(brief, inputs, td):
    data = (td.get("market_data") or {}).get("data") or {}
    system = (
        agent_persona("oasis")
        + " Produce a client-ready MARKET REPORT in Markdown.\n\n"
        "EVIDENCE RULES — these decide whether the report is worth anything:\n"
        "- Every claim carries a number. 'Demand is growing' is worthless; "
        "'impressions rose from 1,240 to 3,510 across 28 days (+183%)' is a finding.\n"
        "- Use ONLY figures present in DATA or returned by a tool. Never estimate, "
        "round up, or infer a number that was not measured.\n"
        "- Where a number is missing, say so explicitly: 'no conversion data is "
        "connected, so revenue impact cannot be sized'. A stated gap is a finding; "
        "a guess is a liability.\n"
        "- Quantify every opportunity: current position, search volume or impressions, "
        "and the realistic gain if it moved. Rank them by that gain.\n"
        "- Attach a confidence to each recommendation (high/medium/low) and say what "
        "drives it — sample size, recency, or how competitive the SERP is.\n\n"
        "STRUCTURE:\n"
        "1. Executive summary — five bullets, each containing a number.\n"
        "2. Demand — a markdown table: topic/query, impressions, clicks, CTR, average "
        "position. Sorted by opportunity, not alphabetically.\n"
        "3. Topic landscape — which clusters carry the demand and how concentrated it "
        "is. Name the share the top cluster holds.\n"
        "4. Opportunity analysis — a table: opportunity, current position, potential "
        "gain, effort, confidence. Ranked.\n"
        "5. Competitive picture — only if a tool returned real results; otherwise state "
        "that it was not checked.\n"
        "6. Risks and unknowns — what the data cannot tell us, and what to connect to "
        "close each gap.\n"
        "7. Recommendations — numbered, each naming the expected numeric outcome.\n\n"
        "Use the tools before writing: pull the market data, and where a competitive "
        "claim matters, search for it rather than asserting it. No emoji. 900-1400 words."
    )
    user = brief_block(brief) + f"\n\nDATA:\n{data}" + feedback_block(inputs)
    return system, user


MARKET_REPORT = Skill(
    key="oasis.market_report", agent_id="oasis", weight="heavy", tools=["market_data"],
    build_prompt=_report_prompt, output="markdown", parse=lambda raw: raw,
    label="Market report", description="Client-ready market report from real GSC data.",
    # A report with tables and quantified opportunities does not fit the default
    # budget; without this it is truncated mid-table.
    max_tokens=ARTICLE_MAX_TOKENS,
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
