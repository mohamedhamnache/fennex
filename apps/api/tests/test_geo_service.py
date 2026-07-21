import pytest
from unittest.mock import AsyncMock, patch
from app.services.geo_service import compute_geo_core
from app.services import geo_service as G

_RICH = (
    "# Best vegan protein\n\n"
    "The best vegan protein for runners is pea-rice blend at 25g per serving, taken within "
    "30 minutes post-run for recovery and steady daily intake across training weeks here.\n\n"
    "## What is the best option?\n\n"
    "According to a 2023 study, 80% of runners improved recovery. See [the report](https://example.com/report).\n\n"
    "- Pea protein\n- Rice protein\n- Hemp protein\n\n"
    "## FAQ\n\nShort answer here.\n"
)


def test_core_rewards_all_signals():
    score, b = compute_geo_core("Best vegan protein", _RICH, "meta")
    assert b["answer_up_top"] == 15
    assert b["qa_structure"] == 12
    assert b["extractable_format"] == 12
    assert b["statistics"] == 10
    assert b["citations"] == 11
    assert b["concise_paragraphs"] == 10
    assert score == 70.0


def test_core_zero_for_bare_content():
    score, b = compute_geo_core("T", "# T\n\nOne short line.", None)
    assert b["qa_structure"] == 0 and b["extractable_format"] == 0 and b["citations"] == 0
    assert score <= 25  # maybe answer/concise partials only


def test_core_never_exceeds_70():
    score, _ = compute_geo_core("T", _RICH * 3, "m")
    assert 0 <= score <= 70


async def test_judgment_parses_json():
    with patch("app.services.geo_service.call_llm",
               new=AsyncMock(return_value='{"score": 24, "feedback": "clear answer"}')):
        score, fb = await G.geo_llm_judgment("anthropic", "m", "k", "T", "body", "en")
    assert score == 24.0 and fb == "clear answer"


async def test_judgment_clamps_and_survives_bad_output():
    with patch("app.services.geo_service.call_llm", new=AsyncMock(return_value="not json")):
        assert await G.geo_llm_judgment("anthropic", "m", "k", "T", "b", "en") == (0.0, "")
    with patch("app.services.geo_service.call_llm", new=AsyncMock(return_value='{"score": 999}')):
        score, _ = await G.geo_llm_judgment("anthropic", "m", "k", "T", "b", "en")
    assert score == 30.0  # clamped to max


async def test_compute_geo_score_is_core_plus_judgment():
    with patch("app.services.geo_service.geo_llm_judgment", new=AsyncMock(return_value=(20.0, "ok"))):
        score, b = await G.compute_geo_score("anthropic", "m", "k", "Best vegan protein", _RICH, "meta", "en")
    assert score == 90.0 and b["llm_judgment"] == 20.0 and b["answer_up_top"] == 15


async def test_ensure_skips_repair_when_core_ok():
    calls = AsyncMock(return_value='{"score": 25, "feedback": "ok"}')  # only the judgment call
    with patch("app.services.geo_service.call_llm", new=calls):
        body, score, b = await G.ensure_geo_quality("anthropic", "m", "k", "Best vegan protein",
                                                     "vegan protein", _RICH, "meta", "en")
    assert body == _RICH and score == 95.0 and calls.call_count == 1  # judgment only, no repair


async def test_ensure_runs_one_repair_when_core_low():
    thin = "# T\n\nx."
    seq = AsyncMock(side_effect=["# T\n\nRepaired answer with structure.", '{"score": 10, "feedback": "better"}'])
    with patch("app.services.geo_service.call_llm", new=seq):
        body, score, b = await G.ensure_geo_quality("anthropic", "m", "k", "T", "kw", thin, "meta", "en")
    assert body == "# T\n\nRepaired answer with structure." and seq.call_count == 2  # repair + judgment


async def test_ensure_never_raises_on_repair_failure():
    thin = "# T\n\nx."
    async def boom(*a, **k):
        raise RuntimeError("provider down")
    with patch("app.services.geo_service.call_llm", new=boom):
        body, score, b = await G.ensure_geo_quality("anthropic", "m", "k", "T", "kw", thin, "meta", "en")
    assert body == thin and score >= 0  # original body kept, judgment degraded to 0
