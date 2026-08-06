"""BaseEmployee -- the Fennex employee, executed on the Strands runtime.

The employee wraps Strands; Strands never wraps the employee. Identity, Brand
DNA, memory, permissions and knowledge are assembled by Fennex and handed to
the runtime as instructions and tools. The runtime's only job is the agentic
loop: let the model choose tools, call them, iterate, answer.

Every employee gets this behaviour by declaring data. A roster file overrides a
hook only when the default cannot express what it needs.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import ExitStack
from typing import Any, AsyncIterator, Optional

from app.employees.runtime import budget as budget_layer
from app.employees.runtime import mcp as mcp_layer
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

    def instructions(self, ctx, action, task=None, *, visual: bool = False,
                     conversational: bool = False) -> str:
        """The full system prompt: identity, brand, memory, and the craft.

        The skill's own system prompt is inherited verbatim. That is where the
        output contract lives -- the JSON shape, the word count, the structure
        -- and discarding it is how an agentic run ends up returning prose
        where the caller expected a parsed object.
        """
        blocks = [ctx.system_preamble(self.employee, visual=visual)]

        # In chat the employee speaks; the artifact is produced later, when the
        # user presses the button. Inheriting the skill's output contract here
        # makes it reply with raw JSON or a full article instead of talking.
        skill_system = "" if conversational else self._skill_prompts(action, task, ctx)[0]
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

        if conversational:
            blocks.append(
                "You are speaking to the user in a chat. Reply in your own voice, and lead "
                "with the answer -- not with what you are about to do.\n\n"

                "WHAT NOT TO SEND. The finished artifact does not belong here: no article, no "
                "raw JSON object, no deliverable. That work runs separately when the user "
                "approves it. Chat is where you give the judgement.\n\n"

                "HOW TO FORMAT. The chat renders markdown, so use it -- but only where it "
                "earns its place. Short paragraphs. `## headings` once an answer covers more "
                "than one thing. A table when you are comparing rows against the same columns; "
                "prose when you are not, because a two-row table is a list wearing a costume. "
                "Bold the figure that matters, not every noun.\n\n"

                "ONE THING FIRST. If a single point outranks the rest, mark it with a "
                "'> ' callout. At most one per reply -- a page of callouts has no emphasis "
                "left in it.\n\n"

                "SHOW A NUMBER, DO NOT JUST STATE IT. When three or more values are worth "
                "comparing, draw them, with a fenced ```chart block holding this exact JSON:\n"
                '```chart\n'
                '{"type":"bar","title":"Revenue by landing page","unit":"currency",'
                '"currency":"EUR","data":[{"label":"/blog/coffee","value":3038}],'
                '"note":"optional caveat"}\n'
                '```\n'
                "type is bar | line | area | donut -- bar to rank things, line or area over "
                "time, donut for a split of one whole. unit is currency | percent | number. "
                "Twelve points at most; beyond that a chart is wallpaper.\n\n"

                "EVERY VALUE IN A CHART MUST BE ONE YOU MEASURED. A chart makes a number look "
                "authoritative, so drawing an estimate is worse than writing it in a sentence "
                "where the reader can see it hedged. If you do not have the figures, say so "
                "instead of plotting a guess.")
        else:
            blocks.append(
                "Do not describe how the work could be done -- do it. Return the finished "
                "output only, with no preamble about your process.")

        # The legacy path applied this inside call_llm. The runtime hands its
        # system prompt straight to Strands, so without this an employee
        # answers in whatever language the prompt happened to be in and the
        # thread ends up mixing languages.
        from app.services.llm_service import language_directive

        return "\n\n".join(b for b in blocks if b) + language_directive(ctx.locale)

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
                ctx.tier, action.weight, ctx.keys,
                provider_override=getattr(ctx, "model_provider_override", None),
                model_override=getattr(ctx, "model_override", None))
        except model_provider.ModelUnavailable as exc:
            return Outcome(ok=False, error=str(exc), employee_id=self.employee.id,
                           action_id=action.id)
        metrics.provider, metrics.model_id = choice.provider, choice.model_id

        await self.load_context(ctx)
        visual = any(c.startswith("image.") for c in action.capabilities)
        prompt = self.build_prompt(action, task, ctx)
        last_error: Optional[str] = None

        # MCP clients are context managers; one stack owns them for the whole
        # execution so retries reuse the same open sessions.
        with ExitStack() as stack:
            tools = toolbridge.build_tools(self.employee, ctx, on_call=metrics.record_tool)
            tools += self._mcp_tools(ctx, stack)
            return await self._attempt(action, task, ctx, model, tools, prompt,
                                       metrics, visual, last_error)

    async def _attempt(self, action, task, ctx, model, tools, prompt, metrics,
                       visual, last_error) -> Outcome:
        from strands import Agent

        spend = budget_layer.for_action(action)
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
                # Two ceilings: Strands caps turns and tokens, the deadline
                # catches a hung provider or a tool that never returns, which
                # a token limit cannot.
                async with asyncio.timeout(spend.seconds):
                    result = await agent.invoke_async(prompt, limits=spend.to_limits())
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
            except (asyncio.TimeoutError, TimeoutError):
                # A deadline is not worth retrying into: the next attempt would
                # spend the same time again for the same reason.
                logger.warning("agentic run timed out: %s.%s after %ss",
                               self.employee.id, action.id, spend.seconds)
                last_error = (f"{self.employee.name} ran out of time after "
                              f"{spend.seconds}s. Try narrowing the request.")
                break
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

    async def stream(self, action, task, ctx, *,
                     conversational: bool = True) -> AsyncIterator[dict]:
        """Stream a turn: text deltas and tool-use notices as they happen."""
        from strands import Agent

        metrics = Execution(employee_id=self.employee.id, action_id=action.id)
        try:
            model, choice = model_provider.for_action(
                ctx.tier, action.weight, ctx.keys,
                provider_override=getattr(ctx, "model_provider_override", None),
                model_override=getattr(ctx, "model_override", None))
        except model_provider.ModelUnavailable as exc:
            yield {"type": "error", "message": str(exc)}
            return
        metrics.provider, metrics.model_id = choice.provider, choice.model_id

        await self.load_context(ctx)
        visual = any(c.startswith("image.") for c in action.capabilities)
        stack = ExitStack()
        tools = toolbridge.build_tools(self.employee, ctx, on_call=metrics.record_tool)
        tools += self._mcp_tools(ctx, stack)

        spend = budget_layer.for_action(action, conversational=conversational)
        agent = Agent(
            model=model, tools=tools,
            system_prompt=self.instructions(ctx, action, task, visual=visual,
                                            conversational=conversational),
            name=self.employee.name, agent_id=self.employee.id,
            description=self.employee.role)

        # `current_tool_use` is present on every chunk of a tool call, not once
        # per call, so emit only when the tool actually changes -- otherwise a
        # single lookup floods the stream with dozens of identical frames.
        last_tool: Optional[str] = None
        try:
            chat_prompt = (self._chat_prompt(task, ctx) if conversational
                           else self.build_prompt(action, task, ctx))
            async with asyncio.timeout(spend.seconds):
                async for event in agent.stream_async(chat_prompt,
                                                      limits=spend.to_limits()):
                    delta = _delta_of(event)
                    if delta:
                        yield {"type": "delta", "employeeId": self.employee.id,
                               "text": delta}
                    used = _tool_of(event)
                    if used and used != last_tool:
                        last_tool = used
                        yield {"type": "tool", "employeeId": self.employee.id,
                               "tool": used}
        except (asyncio.TimeoutError, TimeoutError):
            logger.warning("agentic stream timed out: %s after %ss",
                           self.employee.id, spend.seconds)
            yield {"type": "error", "employeeId": self.employee.id,
                   "message": f"{self.employee.name} ran out of time after "
                              f"{spend.seconds}s."}
            return
        except Exception as exc:   # noqa: BLE001
            logger.exception("agentic stream failed: %s", self.employee.id)
            yield {"type": "error", "employeeId": self.employee.id, "message": str(exc)}
            return
        finally:
            stack.close()
        yield {"type": "telemetry", "metrics": metrics.finish(ok=True).to_dict()}

    def _mcp_tools(self, ctx, stack) -> list:
        """Tools from every MCP server this employee is entitled to use.

        A server that will not start is skipped: a broken integration must
        never cost the user their answer.
        """
        tools: list = []
        # Connectors the organisation configured take priority over any
        # environment defaults, so connecting one in the UI is live at once.
        configured = getattr(ctx, "connectors", None) or {}
        for server, client in mcp_layer.clients_for(self.employee,
                                                    ctx.granted_permissions,
                                                    configured):
            try:
                stack.enter_context(client)
                found = client.list_tools_sync()
                tools.extend(found)
                logger.info("mcp %s attached %d tools for %s",
                            server.app, len(found), self.employee.id)
            except Exception:
                logger.warning("mcp server %s unavailable for %s",
                               server.app, self.employee.id, exc_info=True)
        return tools

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

    def _chat_prompt(self, task, ctx) -> str:
        """What the user actually said, plus what is already settled."""
        lines = [f"THE USER SAID: {task.goal or ctx.goal}"]
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
        # A deliverable with no artifact record -- a market report, an outreach
        # plan -- IS the text. Keep the whole thing: the summary is for the
        # transcript line, `body` is the document itself.
        return Outcome(ok=True, summary=_headline(text), content=text,
                       structured={"body": text, "format": "markdown"})

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


def _headline(text: str) -> str:
    """A one-line summary for the transcript: the first heading, or first line."""
    for line in (text or "").splitlines():
        stripped = line.strip().lstrip("#").strip()
        if stripped:
            return stripped[:200]
    return (text or "")[:200]


def _braces(text: str) -> str:
    """The outermost {...} span, for JSON buried in commentary."""
    start, end = text.find("{"), text.rfind("}")
    return text[start:end + 1] if 0 <= start < end else ""


# Keys whose value is prose a person can read. Field names are English by
# contract -- the parser depends on them -- so falling back to dumping them was
# how an otherwise French result surfaced as "scorecard: {}, gaps: []".
_READABLE_KEYS = ("insights", "summary", "rationale", "analysis", "recommendation",
                  "topic", "angle", "title", "description",
                  "primary_keyword", "primary", "keyword")


def _summarise_structured(data: dict) -> str:
    """A one-line summary of a structured result, for the transcript."""
    for key in _READABLE_KEYS:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:300]
    # Nothing readable: prefer the first prose value anywhere over field names.
    for value in data.values():
        if isinstance(value, str) and len(value.strip()) > 30:
            return value.strip()[:300]
    return ""


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
