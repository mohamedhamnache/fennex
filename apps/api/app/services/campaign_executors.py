"""Executors: thin adapters wrapping existing agent services for the campaign orchestrator."""
import json
import re

from app.models.article import Article, ArticleStatus
from app.services.analytics_service import get_market_insights, get_opportunities
from app.services.campaign_catalog import CampaignContext, StepResult
from app.services.llm_service import call_llm, get_org_llm_keys
from app.services.oasis_service import generate_market_report
from app.workers.tasks.article_tasks import _build_system_prompt, _build_user_prompt, _parse_llm_response

_PROVIDERS = [("anthropic", "claude-opus-4-8"), ("openai", "gpt-4o")]


def _pick_provider(keys: dict) -> tuple[str, str] | None:
    for provider, model in _PROVIDERS:
        if provider in keys:
            return provider, model
    return None


async def exec_oasis_market_report(campaign, step, context: CampaignContext, db) -> StepResult:
    res = await generate_market_report(campaign.project_id, campaign.org_id, db)
    if not res.get("ok"):
        raise RuntimeError(res.get("error", "Market report failed."))
    md = res.get("markdown", "")
    return StepResult(summary=md[:600], artifact_type="report", structured={"markdown": md, "title": res.get("title")})


async def exec_zerda_pick_angle(campaign, step, context: CampaignContext, db) -> StepResult:
    opps = await get_opportunities(campaign.project_id, campaign.org_id, db)
    market = await get_market_insights(campaign.project_id, campaign.org_id, db)
    keys = await get_org_llm_keys(campaign.org_id, db)
    pm = _pick_provider(keys)
    if pm is None:
        raise RuntimeError("No AI key configured.")
    top = (opps.striking_distance + opps.ctr_wins)[:12]
    lines = [f"- \"{o.query}\" pos {o.position:.1f}, +{o.potential_clicks} potential" for o in top]
    clusters = "; ".join(f"{c.topic} ({c.query_count} queries)" for c in market.clusters[:8])
    system = (
        "You are Zerda, Fennex's SEO strategist. From the DATA pick ONE focus for a content campaign. "
        "Respond with ONLY JSON: {\"topic\": str, \"keyword\": str, \"rationale\": str}. "
        "Prefer a striking-distance query with real demand aligned to the goal."
    )
    user = f"GOAL: {campaign.goal}\nPERSONA: {campaign.persona}\nTOPIC CLUSTERS: {clusters}\nOPPORTUNITIES:\n" + "\n".join(lines)
    raw = await call_llm(pm[0], pm[1], keys[pm[0]], system, user)
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    try:
        data = json.loads(cleaned)
    except Exception:
        data = {"topic": campaign.goal, "keyword": (top[0].query if top else campaign.goal), "rationale": "fallback"}
    topic = str(data.get("topic") or campaign.goal)[:200]
    keyword = str(data.get("keyword") or campaign.goal)[:200]
    rationale = str(data.get("rationale") or "")[:400]
    return StepResult(
        summary=f"Focus: {topic} (target keyword: {keyword}). {rationale}",
        structured={"topic": topic, "keyword": keyword, "rationale": rationale},
    )


def _angle(context: CampaignContext) -> dict:
    for p in context.prior:
        st = p.get("structured") or {}
        if st.get("keyword") or st.get("topic"):
            return st
    return {}


async def exec_dune_write_article(campaign, step, context: CampaignContext, db) -> StepResult:
    brief = step.brief or {}
    angle = _angle(context)
    title = str(brief.get("title") or angle.get("topic") or campaign.goal)[:500]
    keyword = str(brief.get("keyword") or angle.get("keyword") or "")[:500] or None
    keys = await get_org_llm_keys(campaign.org_id, db)
    pm = _pick_provider(keys)
    if pm is None:
        raise RuntimeError("No AI key configured.")
    article = Article(org_id=campaign.org_id, project_id=campaign.project_id, title=title,
                      target_keyword=keyword, status=ArticleStatus.generating)
    db.add(article); await db.flush()
    system = _build_system_prompt(None, context.project_profile)
    user = _build_user_prompt(article)
    try:
        raw = await call_llm(pm[0], pm[1], keys[pm[0]], system, user)
    except Exception:
        article.status = ArticleStatus.failed
        raise
    parsed = _parse_llm_response(raw, title)
    article.body_markdown = parsed["body_markdown"]
    article.word_count = len(parsed["body_markdown"].split())
    article.status = ArticleStatus.ready
    await db.commit()
    return StepResult(summary=f"Drafted article: {title}", artifact_type="article",
                      artifact_ids=[str(article.id)], structured={"article_id": str(article.id), "title": title})
