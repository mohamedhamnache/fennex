"""The AI Employee contract.

An employee is not a prompt. It is:

    Employee
      |- Prompt          system_prompt + personality
      |- Knowledge       knowledge_sources (what it is allowed to read)
      |- Connected Apps  connected_apps (WordPress, Shopify, Meta, ...)
      |- Memory          memory_scope (what institutional knowledge it sees)
      |- Tools           allowed_tools (gated by permissions)
      `- Actions         actions (the units of work it can be assigned)

Every employee also implements the same lifecycle, so the Orchestrator can drive
any of them -- including ones that do not exist yet -- through the same loop:

    planner()      choose which action answers this task
    execute()      do the work
    evaluate()     grade the output before it leaves the department
    learn()        write what was learned back into shared memory
    health_check() report whether this employee can work at all right now

The defaults below are real implementations, not stubs. A new employee that
only declares data (identity, capabilities, actions) is fully operational; it
overrides a hook only when it needs behaviour the default cannot express.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Awaitable, Callable, Optional

from app.employees import capabilities as caps

if TYPE_CHECKING:
    from app.employees.context import WorkContext, Task

# --- status / permissions -----------------------------------------------------

STATUS_ACTIVE = "active"
STATUS_BETA = "beta"
STATUS_DEPRECATED = "deprecated"
STATUS_DISABLED = "disabled"
STATUSES = {STATUS_ACTIVE, STATUS_BETA, STATUS_DEPRECATED, STATUS_DISABLED}

# Memory scopes, widest last. An employee sees its own scope and everything
# narrower is invisible to it; `org` sees the whole company's knowledge.
SCOPE_SELF = "self"
SCOPE_DEPARTMENT = "department"
SCOPE_PROJECT = "project"
SCOPE_ORG = "org"
SCOPES = [SCOPE_SELF, SCOPE_DEPARTMENT, SCOPE_PROJECT, SCOPE_ORG]


@dataclass(frozen=True)
class Permission:
    """A capability boundary the Orchestrator enforces before execution."""

    slug: str
    description: str = ""


# Canonical permissions. Anything an employee does that touches the outside
# world -- or spends money -- must be covered by one of these.
P_READ_ANALYTICS = "read:analytics"
P_READ_CONTENT = "read:content"
P_READ_PRODUCTS = "read:products"
P_READ_COMPETITORS = "read:competitors"
P_WRITE_CONTENT = "write:content"
P_WRITE_IMAGES = "write:images"
P_WRITE_SOCIAL = "write:social"
P_PUBLISH_EXTERNAL = "publish:external"
P_SEND_EMAIL = "send:email"
P_SPEND_CREDITS = "spend:credits"

ALL_PERMISSIONS = [
    P_READ_ANALYTICS, P_READ_CONTENT, P_READ_PRODUCTS, P_READ_COMPETITORS,
    P_WRITE_CONTENT, P_WRITE_IMAGES, P_WRITE_SOCIAL, P_PUBLISH_EXTERNAL,
    P_SEND_EMAIL, P_SPEND_CREDITS,
]


# --- results ------------------------------------------------------------------


@dataclass
class Outcome:
    """What an employee hands back. Mirrors the legacy AgentResult so the two
    layers interoperate while the migration completes."""

    ok: bool
    summary: str = ""
    content: Any = None
    artifact_type: Optional[str] = None
    artifact_ids: list[str] = field(default_factory=list)
    structured: dict = field(default_factory=dict)
    error: Optional[str] = None
    # filled in by the runtime
    employee_id: str = ""
    action_id: str = ""
    cost: dict = field(default_factory=dict)   # {provider, model, tier}

    @classmethod
    def from_agent_result(cls, r, employee_id: str = "", action_id: str = "") -> "Outcome":
        return cls(ok=r.ok, summary=r.summary, content=r.content, artifact_type=r.artifact_type,
                   artifact_ids=list(r.artifact_ids or []), structured=dict(r.structured or {}),
                   error=r.error, employee_id=employee_id, action_id=action_id)


@dataclass
class Evaluation:
    passed: bool
    score: int = 0
    feedback: str = ""


@dataclass
class Health:
    ok: bool
    detail: str = ""
    checks: dict = field(default_factory=dict)


@dataclass
class PlannedStep:
    """One unit of work the planner commits to."""

    action_id: str
    why: str = ""
    inputs: dict = field(default_factory=dict)


# --- actions ------------------------------------------------------------------


@dataclass
class Action:
    """A unit of work an employee can be assigned.

    `skill_key` bridges to the existing skill catalog (app.services.agents), so
    the framework inherits every working generator without a rewrite. An action
    may instead supply `handler(employee, task, ctx) -> Outcome` for work that
    is not a single LLM call (tool-only actions, deterministic pipelines).
    """

    id: str
    label: str
    description: str
    capabilities: list[str]
    weight: str = "light"                      # "light" | "heavy" -> model tier
    inputs: list[str] = field(default_factory=list)
    outputs: list[str] = field(default_factory=list)
    skill_key: Optional[str] = None
    handler: Optional[Callable[..., Awaitable[Outcome]]] = None
    requires_permissions: list[str] = field(default_factory=list)
    requires_approval: bool = False            # human sign-off before it runs

    def __post_init__(self) -> None:
        unknown = caps.unknown(self.capabilities)
        if unknown:
            raise ValueError(f"action {self.id}: unknown capabilities {unknown}")
        if not self.skill_key and not self.handler:
            raise ValueError(f"action {self.id}: needs either skill_key or handler")


# --- the employee -------------------------------------------------------------


@dataclass
class Employee:
    """A member of the AI company. Data first; behaviour is overridable."""

    # identity
    id: str
    name: str
    codename: str
    role: str
    department: str
    description: str
    avatar: str = ""                            # asset path or generated initial
    icon: str = "sparkles"                      # lucide icon name (frontend)
    version: str = "1.0.0"
    status: str = STATUS_ACTIVE

    # mind
    system_prompt: str = ""
    personality: str = ""
    expertise: list[str] = field(default_factory=list)
    goals: list[str] = field(default_factory=list)

    # reach
    capabilities: list[str] = field(default_factory=list)
    actions: list[Action] = field(default_factory=list)
    allowed_tools: list[str] = field(default_factory=list)
    connected_apps: list[str] = field(default_factory=list)
    permissions: list[str] = field(default_factory=list)
    memory_scope: str = SCOPE_PROJECT
    knowledge_sources: list[str] = field(default_factory=list)
    supported_inputs: list[str] = field(default_factory=lambda: ["text"])
    supported_outputs: list[str] = field(default_factory=lambda: ["text"])

    # collaboration -- who this employee habitually receives from / hands to.
    # Advisory only: the Orchestrator may route differently. Declared as
    # capabilities, never as employee ids, so the graph survives roster changes.
    consumes: list[str] = field(default_factory=list)
    produces_for: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.status not in STATUSES:
            raise ValueError(f"employee {self.id}: bad status {self.status!r}")
        if self.memory_scope not in SCOPES:
            raise ValueError(f"employee {self.id}: bad memory_scope {self.memory_scope!r}")
        unknown = caps.unknown(self.capabilities)
        if unknown:
            raise ValueError(f"employee {self.id}: unknown capabilities {unknown}")
        # An employee's capability surface is the union of what it declares and
        # what its actions can actually do -- declared-but-unbacked capabilities
        # are the main way a roster drifts into lying about itself.
        for a in self.actions:
            for c in a.capabilities:
                if c not in self.capabilities:
                    self.capabilities.append(c)

    # -- introspection ---------------------------------------------------------

    @property
    def action_ids(self) -> list[str]:
        return [a.id for a in self.actions]

    def action(self, action_id: str) -> Optional[Action]:
        return next((a for a in self.actions if a.id == action_id), None)

    def actions_for(self, capability: str) -> list[Action]:
        return [a for a in self.actions if capability in a.capabilities]

    def covers(self, capability: str) -> bool:
        return capability in self.capabilities

    def coverage(self, wanted: list[str]) -> float:
        """Share of the wanted capabilities this employee covers (0..1)."""
        if not wanted:
            return 0.0
        hit = sum(1 for c in wanted if self.covers(c))
        return hit / len(wanted)

    def unbacked_capabilities(self) -> list[str]:
        backed = {c for a in self.actions for c in a.capabilities}
        return [c for c in self.capabilities if c not in backed]

    def prompt_preamble(self) -> str:
        """Identity block prepended to every call this employee makes."""
        parts = [p for p in (self.personality, self.system_prompt) if p]
        if self.goals:
            parts.append("Your standing goals:\n" + "\n".join(f"- {g}" for g in self.goals))
        return "\n\n".join(parts)

    # -- lifecycle -------------------------------------------------------------

    async def planner(self, task: "Task", ctx: "WorkContext") -> list[PlannedStep]:
        """Choose the action(s) that answer this task.

        Default: if the task names an action, honour it; otherwise pick the
        action with the greatest overlap with the task's requested capabilities.
        """
        if task.action_id and self.action(task.action_id):
            return [PlannedStep(action_id=task.action_id, why=task.goal, inputs=dict(task.inputs))]

        wanted = task.capabilities or []
        scored = []
        for a in self.actions:
            overlap = len(set(a.capabilities) & set(wanted))
            if overlap:
                scored.append((overlap, a))
        if not scored:
            return []
        scored.sort(key=lambda p: (-p[0], p[1].weight == "heavy"))
        best = scored[0][1]
        return [PlannedStep(action_id=best.id, why=task.goal, inputs=dict(task.inputs))]

    async def execute(self, action: Action, task: "Task", ctx: "WorkContext") -> Outcome:
        """Do the work.

        Default: a custom handler if the action has one, otherwise run the bound
        skill through the existing AgentRunner with this employee's identity and
        the Orchestrator-assembled context injected into the prompt.
        """
        if action.handler is not None:
            return await action.handler(self, action, task, ctx)
        return await ctx.run_skill(self, action, task)

    async def evaluate(self, outcome: Outcome, task: "Task", ctx: "WorkContext") -> Evaluation:
        """Grade the work before it leaves the department."""
        if not outcome.ok:
            return Evaluation(passed=False, score=0, feedback=outcome.error or "no result")
        return await ctx.review(self, outcome, task)

    async def learn(self, task: "Task", outcome: Outcome, evaluation: Evaluation,
                    ctx: "WorkContext") -> None:
        """Write what was learned into shared memory (institutional knowledge)."""
        if not outcome.ok or not outcome.summary:
            return
        await ctx.remember(
            employee_id=self.id,
            scope=self.memory_scope,
            kind="outcome",
            key=f"{self.id}:{outcome.action_id}",
            content=outcome.summary[:1000],
            meta={"score": evaluation.score, "goal": task.goal[:300],
                  "artifact_type": outcome.artifact_type},
        )

    async def health_check(self, ctx: "WorkContext") -> Health:
        """Can this employee work right now?"""
        checks: dict[str, Any] = {}
        checks["status"] = self.status
        checks["has_actions"] = bool(self.actions)
        checks["llm_available"] = bool(ctx.available_providers())
        missing_tools = ctx.missing_tools(self.allowed_tools)
        checks["missing_tools"] = missing_tools
        unbacked = self.unbacked_capabilities()
        checks["unbacked_capabilities"] = unbacked
        ok = (self.status in (STATUS_ACTIVE, STATUS_BETA) and bool(self.actions)
              and bool(ctx.available_providers()) and not missing_tools)
        detail = "ready"
        if not ok:
            reasons = []
            if self.status not in (STATUS_ACTIVE, STATUS_BETA):
                reasons.append(f"status is {self.status}")
            if not self.actions:
                reasons.append("no actions registered")
            if not ctx.available_providers():
                reasons.append("no LLM provider key configured")
            if missing_tools:
                reasons.append(f"unresolved tools: {', '.join(missing_tools)}")
            detail = "; ".join(reasons)
        return Health(ok=ok, detail=detail, checks=checks)

    # -- serialization ---------------------------------------------------------

    def to_dict(self, *, include_prompt: bool = False) -> dict:
        """Public shape. The system prompt is withheld unless explicitly asked
        for -- it is the employee's proprietary craft, not display data."""
        data = {
            "id": self.id,
            "name": self.name,
            "codename": self.codename,
            "avatar": self.avatar,
            "icon": self.icon,
            "role": self.role,
            "department": self.department,
            "description": self.description,
            "version": self.version,
            "status": self.status,
            "personality": self.personality,
            "expertise": list(self.expertise),
            "goals": list(self.goals),
            "capabilities": list(self.capabilities),
            "allowedTools": list(self.allowed_tools),
            "connectedApps": list(self.connected_apps),
            "permissions": list(self.permissions),
            "memoryScope": self.memory_scope,
            "knowledgeSources": list(self.knowledge_sources),
            "supportedInputs": list(self.supported_inputs),
            "supportedOutputs": list(self.supported_outputs),
            "consumes": list(self.consumes),
            "producesFor": list(self.produces_for),
            "actions": [
                {
                    "id": a.id,
                    "label": a.label,
                    "description": a.description,
                    "capabilities": list(a.capabilities),
                    "weight": a.weight,
                    "inputs": list(a.inputs),
                    "outputs": list(a.outputs),
                    "requiresApproval": a.requires_approval,
                    "requiresPermissions": list(a.requires_permissions),
                }
                for a in self.actions
            ],
        }
        if include_prompt:
            data["systemPrompt"] = self.system_prompt
        return data
