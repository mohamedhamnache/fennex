"""One structured LLM call that turns crawled text + deterministic signals into
the interpretive discovery fields (industry, mission, tone, audience, goals...)."""
import json
import logging
import re

from app.services.discovery.extractors import empty_result, merge_result
from app.services.llm_service import call_llm

logger = logging.getLogger(__name__)

_ALLOWED_TOP = {"business", "brand", "audience", "competitors", "goals",
                "success_metrics", "products", "seo"}

_SYSTEM = (
    "You are a senior brand and market strategist. Given a company's website "
    "text and already-extracted signals, infer its business profile. "
    "Respond with a single valid JSON object and nothing else. Use only these "
    "top-level keys: business, brand, audience, goals, success_metrics, "
    "competitors. In business set: industry, country, timezone, description "
    "(2-3 sentences on what they do). In brand set: tone, personality (array), "
    "mission, vision, values (array), voice_prompt (one paragraph an AI writer "
    "can follow), vocabulary (array of preferred words), avoid_words (array), "
    "cta_style, reading_level, emoji_policy. audience is an array of 1-2 ICP "
    "objects with: label, age, gender, country, profession, interests (array), "
    "pains (array), goals (array), budget, buying_behavior. goals is an array "
    "of 3-6 concrete marketing goals. success_metrics is an array of 3-5 "
    "metrics. competitors is an array of {name, url, note}. Leave a field out "
    "if you cannot infer it. Never invent a URL."
)


def build_prompt(text: str, partial: dict) -> tuple[str, str]:
    signals = {
        "name": partial["business"].get("name"),
        "language": partial["business"].get("language"),
        "socials": list(partial["business"].get("socials", {}).keys()),
        "navigation": partial["business"].get("navigation"),
        "products": [p.get("name") for p in partial.get("products", []) if p.get("name")],
        "colors": partial["brand"].get("colors"),
    }
    user = (
        "Known signals (already extracted, do not contradict):\n"
        + json.dumps(signals, ensure_ascii=False)
        + "\n\nWebsite text (may be truncated):\n"
        + text[:12000]
    )
    return _SYSTEM, user


def parse_synthesis(raw: str) -> dict:
    if not raw:
        return {}
    match = re.search(r"\{.*\}", raw, re.S)
    if not match:
        return {}
    try:
        data = json.loads(match.group(0))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    result = {}
    for k, v in data.items():
        if k not in _ALLOWED_TOP:
            continue
        if k in {"business", "brand", "seo"}:
            if isinstance(v, dict):
                result[k] = v
        elif k in {"audience", "competitors", "goals", "success_metrics", "products"}:
            if isinstance(v, list):
                result[k] = v
    return result


async def synthesise(text: str, partial: dict, *, provider: str, model: str,
                     api_key: str, locale: str = "en") -> dict:
    if not text.strip():
        return partial
    try:
        sysp, userp = build_prompt(text, partial)
    except Exception:
        logger.exception("discovery synthesis prompt building failed")
        return partial
    try:
        raw = await call_llm(provider, model, api_key, sysp, userp, locale=locale, max_tokens=2000)
    except Exception:
        logger.exception("discovery synthesis LLM call failed")
        return partial
    return merge_result(partial, parse_synthesis(raw))
