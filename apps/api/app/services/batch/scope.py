"""Batch mode as an async-context flag.

Scheduled work opts in by wrapping its body in batch_scope(); every call_llm
underneath it routes to the 50%-off Batch API without a single service
signature changing. User-triggered runs of the same code path simply never
enter the scope, so they keep their interactive latency.
"""
from contextlib import contextmanager
from contextvars import ContextVar

_batch_mode: ContextVar[bool] = ContextVar("fennex_batch_mode", default=False)


def batch_enabled() -> bool:
    return _batch_mode.get()


@contextmanager
def batch_scope():
    token = _batch_mode.set(True)
    try:
        yield
    finally:
        _batch_mode.reset(token)
