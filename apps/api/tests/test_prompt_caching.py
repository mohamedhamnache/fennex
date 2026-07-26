from app.services.llm_service import CACHEABLE_MIN_CHARS, _anthropic_system_blocks


def test_short_system_prompt_is_left_alone():
    """Below the cacheable threshold a cache_control block only adds overhead."""
    assert _anthropic_system_blocks("be brief") == "be brief"


def test_long_system_prompt_is_marked_ephemeral():
    prompt = "x" * (CACHEABLE_MIN_CHARS + 1)
    blocks = _anthropic_system_blocks(prompt)
    assert isinstance(blocks, list)
    assert blocks[0]["type"] == "text"
    assert blocks[0]["text"] == prompt
    assert blocks[0]["cache_control"] == {"type": "ephemeral"}


def test_empty_prompt_is_left_alone():
    assert _anthropic_system_blocks("") == ""
