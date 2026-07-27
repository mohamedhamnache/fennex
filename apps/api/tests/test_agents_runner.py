import uuid, json, pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from app.models.organization import PlanTier
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
    async def fake_call(provider, model, key, system, user, locale="en", max_tokens=4096, feature=None):
        seen["max_tokens"] = max_tokens
        return "body"
    with patch("app.services.agents.runner.call_llm", new=fake_call):
        r = await AgentRunner.run(_mt_skill(), _brief(), inputs={}, tier="balanced", db=None, keys={"anthropic": "x"})
    assert r.ok and seen["max_tokens"] == 8192


async def test_override_bypasses_resolve_and_fills_runtime():
    captured = {}
    async def persist(content, campaign, brief, db):
        captured["runtime"] = dict(brief.runtime)
        from app.services.agents.spec import AgentResult
        return AgentResult(ok=True, summary="saved")
    from app.services.agents.spec import Skill
    skill = Skill(key="dune.generate_article", agent_id="dune", weight="heavy", tools=[],
                  build_prompt=lambda b, i, td: ("S", "U"), output="markdown", parse=lambda r: r, persist=persist)
    async def fake_call(provider, model, key, system, user, locale="en", max_tokens=4096, feature=None):
        captured["provider"] = provider; captured["model"] = model
        return "body"
    with patch("app.services.agents.runner.call_llm", new=fake_call):
        r = await AgentRunner.run(skill, _brief(), inputs={"a": 1}, tier="balanced", db=None,
                                  keys={"anthropic": "x", "openai": "y"},
                                  provider_override="openai", model_override="gpt-4o")
    assert r.ok and captured["provider"] == "openai" and captured["model"] == "gpt-4o"
    assert captured["runtime"]["provider"] == "openai" and captured["runtime"]["api_key"] == "y"
    assert captured["runtime"]["inputs"] == {"a": 1}


# --- entitlement gate on the runner's override path (finding 1) ---------------
#
# The runner used to honour provider_override/model_override with no catalog
# check and no entitlement cap at all -- an authenticated user on any plan
# could name claude-opus-5 directly and get it, every article generation.
# These tests pin the fix: an override is only honoured when it is catalogued
# AND within the org's entitlement (app.core.entitlements.cap_band, applied to
# the model's *highest* catalogued band); anything else falls back to normal
# tier resolution instead of raising or silently granting premium.


class _FakeDB:
    """Stands in for the AsyncSession: only `.get(Organization, id)` is used
    by the override path, and only when a premium-band override is named."""

    def __init__(self, org):
        self._org = org
        self.get_calls = 0

    async def get(self, model, pk):
        self.get_calls += 1
        return self._org


def _org(plan=PlanTier.PRO, flag=True):
    return SimpleNamespace(plan_tier=plan, premium_models_enabled=flag, trial_ends_at=None)


def _heavy_skill():
    return Skill(key="dune.generate_article", agent_id="dune", weight="heavy", tools=[],
                 build_prompt=lambda b, i, td: ("S", "U"), output="markdown", parse=lambda r: r)


async def _run_and_capture(skill, db, provider_override, model_override):
    captured = {}

    async def fake_call(provider, model, key, system, user, locale="en", max_tokens=4096, feature=None):
        captured["provider"] = provider
        captured["model"] = model
        return "body"

    with patch("app.services.agents.runner.call_llm", new=fake_call):
        r = await AgentRunner.run(skill, _brief(), inputs={}, tier="balanced", db=db,
                                  keys={"anthropic": "x"},
                                  provider_override=provider_override,
                                  model_override=model_override)
    assert r.ok
    return captured


async def test_premium_override_is_refused_for_an_unentitled_org_and_falls_back():
    """PRO plan but premium_models_enabled is False -- entitlement is opt-in,
    not implied by plan alone."""
    db = _FakeDB(_org(PlanTier.PRO, flag=False))
    captured = await _run_and_capture(_heavy_skill(), db, "anthropic", "claude-opus-5")
    assert captured["model"] != "claude-opus-5"
    assert (captured["provider"], captured["model"]) == ("anthropic", "claude-sonnet-5")
    assert db.get_calls == 1  # only queried because the override named a premium model


async def test_premium_override_is_refused_when_no_org_is_reachable():
    """db=None (no org to check) must cap at the safe default, not raise or
    silently grant premium."""
    captured = await _run_and_capture(_heavy_skill(), None, "anthropic", "claude-opus-5")
    assert (captured["provider"], captured["model"]) == ("anthropic", "claude-sonnet-5")


async def test_premium_override_is_honoured_for_an_entitled_org():
    db = _FakeDB(_org(PlanTier.PRO, flag=True))
    captured = await _run_and_capture(_heavy_skill(), db, "anthropic", "claude-opus-5")
    assert (captured["provider"], captured["model"]) == ("anthropic", "claude-opus-5")


async def test_an_uncatalogued_override_falls_back_without_raising():
    """A model string that prices to $0 must not be honoured just because a
    key is configured for its provider."""
    captured = await _run_and_capture(_heavy_skill(), None, "anthropic", "not-a-real-model")
    assert (captured["provider"], captured["model"]) == ("anthropic", "claude-sonnet-5")


async def test_a_legitimate_standard_band_override_is_still_honoured_without_a_query():
    """Cheap/standard overrides were never gated by entitlement and must not
    start paying for an org lookup either -- cap_band(band, None) already
    equals band for them, so the real org can never change the outcome."""
    db = _FakeDB(_org(PlanTier.PRO, flag=False))
    captured = await _run_and_capture(_heavy_skill(), db, "anthropic", "claude-sonnet-5")
    assert (captured["provider"], captured["model"]) == ("anthropic", "claude-sonnet-5")
    assert db.get_calls == 0
