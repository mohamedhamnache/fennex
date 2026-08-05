"""/images/improve-prompt: attribution and mode.

The endpoint already existed and already routed through `call_llm`, which is
the ambient-metering chokepoint. That was ASSERTED rather than demonstrated
before Mirage's rephrase control started spending on it, so it is pinned here:
resolving the org's keys must set the metering org, and the call must arrive
at the meter naming this feature. A NULL feature is not a metering failure but
it is an accounting one -- the spend cannot be told apart from every other
unnamed LLM call in the org's ledger.
"""
import uuid

import pytest

from app.api.v1.routers import images as images_router
from app.core import metering_context
from app.services import llm_service


class _Usage:
    provider = "anthropic"
    model = "claude-haiku-4-5-20251001"
    input_tokens = 120
    output_tokens = 90
    cache_read_tokens = 0
    cache_write_tokens = 0
    batch = False


@pytest.fixture
def metered(monkeypatch):
    """Run call_llm for real, with the provider call and the meter stubbed, and
    capture what the meter was handed."""
    recorded: dict = {}

    async def fake_call_llm_usage(provider, model, api_key, system_prompt, user_prompt,
                                  locale="en", max_tokens=llm_service.DEFAULT_MAX_TOKENS):
        recorded["system"] = system_prompt
        recorded["user"] = user_prompt
        recorded["max_tokens"] = max_tokens
        return "  a rewritten instruction  ", _Usage()

    async def fake_record_llm(db, *, org_id, project_id, usage, feature=None):
        recorded["org_id"] = org_id
        recorded["feature"] = feature
        return 0

    monkeypatch.setattr(llm_service, "call_llm_usage", fake_call_llm_usage)
    # The ambient branch imports the meter and the session factory lazily, so
    # both are replaced on their own modules. Patching the FUNCTION rather than
    # swapping the module into sys.modules is deliberate: `from
    # app.services.metering import meter` resolves the already-bound package
    # ATTRIBUTE, which a sys.modules substitution does not touch -- so that
    # form of the stub silently does nothing as soon as any earlier test has
    # imported the real module.
    from app.services.metering import meter as real_meter
    monkeypatch.setattr(real_meter, "record_llm", fake_record_llm)

    class _NullSession:
        async def __aenter__(self):
            return None

        async def __aexit__(self, *exc):
            return False

    import app.core.database as database
    monkeypatch.setattr(database, "async_session_factory", lambda: _NullSession())
    return recorded


async def _call(monkeypatch, metered, *, org_id, mode=None):
    async def fake_get_llm_keys(org_id_, db):
        return {"anthropic": "sk-test"}

    from app.services.providers import registry
    monkeypatch.setattr(registry, "get_llm_keys", fake_get_llm_keys)

    class _User:
        pass

    user = _User()
    user.org_id = org_id

    body = images_router.ImprovePromptRequest(prompt="remove the mint", mode=mode)
    return await images_router.improve_prompt(body, user, None)


async def test_improve_prompt_meters_against_the_calling_org_and_names_the_feature(
    monkeypatch, metered,
):
    org = uuid.uuid4()
    metering_context.set_metering_org(None)

    out = await _call(monkeypatch, metered, org_id=org)

    assert out.improved_prompt == "a rewritten instruction"  # stripped
    # get_org_llm_keys set the ambient org; call_llm's else-branch read it back.
    assert metered["org_id"] == org
    assert metered["feature"] == "improve_prompt"


async def test_edit_instruction_mode_uses_the_editing_system_prompt(monkeypatch, metered):
    await _call(monkeypatch, metered, org_id=uuid.uuid4(), mode="edit_instruction")
    assert metered["system"] == images_router._IMPROVE_EDIT_SYSTEM
    # The user's own words must reach the model intact; the wrapper only frames
    # them. Asserting the payload rather than the wrapper's exact sentence so
    # the framing can be reworded without a test edit.
    assert "remove the mint" in metered["user"]


async def test_edit_instruction_prompt_is_operation_aware(monkeypatch, metered):
    """The rewriter must know which edits take rich description and which do
    not.

    Uniform verbosity is the failure mode this guards: dressing a parametric
    edit ("brighten it") in scene description misroutes the planner into
    regenerating the picture instead of adjusting it, and a removal only ever
    needed an unambiguous target. The instruction also has to keep saying what
    must NOT change, which is what stops a generative edit drifting into a
    different photograph.
    """
    system = images_router._IMPROVE_EDIT_SYSTEM
    for term in ("GENERATIVE", "REGIONAL", "PARAMETRIC"):
        assert term in system, f"the rewriter must distinguish {term} edits"
    assert "MUST NOT CHANGE" in system
    assert "SAME LANGUAGE" in system
    # It stays an instruction to an editor: a whole-photo description reads as
    # "generate this" and replaces the user's image.
    assert "never write a description of the whole photograph" in system.lower()


async def test_default_mode_still_improves_a_generation_prompt(monkeypatch, metered):
    """The Image Studio's PromptToolbar sends no mode and must be unaffected."""
    await _call(monkeypatch, metered, org_id=uuid.uuid4(), mode=None)
    assert metered["system"] == images_router._IMPROVE_SYSTEM
    assert "Improve this image prompt" in metered["user"]


async def test_output_ceiling_comes_from_the_feature_policy(monkeypatch, metered):
    """Naming the feature is what buys the 512-token ceiling; without a policy
    row this endpoint would inherit the 4096 default, and output costs ~5x
    input on a button a user can press repeatedly."""
    from app.services.agents.policy import policy_for

    await _call(monkeypatch, metered, org_id=uuid.uuid4(), mode="edit_instruction")
    assert metered["max_tokens"] == policy_for("improve_prompt").max_output_tokens == 512
