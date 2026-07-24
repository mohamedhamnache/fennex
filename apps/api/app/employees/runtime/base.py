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

    def instructions(self, ctx, action, task=None, *, visual: bool = False) -> str:
        """The full system prompt: identity, brand, memory, and the craft.

        The skill's own system prompt is inherited verbatim. That is where the
        output contract lives -- the JSON shape, the word count, the structure
        -- and discarding it is how an agentic run ends up returning prose
        where the caller expected a parsed object.
        """
        blocks = [ctx.system_preamble(self.employee, visual=visual)]

        skill_system = self._skill_prompts(action, task, ctx)[0]
        if skill_system:
            blocks.append(skill_system)
        elif action is not None:
            outputs = ", ".join(action.outputs) or "the result"
            blocks.append(
                f"YOUR TASK: {action.label} -- {action.description}\n"
                f"It must produce: {outputs}.")

        if self.employee.allowed_tools:
            blocks.append(
                "You have tools. Use them to ground your work in this project's real data "
                "before you assert anything. Never invent a number a tool could have told "
                "you. If a tool is unavailable, say so plainly and work from what you have. "
                "When you have gathered enough, produce the final output in exactly the "
                "format required above -- tool results are your evidence, not your answer.")

        blocks.append(
            "Do not describe how the work could be done -- do it. Return the finished "
            "output only, with no preamble about your process.")
        return "\n\n".join(b for b in blocks if b)

    def _skill_prompts(self, action, task, ctx) -> tuple[str, str]:
        """The bound skill's (system, user) prompts, or ("", "").

        Reusing them is the point of the migration: the domain prompt work is
        proven, and Strands only adds the tool loop on top of it. Tools run
        live now, so the skill receives an empty pre-fetched tool payload.
        """
        if action is None or not action.skill_key:
            return "", ""
        from app.services.agents.registry import get_skill

        skill = get_skill(action.skill_key)
        if skill is None or skill.build_prompt is None:
            return "", ""
        try:
            inputs = dict((task.inputs if task else None) or {})
            return skill.build_prompt(ctx, inputs, {})
        except Exception:
            logger.warning("could not reuse skill prompts for %s", action.skill_key)
            return "", ""

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
                    system_prompt=self.instructions(ctx, action, task, visual=visual),
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
            system_prompt=self.instructions(ctx, action, task, visual=visual),
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
        """The user-side prompt.

        The skill's own user prompt is inherited when present -- it carries the
        brief, the word count and the shape the caller expects.
        """
        skill_user = self._skill_prompts(action, task, ctx)[1]
        if skill_user:
            # Append rather than replace: a skill builds its prompt from the
            # goal and may ignore `inputs` entirely, which would silently drop
            # the title and keyword the conversation already agreed.
            settled = self._settled_block(task)
            return f"{skill_user}\n\n{settled}" if settled else skill_user

        lines = [f"REQUEST: {task.goal or ctx.goal}"]
        settled = self._settled_block(task)
        if settled:
            lines.append(settled)
        return "\n\n".join(lines)

    def _settled_block(self, task) -> str:
        """What the conversation already decided, so nothing is re-asked."""
        if task is None:
            return ""
        inputs = task.inputs or {}
        parts = []
        facts = {k: v for k, v in inputs.items()
                 if v and k not in ("feedback", "upstream", "upstream_artifacts")}
        if facts:
            rendered = "\n".join(f"- {k}: {str(v)[:400]}" for k, v in facts.items())
            parts.append(f"WHAT IS ALREADY SETTLED (use it, do not ask again):\n{rendered}")
        if inputs.get("upstream"):
            parts.append(f"PREVIOUS STEP PRODUCED:\n{str(inputs['upstream'])[:1500]}")
        if inputs.get("feedback"):
            parts.append(f"REVIEWER FEEDBACK TO ADDRESS:\n{inputs['feedback']}")
        return "\n\n".join(parts)

    async def persist(self, text: str, action, task, ctx) -> Outcome:
        """Turn the model's output into a saved artifact or structured result.

        Three shapes, in order:
          1. the skill has a persist hook -- reuse it, so the migration
             inherits working business logic rather than reimplementing it
          2. the skill returns JSON -- parse it into `structured` so the next
             specialist inherits the angle, keyword and rationale rather than
             a wall of prose
          3. otherwise the answer is the result
        """
        if action.skill_key:
            saved = await self._persist_via_skill(text, action, task, ctx)
            if saved is not None:
                return saved
            structured = self._structured_from(text, action)
            if structured is not None:
                return Outcome(ok=True, summary=_summarise_structured(structured),
                               content=structured, structured=structured)
        return Outcome(ok=True, summary=text[:400], content=text)

    def _structured_from(self, text: str, action) -> Optional[dict]:
        """Parse a JSON-shaped skill's output into a dict, or None.

        An agent that has been reasoning out loud often wraps its JSON in
        commentary, so the skill's own parser is tried first and a braces-only
        fallback second.
        """
        from app.services.agents.registry import get_skill

        skill = get_skill(action.skill_key)
        if skill is None or skill.output != "json":
            return None
        for candidate in (text, _braces(text)):
            if not candidate:
                continue
            try:
                parsed = skill.parse(candidate) if skill.parse else None
            except Exception:
                parsed = None
            if isinstance(parsed, dict) and parsed:
                return parsed
        logger.warning("agentic output for %s was not usable JSON", action.skill_key)
        return None

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


def _braces(text: str) -> str:
    """The outermost {...} span, for JSON buried in commentary."""
    start, end = text.find("{"), text.rfind("}")
    return text[start:end + 1] if 0 <= start < end else ""


def _summarise_structured(data: dict) -> str:
    """A one-line summary of a structured result, for the transcript."""
    for key in ("topic", "angle", "title", "summary", "primary_keyword", "keyword"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:300]
    return ", ".join(f"{k}: {str(v)[:60]}" for k, v in list(data.items())[:3])[:300]


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
