from app.services.agents.spec import Skill, AgentResult
from app.services.llm_service import ARTICLE_MAX_TOKENS
from app.services.agents.skills._common import brief_block, feedback_block, parse_json
from app.models.article import Article, ArticleStatus
from app.services.article_service import compute_seo_score, _markdown_to_html
from app.workers.tasks.article_tasks import _build_system_prompt, _build_user_prompt, _parse_llm_response


def _write_article_prompt(brief, inputs, td):
    title = str(inputs.get("angle") or inputs.get("title") or brief.goal)[:500]
    keyword = str(inputs.get("keyword") or "") or title
    # Reuse the proven article prompt (title/keyword carried on a lightweight shim object).
    class _Shim:
        pass
    art = _Shim()
    art.title = title
    art.target_keyword = keyword
    art.tone = (brief.brand or {}).get("tone", "professional")
    art.word_count_target = 1600
    system = _build_system_prompt(None, brief.project_profile)
    user = _build_user_prompt(art)
    ctx = [f"This article serves the campaign goal: {brief.goal}. Keep it pointed at that goal."]
    if inputs.get("rationale"):
        ctx.append(f"Chosen angle & why it wins: {inputs['rationale']}")
    user += ("\n\nCAMPAIGN CONTEXT (write specifically to this angle — do NOT drift into a generic "
             "keyword overview):\n- " + "\n- ".join(ctx) + feedback_block(inputs))
    return system, user


async def _persist_article(raw_markdown, campaign, brief, db):
    from app.services.writing_service import ensure_seo_quality
    from app.services.geo_service import ensure_geo_quality

    rt = brief.runtime or {}
    inputs = rt.get("inputs") or {}
    parsed = _parse_llm_response(raw_markdown, "Article")
    # Prefer the brief's title: the model's meta_title is a search snippet, not
    # necessarily the headline the user asked for.
    title = (str(inputs.get("title") or "").strip()
             or parsed["meta_title"] or "Article")[:200]
    # The keyword was previously dropped here, so SEO scoring ran blind and
    # every chat-written article came out with a poor score.
    keyword = (str(inputs.get("keyword") or "").strip()
               or str(inputs.get("primary_keyword") or "").strip() or None)

    art = Article(org_id=brief.org_id, project_id=brief.project_id, title=title,
                  target_keyword=keyword, status=ArticleStatus.generating)
    db.add(art); await db.flush()

    body_md = parsed["body_markdown"]
    meta_description = parsed["meta_description"]
    seo_score, geo_score = None, None

    # Same repair pass the article generator uses -- it lengthens thin drafts
    # and fixes structure, which is the difference between a stub and a piece.
    if rt.get("provider") and rt.get("api_key"):
        try:
            body_md, seo_score = await ensure_seo_quality(
                rt["provider"], rt.get("model"), rt["api_key"], title, keyword,
                body_md, meta_description, brief.locale)
            body_md, geo_score, _ = await ensure_geo_quality(
                rt["provider"], rt.get("model"), rt["api_key"], title, keyword,
                body_md, meta_description, brief.locale)
        except Exception:  # noqa: BLE001 -- a failed repair must not lose the draft
            seo_score = None

    art.body_markdown = body_md
    art.body_html = _markdown_to_html(body_md)
    art.meta_title = parsed["meta_title"]
    art.meta_description = meta_description
    art.word_count = len(body_md.split())
    art.geo_score = geo_score
    if seo_score is None:
        seo_score, _ = compute_seo_score(title, body_md, keyword, meta_description)
    art.seo_score = seo_score
    art.status = ArticleStatus.ready
    await db.commit()
    return AgentResult(ok=True, summary=f"Article: {title} ({art.word_count} words)",
                       artifact_type="article", artifact_ids=[str(art.id)],
                       structured={"article_id": str(art.id), "title": title,
                                   "keyword": keyword, "seo_score": art.seo_score,
                                   "word_count": art.word_count})


