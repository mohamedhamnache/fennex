"""WorkContext -- everything an employee needs, assembled by the Orchestrator.

The employee never fetches its own brand, memory or credentials. It receives a
context and works through it. That single rule is what makes the framework
scale: the Orchestrator can change how brand, memory, permissions or model
routing work for the entire company without editing a single employee.

WorkContext deliberately exposes the same attribute surface as the legacy
`Brief` (goal, persona, project_id, org_id, locale, project_profile, brand,
existing_content, artifacts, runtime) so existing skills and data tools run
against it unchanged.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from app.employees import memory as memory_layer
from app.employees import toolbelt
from app.employees.brand_dna import BrandDNA
from app.employees.spec import Evaluation, Outcome

logger = logging.getLogger(__name__)


@dataclass
class Task:
    """A unit of work assigned to an employee by the Orchestrator."""

    id: str
    goal: str
    capabilities: list[str] = field(default_factory=list)
    employee_id: Optional[str] = None       # resolved by the orchestrator
    action_id: Optional[str] = None         # optional pin
    inputs: dict = field(default_factory=dict)
    depends_on: list[str] = field(default_factory=list)
    why: str = ""

    def to_dict(self) -> dict:
        return {"id": self.id, "goal": self.goal, "capabilities": list(self.capabilities),
                "employeeId": self.employee_id, "actionId": self.action_id,
                "dependsOn": list(self.depends_on), "why": self.why}


@dataclass
class LogEntry:
    at: str
    level: str
    event: str
    detail: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {"at": self.at, "level": self.level, "event": self.event, "detail": self.detail}


@dataclass
class WorkContext:
    """The shared workspace for one orchestrated run."""

    goal: str
    project_id: uuid.UUID
    org_id: uuid.UUID
    db: Any
    dna: BrandDNA
    tier: str = "balanced"
    persona: str = "creator"
    keys: dict = field(default_factory=dict)
    granted_permissions: list[str] = field(default_factory=list)
    # results produced so far, keyed by task id -- later tasks read earlier output
    outputs: dict[str, Outcome] = field(default_factory=dict)
    artifacts: list[dict] = field(default_factory=list)
    existing_content: list[str] = field(default_factory=list)
    recalled: list = field(default_factory=list)
    logs: list[LogEntry] = field(default_factory=list)
    runtime: dict = field(default_factory=dict)
    cost: dict = field(default_factory=lambda: {"calls": 0, "by_model": {}})
    approvals: dict[str, bool] = field(default_factory=dict)
    # MCP connectors this organisation configured, keyed by app.
    connectors: dict = field(default_factory=dict)

    # -- legacy Brief compatibility -------------------------------------------

    @property
    def locale(self) -> str:
        return self.dna.locale or "en"

    @property
    def project_profile(self) -> str:
        return self.dna.project_profile or ""

    @property
    def brand(self) -> dict:
        """Legacy skills read `brief.brand` -- keep the old shape working."""
        return {
            "voice_prompt": self.dna.voice, "tone": self.dna.tone,
            "vocabulary": self.dna.vocabulary, "avoid_words": self.dna.avoid_words,
            "kit": {"colors": self.dna.colors, "primary_font": self.dna.typography,
                    "style_rules": self.dna.visual_identity, "tone": self.dna.tone},
        }

    def add_artifact(self, result, employee_id: str, action_key: str) -> None:
        self.artifacts.append({
            "agent": employee_id, "employee": employee_id, "skill": action_key,
            "summary": getattr(result, "summary", ""),
            "artifact_type": getattr(result, "artifact_type", None),
            "artifact_ids": getattr(result, "artifact_ids", []) or [],
            "structured": getattr(result, "structured", {}) or {},
        })

    # -- logging ---------------------------------------------------------------

    def log(self, event: str, level: str = "info", **detail) -> None:
        entry = LogEntry(at=datetime.now(timezone.utc).isoformat(), level=level,
                         event=event, detail=detail)
        self.logs.append(entry)
        logger.log(logging.WARNING if level in ("warn", "error") else logging.INFO,
                   "orchestrator %s %s", event, detail)

    def execution_log(self) -> list[dict]:
        return [entry.to_dict() for entry in self.logs]

    # -- runtime facts employees ask about -------------------------------------

    def available_providers(self) -> list[str]:
        return list(self.keys.keys())

    def missing_tools(self, names) -> list[str]:
        return toolbelt.missing(names)

    def permits(self, permission: str) -> bool:
        return permission in self.granted_permissions

    # -- prompt assembly -------------------------------------------------------

    def system_preamble(self, employee, *, visual: bool = False) -> str:
        """Identity + Brand DNA + memory, in that order.

        Assembled here rather than in the employee so every member of the
        company gets an identical, auditable context envelope.
        """
        blocks = [employee.prompt_preamble(), self.dna.as_prompt(visual=visual)]
        recalled = memory_layer.as_prompt(self.recalled)
        if recalled:
            blocks.append(recalled)
        if self.artifacts:
            done = "\n".join(
                f"- {a['agent']} produced {a.get('artifact_type') or 'output'}: "
                f"{(a.get('summary') or '')[:200]}" for a in self.artifacts[-6:])
            blocks.append("ALREADY DELIVERED IN THIS RUN -- build on it, never repeat it:\n" + done)
        return "\n\n".join(b for b in blocks if b)

    # -- capabilities employees call back into ---------------------------------

    async def run_tool(self, name: str, inputs: Optional[dict] = None):
        return await toolbelt.run(name, self, self.db, inputs,
                                  granted=self.granted_permissions)

    async def run_skill(self, employee, action, task: Task) -> Outcome:
        """Execute an action bound to a legacy skill, with the employee's
        identity, Brand DNA and memory injected into the system prompt."""
        from app.services.agents.registry import get_skill
        from app.services.agents.runner import AgentRunner

        skill = get_skill(action.skill_key) if action.skill_key else None
        if skill is None:
            return Outcome(ok=False, error=f"action {action.id} has no runnable skill",
                           employee_id=employee.id, action_id=action.id)

        visual = any(c.startswith("image.") for c in action.capabilities)
        preamble = self.system_preamble(employee, visual=visual)

        # Wrap the skill so the company's context envelope is prepended to
        # whatever system prompt the skill builds for itself.
        original = skill.build_prompt

        def build(brief, inputs, tool_data):
            system, user = original(brief, inputs, tool_data)
            return (f"{preamble}\n\n{system}" if preamble else system), user

        skill_with_identity = _clone_skill(skill, build)
        inputs = {**self.inherited_inputs(task), **(task.inputs or {})}

        result = await AgentRunner.run(skill_with_identity, self, inputs, self.tier, self.db,
                                       keys=self.keys, campaign=self.runtime.get("campaign"))
        self.cost["calls"] += 1
        outcome = Outcome.from_agent_result(result, employee_id=employee.id, action_id=action.id)
        return outcome

    def inherited_inputs(self, task: Task) -> dict:
        """What upstream tasks handed down to this one."""
        inherited: dict = {}
        for dep_id in task.depends_on:
            out = self.outputs.get(dep_id)
            if out is None or not out.ok:
                continue
            structured = out.structured or {}
            for key in ("topic", "keyword", "angle", "rationale", "title", "article_id",
                        "image_id", "product_id"):
                if structured.get(key) and key not in inherited:
                    inherited[key] = structured[key]
            if out.summary and "upstream" not in inherited:
                inherited["upstream"] = out.summary[:600]
        return inherited

    async def review(self, employee, outcome: Outcome, task: Task) -> Evaluation:
        from app.services.agents.registry import get_skill
        from app.services.agents.reviewer import review as legacy_review
        action = employee.action(outcome.action_id)
        skill = get_skill(action.skill_key) if action and action.skill_key else None
        if skill is None:
            return Evaluation(passed=True, score=75, feedback="")
        try:
            legacy_result = _as_agent_result(outcome)
            rev = await legacy_review(self, skill, legacy_result, self.tier, self.keys, self.db)
            return Evaluation(passed=bool(rev.get("passed", True)),
                              score=int(rev.get("score", 0) or 0),
                              feedback=str(rev.get("feedback", "") or ""))
        except Exception:
            logger.exception("review failed for %s", employee.id)
            return Evaluation(passed=True, score=70, feedback="")

    async def remember(self, *, employee_id: str, scope: str, kind: str, key: str,
                       content: str, meta: Optional[dict] = None) -> None:
        await memory_layer.remember(
            self.db, org_id=self.org_id, project_id=self.project_id,
            employee_id=employee_id, content=content, scope=scope, kind=kind,
            key=key, meta=meta or {})

    async def load_memory(self, employee, *, limit: int = 8) -> None:
        """Recall what the company knows that is relevant to this goal.

        No `scope` filter: reading rights follow each memory's own scope, so the
        employee sees org truth, its project, its department and its own notes.
        """
        self.recalled = await memory_layer.recall(
            self.db, org_id=self.org_id, project_id=self.project_id, query=self.goal,
            employee_id=employee.id, department=employee.department, limit=limit)


def _clone_skill(skill, build_prompt):
    """Copy a Skill with a replaced prompt builder (dataclasses.replace is not
    usable here -- Skill carries callables we must preserve by reference)."""
    import copy
    clone = copy.copy(skill)
    object.__setattr__(clone, "build_prompt", build_prompt)
    return clone


def _as_agent_result(outcome: Outcome):
    from app.services.agents.spec import AgentResult
    return AgentResult(ok=outcome.ok, summary=outcome.summary, content=outcome.content,
                       artifact_type=outcome.artifact_type, artifact_ids=outcome.artifact_ids,
                       structured=outcome.structured, error=outcome.error)
