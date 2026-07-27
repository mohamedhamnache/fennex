import pytest

from app.services import llm_service
from app.services.batch import client as batch_client
from app.services.batch.scope import batch_enabled, batch_scope
from app.services.llm_service import LLMUsage


def test_batch_mode_is_off_by_default():
    assert batch_enabled() is False


def test_scope_turns_batch_on_and_restores_it():
    assert batch_enabled() is False
    with batch_scope():
        assert batch_enabled() is True
    assert batch_enabled() is False


def test_nested_scopes_restore_correctly():
    with batch_scope():
        with batch_scope():
            assert batch_enabled() is True
        assert batch_enabled() is True
    assert batch_enabled() is False


async def test_call_llm_usage_ignores_batch_outside_a_scope(monkeypatch):
    called = {"batched": False, "sync": False}

    async def fake_run_batched(*a, **k):
        called["batched"] = True
        return "batched", LLMUsage("openai", "gpt-4o", batch=True)

    async def fake_openai_usage(model, api_key, system_prompt, user_prompt, max_tokens):
        called["sync"] = True
        return "sync", LLMUsage("openai", model)

    monkeypatch.setattr(batch_client, "run_batched", fake_run_batched)
    monkeypatch.setattr(llm_service, "_openai_usage", fake_openai_usage)

    text, usage = await llm_service.call_llm_usage("openai", "gpt-4o", "k", "s", "u")
    assert (text, called["sync"], called["batched"]) == ("sync", True, False)


async def test_call_llm_usage_uses_batch_inside_a_scope(monkeypatch):
    async def fake_run_batched(*a, **k):
        return "batched", LLMUsage("openai", "gpt-4o", input_tokens=5, batch=True)

    monkeypatch.setattr(batch_client, "run_batched", fake_run_batched)
    with batch_scope():
        text, usage = await llm_service.call_llm_usage("openai", "gpt-4o", "k", "s", "u")
    assert text == "batched"
    assert usage.batch is True


async def test_batch_failure_falls_back_to_the_sync_path(monkeypatch):
    """A batch problem must never kill a scheduled job."""
    async def fake_run_batched(*a, **k):
        return None

    async def fake_openai_usage(model, api_key, system_prompt, user_prompt, max_tokens):
        return "sync", LLMUsage("openai", model)

    monkeypatch.setattr(batch_client, "run_batched", fake_run_batched)
    monkeypatch.setattr(llm_service, "_openai_usage", fake_openai_usage)
    with batch_scope():
        text, usage = await llm_service.call_llm_usage("openai", "gpt-4o", "k", "s", "u")
    assert text == "sync"
    assert usage.batch is False


async def test_anthropic_stays_on_the_sync_path_inside_a_scope(monkeypatch):
    """Only the OpenAI batch path is implemented; other providers must not stall."""
    async def fake_anthropic_usage(model, api_key, system_prompt, user_prompt, max_tokens):
        return "sync", LLMUsage("anthropic", model)

    monkeypatch.setattr(llm_service, "_anthropic_usage", fake_anthropic_usage)
    with batch_scope():
        text, usage = await llm_service.call_llm_usage("anthropic", "claude-sonnet-5", "k", "s", "u")
    assert (text, usage.batch) == ("sync", False)
