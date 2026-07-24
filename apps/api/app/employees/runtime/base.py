"""BaseEmployee -- the Fennex employee, executed on the Strands runtime.

The employee wraps Strands; Strands never wraps the employee. Identity, Brand
DNA, memory, permissions and knowledge are assembled by Fennex and handed to
the runtime as instructions and tools. The runtime's only job is the agentic
loop: let the model choose tools, call them, iterate, answer.

Every employee gets this behaviour by declaring data. A roster file overrides a
hook only when the default cannot express what it needs.
"""

from __future__ import annotations

import logging
from typing import Any, AsyncIterator, Optional

from app.employees.runtime import models as model_provider
from app.employees.runtime import toolbridge
from app.employees.runtime.telemetry import Execution
from app.employees.spec import Outcome

logger = logging.getLogger(__name__)

MAX_RETRIES = 2


class BaseEmployee:
    """Runtime wrapper around a declarative Employee.

    Construction is cheap and stateless -- one is made per execution, so an
    employee never carries context between conversations.
    """

    def __init__(self, employee):
        self.employee = employee

    # -- identity ------------------------------------------------------------

    @property
    def id(self) -> str:
        return self.employee.id

    def instructions(self, ctx, action, *, visual: bool = False) -> str:
        """The full system prompt: who they are, the brand, what they know.

        Assembled by Fennex, not Strands, so every employee gets an identical
        and auditable context envelope regardless of runtime.
        """
        blocks = [ctx.system_preamble(self.employee, visual=visual)]

        if action is not None:
            outputs = ", ".join(action.outputs) or "the result"
            blocks.append(
                f"YOUR TASK: {action.label} -- {action.description}\n"
                f"It must produce: {outputs}.")

        if self.employee.allowed_tools:
            blocks.append(
                "You have tools. Use them to ground your work in this project's real data "
                "before you assert anything. Never invent a number a tool could have told "
                "you. If a tool is unavailable, say so plainly and work from what you have.")

        blocks.append(
            "Do not describe how the work could be done -- do it. Return the finished "
            "output only, with no preamble about your process.")
        return "\n\n".join(b for b in blocks if b)

    # -- knowledge -----------------------------------------------------------

    async def load_context(self, ctx) -> None:
        """Memory and knowledge, loaded before the model sees anything.

        Brand DNA is already on the context; this pulls what is specific to
        this employee so it never has to ask for something the company knows.
        """
        await ctx.load_memory(self.employee)

    # -- execution -----------------------------------------------------------

    async def execute(self, action, task, ctx) -> Outcome:
        """Run one action on the Strands runtime, with retry and telemetry."""
        from strands import Agent

        metrics = Execution(employee_id=self.employee.id, action_id=action.id)
        try:
            model, choice = model_provider.for_action(
                ctx.tier, action.weight, ctx.keys)
        except model_provider.ModelUnavailable as exc:
            return Outcome(ok=False, error=str(exc), employee_id=self.employee.id,
                           action_id=action.id)
        metrics.provider, metrics.model_id = choice.provider, choice.model_id

        await self.load_context(ctx)
        visual = any(c.startswith("image.") for c in action.capabilities)
        tools = toolbridge.build_tools(self.employee, ctx, on_call=metrics.record_tool)

        prompt = self.build_prompt(action, task, ctx)
        last_error: Optional[str] = None

        for attempt in range(MAX_RETRIES + 1):
            metrics.retries = attempt
            try:
                agent = Agent(
                    model=model,
                    tools=tools,
                    system_prompt=self.instructions(ctx, action, visual=visual),
                    name=self.employee.name,
                    agent_id=self.employee.id,
                    description=self.employee.role,
                )
                result = await agent.invoke_async(prompt)
                metrics.absorb_usage(result)
                text = _text_of(result)
                if not text.strip():
                    last_error = "The employee returned nothing."
                    continue

                outcome = await self.persist(text, action, task, ctx)
                outcome.employee_id, outcome.action_id = self.employee.id, action.id
                outcome.cost = metrics.finish(ok=outcome.ok, error=outcome.error).to_dict()
                if outcome.ok:
                    return outcome
                last_error = outcome.error
            except Exception as exc:   # noqa: BLE001
                logger.exception("agentic execution failed: %s.%s",
                                 self.employee.id, action.id)
                last_error = str(exc)
                # Reflection: tell the next attempt what went wrong.
                prompt = (f"{prompt}\n\nYour previous attempt failed with: {last_error}. "
                          f"Correct it and return the finished output.")

        return Outcome(ok=False, error=last_error or "The employee could not complete this.",
                       employee_id=self.employee.id, action_id=action.id,
                       cost=metrics.finish(ok=False, error=last_error).to_dict())

    async def stream(self, action, task, ctx) -> AsyncIterator[dict]:
        """Stream a turn: text deltas and tool-use notices as they happen."""
        from strands import Agent

        metrics = Execution(employee_id=self.employee.id, action_id=action.id)
        try:
            model, choice = model_provider.for_action(ctx.tier, action.weight, ctx.keys)
        except model_provider.ModelUnavailable as exc:
            yield {"type": "error", "message": str(exc)}
            return
        metrics.provider, metrics.model_id = choice.provider, choice.model_id

        await self.load_context(ctx)
        visual = any(c.startswith("image.") for c in action.capabilities)
        tools = toolbridge.build_tools(self.employee, ctx, on_call=metrics.record_tool)

        agent = Agent(
            model=model, tools=tools,
            system_prompt=self.instructions(ctx, action, visual=visual),
            name=self.employee.name, agent_id=self.employee.id,
            description=self.employee.role)

        try:
            async for event in agent.stream_async(self.build_prompt(action, task, ctx)):
                delta = _delta_of(event)
                if delta:
                    yield {"type": "delta", "employeeId": self.employee.id, "text": delta}
                used = _tool_of(event)
                if used:
                    yield {"type": "tool", "employeeId": self.employee.id, "tool": used}
        except Exception as exc:   # noqa: BLE001
            logger.exception("agentic stream failed: %s", self.employee.id)
            yield {"type": "error", "employeeId": self.employee.id, "message": str(exc)}
            return
        yield {"type": "telemetry", "metrics": metrics.finish(ok=True).to_dict()}

    # -- overridable hooks ---------------------------------------------------

    def build_prompt(self, action, task, ctx) -> str:
        """The user-side prompt. Overridden when an action needs a shape."""
        lines = [f"REQUEST: {task.goal or ctx.goal}"]
        inputs = {k: v for k, v in (task.inputs or {}).items()
                  if v and k not in ("feedback", "upstream_artifacts")}
        if inputs:
            rendered = "\n".join(f"- {k}: {str(v)[:400]}" for k, v in inputs.items())
            lines.append(f"WHAT IS ALREADY SETTLED (use it, do not ask again):\n{rendered}")
        if (task.inputs or {}).get("upstream"):
            lines.append(f"PREVIOUS STEP PRODUCED:\n{task.inputs['upstream']}")
        if (task.inputs or {}).get("feedback"):
            lines.append(f"REVIEWER FEEDBACK TO ADDRESS:\n{task.inputs['feedback']}")
        return "\n\n".join(lines)

    async def persist(self, text: str, action, task, ctx) -> Outcome:
        """Turn the model's output into a saved artifact.

        The default keeps the answer as conversation. Actions that produce a
        record (an article, an image) reuse the existing persist hook from the
        skill catalog, so the migration inherits working business logic rather
        than reimplementing it.
        """
        if action.skill_key:
            saved = await self._persist_via_skill(text, action, task, ctx)
            if saved is not None:
                return saved
        return Outcome(ok=True, summary=text[:400], content=text)

    async def _persist_via_skill(self, text: str, action, task, ctx) -> Optional[Outcome]:
        from app.services.agents.registry import get_skill

        skill = get_skill(action.skill_key)
        if skill is None or skill.persist is None:
            return None
        content = text
        if skill.parse is not None:
            try:
                parsed = skill.parse(text)
                if parsed is not None:
                    content = parsed
            except Exception:
                logger.warning("skill %s could not parse agentic output", action.skill_key)
        try:
            ctx.runtime = {**(ctx.runtime or {}), "inputs": dict(task.inputs or {})}
            result = await skill.persist(content, ctx.runtime.get("campaign"), ctx, ctx.db)
            return Outcome.from_agent_result(result, self.employee.id, action.id)
        except Exception as exc:   # noqa: BLE001
            logger.exception("persist failed for %s", action.skill_key)
            return Outcome(ok=False, error=str(exc))

    async def health(self, ctx) -> dict:
        """Can this employee run on the runtime right now?"""
        checks = {
            "providers": ctx.available_providers(),
            "tools": toolbridge.describe(self.employee, ctx),
            "actions": len(self.employee.actions),
        }
        ok = bool(ctx.available_providers()) and bool(self.employee.actions)
        return {"ok": ok, "checks": checks}


# --- result shapes ------------------------------------------------------------
# The SDK's event and result shapes are not a stable contract, so these read
# defensively and degrade to empty rather than raising mid-turn.


def _text_of(result: Any) -> str:
    if result is None:
        return ""
    for attr in ("message", "output", "content"):
        value = getattr(result, attr, None)
        if isinstance(value, str) and value.strip():
            return value
    return str(result)


def _delta_of(event: Any) -> str:
    if isinstance(event, dict):
        if isinstance(event.get("data"), str):
            return event["data"]
        delta = event.get("delta")
        if isinstance(delta, dict) and isinstance(delta.get("text"), str):
            return delta["text"]
    return ""


def _tool_of(event: Any) -> Optional[str]:
    if isinstance(event, dict):
        use = event.get("current_tool_use") or event.get("tool_use")
        if isinstance(use, dict) and use.get("name"):
            return str(use["name"])
    return None
