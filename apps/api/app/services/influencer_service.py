"""Influencer Studio: LLM-powered per-network post variants + hooks.

Sirocco (creative director) writes native content for each selected network from
a single topic via the agent core (sirocco.MULTI_NETWORK_SOCIAL skill): several
scroll-stopping hook options plus a full caption and hashtags tuned to that
platform's voice, length and format. Deterministic best-time hints ride along for
scheduling. No emoji (house style)."""
from app.services.agents.skills import sirocco as sirocco_skills
from app.services.agents.standalone import run_standalone

SUPPORTED_PLATFORMS = ["linkedin", "instagram", "twitter", "facebook", "tiktok"]

# Per-network authoring brief + hard character ceiling.
PLATFORM_BRIEFS: dict[str, dict] = {
    "linkedin": {"limit": 3000, "brief": "Professional thought-leadership. 2-4 short paragraphs with line breaks, one clear insight, a soft CTA. 3-5 targeted hashtags."},
    "instagram": {"limit": 2200, "brief": "Punchy and visual-first. A strong first line, short scannable lines, a question or CTA. 5-10 discovery hashtags."},
    "twitter": {"limit": 280, "brief": "One tight, high-signal post under 280 characters total including hashtags. 1-2 hashtags max. No thread."},
    "facebook": {"limit": 2000, "brief": "Warm and conversational. A relatable opener and an explicit question CTA to spark comments. 1-3 hashtags."},
    "tiktok": {"limit": 2200, "brief": "A short video caption. A curiosity-driven hook line, trend-aware phrasing, a call to watch/follow. 3-5 trending-style hashtags."},
}

# General best-posting windows per platform (deterministic hints; dayKey + local time range).
BEST_TIMES: dict[str, dict] = {
    "linkedin": {"day": "tue", "time": "09:00–11:00"},
    "instagram": {"day": "wed", "time": "11:00–13:00"},
    "twitter": {"day": "wed", "time": "09:00–12:00"},
    "facebook": {"day": "thu", "time": "13:00–15:00"},
    "tiktok": {"day": "thu", "time": "18:00–21:00"},
}


async def generate_studio(project_id, org_id, topic, platforms, tone, keyword, db) -> dict:
    """Generate native variants (hooks + caption + hashtags + best time) for each
    selected platform via the sirocco.MULTI_NETWORK_SOCIAL skill."""
    topic = (topic or "").strip()
    if not topic:
        return {"ok": False, "error": "missing_topic", "variants": []}
    wanted = [p for p in platforms if p in PLATFORM_BRIEFS] or ["linkedin"]
    inputs = {"topic": topic, "platforms": wanted, "tone": tone, "keyword": keyword}
    result = await run_standalone(sirocco_skills.MULTI_NETWORK_SOCIAL, project_id, org_id,
                                  f"Create social posts about: {topic}", db, inputs=inputs)
    if not result.ok:
        return {"ok": False, "error": result.error or "generation_failed", "variants": []}
    variants = []
    for v in (result.content or {}).get("variants", []):
        plat = str(v.get("platform", "")).strip()
        if plat not in PLATFORM_BRIEFS:
            continue
        content = str(v.get("content", "")).strip()[:PLATFORM_BRIEFS[plat]["limit"]]
        variants.append({
            "platform": plat,
            "hooks": [str(h).strip() for h in (v.get("hooks") or []) if str(h).strip()][:3],
            "content": content,
            "hashtags": [str(t).strip() for t in (v.get("hashtags") or []) if str(t).strip()][:10],
            "char_count": len(content),
            "best_time": BEST_TIMES.get(plat),
        })
    if not variants:
        return {"ok": False, "error": "generation_failed", "variants": []}
    return {"ok": True, "variants": variants}
