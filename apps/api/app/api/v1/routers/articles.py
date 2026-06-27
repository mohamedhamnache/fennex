import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, status, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

import arq

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.models.article import Article, ArticleRevision, ArticleStatus
from app.models.project import Project

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class ArticleOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    title: str
    target_keyword: Optional[str]
    tone: str
    status: str
    body_markdown: Optional[str]
    body_html: Optional[str]
    word_count: int
    word_count_target: int
    seo_score: Optional[float]
    meta_title: Optional[str]
    meta_description: Optional[str]
    outline: Optional[dict]
    brand_voice_id: Optional[uuid.UUID]
    content_item_id: Optional[uuid.UUID]
    error: Optional[str]
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class CreateArticleRequest(BaseModel):
    project_id: uuid.UUID
    title: str
    target_keyword: Optional[str] = None
    tone: Optional[str] = "professional"
    brand_voice_id: Optional[uuid.UUID] = None
    content_item_id: Optional[uuid.UUID] = None
    word_count_target: Optional[int] = 1500


class UpdateArticleRequest(BaseModel):
    title: Optional[str] = None
    target_keyword: Optional[str] = None
    tone: Optional[str] = None
    body_markdown: Optional[str] = None
    body_html: Optional[str] = None
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    brand_voice_id: Optional[uuid.UUID] = None


class GenerateArticleRequest(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = None


class SaveRevisionRequest(BaseModel):
    note: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_article_or_404(article_id: uuid.UUID, org_id: uuid.UUID, db) -> Article:
    result = await db.execute(
        select(Article).where(Article.id == article_id, Article.org_id == org_id)
    )
    article = result.scalar_one_or_none()
    if article is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Article not found")
    return article


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("", status_code=201, response_model=ArticleOut)
async def create_article(
    body: CreateArticleRequest,
    current_user: CurrentUser,
    db: DB,
):
    # Verify project belongs to org
    proj_result = await db.execute(
        select(Project).where(Project.id == body.project_id, Project.org_id == current_user.org_id)
    )
    if proj_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    article = Article(
        org_id=current_user.org_id,
        project_id=body.project_id,
        title=body.title,
        target_keyword=body.target_keyword,
        tone=body.tone or "professional",
        status=ArticleStatus.draft,
        brand_voice_id=body.brand_voice_id,
        content_item_id=body.content_item_id,
        word_count_target=body.word_count_target or 1500,
    )
    db.add(article)
    await db.flush()
    await db.refresh(article)
    await db.commit()
    return ArticleOut.model_validate(article)


@router.get("", response_model=list[ArticleOut])
async def list_articles(
    current_user: CurrentUser,
    db: DB,
    project_id: uuid.UUID = Query(...),
):
    result = await db.execute(
        select(Article)
        .where(
            Article.project_id == project_id,
            Article.org_id == current_user.org_id,
        )
        .order_by(Article.created_at.desc())
    )
    articles = result.scalars().all()
    return [ArticleOut.model_validate(a) for a in articles]


@router.get("/{article_id}", response_model=ArticleOut)
async def get_article(
    article_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    article = await _get_article_or_404(article_id, current_user.org_id, db)
    return ArticleOut.model_validate(article)


@router.patch("/{article_id}", response_model=ArticleOut)
async def update_article(
    article_id: uuid.UUID,
    body: UpdateArticleRequest,
    current_user: CurrentUser,
    db: DB,
):
    article = await _get_article_or_404(article_id, current_user.org_id, db)

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(article, field, value)

    # Recalculate word_count if body_markdown was updated
    if "body_markdown" in update_data and update_data["body_markdown"]:
        article.word_count = len(update_data["body_markdown"].split())

    await db.flush()
    await db.refresh(article)
    await db.commit()
    return ArticleOut.model_validate(article)


@router.delete("/{article_id}", status_code=204)
async def delete_article(
    article_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    article = await _get_article_or_404(article_id, current_user.org_id, db)
    await db.delete(article)
    await db.commit()
    return None


@router.post("/{article_id}/generate", response_model=ArticleOut)
async def generate_article(
    article_id: uuid.UUID,
    body: GenerateArticleRequest,
    current_user: CurrentUser,
    db: DB,
):
    article = await _get_article_or_404(article_id, current_user.org_id, db)

    article.status = ArticleStatus.generating
    article.error = None
    await db.flush()
    await db.commit()
    await db.refresh(article)

    redis_pool = await arq.create_pool(settings.REDIS_SETTINGS)
    try:
        await redis_pool.enqueue_job(
            "generate_article_task",
            str(article.id),
            str(current_user.org_id),
            provider_override=body.provider,
            model_override=body.model,
        )
    finally:
        await redis_pool.aclose()

    return ArticleOut.model_validate(article)


@router.post("/{article_id}/save-revision")
async def save_revision(
    article_id: uuid.UUID,
    body: SaveRevisionRequest,
    current_user: CurrentUser,
    db: DB,
):
    article = await _get_article_or_404(article_id, current_user.org_id, db)

    if not article.body_markdown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Article has no content to save as revision",
        )

    revision = ArticleRevision(
        article_id=article.id,
        body_markdown=article.body_markdown,
        word_count=article.word_count,
        note=body.note,
    )
    db.add(revision)
    await db.flush()
    await db.refresh(revision)
    await db.commit()
    return {"revision_id": str(revision.id), "created_at": revision.created_at.isoformat()}


@router.get("/{article_id}/seo-score")
async def get_seo_score(
    article_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    article = await _get_article_or_404(article_id, current_user.org_id, db)

    body = article.body_markdown or ""
    kw = (article.target_keyword or "").lower().strip()
    title_lower = article.title.lower()

    breakdown = {}
    score = 0.0

    # keyword in title: +20
    if kw and kw in title_lower:
        breakdown["keyword_in_title"] = 20
        score += 20
    else:
        breakdown["keyword_in_title"] = 0

    # keyword in first paragraph: +15
    paragraphs = [p.strip() for p in body.split("\n\n") if p.strip()]
    first_para = paragraphs[0].lower() if paragraphs else ""
    if kw and kw in first_para:
        breakdown["keyword_in_first_paragraph"] = 15
        score += 15
    else:
        breakdown["keyword_in_first_paragraph"] = 0

    # keyword density 0.5-2.5%: +15 (else partial)
    words = body.split()
    total_words = len(words)
    if kw and total_words > 0:
        kw_count = body.lower().count(kw)
        density = (kw_count / total_words) * 100
        if 0.5 <= density <= 2.5:
            breakdown["keyword_density"] = 15
            score += 15
        elif density > 0:
            breakdown["keyword_density"] = 7
            score += 7
        else:
            breakdown["keyword_density"] = 0
    else:
        breakdown["keyword_density"] = 0

    # word_count >= 1000: +15, >= 1500: +20
    if total_words >= 1500:
        breakdown["word_count"] = 20
        score += 20
    elif total_words >= 1000:
        breakdown["word_count"] = 15
        score += 15
    else:
        breakdown["word_count"] = 0

    # has H2 headings: +15
    if "## " in body:
        breakdown["has_h2_headings"] = 15
        score += 15
    else:
        breakdown["has_h2_headings"] = 0

    # meta_description present: +15
    if article.meta_description:
        breakdown["meta_description"] = 15
        score += 15
    else:
        breakdown["meta_description"] = 0

    return {"score": round(score, 1), "breakdown": breakdown}
