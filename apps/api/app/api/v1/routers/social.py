"""Social media studio endpoints."""
import uuid
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.billing import check_usage_limit, increment_usage
from app.core.dependencies import get_current_user, get_db
from app.models.article import Article
from app.models.social import SocialPost, SocialPlatform, SocialPostStatus, SocialPostType
from app.models.user import User
from app.services.social_service import generate_social_post

router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class SocialPostOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    platform: str
    post_type: str
    status: str
    content: str
    hashtags: list | None
    media_urls: list | None
    scheduled_at: str | None
    published_at: str | None
    article_id: uuid.UUID | None
    engagement_stats: dict | None
    error: str | None
    char_count: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class SocialPostCreate(BaseModel):
    project_id: uuid.UUID
    platform: SocialPlatform
    post_type: Optional[SocialPostType] = SocialPostType.article_share
    content: str
    hashtags: Optional[list] = None
    scheduled_at: Optional[str] = None
    article_id: Optional[uuid.UUID] = None


class SocialPostUpdate(BaseModel):
    content: Optional[str] = None
    hashtags: Optional[list] = None
    scheduled_at: Optional[str] = None
    status: Optional[SocialPostStatus] = None
    media_urls: Optional[list] = None


class SocialPostGenerate(BaseModel):
    project_id: uuid.UUID
    platform: SocialPlatform
    post_type: Optional[SocialPostType] = SocialPostType.article_share
    article_id: Optional[uuid.UUID] = None


class ScheduleRequest(BaseModel):
    scheduled_at: str


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_post_or_404(
    post_id: uuid.UUID,
    current_user: User,
    db: AsyncSession,
) -> SocialPost:
    result = await db.execute(
        select(SocialPost).where(
            SocialPost.id == post_id,
            SocialPost.org_id == current_user.org_id,
        )
    )
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Social post not found")
    return post


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("", response_model=SocialPostOut, status_code=201)
async def create_social_post(
    body: SocialPostCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(check_usage_limit("social")),
):
    """Create a social post manually."""
    post = SocialPost(
        org_id=current_user.org_id,
        project_id=body.project_id,
        platform=body.platform,
        post_type=body.post_type,
        status=SocialPostStatus.draft,
        content=body.content,
        hashtags=body.hashtags,
        scheduled_at=body.scheduled_at,
        article_id=body.article_id,
        char_count=len(body.content),
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)
    await increment_usage(current_user.org_id, "social", db)
    return post


