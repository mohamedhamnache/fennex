import pytest

from app.services.discovery import synthesis, extractors


def test_parse_handles_code_fence_and_prose():
    raw = 'Here you go:\n```json\n{"business":{"industry":"Coffee"},' \
          '"brand":{"tone":"warm"},"audience":[{"label":"Locals"}],' \
          '"goals":["Increase SEO traffic"]}\n```\nHope that helps.'
    p = synthesis.parse_synthesis(raw)
    assert p["business"]["industry"] == "Coffee"
    assert p["brand"]["tone"] == "warm"
    assert p["audience"][0]["label"] == "Locals"
    assert "Increase SEO traffic" in p["goals"]


def test_parse_malformed_returns_empty():
    assert synthesis.parse_synthesis("not json at all") == {}


def test_build_prompt_mentions_json_and_business():
    sysp, userp = synthesis.build_prompt("We roast coffee in Lyon.", extractors.empty_result())
    assert "JSON" in sysp
    assert "coffee" in userp.lower()


def test_parse_synthesis_drops_wrong_typed_value():
    raw = '{"goals": {"foo": 1}, "business": {"industry": "Tech"}}'
    p = synthesis.parse_synthesis(raw)
    assert "goals" not in p
    assert p["business"]["industry"] == "Tech"


async def test_synthesise_returns_partial_on_empty_text():
    partial = extractors.empty_result()
    partial["business"]["name"] = "Test Co"
    result = await synthesis.synthesise("", partial, provider="test", model="test", api_key="test")
    assert result == partial
    assert result["business"]["name"] == "Test Co"


async def test_synthesise_returns_partial_on_llm_error(monkeypatch):
    partial = extractors.empty_result()
    partial["business"]["name"] = "Test Co"

    async def mock_call_llm(*args, **kwargs):
        raise RuntimeError("LLM failed")

    monkeypatch.setattr("app.services.discovery.synthesis.call_llm", mock_call_llm)
    result = await synthesis.synthesise("Some text", partial, provider="test", model="test", api_key="test")
    assert result == partial
    assert result["business"]["name"] == "Test Co"


async def test_synthesise_merges_successful_parse(monkeypatch):
    partial = extractors.empty_result()
    partial["business"]["name"] = "Test Co"

    async def mock_call_llm(*args, **kwargs):
        return '{"goals": ["Increase revenue"], "business": {"industry": "Tech"}}'

    monkeypatch.setattr("app.services.discovery.synthesis.call_llm", mock_call_llm)
    result = await synthesis.synthesise("Some text", partial, provider="test", model="test", api_key="test")
    assert result["business"]["name"] == "Test Co"
    assert result["business"]["industry"] == "Tech"
    assert "Increase revenue" in result["goals"]
