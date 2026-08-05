"""Streamed LLM calls must be metered exactly like unstreamed ones.

They were not. `stream_llm` made real Anthropic/OpenAI/Google calls and
recorded nothing, and it is the path Article Studio, the writing service and
the employee chat all take -- so the busiest LLM surfaces in the product were
billing the customer nothing while the supplier billed us.
"""
import uuid

import pytest

from app.core import metering_context
from app.services import llm_service

pytestmark = pytest.mark.asyncio


@pytest.fixture
def metered(monkeypatch):
    """Capture what reaches record_llm, without a database."""
    calls: list[dict] = []

    async def fake_record_llm(db, *, org_id, project_id, usage, feature=None):
        calls.append({"org_id": org_id, "usage": usage, "feature": feature})
        return 0

    from app.services.metering import meter as real_meter
    monkeypatch.setattr(real_meter, "record_llm", fake_record_llm)

    class _FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    import app.core.database as database
    monkeypatch.setattr(database, "AsyncSessionLocal", lambda: _FakeSession(), raising=False)
    return calls


# --------------------------------------------------------------------------
# Anthropic
# --------------------------------------------------------------------------

class _Usage:
    def __init__(self, i, o, cr=0, cw=0):
        self.input_tokens = i
        self.output_tokens = o
        self.cache_read_input_tokens = cr
        self.cache_creation_input_tokens = cw


class _Snapshot:
    def __init__(self, usage):
        self.usage = usage


class _FakeAnthropicStream:
    """Mimics the SDK's async context-managed message stream."""

    def __init__(self, chunks, usage):
        self._chunks = chunks
        self.current_message_snapshot = _Snapshot(usage)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    @property
    def text_stream(self):
        async def gen():
            for c in self._chunks:
                yield c
        return gen()


def _patch_anthropic(monkeypatch, chunks, usage):
    stream_obj = _FakeAnthropicStream(chunks, usage)

    class _Messages:
        def stream(self, **kwargs):
            return stream_obj

    class _Client:
        def __init__(self, api_key=None):
            self.messages = _Messages()

    monkeypatch.setattr(llm_service, "AsyncAnthropic", _Client)
    return stream_obj


async def test_anthropic_stream_is_metered_against_the_ambient_org(monkeypatch, metered):
    _patch_anthropic(monkeypatch, ["Hello ", "world"], _Usage(120, 45, cr=10, cw=5))
    org = uuid.uuid4()
    metering_context.set_metering_org(org)

    out = [c async for c in llm_service.stream_llm(
        "anthropic", "claude-haiku-4-5-20251001", "k", "sys", "usr", feature="article_draft")]

    assert "".join(out) == "Hello world"
    assert len(metered) == 1, "a streamed call must produce exactly one usage event"
    assert metered[0]["org_id"] == org
    assert metered[0]["feature"] == "article_draft"
    u = metered[0]["usage"]
    assert (u.input_tokens, u.output_tokens) == (120, 45)
    assert (u.cache_read_tokens, u.cache_write_tokens) == (10, 5)


async def test_an_abandoned_stream_still_bills_what_it_consumed(monkeypatch, metered):
    """The caller is an HTTP response the user can navigate away from.

    An interrupted stream has still spent the supplier's tokens, so metering
    only complete streams would make exactly the interrupted ones free -- and
    would quietly reward abandoning them.
    """
    _patch_anthropic(monkeypatch, ["one ", "two ", "three"], _Usage(200, 12))
    metering_context.set_metering_org(uuid.uuid4())

    agen = llm_service.stream_llm("anthropic", "claude-haiku-4-5-20251001", "k", "s", "u")
    assert await agen.__anext__() == "one "
    await agen.aclose()  # the client goes away mid-stream

    assert len(metered) == 1, "an abandoned stream must still be metered"
    assert metered[0]["usage"].input_tokens == 200


# --------------------------------------------------------------------------
# OpenAI
# --------------------------------------------------------------------------

class _Delta:
    def __init__(self, content):
        self.content = content


class _Choice:
    def __init__(self, content):
        self.delta = _Delta(content)


class _OAChunk:
    def __init__(self, content=None, usage=None):
        self.choices = [_Choice(content)] if content is not None else []
        self.usage = usage


class _OAUsage:
    def __init__(self, p, c, cached=0):
        self.prompt_tokens = p
        self.completion_tokens = c
        self.prompt_tokens_details = type("D", (), {"cached_tokens": cached})()


