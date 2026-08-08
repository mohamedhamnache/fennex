"""Settling an A/B test.

WHY THERE IS A TEST HERE AT ALL. The tempting implementation is "whichever
variant has the higher rate wins". With 40 visitors and 3 conversions against 2,
that rule declares a 50% improvement, the merchant moves budget behind it, and
the difference was noise. Declaring a winner is the moment an experiment becomes
a spending decision, so the bar has to be a real one.

A two-proportion z-test, one-sided, at 95%. Not because it is sophisticated --
because it is the standard every ad platform and every optimisation tool already
uses, so a winner declared here means what a merchant expects it to mean.

Below the threshold there is NO winner. Not a provisional one, not a "leading"
one. `winner` stays null and the status stays "running", because a leading
variant shown in a winner-shaped slot gets acted on exactly like a settled one.
"""
from __future__ import annotations

import math

# 95% one-sided. A tighter bar makes most real ecommerce tests unsettleable at
# the volumes a small store sees; a looser one starts calling noise.
Z_95 = 1.645
CONFIDENCE_THRESHOLD = 0.95

# Under this many observations per side, no result is reported at all, whatever
# the arithmetic says. The z-test's normal approximation is not trustworthy on a
# handful of trials, and a "99% confident" verdict from 9 visitors is worse than
# no verdict.
MIN_TRIALS_PER_SIDE = 30


def _phi(z: float) -> float:
    """Standard normal CDF, via erf -- no scipy in this image."""
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def significance(a_wins: int, a_trials: int, b_wins: int, b_trials: int) -> tuple[str | None, float]:
    """(winner, confidence). Winner is None until the bar is cleared."""
    if a_trials < MIN_TRIALS_PER_SIDE or b_trials < MIN_TRIALS_PER_SIDE:
        return None, 0.0
    if a_wins > a_trials or b_wins > b_trials or a_wins < 0 or b_wins < 0:
        return None, 0.0

    p_a = a_wins / a_trials
    p_b = b_wins / b_trials
    pooled = (a_wins + b_wins) / (a_trials + b_trials)
    if pooled in (0.0, 1.0):
        # Every trial converted, or none did. There is no variance to test
        # against and no difference to detect.
        return None, 0.0

    se = math.sqrt(pooled * (1 - pooled) * (1 / a_trials + 1 / b_trials))
    if se == 0:
        return None, 0.0

    z = (p_b - p_a) / se
    confidence = _phi(abs(z))
    if confidence < CONFIDENCE_THRESHOLD:
        return None, round(confidence, 3)
    return ("B" if z > 0 else "A"), round(confidence, 3)


def settle(experiment) -> None:
    """Score an experiment in place from its recorded counts.

    Revenue impact is only estimated once a winner exists, and only from the
    values the merchant actually recorded -- never from a projection.
    """
    winner, confidence = significance(
        experiment.a_wins or 0, experiment.a_trials or 0,
        experiment.b_wins or 0, experiment.b_trials or 0)
    experiment.confidence = confidence
    experiment.winner = winner
    experiment.status = "settled" if winner else "running"

    if winner and experiment.a_value is not None and experiment.b_value is not None:
        best = max(float(experiment.a_value), float(experiment.b_value))
        worst = min(float(experiment.a_value), float(experiment.b_value))
        experiment.revenue_impact = round(best - worst, 2)
