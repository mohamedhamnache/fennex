import json

import pytest

from app.services.agents import cascade
from app.services.agents.cascade import validators


def test_non_empty_rejects_blank():
    assert validators.non_empty("hi") is True
    assert validators.non_empty("   ") is False


def test_json_object_requires_parseable_json_with_keys():
    check = validators.json_object(("title", "slug"))
    assert check(json.dumps({"title": "a", "slug": "b"})) is True
    assert check(json.dumps({"title": "a"})) is False
    assert check("not json at all") is False


def test_json_object_tolerates_a_fenced_block():
    check = validators.json_object(("title",))
    assert check('```json\n{"title": "a"}\n```') is True


def test_max_chars_rejects_overrun():
    assert validators.max_chars(5)("abc") is True
    assert validators.max_chars(5)("abcdef") is False


@pytest.fixture
def spy(monkeypatch):
    """Returns (calls, replies). Push canned responses onto `replies`; each
    call_llm pops the next one and records what it was asked to run."""
    calls: list[dict] = []
    replies: list[str] = []

    async def fake_call_llm(provider, model, api_key, system_prompt, user_prompt,
                            locale="en", max_tokens=None, meter=None, feature=None):
        calls.append({"provider": provider, "model": model, "feature": feature,
                      "meter": meter})
        return replies.pop(0)

    monkeypatch.setattr(cascade, "call_llm", fake_call_llm)
    return calls, replies


async def test_valid_cheap_output_does_not_escalate(spy):
    calls, replies = spy
    replies.append('{"title": "ok"}')
    out = await cascade.call_with_cascade(
        keys={"openai": "k"}, feature="extraction", system_prompt="s", user_prompt="u",
        validate=validators.json_object(("title",)))
    assert out == '{"title": "ok"}'
    assert len(calls) == 1
    assert calls[0]["model"] == "gpt-4o-mini"


async def test_invalid_output_escalates_exactly_one_band_once(spy):
    calls, replies = spy
    replies.extend(["garbage", '{"title": "ok"}'])
    out = await cascade.call_with_cascade(
        keys={"openai": "k"}, feature="extraction", system_prompt="s", user_prompt="u",
        validate=validators.json_object(("title",)))
    assert out == '{"title": "ok"}'
    assert [c["model"] for c in calls] == ["gpt-4o-mini", "gpt-4o"]


async def test_both_attempts_are_metered(spy):
    """The ledger must show the true cost of a cascade, not just the winner."""
    calls, replies = spy
    replies.extend(["garbage", '{"title": "ok"}'])
    sentinel = {"db": None, "org_id": None}
    await cascade.call_with_cascade(
        keys={"openai": "k"}, feature="extraction", system_prompt="s", user_prompt="u",
        meter=sentinel, validate=validators.json_object(("title",)))
    assert [c["meter"] for c in calls] == [sentinel, sentinel]


async def test_second_failure_returns_the_retry_output_rather_than_raising(spy):
    """A cascade is a cost optimisation, not a correctness gate: the caller's own
    parsing still decides what to do with a bad response."""
    calls, replies = spy
    replies.extend(["garbage", "still garbage"])
    out = await cascade.call_with_cascade(
        keys={"openai": "k"}, feature="extraction", system_prompt="s", user_prompt="u",
        validate=validators.json_object(("title",)))
    assert out == "still garbage"
    assert len(calls) == 2


async def test_no_retry_when_escalation_resolves_to_the_same_model(spy):
    """editorial_polish sits on standard and its premium escalation is capped
    back to standard for an unentitled org -- re-running the identical model
    would burn a call for nothing."""
    calls, replies = spy
    replies.append("garbage")
    out = await cascade.call_with_cascade(
        keys={"anthropic": "k"}, feature="editorial_polish", system_prompt="s",
        user_prompt="u", org=None, validate=validators.json_object(("title",)))
    assert out == "garbage"
    assert len(calls) == 1


async def test_no_keys_raises(spy):
    with pytest.raises(ValueError):
        await cascade.call_with_cascade(keys={}, feature="extraction",
                                        system_prompt="s", user_prompt="u")
