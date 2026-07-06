"""Pure scoring + matching helpers for closed-loop recommendation tracking."""

METRIC_WEIGHTS = {"clicks": 0.45, "position": 0.25, "impressions": 0.20, "ctr": 0.10}
WON_THRESHOLD = 10.0
DECLINED_THRESHOLD = -10.0
MEASUREMENT_WINDOW_DAYS = 28

_STOPWORDS = {"the", "and", "for", "with", "you", "your", "how", "what", "best", "top"}


def _pct_delta(before: float, after: float) -> float:
    before = before or 0.0
    after = after or 0.0
    if before == 0:
        return 100.0 if after > 0 else 0.0
    return (after - before) / before * 100.0


def _position_improvement_pct(baseline_pos: float, latest_pos: float) -> float:
    # Lower position is better, so improvement = baseline - latest.
    if not baseline_pos:
        return 0.0
    return (baseline_pos - latest_pos) / baseline_pos * 100.0


def compute_impact(baseline: dict, latest: dict) -> tuple[float, str]:
    """Weighted multi-metric impact score and verdict from baseline vs latest metrics.
    Both dicts hold clicks, impressions, ctr, position."""
    clicks_d = _pct_delta(baseline.get("clicks"), latest.get("clicks"))
    impr_d = _pct_delta(baseline.get("impressions"), latest.get("impressions"))
    ctr_d = _pct_delta(baseline.get("ctr"), latest.get("ctr"))
    pos_d = _position_improvement_pct(baseline.get("position") or 0.0, latest.get("position") or 0.0)

    score = round(
        METRIC_WEIGHTS["clicks"] * clicks_d
        + METRIC_WEIGHTS["impressions"] * impr_d
        + METRIC_WEIGHTS["ctr"] * ctr_d
        + METRIC_WEIGHTS["position"] * pos_d,
        1,
    )
    if score > WON_THRESHOLD:
        verdict = "won"
    elif score < DECLINED_THRESHOLD:
        verdict = "declined"
    else:
        verdict = "flat"
    return score, verdict


def _tokens(text: str) -> set[str]:
    return {w for w in "".join(c.lower() if c.isalnum() else " " for c in text).split()
            if len(w) >= 4 and w not in _STOPWORDS}


def matches_query(anchor_query: str, text: str) -> bool:
    """True if the anchor query shares a meaningful token with the text."""
    if not anchor_query or not text:
        return False
    q = _tokens(anchor_query)
    if not q:
        return False
    return bool(q & _tokens(text))
