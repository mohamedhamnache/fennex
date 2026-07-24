"""Fennex tools, exposed to a Strands agent.

Every tool an employee may call is built here from the Fennex toolbelt and
bound to one execution's context. Two boundaries are enforced at construction,
so the model cannot reach past them no matter what it decides to call:

    allowed_tools   the employee's own declaration -- previously advertising
                    only, since the legacy runner ran the skill's fixed list
                    and never consulted it. Under the agentic runtime it is
                    the actual ceiling.
    permissions     the toolbelt refuses any tool whose permission the run
                    was not granted.

A tool the employee did not declare is simply never handed to the model.
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Any, Callable

from app.employees import toolbelt

logger = logging.getLogger(__name__)

# Tools are described to the model in its own terms; the toolbelt's own label
# and description are used so a new integration needs no wording here.
_MAX_RESULT_CHARS = 6000


def _summarise(data: Any) -> str:
    """Render a tool result compactly enough to sit in a model context."""
    if data is None:
        return "No data."
    try:
        text = json.dumps(data, ensure_ascii=False, default=str)
    except Exception:
        text = str(data)
    if len(text) > _MAX_RESULT_CHARS:
        return text[:_MAX_RESULT_CHARS] + f"... [truncated, {len(text)} chars total]"
    return text


def build_tools(employee, ctx, *, on_call: Callable[[str, bool], None] | None = None) -> list:
    """The Strands tool list for this employee, in this run.

    `on_call(name, ok)` is invoked after each call so telemetry can count tool
    use without the tools themselves knowing about metrics.
    """
    from strands import tool

    built: list = []
    for name in employee.allowed_tools:
        spec = toolbelt.get_tool(name)
        if spec is None:
            logger.warning("employee %s declares unknown tool %s", employee.id, name)
            continue
        if spec.permission not in ctx.granted_permissions:
            # Declared but not granted for this run: do not even offer it.
            logger.info("tool %s withheld from %s: %s not granted",
                        name, employee.id, spec.permission)
            continue
        built.append(_make(spec, ctx, on_call))
    return built


def _make(spec, ctx, on_call):
    """Wrap one Fennex tool as a Strands tool bound to this context."""
    from strands import tool

    # Strands derives the tool name from the function name, which must be a
    # valid identifier -- Fennex tool names use dots ("shopify.products").
    safe_name = spec.name.replace(".", "_").replace("-", "_")
    description = (spec.description or spec.label or spec.name)[:900]

    @tool(name=safe_name, description=description)
    async def _run(query: str = "") -> str:
        """Execute the underlying Fennex tool and return its data as text."""
        async with _session_for(ctx) as db:
            result = await toolbelt.run(spec.name, ctx, db, {"query": query},
                                        granted=ctx.granted_permissions)
        if on_call:
            on_call(spec.name, result.ok)
        if result.denied:
            return f"Refused: {result.error}"
        if not result.ok:
            return f"Unavailable: {result.error}"
        return _summarise(result.data)

    return _run


@asynccontextmanager
async def _session_for(ctx):
    """A database session this tool call owns.

    The model decides which tools to call and the runtime may run several at
    once, so they cannot share the turn's session -- concurrent use of one
    AsyncSession raises, or worse, interleaves. Each call gets its own; if no
    factory is reachable we fall back to the shared session behind a lock.
    """
    try:
        from app.core.database import AsyncSessionLocal
    except Exception:
        AsyncSessionLocal = None   # noqa: N806

    if AsyncSessionLocal is not None:
        session = AsyncSessionLocal()
        try:
            yield session
        finally:
            await session.close()
        return

    lock = getattr(ctx, "_tool_lock", None)
    if lock is None:
        lock = asyncio.Lock()
        try:
            object.__setattr__(ctx, "_tool_lock", lock)
        except Exception:
            pass
    async with lock:
        yield ctx.db


def describe(employee, ctx) -> list[dict]:
    """What this employee may actually reach right now -- for the UI and logs."""
    out = []
    for name in employee.allowed_tools:
        spec = toolbelt.get_tool(name)
        if spec is None:
            out.append({"name": name, "available": False, "reason": "unknown tool"})
            continue
        granted = spec.permission in ctx.granted_permissions
        out.append({"name": name, "label": spec.label, "kind": spec.kind,
                    "app": spec.app, "permission": spec.permission,
                    "available": granted,
                    "reason": None if granted else f"{spec.permission} not granted"})
    return out
