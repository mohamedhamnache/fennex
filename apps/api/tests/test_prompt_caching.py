from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.llm_service import CACHEABLE_MIN_CHARS, _anthropic_system_blocks, stream_llm


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


class _FakeAnthropicStream:
    """Minimal stand-in for the ``async with client.messages.stream(...)``
    context manager: an async context manager whose ``text_stream`` attribute
    is itself an async generator of text chunks."""

    def __init__(self, chunks):
        self.text_stream = self._gen(chunks)

    @staticmethod
    async def _gen(chunks):
        for chunk in chunks:
            yield chunk

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False


async def _drain(agen):
    return [chunk async for chunk in agen]


@pytest.mark.asyncio
async def test_stream_llm_anthropic_marks_long_system_prompt():
    """stream_llm's Anthropic branch should cache-mark the system prompt the
    same way call_llm/call_llm_usage already do."""
    long_system = "x" * (CACHEABLE_MIN_CHARS + 1)
    fake_stream = _FakeAnthropicStream(["hello"])
    mock_client = MagicMock()
    mock_client.messages.stream = MagicMock(return_value=fake_stream)
    mock_cls = MagicMock(return_value=mock_client)

    with patch("app.services.llm_service.AsyncAnthropic", mock_cls):
        chunks = await _drain(stream_llm("anthropic", "claude-x", "key", long_system, "user"))

    assert chunks == ["hello"]
    _, kwargs = mock_client.messages.stream.call_args
    assert isinstance(kwargs["system"], list)
    assert kwargs["system"][0]["type"] == "text"
    assert kwargs["system"][0]["text"] == long_system
    assert kwargs["system"][0]["cache_control"] == {"type": "ephemeral"}


@pytest.mark.asyncio
async def test_stream_llm_anthropic_short_system_prompt_is_plain_string():
    fake_stream = _FakeAnthropicStream(["hi"])
    mock_client = MagicMock()
    mock_client.messages.stream = MagicMock(return_value=fake_stream)
    mock_cls = MagicMock(return_value=mock_client)

    with patch("app.services.llm_service.AsyncAnthropic", mock_cls):
        chunks = await _drain(stream_llm("anthropic", "claude-x", "key", "short system", "user"))

    assert chunks == ["hi"]
    _, kwargs = mock_client.messages.stream.call_args
    assert kwargs["system"] == "short system"


@pytest.mark.asyncio
async def test_stream_llm_anthropic_does_not_append_directive_to_system_prompt():
    """The old ``system_prompt + language_directive(locale)`` behaviour must be
    gone: a non-English locale must not change the system prompt at all."""
    fake_stream = _FakeAnthropicStream(["bonjour"])
    mock_client = MagicMock()
    mock_client.messages.stream = MagicMock(return_value=fake_stream)
    mock_cls = MagicMock(return_value=mock_client)

    with patch("app.services.llm_service.AsyncAnthropic", mock_cls):
        chunks = await _drain(
            stream_llm("anthropic", "claude-x", "key", "system", "user", locale="fr")
        )

    assert chunks == ["bonjour"]
    _, kwargs = mock_client.messages.stream.call_args
    assert kwargs["system"] == "system"


@pytest.mark.asyncio
async def test_stream_llm_anthropic_non_english_locale_directive_in_user_prompt():
    fake_stream = _FakeAnthropicStream(["bonjour"])
    mock_client = MagicMock()
    mock_client.messages.stream = MagicMock(return_value=fake_stream)
    mock_cls = MagicMock(return_value=mock_client)

    with patch("app.services.llm_service.AsyncAnthropic", mock_cls):
        await _drain(stream_llm("anthropic", "claude-x", "key", "system", "user prompt", locale="fr"))

    _, kwargs = mock_client.messages.stream.call_args
    content = kwargs["messages"][0]["content"]
    assert content.startswith("IMPORTANT: Write all human-readable text in your response in French.")
    assert content.endswith("user prompt")


@pytest.mark.asyncio
async def test_stream_llm_anthropic_english_locale_leaves_user_prompt_unchanged():
    fake_stream = _FakeAnthropicStream(["hi"])
    mock_client = MagicMock()
    mock_client.messages.stream = MagicMock(return_value=fake_stream)
    mock_cls = MagicMock(return_value=mock_client)

    with patch("app.services.llm_service.AsyncAnthropic", mock_cls):
        await _drain(stream_llm("anthropic", "claude-x", "key", "system", "user prompt", locale="en"))

    _, kwargs = mock_client.messages.stream.call_args
    assert kwargs["messages"][0]["content"] == "user prompt"


@pytest.mark.asyncio
async def test_stream_llm_anthropic_none_locale_leaves_user_prompt_unchanged():
    fake_stream = _FakeAnthropicStream(["hi"])
    mock_client = MagicMock()
    mock_client.messages.stream = MagicMock(return_value=fake_stream)
    mock_cls = MagicMock(return_value=mock_client)

    with patch("app.services.llm_service.AsyncAnthropic", mock_cls):
        await _drain(stream_llm("anthropic", "claude-x", "key", "system", "user prompt", locale=None))

    _, kwargs = mock_client.messages.stream.call_args
    assert kwargs["messages"][0]["content"] == "user prompt"


@pytest.mark.asyncio
async def test_stream_llm_openai_unaffected_by_cache_marking_and_gets_directive_in_user_prompt():
    """OpenAI never gets Anthropic-style cache blocks, but must still receive
    the locale directive -- now via the user prompt instead of the system one."""
    async def _chunks():
        chunk = MagicMock()
        chunk.choices = [MagicMock(delta=MagicMock(content="hola"))]
        yield chunk

    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=_chunks())
    mock_cls = MagicMock(return_value=mock_client)

    with patch("app.services.llm_service.AsyncOpenAI", mock_cls):
        chunks = await _drain(
            stream_llm("openai", "gpt-4o", "key", "system", "user prompt", locale="es")
        )

    assert chunks == ["hola"]
    _, kwargs = mock_client.chat.completions.create.call_args
    messages = kwargs["messages"]
    assert messages[0] == {"role": "system", "content": "system"}
    assert messages[1]["role"] == "user"
    assert messages[1]["content"].startswith("IMPORTANT: Write all human-readable text in your response in Spanish.")
    assert messages[1]["content"].endswith("user prompt")


@pytest.mark.asyncio
async def test_stream_llm_google_unaffected_by_cache_marking_and_gets_directive_in_user_prompt():
    mock_google = AsyncMock(return_value="hola")

    with patch("app.services.llm_service._call_google", mock_google):
        chunks = await _drain(
            stream_llm("google", "gemini-1.5-flash", "key", "system", "user prompt", locale="es")
        )

    assert chunks == ["hola"]
    args, _ = mock_google.call_args
    # _call_google(model, api_key, system_prompt, user_prompt)
    assert args[2] == "system"
    assert args[3].startswith("IMPORTANT: Write all human-readable text in your response in Spanish.")
    assert args[3].endswith("user prompt")