@router.get("", response_model=list[SocialPostOut])
async def list_social_posts(
    project_id: uuid.UUID,
    platform: Optional[SocialPlatform] = None,
    status: Optional[SocialPostStatus] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all social posts for a project, optionally filtered."""
    query = select(SocialPost).where(
        SocialPost.project_id == project_id,
        SocialPost.org_id == current_user.org_id,
    )
    if platform is not None:
        query = query.where(SocialPost.platform == platform)
    if status is not None:
        query = query.where(SocialPost.status == status)
    query = query.order_by(SocialPost.created_at.desc())
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/generate", response_model=SocialPostOut, status_code=201)
async def generate_post(
    body: SocialPostGenerate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate a social post using heuristic content generation."""
    title = "SEO and Digital Marketing"
    keyword = None
    article_url = None

    if body.article_id:
        result = await db.execute(
            select(Article).where(
                Article.id == body.article_id,
                Article.org_id == current_user.org_id,
            )
        )
        article = result.scalar_one_or_none()
        if not article:
            raise HTTPException(status_code=404, detail="Article not found")
        title = article.title
        keyword = article.target_keyword
        # No real URL in this phase
        article_url = None

    generated = generate_social_post(
        platform=body.platform.value,
        post_type=body.post_type.value if body.post_type else "article_share",
        title=title,
        keyword=keyword,
        article_url=article_url,
    )

    post = SocialPost(
        org_id=current_user.org_id,
        project_id=body.project_id,
        platform=body.platform,
        post_type=body.post_type or SocialPostType.article_share,
        status=SocialPostStatus.draft,
        content=generated["content"],
        hashtags=generated["hashtags"],
        char_count=generated["char_count"],
        article_id=body.article_id,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)
    return post


# ── Social Connections schemas (must be defined before GET /connections route) ─
from pydantic import BaseModel as _BaseModel


class SocialConnectionOut(_BaseModel):
    id: str
    platform: str
    handle: str | None
    model_config = {"from_attributes": True}


class SocialConnectionUpsert(_BaseModel):
    handle: str | None = None
    token: str


# NOTE: GET /connections is registered here (before GET /{post_id}) so that
# FastAPI does not try to coerce "connections" as a UUID path parameter.
@router.get("/connections", response_model=list[SocialConnectionOut])
async def list_social_connections(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.social_connections_service import list_connections
    conns = await list_connections(current_user.org_id, db)
    return [SocialConnectionOut(id=str(c.id), platform=c.platform, handle=c.handle) for c in conns]


@router.get("/{post_id}", response_model=SocialPostOut)
async def get_social_post(
    post_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single social post."""
    return await _get_post_or_404(post_id, current_user, db)


@router.patch("/{post_id}", response_model=SocialPostOut)
async def update_social_post(
    post_id: uuid.UUID,
    body: SocialPostUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a social post (partial update)."""
    post = await _get_post_or_404(post_id, current_user, db)

    if body.content is not None:
        post.content = body.content
        post.char_count = len(body.content)
    if body.hashtags is not None:
        post.hashtags = body.hashtags
    if body.scheduled_at is not None:
        post.scheduled_at = body.scheduled_at
    if body.status is not None:
        post.status = body.status
    if body.media_urls is not None:
        post.media_urls = body.media_urls

    await db.commit()
    await db.refresh(post)
    return post


@router.delete("/{post_id}", status_code=204)
async def delete_social_post(
    post_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a social post."""
    post = await _get_post_or_404(post_id, current_user, db)
    await db.delete(post)
    await db.commit()


@router.post("/{post_id}/schedule", response_model=SocialPostOut)
async def schedule_post(
    post_id: uuid.UUID,
    body: ScheduleRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Schedule a social post."""
    post = await _get_post_or_404(post_id, current_user, db)
    post.status = SocialPostStatus.scheduled
    post.scheduled_at = body.scheduled_at
    await db.commit()
    await db.refresh(post)
    return post


@router.post("/{post_id}/publish", response_model=SocialPostOut)
async def publish_post(
    post_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark a social post as published."""
    post = await _get_post_or_404(post_id, current_user, db)
    post.status = SocialPostStatus.published
    post.published_at = datetime.now(timezone.utc).isoformat()
    await db.commit()
    await db.refresh(post)
    return post


# ── Social Connections endpoints (PUT / DELETE) ───────────────────────────────

@router.put("/connections/{platform}", response_model=SocialConnectionOut)
async def upsert_social_connection(
    platform: str,
    body: SocialConnectionUpsert,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.social_connections_service import upsert_connection, VALID_PLATFORMS
    if platform not in VALID_PLATFORMS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid platform. Must be one of: {', '.join(sorted(VALID_PLATFORMS))}",
        )
    conn = await upsert_connection(current_user.org_id, platform, body.handle, body.token, db)
    return SocialConnectionOut(id=str(conn.id), platform=conn.platform, handle=conn.handle)


@router.delete("/connections/{platform}", status_code=204)
async def delete_social_connection(
    platform: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.social_connections_service import delete_connection, VALID_PLATFORMS
    if platform not in VALID_PLATFORMS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid platform. Must be one of: {', '.join(sorted(VALID_PLATFORMS))}",
        )
    deleted = await delete_connection(current_user.org_id, platform, db)
    if not deleted:
        raise HTTPException(status_code=404, detail="Connection not found")
