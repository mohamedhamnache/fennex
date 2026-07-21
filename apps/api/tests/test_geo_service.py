from app.services.geo_service import compute_geo_core

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
