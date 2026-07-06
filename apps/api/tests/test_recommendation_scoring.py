from app.services.recommendation_scoring import compute_impact, matches_query, MEASUREMENT_WINDOW_DAYS


def test_window_constant():
    assert MEASUREMENT_WINDOW_DAYS == 28


def test_clicks_growth_scores_won():
    base = {"clicks": 40, "impressions": 1000, "ctr": 0.04, "position": 8.0}
    latest = {"clicks": 182, "impressions": 2200, "ctr": 0.083, "position": 4.0}
    score, verdict = compute_impact(base, latest)
    assert verdict == "won"
    assert score > 10


def test_flat_when_unchanged():
    base = {"clicks": 100, "impressions": 2000, "ctr": 0.05, "position": 5.0}
    score, verdict = compute_impact(base, dict(base))
    assert verdict == "flat"
    assert -10 <= score <= 10


def test_decline_scores_declined():
    base = {"clicks": 200, "impressions": 3000, "ctr": 0.066, "position": 4.0}
    latest = {"clicks": 60, "impressions": 1500, "ctr": 0.04, "position": 9.0}
    score, verdict = compute_impact(base, latest)
    assert verdict == "declined"
    assert score < -10


def test_position_improvement_is_positive():
    # only position improves (8 -> 4), everything else equal
    base = {"clicks": 100, "impressions": 2000, "ctr": 0.05, "position": 8.0}
    latest = {"clicks": 100, "impressions": 2000, "ctr": 0.05, "position": 4.0}
    score, _ = compute_impact(base, latest)
    assert score > 0


def test_zero_baseline_clicks_no_crash():
    base = {"clicks": 0, "impressions": 0, "ctr": 0.0, "position": 0.0}
    latest = {"clicks": 5, "impressions": 100, "ctr": 0.05, "position": 6.0}
    score, verdict = compute_impact(base, latest)
    assert isinstance(score, float)


def test_matches_query_token_overlap():
    assert matches_query("olive oil benefits", "10 Olive Oil Benefits You Should Know") is True
    assert matches_query("olive oil benefits", "A guide to sourdough bread") is False
