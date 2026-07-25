import uuid
from typing import Optional

import arq
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.models.discovery import DiscoveryRun
from app.services import workspace_provisioning_service as prov

router = APIRouter()


# -- Schemas ------------------------------------------------------------------

class DiscoveryStart(BaseModel):
    url: Optional[str] = None
    description: Optional[str] = None


class DiscoveryPatch(BaseModel):
    result: dict


class ProvisionRequest(BaseModel):
    run_id: uuid.UUID
    persona: Optional[str] = None


def _out(run: DiscoveryRun) -> dict:
    return {
        "id": str(run.id),
        "status": run.status,
        "stage": run.stage,
        "progress": run.progress,
        "result": run.result,
        "error": run.error,
    }


async def _get_owned_run(run_id: uuid.UUID, current_user: CurrentUser, db: DB) -> DiscoveryRun:
    """Fetch a DiscoveryRun scoped to the caller's org. Returns 404 (never 403)
    for a run belonging to another org so ids are not enumerable."""
    run = await db.get(DiscoveryRun, run_id)
    if run is None or run.org_id != current_user.org_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    return run


# -- Endpoints ------------------------------------------------------------------

@router.post("/discovery")
async def start_discovery(body: DiscoveryStart, current_user: CurrentUser, db: DB) -> dict:
    if not body.url and not body.description:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide a website URL or a description",
        )

    run = DiscoveryRun(
        id=uuid.uuid4(),
        org_id=current_user.org_id,
        input_url=(body.url or None),
        input_description=(body.description or None),
        status="queued",
        result={},
    )
    db.add(run)
    await db.commit()

    run_id_str = str(run.id)

    redis_pool = await arq.create_pool(settings.REDIS_SETTINGS)
    try:
        await redis_pool.enqueue_job("run_discovery", run_id_str)
    finally:
        await redis_pool.aclose()

    return {"run_id": run_id_str}


@router.get("/discovery/{run_id}")
async def get_discovery(run_id: uuid.UUID, current_user: CurrentUser, db: DB) -> dict:
    run = await _get_owned_run(run_id, current_user, db)
    return _out(run)


@router.patch("/discovery/{run_id}")
async def patch_discovery(
    run_id: uuid.UUID, body: DiscoveryPatch, current_user: CurrentUser, db: DB
) -> dict:
    run = await _get_owned_run(run_id, current_user, db)
    run.result = body.result
    await db.commit()
    return _out(run)


@router.post("/provision")
async def provision_workspace(body: ProvisionRequest, current_user: CurrentUser, db: DB) -> dict:
    run = await _get_owned_run(body.run_id, current_user, db)
    project_id = await prov.provision(run.id, persona=body.persona, db=db)
    return {"project_id": str(project_id)}
