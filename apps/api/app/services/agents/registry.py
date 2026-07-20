from app.services.agents.skills import zerda, dune, sirocco, oasis, sable, mirage, nomad

_ALL = [
    zerda.PICK_ANGLE, zerda.KEYWORD_TARGETS,
    dune.WRITE_ARTICLE, dune.PRODUCT_COPY,
    sirocco.MULTI_NETWORK_SOCIAL, sirocco.GENERATE_VISUAL,
    oasis.MARKET_REPORT, oasis.DEFINE_ICP,
    sable.COMPETITOR_SCAN,
    mirage.PRODUCT_SHOT,
    nomad.OUTREACH_PLAN, nomad.TESTIMONIAL_CONTENT,
]

SKILLS = {s.key: s for s in _ALL}


def get_skill(key: str):
    return SKILLS.get(key)


def catalog_text() -> str:
    return "\n".join(f"- {s.key} ({s.agent_id} — {s.label}): {s.description}" for s in _ALL)
