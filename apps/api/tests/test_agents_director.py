import uuid, json, pytest
from unittest.mock import AsyncMock, patch
from sqlalchemy import select
from app.services.agents.brief import Brief
from app.services.agents import director


def _brief(persona="creator"):
    return Brief(goal="g", persona=persona, project_id=uuid.uuid4(), org_id=uuid.uuid4(),
                 locale="en", project_profile="", brand={}, existing_content=[], artifacts=[])


def test_persona_flow_has_create_and_distribute():
    for persona in ["creator", "ecommerce", "freelancer", "company"]:
        steps = [{"skill": k} for k in director._persona_flow(persona)]
        assert director._has_create_and_distribute(steps)


async def test_plan_falls_back_when_llm_plan_is_thin():
    with patch("app.services.agents.director.call_llm", new=AsyncMock(return_value='{"steps":[{"skill":"zerda.pick_angle"}]}')):
        steps = await director.plan(_brief("creator"), tier="balanced", keys={"anthropic": "x"}, db=None)
    # thin plan (no create+distribute) -> persona fallback
    assert any(s["skill"] == "dune.write_article" for s in steps)
    assert director._has_create_and_distribute(steps)


async def test_plan_keeps_valid_llm_plan():
    good = {"steps": [{"skill": "zerda.pick_angle", "why": "a"}, {"skill": "dune.write_article", "why": "b"},
                      {"skill": "sirocco.multi_network_social", "why": "c"}]}
    with patch("app.services.agents.director.call_llm", new=AsyncMock(return_value=json.dumps(good))):
        steps = await director.plan(_brief("creator"), tier="balanced", keys={"anthropic": "x"}, db=None)
    assert [s["skill"] for s in steps] == ["zerda.pick_angle", "dune.write_article", "sirocco.multi_network_social"]
