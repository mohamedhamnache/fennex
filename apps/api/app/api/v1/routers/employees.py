"""The AI company, exposed.

Read endpoints describe the workforce (registry, capabilities, tools, health);
the write endpoint hands a goal to the Orchestrator. The frontend never hardcodes
the roster -- it renders whatever the registry reports.
"""

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from app.core.dependencies import CurrentUser, DB
from app.employees import capabilities as caps
from app.employees import memory as memory_layer
from app.employees import orchestrator, registry, toolbelt

router = APIRouter()


class DelegateRequest(BaseModel):
    goal: str
    project_id: uuid.UUID
    persona: str = "creator"
    tier: str | None = None
    capabilities: list[str] | None = None
    parallelism: int = orchestrator.DEFAULT_PARALLELISM


class MemoryWrite(BaseModel):
    project_id: uuid.UUID | None = None
    employee_id: str
    content: str
    scope: str = "project"
    kind: str = "note"
    key: str | None = None


# --- the workforce ------------------------------------------------------------


@router.get("")
async def list_employees(
    current_user: CurrentUser,
    department: str | None = Query(default=None),
    capability: str | None = Query(default=None),
    include_disabled: bool = Query(default=False),
) -> dict:
    """The registry. This is the single source of truth for who works here."""
    if capability:
        employees = registry.find_by_capability(capability)
    else:
        employees = registry.all_employees(include_disabled=include_disabled)
    if department:
        employees = [e for e in employees if e.department.lower() == department.lower()]
    return {
        "employees": [e.to_dict() for e in employees],
        "stats": registry.stats(),
        "departments": sorted({e.department for e in registry.all_employees()}),
    }


@router.get("/capabilities")
async def list_capabilities(current_user: CurrentUser) -> dict:
    """The taxonomy, plus who covers each capability."""
    index = registry.capability_index()
    return {
        "capabilities": [
            {
                "slug": c.slug, "label": c.label, "domain": c.domain,
                "description": c.description,
                "coveredBy": [e.id for e in index.get(c.slug, [])],
            }
            for c in caps.ALL
        ],
        "domains": sorted({c.domain for c in caps.ALL}),
    }


@router.get("/tools")
async def list_tools(current_user: CurrentUser, db: DB,
                     project_id: uuid.UUID | None = Query(default=None)) -> dict:
    """The Tool Layer, and which connected apps this project can actually reach."""
    connected: dict[str, bool] = {}
    if project_id is not None:
        connected = await toolbelt.available_apps(project_id, current_user.org_id, db)
    return {"tools": [t.to_dict() for t in toolbelt.all_tools()],
            "apps": toolbelt.apps(), "connected": connected}


@router.get("/health")
async def employee_health(current_user: CurrentUser, db: DB,
                          project_id: uuid.UUID = Query(...)) -> dict:
    """Status board: can each employee actually work right now?"""
    return {"employees": await orchestrator.health_report(project_id, current_user.org_id, db)}


@router.get("/{employee_id}")
async def get_employee(employee_id: str, current_user: CurrentUser,
                       version: str | None = Query(default=None)) -> dict:
    employee = registry.get(employee_id, version=version)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    data = employee.to_dict()
    data["versions"] = registry.versions(employee_id)
    return data


# --- delegation ---------------------------------------------------------------


@router.post("/delegate")
async def delegate(body: DelegateRequest, current_user: CurrentUser, db: DB) -> dict:
    """Hand a goal to the company. The Orchestrator does the rest."""
    if not body.goal.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Goal is required")
    report = await orchestrator.run(
        body.goal.strip(), body.project_id, current_user.org_id, db,
        persona=body.persona, tier=body.tier, capabilities=body.capabilities,
        parallelism=max(1, min(body.parallelism, 6)),
    )
    return report.to_dict()


@router.post("/plan")
async def preview_plan(body: DelegateRequest, current_user: CurrentUser, db: DB) -> dict:
    """Show the team and the plan without executing -- the approval surface."""
    from app.employees import brand_dna
    from app.employees.context import WorkContext
    from app.services.llm_service import get_org_llm_keys

    keys = await get_org_llm_keys(current_user.org_id, db)
    dna = await brand_dna.build(body.project_id, current_user.org_id, db)
    ctx = WorkContext(goal=body.goal, project_id=body.project_id, org_id=current_user.org_id,
                      db=db, dna=dna, persona=body.persona, keys=keys)
    wanted = body.capabilities or await orchestrator.understand(body.goal, body.persona, ctx)
    tasks = orchestrator.build_plan(wanted, body.goal, ctx)
    team = orchestrator.team_for(tasks)
    return {
        "capabilities": wanted,
        "tasks": [t.to_dict() for t in tasks],
        "layers": [[t.id for t in layer] for layer in orchestrator.layers(tasks)],
        "team": [{"id": e.id, "name": e.name, "role": e.role, "department": e.department,
                  "icon": e.icon} for e in team],
        "brandDna": dna.to_dict(),
        "logs": ctx.execution_log(),
    }


# --- institutional memory -----------------------------------------------------


@router.get("/memory/recall")
async def recall_memory(current_user: CurrentUser, db: DB,
                        project_id: uuid.UUID = Query(...),
                        q: str = Query(default=""),
                        employee_id: str | None = Query(default=None),
                        scope: str = Query(default="project"),
                        limit: int = Query(default=20, le=100)) -> dict:
    hits = await memory_layer.recall(db, org_id=current_user.org_id, project_id=project_id,
                                     query=q, employee_id=employee_id, scope=scope, limit=limit)
    return {"memories": [h.to_dict() for h in hits]}


@router.post("/memory")
async def write_memory(body: MemoryWrite, current_user: CurrentUser, db: DB) -> dict:
    employee = registry.get(body.employee_id)
    memory_id = await memory_layer.remember(
        db, org_id=current_user.org_id, project_id=body.project_id,
        employee_id=body.employee_id, content=body.content, scope=body.scope,
        kind=body.kind, key=body.key,
        department=employee.department if employee else None)
    if memory_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Memory could not be stored")
    return {"id": memory_id}


@router.delete("/memory/{memory_id}")
async def delete_memory(memory_id: uuid.UUID, current_user: CurrentUser, db: DB) -> dict:
    ok = await memory_layer.forget(db, org_id=current_user.org_id, memory_id=memory_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memory not found")
    return {"ok": True}
