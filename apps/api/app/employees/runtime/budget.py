"""Hard ceilings on what a single employee turn may spend.

An agentic loop is open-ended by construction: the model decides when it has
done enough. That is the point of it, and also the risk -- a model that is
unsure will keep calling tools, and every round carries the whole transcript
back to the provider. Left alone, one confused turn can cost more than a day
of normal use.

Four independent limits, so no single failure mode can run away:

    turns          how many times the model may go round the tool loop
    total_tokens   the whole turn's token spend, in and out
    output_tokens  the reply length
    wall clock     a real-time deadline, which catches a hung provider or a
                   tool that never returns -- the token limits cannot

They are deliberately separate: token limits do nothing if a request hangs,
and a deadline does nothing against a fast, cheap, endless loop.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

logger = logging.getLogger(__name__)


def _env_int(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, ""))
        return value if value > 0 else default
    except (TypeError, ValueError):
        return default


# Defaults sized from measured runs: a heavy action with tool use has been
# observed at ~6,000 tokens over 3-4 tool calls, so these leave headroom
# without leaving room for a runaway.
MAX_TURNS = _env_int("AGENT_MAX_TURNS", 12)
MAX_TOTAL_TOKENS = _env_int("AGENT_MAX_TOTAL_TOKENS", 60_000)
MAX_OUTPUT_TOKENS = _env_int("AGENT_MAX_OUTPUT_TOKENS", 12_000)
TIMEOUT_SECONDS = _env_int("AGENT_TIMEOUT_SECONDS", 180)
# A conversational reply is short by design and should never need the loop a
# deep action does.
CHAT_TIMEOUT_SECONDS = _env_int("AGENT_CHAT_TIMEOUT_SECONDS", 90)
CHAT_MAX_TURNS = _env_int("AGENT_CHAT_MAX_TURNS", 6)


@dataclass(frozen=True)
class Budget:
    """What one turn is allowed to spend."""

    turns: int
    total_tokens: int
    output_tokens: int
    seconds: int

    def to_limits(self):
        """The Strands-side limits. Caps the loop and the spend."""
        from strands.types.agent import Limits

        return Limits(turns=self.turns, total_tokens=self.total_tokens,
                      output_tokens=self.output_tokens)

    def to_dict(self) -> dict:
        return {"turns": self.turns, "totalTokens": self.total_tokens,
                "outputTokens": self.output_tokens, "seconds": self.seconds}


def for_action(action, *, conversational: bool = False) -> Budget:
    """The budget for one action.

    A light action gets a smaller share than a heavy one: there is no reason
    for a keyword lookup to be allowed a deep researcher's spend.
    """
    if conversational:
        return Budget(turns=CHAT_MAX_TURNS,
                      total_tokens=MAX_TOTAL_TOKENS // 3,
                      output_tokens=min(MAX_OUTPUT_TOKENS, 2_000),
                      seconds=CHAT_TIMEOUT_SECONDS)

    heavy = getattr(action, "weight", "light") == "heavy"
    if heavy:
        return Budget(turns=MAX_TURNS, total_tokens=MAX_TOTAL_TOKENS,
                      output_tokens=MAX_OUTPUT_TOKENS, seconds=TIMEOUT_SECONDS)
    return Budget(turns=max(MAX_TURNS // 2, 3),
                  total_tokens=MAX_TOTAL_TOKENS // 2,
                  output_tokens=MAX_OUTPUT_TOKENS // 2,
                  seconds=max(TIMEOUT_SECONDS // 2, 45))


class BudgetExceeded(RuntimeError):
    """The turn hit a ceiling. Carries a message fit to show a user."""
