import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from app.core.dependencies import CurrentUser, DB
from app.core.security import encrypt_credentials, decrypt_credentials
from app.integrations.publishing.wordpress import WordPressConnector
from app.models.article import Article, ArticleStatus
from app.models.project import Project
from app.models.publishing import PublishingConnection, PublishingPlatform, PublishJob, PublishJobStatus

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class CredentialsIn(BaseModel):
    username: str
    app_password: str


class CreateConnectionRequest(BaseModel):
    project_id: uuid.UUID
    name: str
    platform: PublishingPlatform
    site_url: str
    credentials: CredentialsIn


class UpdateConnectionRequest(BaseModel):
    name: Optional[str] = None
    site_url: Optional[str] = None
    credentials: Optional[CredentialsIn] = None
    is_active: Optional[bool] = None


class ConnectionOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    platform: str
    site_url: str
    is_active: bool
    last_tested_at: Optional[str]
    last_test_ok: Optional[bool]
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class PublishRequest(BaseModel):
    article_id: uuid.UUID
    connection_id: uuid.UUID
    publish_status: str = "draft"  # "draft" | "publish"


class PublishJobOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    connection_id: uuid.UUID
    article_id: Optional[uuid.UUID]
    status: str
    platform_post_id: Optional[str]
    published_url: Optional[str]
    error: Optional[str]
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_connection_or_404(connection_id: uuid.UUID, org_id: uuid.UUID, db) -> PublishingConnection:
    result = await db.execute(
        select(PublishingConnection).where(
            PublishingConnection.id == connection_id,
            PublishingConnection.org_id == org_id,
        )
    )
    conn = result.scalar_one_or_none()
    if conn is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")
    return conn


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/connections", status_code=201, response_model=ConnectionOut)
async def create_connection(
    body: CreateConnectionRequest,
    current_user: CurrentUser,
    db: DB,
):
    # Verify project belongs to org
    proj_result = await db.execute(
        select(Project).where(Project.id == body.project_id, Project.org_id == current_user.org_id)
    )
    if proj_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    credentials_encrypted = encrypt_credentials(body.credentials.model_dump())

    connection = PublishingConnection(
        org_id=current_user.org_id,
        project_id=body.project_id,
        name=body.name,
        platform=body.platform,
        site_url=body.site_url.rstrip("/"),
        credentials_encrypted=credentials_encrypted,
        is_active=True,
    )
    db.add(connection)
    await db.flush()
    await db.refresh(connection)
    await db.commit()
    return ConnectionOut.model_validate(connection)


@router.get("/connections", response_model=list[ConnectionOut])
async def list_connections(
    current_user: CurrentUser,
    db: DB,
    project_id: uuid.UUID = Query(...),
):
    result = await db.execute(
        select(PublishingConnection).where(
            PublishingConnection.project_id == project_id,
            PublishingConnection.org_id == current_user.org_id,
        ).order_by(PublishingConnection.created_at.desc())
    )
    connections = result.scalars().all()
    return [ConnectionOut.model_validate(c) for c in connections]


