"""Task 5: the planner's mask-avoidance instructions previously made every
mask operation unreachable from plain natural-language text -- the LLM was
told to prefer maskless operations and to only touch a mask op for an
explicit painted selection. Auto mask derivation (mask_service.resolve_mask)
makes that steering obsolete and actively harmful, so these instructions are
inverted here.
"""

import uuid

import pytest
from app.services import ai_command_service


def test_planner_no_longer_steers_away_from_mask_operations():
    """The old instruction made every mask op unreachable from plain text."""
    assert "Prefer operations that do NOT require a mask" not in ai_command_service._STEPS_SYSTEM
    assert "user must paint mask on canvas first" not in ai_command_service._OPERATIONS_REFERENCE


def test_operations_reference_documents_the_target_param():
    ref = ai_command_service._OPERATIONS_REFERENCE
    for op in ("replace_background", "remove_object", "smart_erase",
               "insert_object", "generative_fill"):
        line = next(ln for ln in ref.splitlines() if ln.strip().startswith(f"- {op}:"))
        assert "target" in line, f"{op} does not document target"


def test_only_replace_background_is_told_it_may_omit_its_target():
    """Emitting target='the background' would route the commonest, cheapest case
    through the paid segmenter instead of the free product tier. Removal used to
    be in this list, which is what let "supprime la menthe" erase the bottle."""
    ref = ai_command_service._OPERATIONS_REFERENCE
    line = next(ln for ln in ref.splitlines() if ln.strip().startswith("- replace_background:"))
    assert "OMIT" in line


def test_insert_and_fill_require_a_target():
    ref = ai_command_service._OPERATIONS_REFERENCE
    for op in ("insert_object", "generative_fill"):
        line = next(ln for ln in ref.splitlines() if ln.strip().startswith(f"- {op}:"))
        assert "REQUIRED" in line, f"{op} does not mark target required"


def test_removal_operations_require_a_target():
    """"supprime la menthe" produced a disaster: the planner omitted target, the
    product tier masked THE MAIN SUBJECT (the bottle) and erased it, and the mint
    was never touched. Removal always names a thing -- there is no default."""
    ref = ai_command_service._OPERATIONS_REFERENCE
    for op in ("remove_object", "smart_erase"):
        line = next(ln for ln in ref.splitlines() if ln.strip().startswith(f"- {op}:"))
        assert "REQUIRED" in line, f"{op} must require a target, got: {line}"
        assert "OMIT" not in line, f"{op} must not invite omitting the target: {line}"


def test_only_replace_background_may_omit_its_target():
    ref = ai_command_service._OPERATIONS_REFERENCE
    line = next(ln for ln in ref.splitlines() if ln.strip().startswith("- replace_background:"))
    assert "OMIT" in line


def test_the_instructions_tell_the_planner_to_use_the_users_own_words():
    """The old framing said to name a target ONLY when the user singled an object
    out, which read as an invitation to omit it."""
    ref = ai_command_service._OPERATIONS_REFERENCE
    assert "user's own words" in ref
    assert "ONLY\nwhen the user singled out" not in ref


@pytest.mark.asyncio
async def test_a_refusal_from_one_provider_falls_through_to_the_next():
    """These models refuse intermittently. "change background color to green"
    came back as {"error": "...do not map to available tasks"} from one provider
    while the same prompt mapped correctly on another. Returning the first
    refusal turned a transient hiccup into a hard failure the user saw."""
    from unittest.mock import AsyncMock, patch

    from app.services import ai_command_service as svc

    calls = []

    async def _fake_call_llm(provider, model, key, system, user, locale="en"):
        calls.append(provider)
        if provider == "anthropic":
            return '{"error": "modified operations do not map to available tasks"}'
        return '{"steps": [{"operation": "replace_background", "params": {"prompt": "solid green background"}}]}'

    with patch.object(svc, "get_org_llm_keys",
                      AsyncMock(return_value={"anthropic": "k1", "openai": "k2"})), \
         patch.object(svc, "call_llm", _fake_call_llm):
        result = await svc.parse_ai_command_steps("change background color to green",
                                                  [], uuid.uuid4(), None)

    assert "error" not in result, result
    assert result["steps"][0]["operation"] == "replace_background"
    assert calls == ["anthropic", "openai"], "should have tried the second provider"


@pytest.mark.asyncio
async def test_a_genuine_refusal_from_every_provider_is_still_surfaced():
    """If nothing can map it, the user should see the model's own explanation,
    not a generic 'try rephrasing'."""
    from unittest.mock import AsyncMock, patch

    from app.services import ai_command_service as svc

    async def _all_refuse(provider, model, key, system, user, locale="en"):
        return '{"error": "that is not an image edit"}'

    with patch.object(svc, "get_org_llm_keys",
                      AsyncMock(return_value={"anthropic": "k1", "openai": "k2"})), \
         patch.object(svc, "call_llm", _all_refuse):
        result = await svc.parse_ai_command_steps("book me a flight", [], uuid.uuid4(), None)

    assert result["error"] == "that is not an image edit"


@pytest.mark.asyncio
async def test_a_colour_change_is_documented_as_a_background_replacement():
    """The reference now says so explicitly, with worked examples in two
    languages -- a bare 'prompt(str describing new background)' left the model
    to infer that a colour counts."""
    from app.services import ai_command_service as svc

    ref = svc._OPERATIONS_REFERENCE
    assert "replace_background" in ref
    assert "colour" in ref or "color" in ref
    assert "solid green background" in ref
    assert "fond blanc" in ref
