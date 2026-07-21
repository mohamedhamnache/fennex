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


# Structural blueprints for the content-template picker. Keys are stable ids
# shared with the frontend; values are appended to the generation brief.
TEMPLATE_BRIEFS: dict[str, str] = {
    "howto": (
        "Structure the article as a step-by-step HOW-TO GUIDE: a short prerequisites section, "
        "numbered steps as H2s (H3s for sub-steps), a common-mistakes section, and a final checklist."
    ),
    "listicle": (
        "Structure the article as a LISTICLE: a numbered H2 for each item with a punchy opener, "
        "a quick at-a-glance summary list near the top, and consistent depth per item."
    ),
    "comparison": (
        "Structure the article as a COMPARISON (X vs Y): criteria-based H2 sections, a markdown "
        "comparison table near the top, honest pros and cons for each side, and a clear verdict "
        "section explaining who should pick which."
    ),
    "roundup": (
        "Structure the article as a ROUNDUP of picks or tools: a top-picks summary at the start, "
        "one H2 per pick with pros and cons lists, and a final buying-guide style section on how "
        "to choose."
    ),
    "casestudy": (
        "Structure the article as a CASE STUDY: background, the challenge, the approach taken, "
        "the results (concrete and qualitative - never invent numbers), and lessons learned."
    ),
}


def _build_user_prompt(article: Article, template: str | None = None) -> str:
    kw = article.target_keyword or article.title
    template_brief = TEMPLATE_BRIEFS.get(template or "")
    return (
        f"Write a best-in-class, SEO-optimized article that could rank on page one for its keyword.\n\n"
        f"BRIEF\n"
        f"- Working title: {article.title}\n"
        f"- Primary keyword: {kw}\n"
        f"- Tone: {article.tone}\n"
        f"- Target length: approximately {article.word_count_target} words (write to the depth the topic "
        f"deserves, not filler to hit a number)\n\n"
        + (f"TEMPLATE\n{template_brief}\n\n" if template_brief else "")
        +
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
        f"NON-NEGOTIABLE SEO REQUIREMENTS (the draft is scored against these - satisfy EVERY one):\n"
        f"- The primary keyword \"{kw}\" appears in the H1 title.\n"
        f"- The primary keyword \"{kw}\" appears verbatim in the FIRST paragraph.\n"
        f"- The primary keyword and close variants keep a natural density of 0.5-2.5% across the article.\n"
        f"- The article is AT LEAST 1500 words (write the full piece; never stop early or truncate).\n"
        f"- The body uses multiple ## H2 section headings (and ### H3 where useful).\n"
        f"- The META_DESCRIPTION is present, <=160 chars, and includes the keyword.\n\n"
        f"Reply in this EXACT format (nothing before META_TITLE):\n\n"
        f"META_TITLE: <compelling SEO title, <=60 chars, primary keyword near the front>\n"
        f"META_DESCRIPTION: <benefit-driven description, <=160 chars, includes the keyword and an implicit CTA>\n\n"
        f"---\n\n"
        f"<full article in clean Markdown: one H1 (#), H2 (##), H3 (###), lists, and **bold** for key terms>"
    )


async def generate_article_task(ctx, article_id, org_id, provider_override=None, model_override=None):
    """ARQ task: generate an article in place via the agent core (dune.GENERATE_ARTICLE)."""
    article_id_uuid = uuid.UUID(article_id)
    org_id_uuid = uuid.UUID(org_id)
    from app.services.agents.skills.dune import GENERATE_ARTICLE
    from app.services.agents.standalone import run_standalone

    async with async_session_factory() as db:
        article = await db.get(Article, article_id_uuid)
        if article is None:
            return
        org_keys = await get_org_llm_keys(org_id_uuid, db)
        if not org_keys:
            article.status = ArticleStatus.failed
            article.error = "No LLM API keys configured. Add keys in Settings."
            await db.commit()
            return
        project_id = article.project_id
        goal = f"Write the article: {article.title}"

        result = await run_standalone(
            GENERATE_ARTICLE, project_id, org_id_uuid, goal, db,
            inputs={"article_id": article_id},
            provider_override=provider_override, model_override=model_override,
        )
        if not result.ok:
            art = await db.get(Article, article_id_uuid)
            if art is not None:
                art.status = ArticleStatus.failed
                art.error = result.error or "Generation failed."
                await db.commit()
