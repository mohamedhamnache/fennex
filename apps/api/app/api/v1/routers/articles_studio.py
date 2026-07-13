import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.dependencies import CurrentUser, DB
from app.models.article import Article
from app.models.project import Project
from app.services import checks_service, writing_service

router = APIRouter()

NO_AI_KEY_MESSAGE = "No AI key configured. Add an Anthropic or OpenAI key in Settings."


class TransformRequest(BaseModel):
    mode: str
    text: str


class TransformResponse(BaseModel):
    text: str


class ChatRequest(BaseModel):
    question: str
    history: list[dict] | None = None
    body: str | None = None


class ChatResponse(BaseModel):
    answer: str
    insertable: str | None
    revised: str | None = None
    meta_title: str | None = None
    meta_description: str | None = None


async def _load_article_and_project(article_id: uuid.UUID, current_user: CurrentUser, db: DB) -> tuple[Article, Project]:
    result = await db.execute(
        select(Article).where(
            Article.id == article_id,
            Article.org_id == current_user.org_id,
        )
    )
    article = result.scalar_one_or_none()
    if article is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Article not found")

    project_result = await db.execute(select(Project).where(Project.id == article.project_id))
    project = project_result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")

    return article, project


@router.post("/{article_id}/transform", response_model=TransformResponse)
async def transform_selection(article_id: uuid.UUID, body: TransformRequest, current_user: CurrentUser, db: DB):
    article, project = await _load_article_and_project(article_id, current_user, db)
    try:
        text = await writing_service.transform(project, body.mode, body.text, db)
    except writing_service.TextTooLong:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Text too long")
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except RuntimeError as e:
        if str(e) == "no_ai_key":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_AI_KEY_MESSAGE)
        raise
    return TransformResponse(text=text)


@router.post("/{article_id}/chat", response_model=ChatResponse)
async def studio_chat(article_id: uuid.UUID, body: ChatRequest, current_user: CurrentUser, db: DB):
    article, project = await _load_article_and_project(article_id, current_user, db)
    try:
        result = await writing_service.chat(
            project, article, body.question, body.history or [], db, live_body=body.body
        )
    except RuntimeError as e:
        if str(e) == "no_ai_key":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_AI_KEY_MESSAGE)
        raise
    return ChatResponse(**result)


@router.post("/{article_id}/checks")
async def studio_checks(article_id: uuid.UUID, current_user: CurrentUser, db: DB):
    article, project = await _load_article_and_project(article_id, current_user, db)
    seo = checks_service.seo_checklist(article, article.target_keyword)
    ai = checks_service.ai_patterns(article.body_markdown or "", (project.locale or "en")[:2])
    return {"seo": seo, "ai": ai}


@router.post("/{article_id}/plagiarism")
async def studio_plagiarism(article_id: uuid.UUID, current_user: CurrentUser, db: DB):
    article, project = await _load_article_and_project(article_id, current_user, db)
    try:
        result = await checks_service.plagiarism_scan(project, article, db)
    except checks_service.NoProvider:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "no_seo_provider"})
    return result
