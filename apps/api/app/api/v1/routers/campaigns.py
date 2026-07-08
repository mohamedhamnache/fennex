import uuid

import arq
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.models.campaign import Campaign, CampaignStep
from app.services.campaign_director import draft_plan


router = APIRouter()


class CampaignCreate(BaseModel):
    goal: str


class PlanEdit(BaseModel):
    step_ids: list[str]


def _step(s: CampaignStep) -> dict:
    return {"id": str(s.id), "order": s.order, "agent": s.agent, "action": s.action, "brief": s.brief,
            "why": s.why, "status": s.status, "summary": s.summary, "artifact_type": s.artifact_type,
            "artifact_ids": s.artifact_ids, "structured": s.structured, "error": s.error}


def _campaign(c: Campaign, steps: list[CampaignStep]) -> dict:
    return {"id": str(c.id), "goal": c.goal, "persona": c.persona, "status": c.status,
            "director_summary": c.director_summary,
            "steps": [_step(s) for s in sorted(steps, key=lambda x: x.order)]}


async def _load(campaign_id, org_id, db) -> Campaign | None:
    return (await db.execute(select(Campaign).where(Campaign.id == campaign_id, Campaign.org_id == org_id))).scalars().first()


async def _steps(campaign_id, db) -> list[CampaignStep]:
    return list((await db.execute(select(CampaignStep).where(CampaignStep.campaign_id == campaign_id))).scalars().all())


async def enqueue_campaign(campaign_id: str) -> None:
    pool = await arq.create_pool(settings.REDIS_SETTINGS)
    try:
        await pool.enqueue_job("run_campaign", campaign_id)
    finally:
        await pool.aclose()


@router.post("", status_code=201)
async def create_campaign(project_id: uuid.UUID, body: CampaignCreate, current_user: CurrentUser, db: DB):
    from app.models.project import Project
    proj = await db.get(Project, project_id)
    if proj is None or proj.org_id != current_user.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    persona = proj.persona or "creator"
    try:
        plan = await draft_plan(project_id, current_user.org_id, body.goal, persona, db)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    campaign = Campaign(org_id=current_user.org_id, project_id=project_id, goal=body.goal,
                        persona=persona, status="planned", director_summary=plan.get("summary"))
    db.add(campaign)
    await db.flush()
    for i, s in enumerate(plan["steps"]):
        db.add(CampaignStep(campaign_id=campaign.id, order=i, agent=s["agent"], action=s["action"],
                            brief=s.get("brief") or {}, why=s.get("why"), status="pending"))
    await db.commit()
    return _campaign(campaign, await _steps(campaign.id, db))


@router.get("")
async def list_campaigns(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    rows = (await db.execute(select(Campaign).where(
        Campaign.project_id == project_id, Campaign.org_id == current_user.org_id
    ).order_by(Campaign.created_at.desc()))).scalars().all()
    out = []
    for c in rows:
        out.append(_campaign(c, await _steps(c.id, db)))
    return out


@router.get("/{campaign_id}")
async def get_campaign(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campaign not found")
    return _campaign(c, await _steps(c.id, db))


@router.patch("/{campaign_id}/plan")
async def edit_plan(campaign_id: uuid.UUID, body: PlanEdit, current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campaign not found")
    if c.status != "planned":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Plan can only be edited before running.")
    keep = [uuid.UUID(x) for x in body.step_ids]
    steps = await _steps(campaign_id, db)
    for s in steps:
        if s.id not in keep:
            await db.delete(s)
    for order, sid in enumerate(keep):
        s = next((x for x in steps if x.id == sid), None)
        if s is not None:
            s.order = order
    await db.commit()
    return _campaign(c, await _steps(campaign_id, db))


@router.post("/{campaign_id}/run")
async def run(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campaign not found")
    if c.status != "planned":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Campaign is not in a runnable state.")
    c.status = "running"
    await db.commit()
    await enqueue_campaign(str(campaign_id))
    return _campaign(c, await _steps(campaign_id, db))


@router.post("/{campaign_id}/cancel")
async def cancel(campaign_id: uuid.UUID, current_user: CurrentUser, db: DB):
    c = await _load(campaign_id, current_user.org_id, db)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Campaign not found")
    c.cancel_requested = True
    await db.commit()
    return _campaign(c, await _steps(campaign_id, db))
