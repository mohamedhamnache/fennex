"""The AI Orchestrator -- the CEO of the AI company.

It never performs business work. It:

    1. understands the user's intent            -> required capabilities
    2. builds an execution plan                 -> a DAG of tasks
    3. assembles the team                       -> by capability, never by name
    4. injects Brand DNA and institutional memory
    5. enforces permissions and approvals
    6. runs the graph, parallelising every layer that has no dependencies
    7. retries with the reviewer's feedback
    8. produces an execution log

Because task assignment goes through the capability index, an employee hired
tomorrow is eligible for work planned today without a single change here.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from typing import Optional

from app.employees import brand_dna, registry
from app.employees.capabilities import catalog_text as capability_catalog
from app.employees.context import Task, WorkContext
from app.employees.spec import Employee, Evaluation, Outcome

logger = logging.getLogger(__name__)

MAX_RETRIES = 2
MAX_TASKS = 12
DEFAULT_PARALLELISM = 3


@dataclass
class RunReport:
    goal: str
    ok: bool
    tasks: list[dict] = field(default_factory=list)
    team: list[str] = field(default_factory=list)
    artifacts: list[dict] = field(default_factory=list)
    logs: list[dict] = field(default_factory=list)
    cost: dict = field(default_factory=dict)
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {"goal": self.goal, "ok": self.ok, "tasks": self.tasks, "team": self.team,
                "artifacts": self.artifacts, "logs": self.logs, "cost": self.cost,
                "error": self.error}


# --- 1. intent ----------------------------------------------------------------

# Deterministic fallback shapes, expressed as capabilities so they keep working
# as the roster changes. Used when no LLM key is configured or planning fails.
_FALLBACK_FLOWS: dict[str, list[str]] = {
    "creator": ["seo.opportunity_discovery", "content.article", "image.editorial",
                "social.adaptation"],
    "ecommerce": ["research.market_report", "seo.opportunity_discovery",
                  "content.product_description", "image.product_photography",
                  "social.adaptation"],
    "freelancer": ["research.icp", "seo.opportunity_discovery", "content.article",
                   "outreach.linkedin"],
    "company": ["research.market_report", "intel.competitor_analysis",
                "seo.opportunity_discovery", "content.article", "image.editorial",
                "social.adaptation"],
}


async def understand(goal: str, persona: str, ctx: WorkContext) -> list[str]:
    """Turn a free-form goal into the capabilities the work requires."""
    available = ctx.available_providers()
    known = sorted({c for e in registry.all_employees() for c in e.capabilities})
    if not available:
        return _fallback_capabilities(persona, known)

    from app.services.agents.tiers import resolve_model
    from app.services.llm_service import call_llm

    provider, model = resolve_model(ctx.tier, "light", available)
    system = (
        "You are the orchestrator of a company of AI specialists. Read the user's GOAL and list "
        "the CAPABILITIES required to deliver it end to end: research/validate -> decide the "
        "angle -> create -> adapt for distribution. Choose ONLY slugs from the CATALOG. Order "
        "them in execution order. Aim for 3-6 capabilities. Never name employees.\n"
        'Respond with ONLY JSON: {"capabilities": ["slug", ...]}.\n\n'
        f"CATALOG:\n{capability_catalog(known)}"
    )
    user = f"GOAL: {goal}\nPERSONA: {persona}"
    if ctx.dna.project_profile:
        user += f"\nPROJECT: {ctx.dna.project_profile[:800]}"

    try:
        raw = await call_llm(provider, model, ctx.keys[provider], system, user, locale=ctx.locale)
        parsed = json.loads(re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip()))
        wanted = [c for c in parsed.get("capabilities", []) if c in known][:MAX_TASKS]
        ctx.cost["calls"] += 1
    except Exception:
        logger.exception("intent understanding failed; falling back")
        return _fallback_capabilities(persona, known)

    if not wanted:
        return _fallback_capabilities(persona, known)
    ctx.log("intent.understood", capabilities=wanted)
    return wanted


def _fallback_capabilities(persona: str, known: list[str]) -> list[str]:
    flow = _FALLBACK_FLOWS.get(persona, _FALLBACK_FLOWS["creator"])
    return [c for c in flow if c in known]


# --- 2 + 3. plan and team -----------------------------------------------------


def build_plan(capabilities: list[str], goal: str, ctx: WorkContext) -> list[Task]:
    """Turn required capabilities into a dependency graph of assigned tasks.

    Assignment is pure capability resolution -- no employee is ever named here.
    Dependencies are linear by default (each step reads the last), but tasks
    whose capabilities share a domain and need no upstream output are allowed
    to run in parallel.
    """
    tasks: list[Task] = []
    previous: Optional[Task] = None

    for index, capability in enumerate(capabilities):
        employee, action = registry.resolve_action(capability)
        if employee is None or action is None:
            ctx.log("plan.unstaffed", level="warn", capability=capability)
            continue
        task = Task(
            id=f"t{index + 1}",
            goal=goal,
            capabilities=[capability],
            employee_id=employee.id,
            action_id=action.id,
            depends_on=[previous.id] if previous is not None else [],
            why=f"{employee.role} covers {capability}",
        )
        tasks.append(task)
        previous = task

    _relax_dependencies(tasks)
    return tasks


# Research and intelligence establish ground truth; they depend on nothing and
# can all start at once. Everything downstream reads what they produced.
_INDEPENDENT_DOMAINS = {"research", "intel"}


def _relax_dependencies(tasks: list[Task]) -> None:
    """Unchain the tasks that do not actually need an upstream result, so the
    Orchestrator can run them in the same layer."""
    for task in tasks:
        domains = {c.split(".", 1)[0] for c in task.capabilities}
        if domains and domains <= _INDEPENDENT_DOMAINS:
            task.depends_on = []


def team_for(tasks: list[Task]) -> list[Employee]:
    seen: dict[str, Employee] = {}
    for task in tasks:
        if task.employee_id and task.employee_id not in seen:
            employee = registry.get(task.employee_id)
            if employee is not None:
                seen[task.employee_id] = employee
    return list(seen.values())


def layers(tasks: list[Task]) -> list[list[Task]]:
    """Topologically sort into layers; every task in a layer can run in parallel."""
    remaining = {t.id: t for t in tasks}
    done: set[str] = set()
    out: list[list[Task]] = []
    while remaining:
        ready = [t for t in remaining.values() if all(d in done for d in t.depends_on)]
        if not ready:
            # A cycle or a dangling dependency: run the rest sequentially rather
            # than deadlocking the company.
            ready = [next(iter(remaining.values()))]
        out.append(ready)
        for t in ready:
            done.add(t.id)
            remaining.pop(t.id, None)
    return out


# --- 5. permissions and approvals ---------------------------------------------


def _authorize(employee: Employee, action, ctx: WorkContext) -> Optional[str]:
    """Returns a refusal reason, or None when the action may proceed."""
    missing = [p for p in action.requires_permissions if p not in employee.permissions]
    if missing:
        return f"{employee.name} lacks permission: {', '.join(missing)}"
    ungranted = [p for p in action.requires_permissions if p not in ctx.granted_permissions]
    if ungranted:
        return f"organisation has not granted: {', '.join(ungranted)}"
    if action.requires_approval and not ctx.approvals.get(f"{employee.id}.{action.id}"):
        return "awaiting human approval"
    return None


# --- 6 + 7. execution ---------------------------------------------------------


async def run_task(task: Task, ctx: WorkContext) -> Outcome:
    """Drive one employee through the full lifecycle for one task."""
    employee = registry.get(task.employee_id) if task.employee_id else None
    if employee is None:
        # Late binding: the planned employee is gone, so re-resolve by capability.
        for capability in task.capabilities:
            employee = registry.best_for(capability)
            if employee is not None:
                task.employee_id = employee.id
                break
    if employee is None:
        return Outcome(ok=False, error=f"no employee covers {task.capabilities}")

    await ctx.load_memory(employee)

    steps = await employee.planner(task, ctx)
    if not steps:
        return Outcome(ok=False, employee_id=employee.id,
                       error=f"{employee.name} could not plan for {task.capabilities}")

    step = steps[0]
    action = employee.action(step.action_id)
    if action is None:
        return Outcome(ok=False, employee_id=employee.id,
                       error=f"{employee.name} planned an unknown action {step.action_id}")

    refusal = _authorize(employee, action, ctx)
    if refusal:
        ctx.log("task.denied", level="warn", task=task.id, employee=employee.id, reason=refusal)
        return Outcome(ok=False, employee_id=employee.id, action_id=action.id, error=refusal)

    task.inputs = {**step.inputs, **task.inputs}
    outcome = Outcome(ok=False)
    evaluation = Evaluation(passed=False, score=0)

    for attempt in range(MAX_RETRIES + 1):
        ctx.log("task.started", task=task.id, employee=employee.id, action=action.id,
                attempt=attempt + 1)
        outcome = await employee.execute(action, task, ctx)
        outcome.employee_id, outcome.action_id = employee.id, action.id
        if not outcome.ok:
            break
        evaluation = await employee.evaluate(outcome, task, ctx)
        if evaluation.passed:
            break
        # Hand the reviewer's feedback back to the employee and let it retry.
        task.inputs = {**task.inputs, "feedback": evaluation.feedback}
        ctx.log("task.retry", level="warn", task=task.id, employee=employee.id,
                score=evaluation.score, feedback=evaluation.feedback[:200])

    if outcome.ok:
        ctx.add_artifact(outcome, employee.id, f"{employee.id}.{action.id}")
        try:
            await employee.learn(task, outcome, evaluation, ctx)
        except Exception:
            logger.exception("learn() failed for %s", employee.id)
        ctx.log("task.completed", task=task.id, employee=employee.id, score=evaluation.score)
    else:
        ctx.log("task.failed", level="error", task=task.id, employee=employee.id,
                error=outcome.error)
    return outcome


async def _run_layer(layer: list[Task], ctx: WorkContext, parallelism: int) -> None:
    """Run one dependency layer, bounded so a wide layer cannot exhaust the
    provider's rate limit or the org's budget in one burst.

    A SQLAlchemy AsyncSession is not safe for concurrent use, so parallel tasks
    each get their own session from the factory. If no factory is reachable we
    fall back to running the layer sequentially on the shared session -- slower,
    but never corrupt.
    """
    if len(layer) == 1:
        ctx.outputs[layer[0].id] = await run_task(layer[0], ctx)
        return

    factory = _session_factory()
    if factory is None:
        ctx.log("layer.sequential", level="warn", reason="no session factory",
                tasks=[t.id for t in layer])
        for task in layer:
            ctx.outputs[task.id] = await run_task(task, ctx)
        return

    semaphore = asyncio.Semaphore(max(1, parallelism))

    async def guarded(task: Task) -> None:
        async with semaphore:
            async with factory() as session:
                # A shallow context clone sharing artifacts/logs/outputs, but
                # bound to this task's own session.
                child = copy.copy(ctx)
                child.db = session
                child.recalled = []
                try:
                    ctx.outputs[task.id] = await run_task(task, child)
                finally:
                    await session.close()

    results = await asyncio.gather(*(guarded(t) for t in layer), return_exceptions=True)
    for task, result in zip(layer, results):
        if isinstance(result, BaseException):
            ctx.log("task.crashed", level="error", task=task.id, error=str(result))
            ctx.outputs[task.id] = Outcome(ok=False, error=str(result))


def _session_factory():
    try:
        from app.core.database import AsyncSessionLocal
        return AsyncSessionLocal
    except Exception:
        logger.exception("no async session factory available for parallel execution")
        return None


# --- entry point --------------------------------------------------------------


async def run(goal: str, project_id: uuid.UUID, org_id: uuid.UUID, db, *,
              persona: str = "creator", tier: Optional[str] = None,
              capabilities: Optional[list[str]] = None,
              granted_permissions: Optional[list[str]] = None,
              approvals: Optional[dict] = None,
              parallelism: int = DEFAULT_PARALLELISM) -> RunReport:
    """Deliver a goal end to end. This is the only entry point callers need."""
    from app.services.agents.standalone import org_tier
    from app.services.llm_service import get_org_llm_keys
    from app.employees.spec import ALL_PERMISSIONS

    resolved_tier = tier if tier is not None else await org_tier(org_id, db)
    keys = await get_org_llm_keys(org_id, db)
    dna = await brand_dna.build(project_id, org_id, db)

    ctx = WorkContext(
        goal=goal, project_id=project_id, org_id=org_id, db=db, dna=dna,
        tier=resolved_tier, persona=persona, keys=keys,
        granted_permissions=list(granted_permissions if granted_permissions is not None
                                 else ALL_PERMISSIONS),
        approvals=dict(approvals or {}),
    )
    ctx.log("run.started", goal=goal[:200], persona=persona, tier=resolved_tier)

    if not keys:
        ctx.log("run.no_keys", level="error")
        return RunReport(goal=goal, ok=False, logs=ctx.execution_log(),
                         error="No AI key configured. Add an Anthropic or OpenAI key in Settings.")

    wanted = capabilities or await understand(goal, persona, ctx)
    tasks = build_plan(wanted, goal, ctx)
    if not tasks:
        ctx.log("run.unstaffed", level="error", capabilities=wanted)
        return RunReport(goal=goal, ok=False, logs=ctx.execution_log(),
                         error="No employee in the company covers this request.")

    team = team_for(tasks)
    ctx.log("team.assembled", team=[e.id for e in team],
            plan=[t.to_dict() for t in tasks])

    for layer in layers(tasks):
        await _run_layer(layer, ctx, parallelism)

    completed = [t for t in tasks if ctx.outputs.get(t.id) and ctx.outputs[t.id].ok]
    ctx.log("run.finished", completed=len(completed), total=len(tasks))

    return RunReport(
        goal=goal,
        ok=bool(completed),
        team=[e.id for e in team],
        tasks=[{**t.to_dict(),
                "ok": bool(ctx.outputs.get(t.id) and ctx.outputs[t.id].ok),
                "summary": (ctx.outputs[t.id].summary if ctx.outputs.get(t.id) else ""),
                "error": (ctx.outputs[t.id].error if ctx.outputs.get(t.id) else None)}
               for t in tasks],
        artifacts=ctx.artifacts,
        logs=ctx.execution_log(),
        cost=ctx.cost,
    )


async def health_report(project_id: uuid.UUID, org_id: uuid.UUID, db) -> list[dict]:
    """Health-check every employee -- the company's status board."""
    from app.services.agents.standalone import org_tier
    from app.services.llm_service import get_org_llm_keys
    from app.employees import toolbelt
    from app.employees.spec import ALL_PERMISSIONS

    keys = await get_org_llm_keys(org_id, db)
    dna = await brand_dna.build(project_id, org_id, db)
    ctx = WorkContext(goal="", project_id=project_id, org_id=org_id, db=db, dna=dna,
                      tier=await org_tier(org_id, db), keys=keys,
                      granted_permissions=list(ALL_PERMISSIONS))
    connected = await toolbelt.available_apps(project_id, org_id, db)

    out = []
    for employee in registry.all_employees(include_disabled=True):
        health = await employee.health_check(ctx)
        out.append({
            "id": employee.id, "name": employee.name, "department": employee.department,
            "status": employee.status, "ok": health.ok, "detail": health.detail,
            "checks": health.checks,
            "connectedApps": {app: connected.get(app, False) for app in employee.connected_apps},
        })
    return out
