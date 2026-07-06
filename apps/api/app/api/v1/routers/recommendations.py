import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.core.dependencies import CurrentUser, DB
from app.services import recommendation_service as svc

router = APIRouter()


class RecommendationCreate(BaseModel):
    source: str
    source_agent: Optional[str] = None
    kind: Optional[str] = None
    title: str
    detail: Optional[str] = None
    anchor_query: Optional[str] = None
    anchor_url: Optional[str] = None


class RecommendationPatch(BaseModel):
    status: str


def _serialize(r) -> dict:
    return {
        "id": str(r.id), "source": r.source, "source_agent": r.source_agent, "kind": r.kind,
        "title": r.title, "detail": r.detail, "anchor_query": r.anchor_query, "anchor_url": r.anchor_url,
        "status": r.status, "outcome": r.outcome, "impact_score": r.impact_score,
        "baseline": r.baseline, "latest": r.latest, "detected_content": r.detected_content,
        "done_at": r.done_at, "measured_at": r.measured_at,
    }


@router.post("", status_code=201)
async def create_recommendation(project_id: uuid.UUID, body: RecommendationCreate, current_user: CurrentUser, db: DB):
    rec = await svc.create_recommendation(project_id, current_user.org_id, body.model_dump(), db)
    return _serialize(rec)


@router.get("")
async def list_recommendations(project_id: uuid.UUID, current_user: CurrentUser, db: DB, status: Optional[str] = None):
    rows = await svc.list_recommendations(project_id, current_user.org_id, db, status)
    return [_serialize(r) for r in rows]


# Registered before /{rec_id} so "summary" is not coerced to a UUID.
@router.get("/summary")
async def recommendation_summary(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    return await svc.summarize(project_id, current_user.org_id, db)


@router.patch("/{rec_id}")
async def patch_recommendation(rec_id: uuid.UUID, body: RecommendationPatch, current_user: CurrentUser, db: DB):
    rec = await svc.transition(rec_id, current_user.org_id, body.status, db)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recommendation not found")
    return _serialize(rec)
