"""The policy map (app.services.agents.policy) only bites where callers name
their feature. These are the highest-volume paths; a call site without a
feature silently falls back to the tier band and skips its output cap.

Previously this file asserted `"feature=" in inspect.getsource(module)`, which
passes on a comment, a docstring, or an unrelated function elsewhere in the
same module -- it never proved a single call site actually threads its
feature through to resolve_model / call_llm. These tests instead drive each
wired call site and assert on the `feature` kwarg that actually reaches the
mocked boundary, so a call site that silently drops its feature (e.g. a
future refactor that forgets the kwarg) fails the test instead of passing on
unrelated text elsewhere in the file.
"""
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from app.services import discovery_service, knowledge_service
from app.services.agents import director, reviewer, runner
from app.services.agents.brief import Brief
from app.services.agents.spec import AgentResult, Skill


def _brief(**overrides) -> Brief:
    defaults = dict(goal="grow organic traffic", persona="creator", project_id=uuid.uuid4(),
                    org_id=uuid.uuid4(), locale="en", project_profile="", brand={},
                    existing_content=[], artifacts=[])
    defaults.update(overrides)
    return Brief(**defaults)


async def test_discovery_service_names_its_feature():
    resolve = Mock(return_value=("anthropic", "claude-haiku-4-5-20251001"))
    with patch.object(discovery_service, "get_org_llm_keys", new=AsyncMock(return_value={"anthropic": "k"})), \
         patch.object(discovery_service, "resolve_model", new=resolve):
        provider, model, key = await discovery_service._org_model(uuid.uuid4(), db=None)
    assert resolve.call_args.kwargs.get("feature") == "discovery"
    assert (provider, key) == ("anthropic", "k")


async def test_knowledge_service_names_its_feature_at_both_call_sites():
    project = SimpleNamespace(locale="en", knowledge_digest=None)

    class _FakeDB:
        async def get(self, model, id_):
            return project

        async def commit(self):
            pass

    docs = [SimpleNamespace(title="Brand doc", body="x" * 50)]
    resolve = Mock(return_value=("anthropic", "claude-sonnet-5"))
    call_llm = AsyncMock(return_value="A tidy digest.")
    with patch.object(knowledge_service, "list_documents", new=AsyncMock(return_value=docs)), \
         patch("app.services.agents.tiers.resolve_model", new=resolve), \
         patch("app.services.llm_service.call_llm", new=call_llm):
        digest = await knowledge_service.refresh_digest(uuid.uuid4(), uuid.uuid4(),
                                                         {"anthropic": "k"}, _FakeDB())
    assert resolve.call_args.kwargs.get("feature") == "document_digest"
    assert call_llm.call_args.kwargs.get("feature") == "document_digest"
    assert digest == "A tidy digest."


async def test_director_plan_names_its_feature():
    resolve = Mock(return_value=("anthropic", "claude-sonnet-5"))
    call_llm = AsyncMock(return_value='{"steps": [{"skill": "zerda.pick_angle"}]}')
    with patch.object(director, "resolve_model", new=resolve), \
         patch.object(director, "call_llm", new=call_llm):
        await director.plan(_brief(), tier="balanced", keys={"anthropic": "k"}, db=None)
    assert resolve.call_args.kwargs.get("feature") == "agent_reasoning"
    assert call_llm.call_args.kwargs.get("feature") == "agent_reasoning"


async def test_reviewer_review_names_its_feature():
    resolve = Mock(return_value=("anthropic", "claude-sonnet-5"))
    call_llm = AsyncMock(return_value='{"score": 88, "feedback": "solid"}')
    result = AgentResult(ok=True, artifact_type="social", summary="did it")
    skill = Skill(key="dune.write_article", agent_id="dune", weight="heavy", tools=[],
                  build_prompt=lambda b, i, t: ("s", "u"), output="markdown")
    with patch.object(reviewer, "resolve_model", new=resolve), \
         patch.object(reviewer, "call_llm", new=call_llm):
        await reviewer.review(_brief(), skill, result, tier="balanced", keys={"anthropic": "k"}, db=None)
    assert resolve.call_args.kwargs.get("feature") == "agent_reasoning"
    assert call_llm.call_args.kwargs.get("feature") == "agent_reasoning"


async def test_runner_passes_the_skills_feature_through_to_resolve_and_call():
    """runner has no fixed feature literal of its own -- it forwards
    whatever `skill.feature` names, so the meaningful assertion is that the
    value actually travels end to end rather than being dropped anywhere
    between the skill definition and the two LLM boundary calls."""
    resolve = Mock(return_value=("anthropic", "claude-sonnet-5"))
    call_llm = AsyncMock(return_value="body")
    skill = Skill(key="sable.competitor_scan", agent_id="sable", weight="heavy", tools=[],
                  build_prompt=lambda b, i, td: ("SYS", "USR"), output="markdown",
                  parse=lambda raw: raw, feature="competitor_scan")
    with patch.object(runner, "resolve_model", new=resolve), \
         patch.object(runner, "call_llm", new=call_llm):
        result = await runner.AgentRunner.run(skill, _brief(), inputs={}, tier="balanced",
                                              db=None, keys={"anthropic": "k"})
    assert result.ok
    assert resolve.call_args.kwargs.get("feature") == "competitor_scan"
    assert call_llm.call_args.kwargs.get("feature") == "competitor_scan"


async def test_runner_with_no_skill_feature_forwards_none_not_a_default():
    """A skill that never set `feature` must resolve to tier-only routing
    (None), not silently inherit some other feature's policy band."""
    resolve = Mock(return_value=("anthropic", "claude-sonnet-5"))
    call_llm = AsyncMock(return_value="body")
    skill = Skill(key="mirage.product_shot", agent_id="mirage", weight="light", tools=[],
                  build_prompt=lambda b, i, td: ("SYS", "USR"), output="text", parse=lambda raw: raw)
    with patch.object(runner, "resolve_model", new=resolve), \
         patch.object(runner, "call_llm", new=call_llm):
        await runner.AgentRunner.run(skill, _brief(), inputs={}, tier="balanced",
                                     db=None, keys={"anthropic": "k"})
    assert resolve.call_args.kwargs.get("feature") is None
    assert call_llm.call_args.kwargs.get("feature") is None
