import uuid, json, pytest
from unittest.mock import AsyncMock, patch
from app.services.agents.brief import Brief
from app.services.agents.spec import Skill, AgentResult
from app.services.agents.reviewer import review


def _brief():
    return Brief(goal="g", persona="creator", project_id=uuid.uuid4(), org_id=uuid.uuid4(),
                 locale="en", project_profile="", brand={}, existing_content=[], artifacts=[])


def _skill():
    return Skill(key="dune.write_article", agent_id="dune", weight="heavy", tools=[],
                 build_prompt=lambda b, i, t: ("s", "u"), output="markdown")


async def test_failed_result_fails_review_without_llm():
    r = AgentResult(ok=False, error="boom")
    out = await review(_brief(), _skill(), r, tier="balanced", keys={"anthropic": "x"}, db=None)
    assert out["passed"] is False and "boom" in out["feedback"]


async def test_low_seo_score_fails_deterministically():
    r = AgentResult(ok=True, artifact_type="article", structured={"seo_score": 55}, summary="Article: X")
    out = await review(_brief(), _skill(), r, tier="balanced", keys={"anthropic": "x"}, db=None)
    assert out["passed"] is False and "SEO" in out["feedback"]


async def test_good_artifact_uses_llm_judgment():
    r = AgentResult(ok=True, artifact_type="article", structured={"seo_score": 92}, summary="Article: X")
    with patch("app.services.agents.reviewer.call_llm", new=AsyncMock(return_value='{"score": 88, "feedback": "solid"}')):
        out = await review(_brief(), _skill(), r, tier="balanced", keys={"anthropic": "x"}, db=None)
    assert out["passed"] is True and out["score"] == 88
