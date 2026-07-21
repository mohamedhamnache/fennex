import uuid, json, pytest
from unittest.mock import AsyncMock, patch
from app.services.agents.brief import Brief
from app.services.agents.spec import Skill, AgentResult
from app.services.agents.runner import AgentRunner


def _brief():
    return Brief(goal="g", persona="creator", project_id=uuid.uuid4(), org_id=uuid.uuid4(),
                 locale="en", project_profile="", brand={}, existing_content=[], artifacts=[])


def _json_skill():
    return Skill(key="zerda.pick_angle", agent_id="zerda", weight="light", tools=[],
                 build_prompt=lambda b, i, td: ("SYS", "USR"), output="json",
                 parse=lambda raw: json.loads(raw))


async def test_run_parses_json_and_builds_summary():
    with patch("app.services.agents.runner.call_llm", new=AsyncMock(return_value='{"topic":"T","keyword":"k"}')):
        r = await AgentRunner.run(_json_skill(), _brief(), inputs={}, tier="balanced",
                                  db=None, keys={"anthropic": "x"})
    assert r.ok and r.content == {"topic": "T", "keyword": "k"}


async def test_run_repairs_malformed_json_once():
    calls = AsyncMock(side_effect=["not json", '{"topic":"T2"}'])
    with patch("app.services.agents.runner.call_llm", new=calls):
        r = await AgentRunner.run(_json_skill(), _brief(), inputs={}, tier="balanced",
                                  db=None, keys={"openai": "x"})
    assert r.ok and r.content == {"topic": "T2"} and calls.call_count == 2


async def test_run_returns_error_when_no_keys():
    r = await AgentRunner.run(_json_skill(), _brief(), inputs={}, tier="balanced", db=None, keys={})
    assert r.ok is False and r.error


def _mt_skill():
    from app.services.agents.spec import Skill
    return Skill(key="dune.generate_article", agent_id="dune", weight="heavy", tools=[],
                 build_prompt=lambda b, i, td: ("SYS", "USR"), output="markdown",
                 parse=lambda raw: raw, max_tokens=8192)


async def test_run_passes_skill_max_tokens_to_call_llm():
    seen = {}
    async def fake_call(provider, model, key, system, user, locale="en", max_tokens=4096):
        seen["max_tokens"] = max_tokens
        return "body"
    with patch("app.services.agents.runner.call_llm", new=fake_call):
        r = await AgentRunner.run(_mt_skill(), _brief(), inputs={}, tier="balanced", db=None, keys={"anthropic": "x"})
    assert r.ok and seen["max_tokens"] == 8192
