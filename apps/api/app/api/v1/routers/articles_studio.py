import json
import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.core.billing import check_project_not_locked, check_usage_limit, increment_usage
from app.core.database import async_session_factory
from app.core.dependencies import CurrentUser, DB
from app.models.article import Article, ArticleRevision, ArticleStatus
from app.models.brand_voice import BrandVoice
from app.models.project import Project
from app.services import checks_service, writing_service

logger = logging.getLogger(__name__)

router = APIRouter()

SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

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


@router.post("/{article_id}/chat/stream")
async def studio_chat_stream(article_id: uuid.UUID, body: ChatRequest, current_user: CurrentUser, db: DB):
    """SSE variant of /chat: streams raw text chunks ({"d": ...}) and finishes
    with the parsed skill payload ({"done": true, "result": {...}})."""
    article, project = await _load_article_and_project(article_id, current_user, db)
    try:
        provider, model, key, system, user, locale = await writing_service._prepare_chat(
            project, article, body.question, body.history or [], db, body.body
        )
    except RuntimeError as e:
        if str(e) == "no_ai_key":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_AI_KEY_MESSAGE)
        raise

    from app.services.llm_service import stream_llm

    async def event_stream():
        acc: list[str] = []
        try:
            async for chunk in stream_llm(provider, model, key, system, user, locale=locale):
                acc.append(chunk)
                yield _sse({"d": chunk})
            result = writing_service.parse_chat_response("".join(acc))
            yield _sse({"done": True, "result": result})
        except Exception as e:
            logger.exception("chat stream failed")
            yield _sse({"error": str(e)})

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=SSE_HEADERS)


class GenerateStreamRequest(BaseModel):
    provider: str | None = None
    model: str | None = None
    template: str | None = None


@router.post("/{article_id}/generate/stream")
async def studio_generate_stream(
    article_id: uuid.UUID,
    body: GenerateStreamRequest,
    current_user: CurrentUser,
    db: DB,
    _: Annotated[None, Depends(check_usage_limit("articles"))],
):
    """SSE article generation: streams the draft as Dune writes it, then
    persists the finished article (meta, html, word count, SEO score,
    revision) and emits the final payload."""
    from app.agents.llm_router import LLMProvider, LLMRouter, TaskType
    from app.services.llm_service import get_org_llm_keys, project_locale, stream_llm
    from app.workers.tasks.article_tasks import (
        _build_system_prompt,
        _build_user_prompt,
        _parse_llm_response,
    )

    article, project = await _load_article_and_project(article_id, current_user, db)
    await check_project_not_locked(article.project_id, db)

    org_keys = await get_org_llm_keys(current_user.org_id, db)
    if not org_keys:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_AI_KEY_MESSAGE)

    try:
        if body.provider and body.model and body.provider in org_keys:
            provider_val, model = body.provider, body.model
        else:
            resolved, model = LLMRouter({LLMProvider(p) for p in org_keys}).resolve(
                TaskType.LONG_FORM_ARTICLE
            )
            provider_val = resolved.value
    except (ValueError, KeyError) as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    api_key = org_keys[provider_val]

    brand_voice = None
    if article.brand_voice_id:
        brand_voice = await db.get(BrandVoice, article.brand_voice_id)
    try:
        from app.services.ai_analytics_service import project_profile
        profile = await project_profile(article.project_id, db)
    except Exception:
        profile = ""
    try:
        grounding = await writing_service._seo_grounding(project, article, None, db, include_checks=False)
    except Exception:
        grounding = ""

    system_prompt = _build_system_prompt(brand_voice, profile)
    user_prompt = _build_user_prompt(article, template=body.template)
    if grounding:
        user_prompt += (
            "\n\nREAL SEARCH DATA for this site - weave these naturally into headings, copy and the "
            "FAQ where they fit the topic (never stuff):\n" + grounding
        )
    locale = await project_locale(article.project_id, db)
    article_title = article.title
    keyword = article.target_keyword

    await increment_usage(current_user.org_id, "articles", db)
    await db.commit()

    from app.services.llm_service import ARTICLE_MAX_TOKENS

    async def event_stream():
        acc: list[str] = []
        try:
            async for chunk in stream_llm(
                provider_val, model, api_key, system_prompt, user_prompt,
                locale=locale, max_tokens=ARTICLE_MAX_TOKENS,
            ):
                acc.append(chunk)
                yield _sse({"d": chunk})
        except Exception as e:
            logger.exception("generation stream failed")
            async with async_session_factory() as s:
                art = await s.get(Article, article_id)
                if art is not None:
                    art.status = ArticleStatus.failed
                    art.error = str(e)
                    await s.commit()
            yield _sse({"error": str(e)})
            return

        # Persist the finished article in a fresh session.
        from app.services.article_service import _markdown_to_html, compute_seo_score
        parsed = _parse_llm_response("".join(acc), article_title)
        body_md = parsed["body_markdown"]
        # Guarantee excellent SEO by design: audit against the rubric and repair
        # if it falls short.
        yield _sse({"status": "polishing"})
        body_md, seo_score = await writing_service.ensure_seo_quality(
            provider_val, model, api_key, article_title, keyword, body_md, parsed["meta_description"], locale
        )
        word_count = len(body_md.split())
        async with async_session_factory() as s:
            art = await s.get(Article, article_id)
            if art is None:
                yield _sse({"error": "Article deleted during generation"})
                return
            art.body_markdown = body_md
            art.body_html = _markdown_to_html(body_md)
            art.meta_title = parsed["meta_title"]
            art.meta_description = parsed["meta_description"]
            art.word_count = word_count
            art.seo_score = seo_score
            art.status = ArticleStatus.ready
            art.error = None
            s.add(ArticleRevision(article_id=article_id, body_markdown=body_md, word_count=word_count))
            await s.commit()
        yield _sse({
            "done": True,
            "result": {
                "body_markdown": body_md,
                "meta_title": parsed["meta_title"],
                "meta_description": parsed["meta_description"],
                "word_count": word_count,
                "seo_score": seo_score,
            },
        })

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=SSE_HEADERS)


@router.post("/{article_id}/checks")
async def studio_checks(article_id: uuid.UUID, current_user: CurrentUser, db: DB):
    article, project = await _load_article_and_project(article_id, current_user, db)
    seo = checks_service.seo_checklist(article, article.target_keyword)
    ai = checks_service.ai_patterns(article.body_markdown or "", (project.locale or "en")[:2])
    return {"seo": seo, "ai": ai}


class LinksRequest(BaseModel):
    body: str | None = None


@router.post("/{article_id}/links")
async def studio_internal_links(article_id: uuid.UUID, body: LinksRequest, current_user: CurrentUser, db: DB):
    """Deterministic internal-link opportunities against the project's
    published articles (live URLs only - never fabricated)."""
    article, project = await _load_article_and_project(article_id, current_user, db)
    suggestions = await checks_service.internal_link_suggestions(project, article, body.body, db)
    return {"suggestions": suggestions}


@router.post("/{article_id}/plagiarism")
async def studio_plagiarism(article_id: uuid.UUID, current_user: CurrentUser, db: DB):
    article, project = await _load_article_and_project(article_id, current_user, db)
    try:
        result = await checks_service.plagiarism_scan(project, article, db)
    except checks_service.NoProvider:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "no_seo_provider"})
    return result
