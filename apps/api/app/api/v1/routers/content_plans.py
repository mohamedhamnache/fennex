import uuid
from datetime import datetime, date, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, status, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.dependencies import CurrentUser, DB
from app.models.content import ContentPlan, ContentItem, ContentItemStatus, ContentItemType
from app.models.keyword import KeywordResearchJob, Keyword, ResearchStatus, KeywordIntent
from app.models.project import Project

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class ContentItemOut(BaseModel):
    id: uuid.UUID
    plan_id: uuid.UUID
    title: str
    content_type: str
    status: str
    target_keyword: Optional[str]
    notes: Optional[str]
    scheduled_date: Optional[str]
    word_count_target: Optional[int]
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class ContentPlanOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    items: list[ContentItemOut]
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class CreatePlanRequest(BaseModel):
    project_id: uuid.UUID
    name: Optional[str] = "Content Plan"


class CreateItemRequest(BaseModel):
    title: str
    content_type: Optional[ContentItemType] = ContentItemType.article
    status: Optional[ContentItemStatus] = ContentItemStatus.idea
    target_keyword: Optional[str] = None
    notes: Optional[str] = None
    scheduled_date: Optional[str] = None
    word_count_target: Optional[int] = None


class UpdateItemRequest(BaseModel):
    title: Optional[str] = None
    content_type: Optional[ContentItemType] = None
    status: Optional[ContentItemStatus] = None
    target_keyword: Optional[str] = None
    notes: Optional[str] = None
    scheduled_date: Optional[str] = None
    word_count_target: Optional[int] = None


class GenerateRequest(BaseModel):
    seed_keyword: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_plan_or_404(plan_id: uuid.UUID, org_id: uuid.UUID, db) -> ContentPlan:
    result = await db.execute(
        select(ContentPlan)
        .options(selectinload(ContentPlan.items))
        .where(ContentPlan.id == plan_id, ContentPlan.org_id == org_id)
    )
    plan = result.scalar_one_or_none()
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content plan not found")
    return plan


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("", status_code=201, response_model=ContentPlanOut)
async def create_content_plan(
    body: CreatePlanRequest,
    current_user: CurrentUser,
    db: DB,
):
    # Verify project belongs to org
    proj_result = await db.execute(
        select(Project).where(Project.id == body.project_id, Project.org_id == current_user.org_id)
    )
    if proj_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    plan = ContentPlan(
        org_id=current_user.org_id,
        project_id=body.project_id,
        name=body.name or "Content Plan",
    )
    db.add(plan)
    await db.flush()
    await db.refresh(plan)
    await db.commit()

    # Re-fetch with items loaded
    result = await db.execute(
        select(ContentPlan)
        .options(selectinload(ContentPlan.items))
        .where(ContentPlan.id == plan.id)
    )
    plan = result.scalar_one()
    return ContentPlanOut.model_validate(plan)


@router.get("", response_model=list[ContentPlanOut])
async def list_content_plans(
    current_user: CurrentUser,
    db: DB,
    project_id: uuid.UUID = Query(...),
):
    result = await db.execute(
        select(ContentPlan)
        .options(selectinload(ContentPlan.items))
        .where(
            ContentPlan.project_id == project_id,
            ContentPlan.org_id == current_user.org_id,
        )
        .order_by(ContentPlan.created_at.desc())
    )
    plans = result.scalars().all()
    return [ContentPlanOut.model_validate(p) for p in plans]


