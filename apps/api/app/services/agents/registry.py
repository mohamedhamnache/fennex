from app.services.agents.skills import zerda, dune, sirocco, oasis, sable, mirage, nomad

# Skills the campaign director may choose from when planning a campaign.
_ALL = [
    zerda.PICK_ANGLE, zerda.KEYWORD_TARGETS,
    dune.WRITE_ARTICLE, dune.PRODUCT_COPY,
    sirocco.MULTI_NETWORK_SOCIAL, sirocco.GENERATE_VISUAL,
    oasis.MARKET_REPORT, oasis.DEFINE_ICP,
    sable.COMPETITOR_SCAN,
    mirage.PRODUCT_SHOT,
    nomad.OUTREACH_PLAN, nomad.TESTIMONIAL_CONTENT,
]

# Resolvable by key but never offered to the director: these need inputs a
# planner cannot invent (an article_id, for instance) and are invoked directly
# by the flow that already holds them.
_DIRECT = [dune.GENERATE_ARTICLE]

SKILLS = {s.key: s for s in _ALL + _DIRECT}


def get_skill(key: str):
    return SKILLS.get(key)


def catalog_text() -> str:
    return "\n".join(f"- {s.key} ({s.agent_id} — {s.label}): {s.description}" for s in _ALL)