WRITE_ARTICLE = Skill(
    key="dune.write_article", agent_id="dune", weight="heavy", tools=[],
    build_prompt=_write_article_prompt, output="markdown", parse=lambda raw: raw,
    persist=_persist_article, label="Write the article",
    description="Write an SEO article on the chosen angle.",
    # A 1600-word article does not fit in the default budget; without this the
    # draft is truncated mid-flow and lands as a stub.
    max_tokens=ARTICLE_MAX_TOKENS,
)


def _product_copy_prompt(brief, inputs, td):
    p = inputs.get("product") or {}
    system = (
        "You are Dune. Write SEO ecommerce product copy. Return ONLY JSON: "
        '{"title": str (<=70), "description_html": str (2-4 <p> paragraphs), "meta_description": str (<=155)}. '
        "Never invent facts not in the product data. No emoji."
    )
    user = (f"PRODUCT: {p.get('title','')}\nPRICE: {p.get('price','')}\n"
            f"CURRENT DESCRIPTION: {p.get('description','')}\n" + brief_block(brief) + feedback_block(inputs))
    return system, user


PRODUCT_COPY = Skill(
    key="dune.product_copy", agent_id="dune", weight="light", tools=[],
    build_prompt=_product_copy_prompt, output="json", parse=parse_json,
    label="Product copy", description="SEO product title/description/meta from real product data.",
)


import uuid as _uuid
from app.models.article import ArticleRevision
from app.services.llm_service import ARTICLE_MAX_TOKENS
from app.services.writing_service import ensure_seo_quality
from app.services.geo_service import ensure_geo_quality


def _generate_article_prompt(brief, inputs, td):
    ctx = (td.get("article_context") or {}).get("data") or {}
    system = ctx.get("system") or _build_system_prompt(None, brief.project_profile)
    user = ctx.get("user") or brief.goal
    grounding = (td.get("seo_grounding") or {}).get("data", {}).get("grounding", "")
    if grounding:
        user += ("\n\nREAL SEARCH DATA for this site - weave these naturally into headings, copy and the "
                 "FAQ where they fit the topic (never stuff):\n" + grounding)
    user += feedback_block(inputs)
    return system, user


async def _persist_generated_article(raw_markdown, campaign, brief, db):
    rt = brief.runtime or {}
    aid = (rt.get("inputs") or {}).get("article_id")
    article = await db.get(Article, aid if not isinstance(aid, str) else _uuid.UUID(aid)) if aid else None
    if article is None:
        return AgentResult(ok=False, error="Article not found for generation.")
    parsed = _parse_llm_response(raw_markdown, article.title)
    body_md, seo_score = await ensure_seo_quality(
        rt.get("provider"), rt.get("model"), rt.get("api_key"),
        article.title, article.target_keyword, parsed["body_markdown"], parsed["meta_description"], brief.locale,
    )
    body_md, geo_score, _ = await ensure_geo_quality(
        rt.get("provider"), rt.get("model"), rt.get("api_key"),
        article.title, article.target_keyword, body_md, parsed["meta_description"], brief.locale,
    )
    article.geo_score = geo_score
    article.body_markdown = body_md
    article.body_html = _markdown_to_html(body_md)
    article.meta_title = parsed["meta_title"]
    article.meta_description = parsed["meta_description"]
    article.word_count = len(body_md.split())
    article.seo_score = seo_score
    article.status = ArticleStatus.ready
    article.error = None
    db.add(ArticleRevision(article_id=article.id, body_markdown=body_md,
                           word_count=article.word_count, note="Initial generation"))
    await db.commit()
    return AgentResult(ok=True, summary=f"Article: {article.title}", artifact_type="article",
                       artifact_ids=[str(article.id)],
                       structured={"article_id": str(article.id), "seo_score": seo_score,
                                   "word_count": article.word_count})


GENERATE_ARTICLE = Skill(
    key="dune.generate_article", agent_id="dune", weight="heavy",
    tools=["article_context", "seo_grounding"], build_prompt=_generate_article_prompt,
    output="markdown", parse=lambda raw: raw, persist=_persist_generated_article,
    max_tokens=ARTICLE_MAX_TOKENS, label="Generate the article",
    description="Generate an existing article in place with SEO grounding + quality repair.",
)
