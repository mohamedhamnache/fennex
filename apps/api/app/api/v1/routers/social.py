"""Social media studio endpoints."""
import json
import uuid
from datetime import datetime, timezone
from typing import Annotated, Optional
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.billing import check_usage_limit, check_project_not_locked, increment_usage
from app.core.config import settings
from app.core.dependencies import get_current_user, get_db
from app.core.security import decrypt_value
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
    await check_project_not_locked(body.project_id, db)
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


# ── Nomad outreach plan (registered before /{post_id} to avoid UUID coercion) ─

class OutreachPlanRequest(_BaseModel):
    goal: str = ""


@router.post("/outreach-plan")
async def create_outreach_plan(
    project_id: uuid.UUID,
    body: OutreachPlanRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Nomad: generate a week of LinkedIn posts + DM templates; posts saved as drafts."""
    await check_project_not_locked(project_id, db)
    from app.services.nomad_service import generate_outreach_plan
    return await generate_outreach_plan(project_id, current_user.org_id, body.goal, db)


# ── LinkedIn OAuth (registered before /{post_id} to avoid UUID coercion) ──────

@router.post("/linkedin/connect")
async def linkedin_connect(
    return_to: str = "/",
    current_user: User = Depends(get_current_user),
):
    """Start the LinkedIn OAuth flow. Returns the authorization URL."""
    if not settings.LINKEDIN_CLIENT_ID or not settings.LINKEDIN_CLIENT_SECRET:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "LinkedIn OAuth is not configured. Set LINKEDIN_CLIENT_ID and "
            "LINKEDIN_CLIENT_SECRET in the API environment (create an app at "
            "https://developer.linkedin.com with the 'Share on LinkedIn' and "
            "'Sign In with LinkedIn using OpenID Connect' products).",
        )
    state = f"{current_user.org_id}|{return_to}"
    url = (
        "https://www.linkedin.com/oauth/v2/authorization"
        "?response_type=code"
        f"&client_id={settings.LINKEDIN_CLIENT_ID}"
        f"&redirect_uri={quote(settings.LINKEDIN_REDIRECT_URI, safe='')}"
        f"&scope={quote('openid profile w_member_social')}"
        f"&state={quote(state)}"
    )
    return {"redirect_url": url}


@router.get("/linkedin/callback")
async def linkedin_callback(
    db: AsyncSession = Depends(get_db),
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
):
    """Exchange the LinkedIn code for a token and store the connection."""
    org_part, _, return_to = (state or "").partition("|")
    return_to = return_to or "/"
    if error or not code or not org_part:
        return RedirectResponse(f"{settings.FRONTEND_URL}{return_to}?linkedin_error={error or 'missing_params'}")
    try:
        org_id = uuid.UUID(org_part)
    except ValueError:
        return RedirectResponse(f"{settings.FRONTEND_URL}{return_to}?linkedin_error=invalid_state")

    async with httpx.AsyncClient(timeout=20) as client:
        token_resp = await client.post(
            "https://www.linkedin.com/oauth/v2/accessToken",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": settings.LINKEDIN_CLIENT_ID,
                "client_secret": settings.LINKEDIN_CLIENT_SECRET,
                "redirect_uri": settings.LINKEDIN_REDIRECT_URI,
            },
        )
        if token_resp.status_code != 200:
            return RedirectResponse(f"{settings.FRONTEND_URL}{return_to}?linkedin_error=token_exchange_failed")
        access_token = token_resp.json().get("access_token", "")

        userinfo_resp = await client.get(
            "https://api.linkedin.com/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    name, sub = None, None
    if userinfo_resp.status_code == 200:
        info = userinfo_resp.json()
        name, sub = info.get("name"), info.get("sub")

    # Store token + member URN together (URN is required for posting)
    payload = json.dumps({"access_token": access_token, "urn": f"urn:li:person:{sub}" if sub else None})
    from app.services.social_connections_service import upsert_connection
    await upsert_connection(org_id, "linkedin", name, payload, db)

    return RedirectResponse(f"{settings.FRONTEND_URL}{return_to}?linkedin_connected=1")


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
    """Publish a social post — pushes to LinkedIn for real when connected."""
    post = await _get_post_or_404(post_id, current_user, db)

    # Real LinkedIn publishing via the connected account
    if post.platform == SocialPlatform.linkedin:
        from app.models.social import SocialConnection
        conn_result = await db.execute(
            select(SocialConnection).where(
                SocialConnection.org_id == current_user.org_id,
                SocialConnection.platform == SocialPlatform.linkedin,
            )
        )
        conn = conn_result.scalar_one_or_none()
        if conn:
            try:
                creds = json.loads(decrypt_value(conn.encrypted_token))
            except Exception:
                creds = {}
            token, urn = creds.get("access_token"), creds.get("urn")
            if token and urn:
                text = post.content
                if post.hashtags:
                    text += "\n\n" + " ".join(h if h.startswith("#") else f"#{h}" for h in post.hashtags)
                body = {
                    "author": urn,
                    "lifecycleState": "PUBLISHED",
                    "specificContent": {
                        "com.linkedin.ugc.ShareContent": {
                            "shareCommentary": {"text": text[:2900]},
                            "shareMediaCategory": "NONE",
                        }
                    },
                    "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
                }
                async with httpx.AsyncClient(timeout=20) as client:
                    resp = await client.post(
                        "https://api.linkedin.com/v2/ugcPosts",
                        headers={
                            "Authorization": f"Bearer {token}",
                            "X-Restli-Protocol-Version": "2.0.0",
                        },
                        json=body,
                    )
                if resp.status_code not in (200, 201):
                    raise HTTPException(
                        status.HTTP_502_BAD_GATEWAY,
                        f"LinkedIn rejected the post ({resp.status_code}): {resp.text[:180]} — "
                        "try reconnecting LinkedIn.",
                    )

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
