"""Behavioural coverage for knowledge_service's digest generation -- the one
production call site this branch wires to the cheap-first cascade
(app.services.agents.cascade.call_with_cascade).

These tests monkeypatch only the network boundary (cascade.call_llm, the same
seam test_cascade.py itself patches) and drive the real entrypoint
(refresh_digest) so a future change that quietly stops calling the cascade, or
starts accepting a malformed reply, fails here instead of only in a source
grep.
"""
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services import knowledge_service
from app.services.agents import cascade


class _FakeDB:
    def __init__(self, project):
        self._project = project

    async def get(self, model, id_):
        return self._project

    async def commit(self):
        pass


def _project():
    return SimpleNamespace(locale="en", knowledge_digest=None)


def _docs():
    return [SimpleNamespace(title="Brand doc", body="Our tone is direct and we never use emoji. " * 5)]


@pytest.fixture
def spy(monkeypatch):
    """Returns (calls, replies), mirroring test_cascade.py's fixture: push
    canned replies, each fake call_llm pops the next one and records the
    model it was asked to run."""
    calls: list[dict] = []
    replies: list[str] = []

    async def fake_call_llm(provider, model, api_key, system_prompt, user_prompt,
                            locale="en", max_tokens=None, meter=None, feature=None):
        calls.append({"provider": provider, "model": model, "feature": feature})
        return replies.pop(0)

    monkeypatch.setattr(cascade, "call_llm", fake_call_llm)
    return calls, replies


async def test_refresh_digest_escalates_past_a_malformed_cheap_reply(spy, monkeypatch):
    """The cheap model replies with a fenced JSON blob instead of the plain
    prose the prompt demands -- exactly the format failure _plain_prose
    rejects downstream -- so the cascade must escalate one band rather than
    handing the caller a digest it would otherwise discard."""
    calls, replies = spy
    replies.extend(['```json\n{"summary": "nope"}\n```',
                    "This project sells vegan protein bars for endurance athletes."])
    monkeypatch.setattr(knowledge_service, "list_documents", AsyncMock(return_value=_docs()))

    digest = await knowledge_service.refresh_digest(
        uuid.uuid4(), uuid.uuid4(), {"openai": "k"}, _FakeDB(_project()))

    assert [c["model"] for c in calls] == ["gpt-4o-mini", "gpt-4o"]
    assert all(c["feature"] == "document_digest" for c in calls)
    assert digest == "This project sells vegan protein bars for endurance athletes."


async def test_refresh_digest_does_not_escalate_a_good_cheap_reply(spy, monkeypatch):
    """A cheap reply that is already plain prose is accepted as-is -- the
    cascade must not spend a second call on a response that already passes."""
    calls, replies = spy
    replies.append("This project sells vegan protein bars for endurance athletes.")
    monkeypatch.setattr(knowledge_service, "list_documents", AsyncMock(return_value=_docs()))

    digest = await knowledge_service.refresh_digest(
        uuid.uuid4(), uuid.uuid4(), {"openai": "k"}, _FakeDB(_project()))

    assert [c["model"] for c in calls] == ["gpt-4o-mini"]
    assert digest == "This project sells vegan protein bars for endurance athletes."


async def test_refresh_digest_falls_back_to_the_listing_when_both_attempts_fail(spy, monkeypatch):
    """A cascade never raises on validation failure: both attempts can still
    come back structural, and the caller's own parsing (here, _plain_prose)
    must fall back to the deterministic listing exactly as it did before the
    cascade existed."""
    calls, replies = spy
    replies.extend(['{"still": "json"}', '{"still": "json"}'])
    monkeypatch.setattr(knowledge_service, "list_documents", AsyncMock(return_value=_docs()))

    digest = await knowledge_service.refresh_digest(
        uuid.uuid4(), uuid.uuid4(), {"openai": "k"}, _FakeDB(_project()))

    assert len(calls) == 2
    assert digest.startswith("1 document(s) on file: Brand doc.")
