"""Per-execution metrics.

Every agentic run records what it cost and how it behaved, so a slow or
expensive employee can be found without guesswork. Deliberately plain data --
it is attached to the Outcome and written into the execution log; exporting it
to OpenTelemetry later is a change here alone.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Execution:
    """One employee's turn on the runtime."""

    employee_id: str
    action_id: str
    provider: str = ""
    model_id: str = ""
    started_at: float = field(default_factory=time.monotonic)
    latency_ms: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    tool_calls: list[str] = field(default_factory=list)
    tool_failures: list[str] = field(default_factory=list)
    retries: int = 0
    ok: bool = False
    error: Optional[str] = None

    def record_tool(self, name: str, ok: bool) -> None:
        self.tool_calls.append(name)
        if not ok:
            self.tool_failures.append(name)

    def finish(self, *, ok: bool, error: Optional[str] = None) -> "Execution":
        self.latency_ms = int((time.monotonic() - self.started_at) * 1000)
        self.ok, self.error = ok, error
        return self

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def absorb_usage(self, result) -> None:
        """Pull token counts off a Strands result, whatever shape it uses.

        The SDK's metrics surface is not part of its stable contract, so this
        reads defensively: missing usage costs us a number, never the run.
        """
        try:
            metrics = getattr(result, "metrics", None)
            usage = getattr(metrics, "accumulated_usage", None) if metrics else None
            if isinstance(usage, dict):
                self.prompt_tokens = int(usage.get("inputTokens", 0) or 0)
                self.completion_tokens = int(usage.get("outputTokens", 0) or 0)
            elif usage is not None:
                self.prompt_tokens = int(getattr(usage, "inputTokens", 0) or 0)
                self.completion_tokens = int(getattr(usage, "outputTokens", 0) or 0)
        except Exception:
            pass

    def to_dict(self) -> dict:
        return {
            "employeeId": self.employee_id, "actionId": self.action_id,
            "provider": self.provider, "model": self.model_id,
            "latencyMs": self.latency_ms,
            "promptTokens": self.prompt_tokens,
            "completionTokens": self.completion_tokens,
            "totalTokens": self.total_tokens,
            "toolCalls": list(self.tool_calls),
            "toolFailures": list(self.tool_failures),
            "retries": self.retries, "ok": self.ok, "error": self.error,
        }
