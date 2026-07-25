"""Tests for onboarding AI suggest: the suggest service parsing/fallbacks and
the POST /onboarding/suggest endpoint. Reuses the router test's SQLite/dep-
override harness so no test touches Redis, real LLMs, or Postgres."""
import uuid

import pytest

from app.services.discovery import suggest as suggest_service
from app.services import discovery_service

# Reuse the router test's fixtures (client, setup_db, seeding, org ids).
from tests.test_onboarding_router import (  # noqa: F401
    client,
    setup_db,
    _seed_run,
    FAKE_ORG_ID,
)


# -- parse_list ----------------------------------------------------------------

def test_parse_list_bare_array_goals():
    raw = '["Grow organic traffic", "  ", "Launch a newsletter"]'
    assert suggest_service.parse_list(raw, "goals") == [
        "Grow organic traffic", "Launch a newsletter"
    ]


def test_parse_list_object_wrapped_and_fenced_audience():
    raw = 'Sure!\n```json\n{"audience": [{"label": "Busy parents"}, {"nope": 1}]}\n```'
    out = suggest_service.parse_list(raw, "audience")
    assert out == [{"label": "Busy parents"}]


def test_parse_list_competitors_requires_name_or_url():
    raw = '[{"name": "Rival"}, {"url": "https://x.test"}, {"note": "no id"}]'
    out = suggest_service.parse_list(raw, "competitors")
    assert {"name": "Rival"} in out
    assert {"url": "https://x.test"} in out
    assert len(out) == 2


def test_parse_list_malformed_returns_empty():
    assert suggest_service.parse_list("not json", "goals") == []
    assert suggest_service.parse_list("", "audience") == []


# -- suggest() -----------------------------------------------------------------

async def test_suggest_returns_empty_without_key():
    out = await suggest_service.suggest({"business": {"name": "Acme"}}, "goals",
                                        provider="anthropic", model="m", api_key=None)
    assert out == []


async def test_suggest_returns_empty_when_llm_raises(monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("llm down")

    monkeypatch.setattr(suggest_service, "call_llm", boom)
    out = await suggest_service.suggest({"business": {"name": "Acme"}}, "goals",
                                        provider="anthropic", model="m", api_key="k")
    assert out == []


async def test_suggest_parses_llm_output(monkeypatch):
    async def fake_llm(*a, **k):
        return '["Rank for recipe keywords", "Grow Pinterest"]'

    monkeypatch.setattr(suggest_service, "call_llm", fake_llm)
    out = await suggest_service.suggest({"business": {"name": "Acme"}}, "goals",
                                        provider="anthropic", model="m", api_key="k")
    assert out == ["Rank for recipe keywords", "Grow Pinterest"]


# -- endpoint ------------------------------------------------------------------

async def test_suggest_endpoint_invalid_field(client):
    run_id = await _seed_run(FAKE_ORG_ID)
    resp = await client.post("/api/v1/onboarding/suggest",
                             json={"run_id": str(run_id), "field": "bananas"})
    assert resp.status_code == 422


async def test_suggest_endpoint_no_llm_key_returns_empty(client, monkeypatch):
    async def no_model(*a, **k):
        return None, None, None

    monkeypatch.setattr(discovery_service, "_org_model", no_model)
    run_id = await _seed_run(FAKE_ORG_ID, result={"business": {"name": "Acme"}})
    resp = await client.post("/api/v1/onboarding/suggest",
                             json={"run_id": str(run_id), "field": "audience"})
    assert resp.status_code == 200
    assert resp.json() == {"suggestions": []}