def _patch_openai(monkeypatch, chunks, captured):
    class _Completions:
        async def create(self, **kwargs):
            captured.update(kwargs)

            async def gen():
                for c in chunks:
                    yield c
            return gen()

    class _Client:
        def __init__(self, api_key=None):
            self.chat = type("C", (), {"completions": _Completions()})()

    monkeypatch.setattr(llm_service, "AsyncOpenAI", _Client)


async def test_openai_stream_requests_usage_and_meters_it(monkeypatch, metered):
    captured: dict = {}
    _patch_openai(monkeypatch, [
        _OAChunk("Hi"), _OAChunk(" there"),
        _OAChunk(usage=_OAUsage(300, 20, cached=80)),  # final, choice-less
    ], captured)
    metering_context.set_metering_org(uuid.uuid4())

    out = [c async for c in llm_service.stream_llm("openai", "gpt-4o-mini", "k", "s", "u")]

    assert "".join(out) == "Hi there"
    # Without include_usage OpenAI sends no token counts on a stream at all,
    # so the request itself is what makes this meterable.
    assert captured.get("stream_options") == {"include_usage": True}
    assert len(metered) == 1
    u = metered[0]["usage"]
    assert (u.input_tokens, u.output_tokens, u.cache_read_tokens) == (300, 20, 80)


async def test_the_usage_free_final_chunk_is_not_emitted_as_text(monkeypatch, metered):
    """The usage chunk carries no choices; treating it as content would append
    a stray empty piece to the user's article."""
    captured: dict = {}
    _patch_openai(monkeypatch, [_OAChunk("body"), _OAChunk(usage=_OAUsage(10, 2))], captured)
    metering_context.set_metering_org(uuid.uuid4())
    out = [c async for c in llm_service.stream_llm("openai", "gpt-4o-mini", "k", "s", "u")]
    assert out == ["body"]


# --------------------------------------------------------------------------
# Google
# --------------------------------------------------------------------------

async def test_google_stream_is_metered_too(monkeypatch, metered):
    """Google yields once rather than streaming tokens. It must still bill --
    otherwise it is the one provider that streams for free."""
    async def fake_google_usage(model, api_key, system_prompt, user_prompt):
        return "answer", llm_service.LLMUsage("google", model, input_tokens=50, output_tokens=8)

    monkeypatch.setattr(llm_service, "_google_usage", fake_google_usage)
    metering_context.set_metering_org(uuid.uuid4())

    out = [c async for c in llm_service.stream_llm("google", "gemini-2.0-flash", "k", "s", "u")]
    assert out == ["answer"]
    assert len(metered) == 1
    assert metered[0]["usage"].input_tokens == 50


async def test_metering_failure_never_breaks_the_stream(monkeypatch, metered, caplog):
    """Best-effort, exactly like call_llm: a billing problem must not cost the
    user the article they are watching being written."""
    async def boom(*a, **k):
        raise RuntimeError("meter down")

    from app.services.metering import meter as real_meter
    monkeypatch.setattr(real_meter, "record_llm", boom)
    _patch_anthropic(monkeypatch, ["still ", "fine"], _Usage(10, 2))
    metering_context.set_metering_org(uuid.uuid4())

    out = [c async for c in llm_service.stream_llm("anthropic", "m", "k", "s", "u")]
    assert "".join(out) == "still fine"


# --------------------------------------------------------------------------
# Embeddings
# --------------------------------------------------------------------------

async def test_knowledge_embeddings_are_metered(monkeypatch, metered):
    """Knowledge ingest embeds every chunk of every uploaded document.

    It was the one remaining provider path that bypassed metering entirely, so
    ingesting a large document billed the supplier and charged the customer
    nothing.
    """
    from app.services import knowledge_service

    class _Resp:
        data = [type("D", (), {"embedding": [0.1, 0.2]})()]
        usage = type("U", (), {"prompt_tokens": 4321})()

    class _Client:
        def __init__(self, api_key=None):
            self.embeddings = type("E", (), {"create": lambda _s, **kw: _mk(_Resp())})()

    async def _mk(v):
        return v

    monkeypatch.setattr("openai.AsyncOpenAI", _Client)
    org = uuid.uuid4()
    metering_context.set_metering_org(org)

    out = await knowledge_service.embed(["some text"], {"openai": "key"})

    assert out == [[0.1, 0.2]]
    assert len(metered) == 1, "an embeddings call must produce a usage event"
    assert metered[0]["org_id"] == org
    assert metered[0]["feature"] == "knowledge_embed"
    assert metered[0]["usage"].input_tokens == 4321
    assert metered[0]["usage"].model == knowledge_service.EMBED_MODEL
