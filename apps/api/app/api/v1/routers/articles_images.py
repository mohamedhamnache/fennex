import json
import uuid
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from app.core.dependencies import CurrentUser, DB
from app.models.article import Article
from app.services.llm_service import get_org_llm_keys, call_llm, project_locale

router = APIRouter()

_SUGGEST_SYSTEM = (
    "You are an expert content strategist. "
    "Given article content, identify 3–5 places where images would enhance the reader experience. "
    "For each, specify: placement (hero/body/sidebar), the section it belongs to, "
    "a concise image concept, and a detailed AI image generation prompt. "
    "Respond ONLY with a JSON array of objects with keys: "
    "placement, section_hint, image_concept, suggested_prompt. "
    "No markdown, no extra text."
)

_PROVIDERS = [
    ("anthropic", "claude-haiku-4-5-20251001"),
    ("openai", "gpt-4o-mini"),
]


class ImageSuggestion(BaseModel):
    placement: str
    section_hint: str
    image_concept: str
    suggested_prompt: str


@router.post("/{article_id}/suggest-images", response_model=list[ImageSuggestion])
async def suggest_images_for_article(article_id: uuid.UUID, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(Article).where(
            Article.id == article_id,
            Article.org_id == current_user.org_id,
        )
    )
    article = result.scalar_one_or_none()
    if article is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Article not found")

    keys = await get_org_llm_keys(current_user.org_id, db)
    if not keys:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "No AI API key configured. Add an Anthropic or OpenAI key in Settings → API Keys.",
        )

    body_text = article.content or ""
    if len(body_text) > 4000:
        body_text = body_text[:4000] + "…"

    user_msg = (
        f"Article title: {article.title or 'Untitled'}\n\n"
        f"Article content:\n{body_text}"
    )

    last_error = None
    for provider, model in _PROVIDERS:
        if provider not in keys:
            continue
        try:
            raw = await call_llm(provider, model, keys[provider], _SUGGEST_SYSTEM, user_msg, locale=await project_locale(article.project_id, db))
            suggestions_data = json.loads(raw.strip())
            return [ImageSuggestion(**s) for s in suggestions_data[:5]]
        except Exception as e:
            last_error = e
            continue

    raise HTTPException(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        f"LLM call failed: {last_error}",
    )