@router.get("/connections/{connection_id}", response_model=ConnectionOut)
async def get_connection(
    connection_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    conn = await _get_connection_or_404(connection_id, current_user.org_id, db)
    return ConnectionOut.model_validate(conn)


@router.patch("/connections/{connection_id}", response_model=ConnectionOut)
async def update_connection(
    connection_id: uuid.UUID,
    body: UpdateConnectionRequest,
    current_user: CurrentUser,
    db: DB,
):
    conn = await _get_connection_or_404(connection_id, current_user.org_id, db)

    if body.name is not None:
        conn.name = body.name
    if body.site_url is not None:
        conn.site_url = body.site_url.rstrip("/")
    if body.is_active is not None:
        conn.is_active = body.is_active
    if body.credentials is not None:
        conn.credentials_encrypted = encrypt_credentials(body.credentials.model_dump())

    await db.flush()
    await db.refresh(conn)
    await db.commit()
    return ConnectionOut.model_validate(conn)


@router.delete("/connections/{connection_id}", status_code=204)
async def delete_connection(
    connection_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    conn = await _get_connection_or_404(connection_id, current_user.org_id, db)
    await db.delete(conn)
    await db.commit()
    return None


@router.post("/connections/{connection_id}/test")
async def test_connection(
    connection_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    conn = await _get_connection_or_404(connection_id, current_user.org_id, db)

    if not conn.credentials_encrypted:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No credentials stored")

    creds = decrypt_credentials(conn.credentials_encrypted)
    wp = WordPressConnector(
        site_url=conn.site_url,
        username=creds["username"],
        app_password=creds["app_password"],
    )
    result = await wp.test_connection()

    conn.last_tested_at = datetime.now(timezone.utc).isoformat()
    conn.last_test_ok = result.get("ok", False)
    await db.flush()
    await db.commit()

    return result


@router.post("/publish", response_model=PublishJobOut)
async def publish_article(
    body: PublishRequest,
    current_user: CurrentUser,
    db: DB,
):
    # Look up article
    article_result = await db.execute(
        select(Article).where(Article.id == body.article_id, Article.org_id == current_user.org_id)
    )
    article = article_result.scalar_one_or_none()
    if article is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found")

    if article.status not in (ArticleStatus.ready, ArticleStatus.published):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Article must be in 'ready' or 'published' state, got '{article.status.value}'"
        )

    # Look up connection
    conn = await _get_connection_or_404(body.connection_id, current_user.org_id, db)
    if not conn.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connection is not active")

    # Create PublishJob with status=running
    job = PublishJob(
        org_id=current_user.org_id,
        project_id=article.project_id,
        connection_id=conn.id,
        article_id=article.id,
        status=PublishJobStatus.running,
    )
    db.add(job)
    await db.flush()

    # Guard: credentials must be present before attempting decrypt
    if not conn.credentials_encrypted:
        raise HTTPException(status_code=400, detail="Connection has no credentials stored")

    # Decrypt credentials and call WordPress; mark job failed on any exception
    try:
        creds = decrypt_credentials(conn.credentials_encrypted)
        wp = WordPressConnector(
            site_url=conn.site_url,
            username=creds["username"],
            app_password=creds["app_password"],
        )

        result = await wp.publish_post(
            title=article.title,
            content_html=article.body_html or "",
            status=body.publish_status,
            meta_title=article.meta_title,
            meta_description=article.meta_description,
        )
    except Exception as exc:
        job.status = PublishJobStatus.failed
        job.error = str(exc)
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Publish failed: {exc}") from exc

    if result.get("ok"):
        job.status = PublishJobStatus.done
        job.platform_post_id = str(result["post_id"])
        job.published_url = result.get("url")
        job.meta = result.get("raw")
        article.status = ArticleStatus.published
    else:
        job.status = PublishJobStatus.failed
        job.error = result.get("error")

    await db.flush()
    await db.refresh(job)
    await db.commit()
    return PublishJobOut.model_validate(job)


@router.get("/jobs", response_model=list[PublishJobOut])
async def list_jobs(
    current_user: CurrentUser,
    db: DB,
    project_id: uuid.UUID = Query(...),
):
    result = await db.execute(
        select(PublishJob).where(
            PublishJob.project_id == project_id,
            PublishJob.org_id == current_user.org_id,
        ).order_by(PublishJob.created_at.desc())
    )
    jobs = result.scalars().all()
    return [PublishJobOut.model_validate(j) for j in jobs]


@router.get("/jobs/{job_id}", response_model=PublishJobOut)
async def get_job(
    job_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    result = await db.execute(
        select(PublishJob).where(
            PublishJob.id == job_id,
            PublishJob.org_id == current_user.org_id,
        )
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return PublishJobOut.model_validate(job)
