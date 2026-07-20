"""Specialist-data tools. Each: async (brief, db, inputs) -> data payload."""
from app.services.analytics_service import get_opportunities, get_market_insights
from app.services.competitor_service import analyze as _analyze


async def gsc_opportunities(brief, db, inputs):
    o = await get_opportunities(brief.project_id, brief.org_id, db)
    top = (o.striking_distance + o.ctr_wins)[:12]
    return {"queries": [{"query": q.query, "position": q.position, "potential": q.potential_clicks} for q in top]}


async def market_insights(brief, db, inputs):
    m = await get_market_insights(brief.project_id, brief.org_id, db)
    return {"clusters": [{"topic": c.topic, "query_count": c.query_count} for c in m.clusters[:8]],
            "ideas": [{"query": i.query, "type": i.idea_type, "impressions": i.impressions} for i in m.ideas[:12]]}


async def market_data(brief, db, inputs):
    # richer bundle for the market report; reuse insights + opportunities
    m = await get_market_insights(brief.project_id, brief.org_id, db)
    o = await get_opportunities(brief.project_id, brief.org_id, db)
    return {
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


TOOLS = {
    "gsc_opportunities": gsc_opportunities,
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