@router.get("/{plan_id}", response_model=ContentPlanOut)
async def get_content_plan(
    plan_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    plan = await _get_plan_or_404(plan_id, current_user.org_id, db)
    return ContentPlanOut.model_validate(plan)


@router.post("/{plan_id}/items", status_code=201, response_model=ContentItemOut)
async def add_content_item(
    plan_id: uuid.UUID,
    body: CreateItemRequest,
    current_user: CurrentUser,
    db: DB,
):
    plan = await _get_plan_or_404(plan_id, current_user.org_id, db)

    item = ContentItem(
        plan_id=plan.id,
        org_id=current_user.org_id,
        project_id=plan.project_id,
        title=body.title,
        content_type=body.content_type or ContentItemType.article,
        status=body.status or ContentItemStatus.idea,
        target_keyword=body.target_keyword,
        notes=body.notes,
        scheduled_date=body.scheduled_date,
        word_count_target=body.word_count_target,
    )
    db.add(item)
    await db.flush()
    await db.refresh(item)
    await db.commit()
    return ContentItemOut.model_validate(item)


@router.patch("/{plan_id}/items/{item_id}", response_model=ContentItemOut)
async def update_content_item(
    plan_id: uuid.UUID,
    item_id: uuid.UUID,
    body: UpdateItemRequest,
    current_user: CurrentUser,
    db: DB,
):
    # Verify plan belongs to org
    await _get_plan_or_404(plan_id, current_user.org_id, db)

    result = await db.execute(
        select(ContentItem).where(
            ContentItem.id == item_id,
            ContentItem.plan_id == plan_id,
            ContentItem.org_id == current_user.org_id,
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content item not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(item, field, value)

    await db.flush()
    await db.refresh(item)
    await db.commit()
    return ContentItemOut.model_validate(item)


@router.delete("/{plan_id}/items/{item_id}", status_code=204)
async def delete_content_item(
    plan_id: uuid.UUID,
    item_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    # Verify plan belongs to org
    await _get_plan_or_404(plan_id, current_user.org_id, db)

    result = await db.execute(
        select(ContentItem).where(
            ContentItem.id == item_id,
            ContentItem.plan_id == plan_id,
            ContentItem.org_id == current_user.org_id,
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content item not found")

    await db.delete(item)
    await db.commit()
    return None


@router.post("/{plan_id}/generate", status_code=202)
async def generate_content_plan(
    plan_id: uuid.UUID,
    body: GenerateRequest,
    current_user: CurrentUser,
    db: DB,
):
    plan = await _get_plan_or_404(plan_id, current_user.org_id, db)

    # Find last completed keyword research job for this project
    job_result = await db.execute(
        select(KeywordResearchJob)
        .where(
            KeywordResearchJob.project_id == plan.project_id,
            KeywordResearchJob.org_id == current_user.org_id,
            KeywordResearchJob.status == ResearchStatus.completed,
        )
        .order_by(KeywordResearchJob.created_at.desc())
        .limit(1)
    )
    job = job_result.scalar_one_or_none()

    today = date.today()
    items_to_add: list[ContentItem] = []

    if job is None:
        # Fallback: use seed_keyword to create 5 generic items
        seed = body.seed_keyword or "content"
        generic_titles = [
            f"{seed.title()} — Complete Guide",
            f"Best {seed.title()} Tools",
            f"How to {seed.title()} Effectively",
            f"Top {seed.title()} Strategies",
            f"{seed.title()} Tips and Tricks",
        ]
        for i, title in enumerate(generic_titles):
            scheduled = (today + timedelta(days=7 * i)).isoformat()
            items_to_add.append(
                ContentItem(
                    plan_id=plan.id,
                    org_id=current_user.org_id,
                    project_id=plan.project_id,
                    title=title,
                    content_type=ContentItemType.article,
                    status=ContentItemStatus.idea,
                    target_keyword=seed,
                    word_count_target=1500,
                    scheduled_date=scheduled,
                )
            )
    else:
        # Fetch top 10 keywords by search volume
        kw_result = await db.execute(
            select(Keyword)
            .where(Keyword.job_id == job.id)
            .order_by(Keyword.search_volume.desc().nullslast())
            .limit(10)
        )
        keywords = kw_result.scalars().all()

        for i, kw in enumerate(keywords):
            intent = kw.intent
            keyword_str = kw.keyword

            if intent == KeywordIntent.informational:
                title = f"{keyword_str.title()} — Complete Guide"
                word_count = 1500
            elif intent == KeywordIntent.commercial:
                title = f"Best {keyword_str.title()}"
                word_count = 2000
            elif intent == KeywordIntent.navigational:
                title = f"How to {keyword_str.title()}"
                word_count = 1200
            else:
                title = f"{keyword_str.title()} — Complete Guide"
                word_count = 1200

            scheduled = (today + timedelta(days=7 * i)).isoformat()
            items_to_add.append(
                ContentItem(
                    plan_id=plan.id,
                    org_id=current_user.org_id,
                    project_id=plan.project_id,
                    title=title,
                    content_type=ContentItemType.article,
                    status=ContentItemStatus.idea,
                    target_keyword=keyword_str,
                    word_count_target=word_count,
                    scheduled_date=scheduled,
                )
            )

    for item in items_to_add:
        db.add(item)

    await db.commit()

    return {"plan_id": str(plan.id), "items_added": len(items_to_add)}
