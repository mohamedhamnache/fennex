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
