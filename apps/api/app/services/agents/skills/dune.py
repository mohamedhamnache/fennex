from app.services.agents.spec import Skill, AgentResult
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
    parsed = _parse_llm_response(raw_markdown, "Article")
    title = parsed["meta_title"] or "Article"
    keyword = None
    art = Article(org_id=brief.org_id, project_id=brief.project_id, title=title,
                  target_keyword=keyword, status=ArticleStatus.generating)
    db.add(art); await db.flush()
    art.body_markdown = parsed["body_markdown"]
    art.body_html = _markdown_to_html(parsed["body_markdown"])
    art.meta_title = parsed["meta_title"]
    art.meta_description = parsed["meta_description"]
    art.word_count = len(parsed["body_markdown"].split())
    art.seo_score, _ = compute_seo_score(title, parsed["body_markdown"], keyword, parsed["meta_description"])
    art.status = ArticleStatus.ready
    await db.commit()
    return AgentResult(ok=True, summary=f"Article: {title}", artifact_type="article",
                       artifact_ids=[str(art.id)], structured={"article_id": str(art.id), "title": title,
                       "seo_score": art.seo_score, "word_count": art.word_count})


WRITE_ARTICLE = Skill(
    key="dune.write_article", agent_id="dune", weight="heavy", tools=[],
    build_prompt=_write_article_prompt, output="markdown", parse=lambda raw: raw,
    persist=_persist_article, label="Write the article",
    description="Write an SEO article on the chosen angle.",
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
