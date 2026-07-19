"""Influencer Studio: LLM-powered per-network post variants + hooks.

Sirocco (creative director) writes native content for each selected network from
a single topic: several scroll-stopping hook options plus a full caption and
hashtags tuned to that platform's voice, length and format. Deterministic
best-time hints ride along for scheduling. No emoji (house style)."""
import asyncio
import re
import uuid

from app.agents.registry import agent_persona
from app.services.llm_service import call_llm, get_org_llm_keys, project_locale

# Cheap models are plenty for short-form social copy.
_PROVIDERS = [("anthropic", "claude-haiku-4-5-20251001"), ("openai", "gpt-4o-mini")]

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

_HOOK_RE = re.compile(r"<hook>(.*?)</hook>", re.S)
_CONTENT_RE = re.compile(r"<content>(.*?)</content>", re.S)
_TAGS_RE = re.compile(r"<hashtags>(.*?)</hashtags>", re.S)


def _pick(keys: dict):
    return next(((p, m) for p, m in _PROVIDERS if p in keys), None)


def _parse_variant(raw: str, limit: int) -> dict:
    hooks = [h.strip() for h in _HOOK_RE.findall(raw) if h.strip()][:3]
    cm = _CONTENT_RE.search(raw)
    content = (cm.group(1).strip() if cm else raw.strip())[:limit]
    tm = _TAGS_RE.search(raw)
    tags = []
    if tm:
        tags = [t for t in re.split(r"[\s,]+", tm.group(1).strip()) if t.startswith("#")][:10]
    return {"hooks": hooks, "content": content, "hashtags": tags, "char_count": len(content)}


async def _generate_one(platform: str, topic: str, tone: str, keyword: str | None,
                        provider: str, model: str, api_key: str, locale: str) -> dict:
    spec = PLATFORM_BRIEFS[platform]
    system = (
        agent_persona("sirocco") +
        f" You are writing a native {platform} post. {spec['brief']} "
        f"Tone: {tone}. Do NOT use any emoji. Stay within {spec['limit']} characters. "
        "Return EXACTLY this structure and nothing else:\n"
        "<hook>a scroll-stopping opening line</hook>\n"
        "<hook>a different angle opening line</hook>\n"
        "<hook>a third opening line</hook>\n"
        "<content>the full post caption, ready to publish</content>\n"
        "<hashtags>#tag1 #tag2</hashtags>"
    )
    user = f"Topic: {topic}"
    if keyword:
        user += f"\nPrimary keyword to weave in naturally: {keyword}"
    raw = await call_llm(provider, model, api_key, system, user, locale=locale)
    variant = _parse_variant(raw, spec["limit"])
    variant["platform"] = platform
    variant["best_time"] = BEST_TIMES.get(platform)
    return variant


async def generate_studio(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    topic: str,
    platforms: list[str],
    tone: str,
    keyword: str | None,
    db,
) -> dict:
    """Generate native variants (hooks + caption + hashtags + best time) for each
    selected platform, in parallel."""
    topic = (topic or "").strip()
    if not topic:
        return {"ok": False, "error": "missing_topic", "variants": []}
    wanted = [p for p in platforms if p in PLATFORM_BRIEFS] or ["linkedin"]

    keys = await get_org_llm_keys(org_id, db)
    pm = _pick(keys)
    if pm is None:
        return {"ok": False, "error": "no_ai_key", "variants": []}
    locale = await project_locale(project_id, db)

    results = await asyncio.gather(
        *[_generate_one(p, topic, tone, keyword, pm[0], pm[1], keys[pm[0]], locale) for p in wanted],
        return_exceptions=True,
    )
    variants = [r for r in results if isinstance(r, dict)]
    if not variants:
        return {"ok": False, "error": "generation_failed", "variants": []}
    return {"ok": True, "variants": variants}
