from app.agents.registry import agent_persona
from app.services.agents.spec import Skill
from app.services.agents.skills._common import brief_block, feedback_block, parse_json


def _outreach_prompt(brief, inputs, td):
    audience = (inputs or {}).get("audience", "")
    system = (
        agent_persona("nomad")
        + ' Build a one-week LinkedIn outreach plan. Return ONLY JSON: {"posts": [5 items {day,type,content,'
        'hashtags}], "messages": [3 items {scenario,content}], "tips": [3-5 str]}. No emoji.'
    )
    user = (f"TARGET AUDIENCE: {audience}\n" if audience else "") + brief_block(brief) + feedback_block(inputs)
    return system, user


OUTREACH_PLAN = Skill(
    key="nomad.outreach_plan", agent_id="nomad", weight="heavy", tools=[],
    build_prompt=_outreach_prompt, output="json", parse=parse_json,
    label="Outreach plan", description="A week of LinkedIn posts + DM templates.",
)


def _testimonial_prompt(brief, inputs, td):
    t = (inputs or {}).get("testimonial", "")
    system = (
        agent_persona("nomad")
        + ' Turn the TESTIMONIAL into social proof. Return ONLY JSON: {"pieces": [{"format": '
        'linkedin_post|case_study|quote_card|website_blurb, "content"}]}. Never invent facts. No emoji.'
    )
    user = f"TESTIMONIAL: {t}\n" + brief_block(brief) + feedback_block(inputs)
    return system, user


TESTIMONIAL_CONTENT = Skill(
    key="nomad.testimonial_content", agent_id="nomad", weight="light", tools=[],
    build_prompt=_testimonial_prompt, output="json", parse=parse_json,
    label="Testimonial to content", description="Client testimonial -> social proof pieces.",
)
