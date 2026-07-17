"""ARQ task: generate article content via real LLM providers."""
import re
import uuid

from app.agents.llm_router import LLMProvider, LLMRouter, TaskType
from app.core.database import async_session_factory
from app.models.article import Article, ArticleRevision, ArticleStatus
from app.models.brand_voice import BrandVoice
from app.services.article_service import compute_seo_score, _markdown_to_html
from app.services.llm_service import call_llm, get_org_llm_keys, project_locale


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


def _build_system_prompt(brand_voice: BrandVoice | None, profile: str = "") -> str:
    from app.agents.registry import agent_persona
    lines = [
        agent_persona("dune")
        + "You are an elite SEO content strategist and writer. You have mastered the skills that "
        "make content rank and convert:\n"
        "- SEARCH INTENT: you infer whether the query is informational, commercial, transactional or "
        "navigational, and you satisfy that intent completely and directly.\n"
        "- E-E-A-T: you demonstrate first-hand experience, expertise and trust with specific, concrete, "
        "verifiable detail — never vague generalities.\n"
        "- SEMANTIC SEO: you cover the topic and its related entities, subtopics and questions the way a "
        "subject-matter expert would, so the page is topically complete.\n"
        "- ON-PAGE CRAFT: keyword-rich but natural H1/H2/H3s, the primary keyword in the first 100 words, "
        "keyword variations and synonyms (no stuffing), a concise 40-55 word answer near the top that can "
        "win the featured snippet, scannable short paragraphs, lists and bolded key terms.\n"
        "- COPYWRITING: a hook in the first sentence, active voice, varied sentence rhythm, and genuine "
        "usefulness on every line.\n"
        "QUALITY BAR: original and specific — no filler, no padding, no hedging. Never use AI cliches "
        "('in today's fast-paced world', 'in the ever-evolving landscape', 'in conclusion', 'unlock', "
        "'delve', 'it is important to note', 'game-changer'). Never invent statistics, studies, quotes or "
        "facts; when you cite a figure it must be one a reader could plausibly verify, otherwise speak "
        "qualitatively. Write for a human first and the algorithm second."
    ]
    if profile:
        lines.append(
            f"About the site and author: {profile}. Write specifically for this audience and context — "
            "reflect their niche, offers and point of view naturally, and match the sophistication of "
            "someone who works in this field every day."
        )
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
        f"Write a best-in-class, SEO-optimized article that could rank on page one for its keyword.\n\n"
        f"BRIEF\n"
        f"- Working title: {article.title}\n"
        f"- Primary keyword: {kw}\n"
        f"- Tone: {article.tone}\n"
        f"- Target length: approximately {article.word_count_target} words (write to the depth the topic "
        f"deserves, not filler to hit a number)\n\n"
        f"BEFORE WRITING, think about: the dominant search intent behind \"{kw}\"; what a reader must walk "
        f"away knowing; the subtopics, related entities and 'People Also Ask' questions a complete answer "
        f"must cover; and the angle that makes this genuinely more useful than what already ranks.\n\n"
        f"THE ARTICLE MUST INCLUDE\n"
        f"1. An H1 that includes the primary keyword and a clear promise.\n"
        f"2. An introduction that hooks in the first sentence, uses the primary keyword within the first "
        f"100 words, and tells the reader exactly what they'll get.\n"
        f"3. A concise, direct answer to the core query near the top (about 40-55 words) — snippet-ready.\n"
        f"4. A logical body of H2 sections (with H3 subsections where useful) that fully cover the topic; "
        f"use keyword variations and synonyms in headings naturally.\n"
        f"5. Concrete specifics: examples, steps, comparisons, and qualitative evidence. Short paragraphs "
        f"(2-4 sentences). Bulleted or numbered lists where they aid scanning. Bold the key terms.\n"
        f"6. An FAQ section of 3-5 real long-tail questions with tight, useful answers.\n"
        f"7. A conclusion with the key takeaways and a natural, non-pushy call to action.\n\n"
        f"AVOID: keyword stuffing, generic fluff, filler transitions, invented data, and the banned "
        f"cliches from your instructions.\n\n"
        f"Reply in this EXACT format (nothing before META_TITLE):\n\n"
        f"META_TITLE: <compelling SEO title, <=60 chars, primary keyword near the front>\n"
        f"META_DESCRIPTION: <benefit-driven description, <=160 chars, includes the keyword and an implicit CTA>\n\n"
        f"---\n\n"
        f"<full article in clean Markdown: one H1 (#), H2 (##), H3 (###), lists, and **bold** for key terms>"
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

        # Ground the article in the project's onboarding profile (persona, niche…)
        try:
            from app.services.ai_analytics_service import project_profile
            profile = await project_profile(article.project_id, db)
        except Exception:
            profile = ""

        # Ground in real search data (GSC queries + tracked keywords) so the
        # brief targets demand the site actually has - checks are skipped since
        # there is no draft to lint yet.
        grounding = ""
        try:
            from app.models.project import Project
            from app.services.writing_service import _seo_grounding
            project = await db.get(Project, article.project_id)
            if project is not None:
                grounding = await _seo_grounding(project, article, None, db, include_checks=False)
        except Exception:
            grounding = ""

        system_prompt = _build_system_prompt(brand_voice, profile)
        user_prompt = _build_user_prompt(article)
        if grounding:
            user_prompt += (
                "\n\nREAL SEARCH DATA for this site - weave these naturally into headings, copy and the "
                "FAQ where they fit the topic (never stuff):\n" + grounding
            )
        article_title = article.title
        article_locale = await project_locale(article.project_id, db)

    # Phase 2: call LLM (outside DB session)
    try:
        raw = await call_llm(provider_val, model, api_key, system_prompt, user_prompt, locale=article_locale)
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

    async with async_session_factory() as db:
        art = await db.get(Article, article_id_uuid)
        if art is None:
            return
        art.body_markdown = parsed["body_markdown"]
        art.body_html = body_html
        art.meta_title = parsed["meta_title"]
        art.meta_description = parsed["meta_description"]
        art.word_count = word_count
        seo_score, _ = compute_seo_score(
            article_title, parsed["body_markdown"], art.target_keyword, parsed["meta_description"]
        )
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
