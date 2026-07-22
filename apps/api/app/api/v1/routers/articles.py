import uuid
from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

import arq

from app.core.billing import check_usage_limit, check_project_not_locked, increment_usage
from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.models.article import Article, ArticleRevision, ArticleStatus
from app.models.project import Project
from app.services.article_service import compute_seo_score
from app.services.geo_service import compute_geo_core

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
    geo_score: Optional[float]
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

    # Keep the stored SEO score in sync with the live on-page score so the
    # overview cards match what the editor shows.
    score, _ = compute_seo_score(
        article.title, article.body_markdown, article.target_keyword, article.meta_description
    )
    article.seo_score = score
    article.geo_score = compute_geo_core(article.title, article.body_markdown, article.meta_description)[0]

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
    _: Annotated[None, Depends(check_usage_limit("articles"))],
):
    article = await _get_article_or_404(article_id, current_user.org_id, db)
    await check_project_not_locked(article.project_id, db)

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

    await increment_usage(current_user.org_id, "articles", db)
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


@router.get("/{article_id}/revisions")
async def list_revisions(
    article_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    """Revision history (newest first) for the studio's commit-style timeline."""
    article = await _get_article_or_404(article_id, current_user.org_id, db)
    result = await db.execute(
        select(ArticleRevision)
        .where(ArticleRevision.article_id == article.id)
        .order_by(ArticleRevision.created_at.desc())
        .limit(50)
    )
    revisions = result.scalars().all()
    return [
        {
            "id": str(r.id),
            "note": r.note,
            "word_count": r.word_count,
            "body_markdown": r.body_markdown,
            "created_at": r.created_at.isoformat(),
        }
        for r in revisions
    ]


@router.get("/{article_id}/seo-score")
async def get_seo_score(
    article_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    article = await _get_article_or_404(article_id, current_user.org_id, db)

    score, breakdown = compute_seo_score(
        article.title, article.body_markdown, article.target_keyword, article.meta_description
    )

    # Persist so the list/overview cards reflect the same score as the editor.
    if article.seo_score != score:
        article.seo_score = score
        await db.commit()

    return {"score": score, "breakdown": breakdown}


@router.get("/{article_id}/geo-score")
async def get_geo_score(article_id: uuid.UUID, current_user: CurrentUser, db: DB):
    article = await _get_article_or_404(article_id, current_user.org_id, db)
    _, breakdown = compute_geo_core(article.title, article.body_markdown, article.meta_description)
    return {"geo_score": article.geo_score, "breakdown": breakdown}


class TitleSuggestions(BaseModel):
    ok: bool
    titles: list[str] = []
    error: Optional[str] = None


@router.post("/{article_id}/suggest-titles", response_model=TitleSuggestions)
async def suggest_titles(article_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Zerda proposes several SEO-optimized, click-worthy headline options for the
    article, grounded in its own body and target keyword."""
    import json, re
    from app.services.llm_service import get_org_llm_keys, call_llm, project_locale
    from app.services.agents.tiers import resolve_model

    article = await _get_article_or_404(article_id, current_user.org_id, db)
    keys = await get_org_llm_keys(current_user.org_id, db)
    if not keys:
        return TitleSuggestions(ok=False, error="No AI key configured. Add an Anthropic or OpenAI key in Settings.")
    provider, model = resolve_model("balanced", "light", list(keys.keys()))

    excerpt = (article.body_markdown or "")[:1800]
    system = (
        "You are an expert SEO copywriter. Propose 6 headline options for the article. "
        "Each must: be under 60 characters, read naturally, promise a clear benefit, and use the "
        "target keyword where it fits without stuffing. Vary the angles (how-to, list, question, "
        "outcome, contrarian). No emoji, no numbering, no surrounding quotes. "
        'Return ONLY a JSON array of strings, e.g. ["Title one", "Title two"].'
    )
    user = (
        f"TARGET KEYWORD: {article.target_keyword or '(none)'}\n"
        f"CURRENT TITLE: {article.title}\n\nARTICLE EXCERPT:\n{excerpt}"
    )
    try:
        raw = await call_llm(provider, model, keys[provider], system, user,
                             locale=await project_locale(article.project_id, db))
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
        titles = json.loads(cleaned)
    except Exception:
        return TitleSuggestions(ok=False, error="Could not generate titles — please try again.")
    titles = [str(t).strip().strip('"').strip() for t in titles if isinstance(titles, list) and str(t).strip()][:6]
    if not titles:
        return TitleSuggestions(ok=False, error="The AI returned no usable titles — please try again.")
    return TitleSuggestions(ok=True, titles=titles)
