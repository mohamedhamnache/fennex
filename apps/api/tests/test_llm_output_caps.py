import pytest

from app.services import llm_service
from app.services.llm_service import DEFAULT_MAX_TOKENS, LLMUsage


@pytest.fixture
def captured(monkeypatch):
    seen = {}

    async def fake_call_llm_usage(provider, model, api_key, system_prompt, user_prompt,
                                  locale="en", max_tokens=DEFAULT_MAX_TOKENS):
        seen["max_tokens"] = max_tokens
        return "ok", LLMUsage(provider, model)

    monkeypatch.setattr(llm_service, "call_llm_usage", fake_call_llm_usage)
    return seen


async def test_feature_policy_supplies_the_cap(captured):
    await llm_service.call_llm("openai", "gpt-4o-mini", "k", "sys", "usr",
                               feature="meta_description")
    assert captured["max_tokens"] == 256


async def test_explicit_max_tokens_wins_over_the_policy(captured):
    await llm_service.call_llm("openai", "gpt-4o-mini", "k", "sys", "usr",
                               feature="meta_description", max_tokens=4096)
    assert captured["max_tokens"] == 4096


async def test_no_feature_keeps_the_default(captured):
    await llm_service.call_llm("openai", "gpt-4o-mini", "k", "sys", "usr")
    assert captured["max_tokens"] == DEFAULT_MAX_TOKENS


async def test_unknown_feature_gets_the_conservative_default_cap(captured):
    await llm_service.call_llm("openai", "gpt-4o-mini", "k", "sys", "usr",
                               feature="not-registered")
    assert captured["max_tokens"] == 1024
