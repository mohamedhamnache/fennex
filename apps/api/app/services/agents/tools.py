"""Specialist-data tools. Each: async (brief, db, inputs) -> data payload."""
import uuid

from app.services.analytics_service import (
    get_opportunities, get_market_insights, get_overview, get_health_score,
)


def _as_uuid(v):
    return uuid.UUID(v) if isinstance(v, str) else v


async def gsc_opportunities(brief, db, inputs):
    o = await get_opportunities(brief.project_id, brief.org_id, db)
    top = (o.striking_distance + o.ctr_wins)[:12]
    return {"queries": [{"query": q.query, "position": q.position, "potential": q.potential_clicks} for q in top]}


async def market_insights(brief, db, inputs):
    m = await get_market_insights(brief.project_id, brief.org_id, db)
    return {"clusters": [{"topic": c.topic, "query_count": c.query_count} for c in m.clusters[:8]],
            "ideas": [{"query": i.query, "type": i.idea_type, "impressions": i.impressions} for i in m.ideas[:12]]}


async def market_data(brief, db, inputs):
    # richer bundle for the market report; reuse insights + opportunities + overview + health
    m = await get_market_insights(brief.project_id, brief.org_id, db)
    o = await get_opportunities(brief.project_id, brief.org_id, db)
    ov = await get_overview(brief.project_id, brief.org_id, "28d", db)
    health = await get_health_score(brief.project_id, brief.org_id, db)
    return {
        "overview": {"clicks": ov.clicks, "impressions": ov.impressions, "ctr": ov.ctr,
                     "avg_position": ov.avg_position, "clicks_change": ov.clicks_change,
                     "impressions_change": ov.impressions_change},
        "health": {"score": health.score, "grade": health.grade,
                   "components": [{"label": c.label, "score": c.score, "detail": c.detail}
                                  for c in (health.components or [])]},
        "clusters": [{"topic": c.topic, "queries": c.query_count, "clicks": c.clicks,
                      "impressions": c.impressions, "avg_position": c.avg_position} for c in m.clusters[:10]],
        "ideas": [{"query": i.query, "type": i.idea_type, "impressions": i.impressions} for i in m.ideas[:15]],
        "opportunities": [{"query": q.query, "position": q.position, "potential": q.potential_clicks}
                          for q in (o.striking_distance + o.ctr_wins)[:10]],
        "total_potential": o.total_potential_clicks,
    }


async def tracked_keywords(brief, db, inputs):
    try:
        from app.services.seo_hub_service import list_tracked_keywords  # optional
        rows = await list_tracked_keywords(brief.project_id, db)
        return {"keywords": [getattr(r, "keyword", str(r)) for r in rows][:20]}
    except Exception:
        return {"keywords": []}


async def crawl_competitor(brief, db, inputs):
    url = str((inputs or {}).get("competitor_url") or "").strip()
    if not url:
        return {"skipped": True}
    from app.services.competitor_service import analyze as _analyze  # lazy: avoids import cycle
    return {"analysis": await _analyze(brief.project_id, brief.org_id, url, db)}


async def our_demand(brief, db, inputs):
    m = await get_market_insights(brief.project_id, brief.org_id, db)
    return {"clusters": [c.topic for c in m.clusters[:10]]}


async def store_products(brief, db, inputs):
    from app.services import shopify_service
    try:
        rows = await shopify_service.list_products(brief.project_id, brief.org_id, db)
        return {"products": [{"id": str(p.id), "title": p.title, "price": p.price} for p in rows][:50]}
    except Exception:
        return {"products": []}


async def article_context(brief, db, inputs):
    from app.models.article import Article
    from app.models.brand_voice import BrandVoice
    from app.workers.tasks.article_tasks import _build_system_prompt, _build_user_prompt
    aid = (inputs or {}).get("article_id")
    if not aid:
        return {}
    article = await db.get(Article, _as_uuid(aid))
    if article is None:
        return {}
    brand_voice = await db.get(BrandVoice, article.brand_voice_id) if article.brand_voice_id else None
    return {"system": _build_system_prompt(brand_voice, brief.project_profile),
            "user": _build_user_prompt(article),
            "title": article.title, "keyword": article.target_keyword}


async def seo_grounding(brief, db, inputs):
    from app.models.article import Article
    from app.models.project import Project
    from app.services.writing_service import _seo_grounding
    aid = (inputs or {}).get("article_id")
    if not aid:
        return {"grounding": ""}
    try:
        art = await db.get(Article, _as_uuid(aid))
        project = await db.get(Project, art.project_id) if art else None
        if art is None or project is None:
            return {"grounding": ""}
        return {"grounding": await _seo_grounding(project, art, None, db, include_checks=False)}
    except Exception:
        return {"grounding": ""}


TOOLS = {
    "gsc_opportunities": gsc_opportunities,
    "article_context": article_context,
    "seo_grounding": seo_grounding,
    "market_insights": market_insights,
    "market_data": market_data,
    "tracked_keywords": tracked_keywords,
    "crawl_competitor": crawl_competitor,
    "our_demand": our_demand,
    "store_products": store_products,
}


async def run_tools(names, brief, db, inputs) -> dict:
    out = {}
    for name in names or []:
        fn = TOOLS.get(name)
        if fn is None:
            out[name] = {"ok": False, "data": None}
            continue
        try:
            out[name] = {"ok": True, "data": await fn(brief, db, inputs)}
        except Exception:
            out[name] = {"ok": False, "data": None}
    return out
