"""The Strands boundary.

This package is the ONLY place in Fennex that imports `strands`. Everything
above it -- the Router, the Employee Registry, Brand DNA, memory, approvals,
orchestration -- is Fennex's own architecture and must stay independent of the
runtime that happens to execute a turn.

    Fennex
      |- Router               (custom, never imports strands)
      |- Employee Registry    (custom)
      |- Employees            (declarative contracts)
      `- runtime/             <- the only strands-aware layer
           |- models.py       provider abstraction
           |- toolbridge.py   Fennex tools -> Strands tools, permission-gated
           |- telemetry.py    per-execution metrics
           `- base.py         BaseEmployee: wraps a Strands Agent

If Strands is ever replaced, only this package changes.
"""
