"""ARQ task: generate article content via real LLM providers."""
import re
import uuid

from app.agents.llm_router import LLMProvider, LLMRouter, TaskType
from app.core.database import async_session_factory
from app.models.article import Article, ArticleRevision, ArticleStatus
from app.models.brand_voice import BrandVoice
from app.services.article_service import _deterministic_seo_score, _markdown_to_html
from app.services.llm_service import call_llm, get_org_llm_keys


def _parse_llm_response(raw: str, article_title: str) -> dict:
    """Split on the first '\n---\n' to extract meta fields and body."""
    parts = raw.split("\n---\n", 1)
    if len(parts) == 2:
        header, body_markdown = parts[0], parts[1].strip()
        meta_title = None
        meta_description = None
        for line in header.splitlines():
            if line.startswith("META_TITLE:"):
                meta_title = line[len("META_TITLE:"):].strip()
            elif line.startswith("META_DESCRIPTION:"):
                meta_description = line[len("META_DESCRIPTION:"):].strip()
        if not meta_title:
            meta_title = article_title[:60]
        if not meta_description:
            plain = re.sub(r"[#*`]", "", body_markdown)
            meta_description = (plain[:157] + "...") if len(plain) > 157 else plain
    else:
        body_markdown = raw.strip()
        meta_title = article_title[:60]
        plain = re.sub(r"[#*`]", "", body_markdown)
        meta_description = (plain[:157] + "...") if len(plain) > 157 else plain
    return {
        "body_markdown": body_markdown,
        "meta_title": meta_title,
        "meta_description": meta_description,
    }


def _build_system_prompt(brand_voice: BrandVoice | None) -> str:
    lines = [
        "You are an expert SEO content writer. Write comprehensive, well-structured, "
        "engaging articles that rank well in search engines and genuinely help readers."
    ]
    if brand_voice:
        if brand_voice.voice_prompt:
            lines.append(f"Brand voice instructions: {brand_voice.voice_prompt}.")
        tone = brand_voice.tone.value if hasattr(brand_voice.tone, "value") else brand_voice.tone
        lines.append(f"Tone: {tone}.")
        if brand_voice.vocabulary:
            lines.append(f"Preferred vocabulary: {', '.join(brand_voice.vocabulary)}.")
        if brand_voice.avoid_words:
            lines.append(f"Avoid these words: {', '.join(brand_voice.avoid_words)}.")
    return "\n".join(lines)


def _build_user_prompt(article: Article) -> str:
    kw = article.target_keyword or article.title
    return (
        f"Write a complete SEO-optimized article with these specifications:\n"
        f"- Title: {article.title}\n"
        f"- Target keyword: {kw}\n"
        f"- Tone: {article.tone}\n"
        f"- Target length: approximately {article.word_count_target} words\n\n"
        f"Structure:\n"
        f"- H1 title\n"
        f"- Engaging introduction (mention the keyword naturally)\n"
        f"- 5–7 H2 sections with detailed paragraphs\n"
        f"- Conclusion\n\n"
        f"Reply in this exact format (do not add anything before META_TITLE):\n\n"
        f"META_TITLE: <SEO title, max 60 characters>\n"
        f"META_DESCRIPTION: <SEO description, max 160 characters>\n\n"
        f"---\n\n"
        f"<full article in Markdown>"
    )


async def generate_article_task(
    ctx,
    article_id: str,
    org_id: str,
    provider_override: str | None = None,
    model_override: str | None = None,
):
    """ARQ task: call LLM and save generated article content."""
    article_id_uuid = uuid.UUID(article_id)
    org_id_uuid = uuid.UUID(org_id)

    # Phase 1: load article + keys, build prompts
    async with async_session_factory() as db:
        article = await db.get(Article, article_id_uuid)
        if article is None:
            return

        brand_voice = None
        if article.brand_voice_id:
            brand_voice = await db.get(BrandVoice, article.brand_voice_id)

        org_keys = await get_org_llm_keys(org_id_uuid, db)
        if not org_keys:
            article.status = ArticleStatus.failed
            article.error = "No LLM API keys configured. Add keys in Settings."
            await db.commit()
            return

        try:
            if provider_override and model_override and provider_override in org_keys:
                provider_val = provider_override
                model = model_override
            else:
                available_providers = {LLMProvider(p) for p in org_keys}
                resolved_provider, model = LLMRouter(available_providers).resolve(TaskType.LONG_FORM_ARTICLE)
                provider_val = resolved_provider.value
        except (ValueError, KeyError) as e:
            article.status = ArticleStatus.failed
            article.error = str(e)
            await db.commit()
            return

        api_key = org_keys[provider_val]

        system_prompt = _build_system_prompt(brand_voice)
        user_prompt = _build_user_prompt(article)
        article_title = article.title

    # Phase 2: call LLM (outside DB session)
    try:
        raw = await call_llm(provider_val, model, api_key, system_prompt, user_prompt)
    except Exception as e:
        async with async_session_factory() as db:
            art = await db.get(Article, article_id_uuid)
            if art:
                art.status = ArticleStatus.failed
                art.error = str(e)
                await db.commit()
        raise

    # Phase 3: parse response and persist
    parsed = _parse_llm_response(raw, article_title)
    body_html = _markdown_to_html(parsed["body_markdown"])
    word_count = len(parsed["body_markdown"].split())
    seo_score = _deterministic_seo_score(article_title)

    async with async_session_factory() as db:
        art = await db.get(Article, article_id_uuid)
        if art is None:
            return
        art.body_markdown = parsed["body_markdown"]
        art.body_html = body_html
        art.meta_title = parsed["meta_title"]
        art.meta_description = parsed["meta_description"]
        art.word_count = word_count
        art.seo_score = seo_score
        art.status = ArticleStatus.ready
        art.error = None

        db.add(ArticleRevision(
            article_id=article_id_uuid,
            body_markdown=parsed["body_markdown"],
            word_count=word_count,
            note="Initial generation",
        ))
        await db.commit()
