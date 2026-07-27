from app.services import llm_service


class _FakeUsage:
    prompt_tokens = 1000
    completion_tokens = 200
    prompt_tokens_details = None


class _FakeChoice:
    class message:
        content = "hello"


class _FakeResp:
    choices = [_FakeChoice()]
    usage = _FakeUsage()


class _FakeOpenAI:
    def __init__(self, api_key):
        self.chat = self
        self.completions = self

    async def create(self, **kw):
        return _FakeResp()


async def test_call_llm_usage_captures_tokens(monkeypatch):
    monkeypatch.setattr(llm_service, "AsyncOpenAI", _FakeOpenAI)
    text, usage = await llm_service.call_llm_usage(
        "openai", "gpt-4o-mini", "k", "sys", "user")
    assert text == "hello"
    assert usage.input_tokens == 1000
    assert usage.output_tokens == 200
    assert usage.provider == "openai" and usage.model == "gpt-4o-mini"


async def test_call_llm_still_returns_str(monkeypatch):
    monkeypatch.setattr(llm_service, "AsyncOpenAI", _FakeOpenAI)
    out = await llm_service.call_llm("openai", "gpt-4o-mini", "k", "sys", "user")
    assert out == "hello"


class _FakeAnthropicUsage:
    input_tokens = 111
    output_tokens = 22
    cache_read_input_tokens = 5
    cache_creation_input_tokens = 7


class _FakeAnthropicContentBlock:
    text = "hello anthropic"


class _FakeAnthropicResp:
    content = [_FakeAnthropicContentBlock()]
    usage = _FakeAnthropicUsage()


class _FakeAnthropic:
    def __init__(self, api_key):
        self.messages = self

    async def create(self, **kw):
        return _FakeAnthropicResp()


async def test_call_llm_usage_captures_anthropic_tokens(monkeypatch):
    monkeypatch.setattr(llm_service, "AsyncAnthropic", _FakeAnthropic)
    text, usage = await llm_service.call_llm_usage(
        "anthropic", "claude-3-5-sonnet-20241022", "k", "sys", "user")
    assert text == "hello anthropic"
    assert usage.input_tokens == 111
    assert usage.output_tokens == 22
    assert usage.cache_read_tokens == 5
    assert usage.cache_write_tokens == 7
    assert usage.provider == "anthropic" and usage.model == "claude-3-5-sonnet-20241022"


class _FakeAnthropicUsageNoCache:
    input_tokens = 50
    output_tokens = 10
    # cache_read_input_tokens and cache_creation_input_tokens intentionally
    # absent, mirrors a provider response that predates prompt caching (or an
    # uncached call) and doesn't report either field.


class _FakeAnthropicRespNoCache:
    content = [_FakeAnthropicContentBlock()]
    usage = _FakeAnthropicUsageNoCache()


class _FakeAnthropicNoCache:
    def __init__(self, api_key):
        self.messages = self

    async def create(self, **kw):
        return _FakeAnthropicRespNoCache()


async def test_call_llm_usage_anthropic_defaults_missing_cache_read_to_zero(monkeypatch):
    monkeypatch.setattr(llm_service, "AsyncAnthropic", _FakeAnthropicNoCache)
    text, usage = await llm_service.call_llm_usage(
        "anthropic", "claude-3-5-sonnet-20241022", "k", "sys", "user")
    assert text == "hello anthropic"
    assert usage.input_tokens == 50
    assert usage.output_tokens == 10
    assert usage.cache_read_tokens == 0
    assert usage.cache_write_tokens == 0
