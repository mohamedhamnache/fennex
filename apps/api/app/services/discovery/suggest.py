"""AI 'suggest' for onboarding: given an already-discovered business profile,
propose additional on-business items for one field (audience ICPs, goals, or
competitors). Grounds the model in the stored profile so suggestions feel like
a consultant who already understands the business.

Never raises out of ``suggest`` -- a missing key or LLM error yields []."""
import json
import logging
import re

from app.services.llm_service import call_llm

logger = logging.getLogger(__name__)

SUGGESTABLE = {"audience", "goals", "competitors"}

_FIELD_INSTRUCTION = {
    "audience": (
        "Propose 2 additional realistic ideal-customer profiles (ICPs) for this "
        "business that are NOT duplicates of the existing audience. Return a JSON "
        "array of objects, each with: label, age, gender, country, profession, "
        "interests (array), pains (array), goals (array), budget, buying_behavior."
    ),
    "goals": (
        "Propose 3 additional concrete marketing goals for this business that are "
        "NOT duplicates of the existing goals. Return a JSON array of short strings."
    ),
    "competitors": (
        "Propose up to 3 likely competitors for this business that are NOT already "
        "listed. Return a JSON array of objects, each with: name, url, note. Never "
        "invent a URL you are unsure of -- omit the url field instead."
    ),
}

_SYSTEM = (
    "You are a senior brand and market strategist helping set up a marketing "
    "workspace. Respond with a single valid JSON array and nothing else."
)


def build_profile_summary(result: dict) -> str:
    b = result.get("business", {}) or {}
    brand = result.get("brand", {}) or {}
    parts = []
    if b.get("name"):
        parts.append(f"Business: {b['name']}")
    if b.get("industry"):
        parts.append(f"Industry: {b['industry']}")
    if b.get("description"):
        parts.append(f"What they do: {b['description']}")
    products = [p.get("name") for p in (result.get("products") or []) if p.get("name")]
    if products:
        parts.append("Products: " + ", ".join(products[:8]))
    if brand.get("tone"):
        parts.append(f"Tone: {brand['tone']}")
    existing_aud = [a.get("label") for a in (result.get("audience") or []) if a.get("label")]
    if existing_aud:
        parts.append("Existing audience: " + ", ".join(existing_aud))
    if result.get("goals"):
        parts.append("Existing goals: " + ", ".join(str(g) for g in result["goals"]))
    existing_comp = [c.get("name") or c.get("url") for c in (result.get("competitors") or [])]
    existing_comp = [c for c in existing_comp if c]
    if existing_comp:
        parts.append("Existing competitors: " + ", ".join(existing_comp))
    return "\n".join(parts)


def parse_list(raw: str, field: str) -> list:
    """Tolerantly parse the model output into a list of the right shape.
    Accepts a bare JSON array or an object wrapping the array under the field
    name. Malformed input yields []."""
    if not raw:
        return []
    data = None
    array_match = re.search(r"\[.*\]", raw, re.S)
    if array_match:
        try:
            data = json.loads(array_match.group(0))
        except Exception:
            data = None
    if data is None:
        obj_match = re.search(r"\{.*\}", raw, re.S)
        if obj_match:
            try:
                wrapper = json.loads(obj_match.group(0))
                if isinstance(wrapper, dict):
                    data = wrapper.get(field)
            except Exception:
                data = None
    if not isinstance(data, list):
        return []

    if field == "goals":
        return [s.strip() for s in data if isinstance(s, str) and s.strip()]
    if field == "audience":
        return [d for d in data if isinstance(d, dict) and (d.get("label") or "").strip()]
    if field == "competitors":
        return [d for d in data if isinstance(d, dict) and (d.get("name") or d.get("url"))]
    return []


async def suggest(result: dict, field: str, *, provider: str, model: str,
                  api_key: str, locale: str = "en") -> list:
    if field not in SUGGESTABLE or not api_key:
        return []
    summary = build_profile_summary(result or {})
    user = (
        "Business profile:\n" + (summary or "(little is known -- infer sensibly)")
        + "\n\n" + _FIELD_INSTRUCTION[field]
    )
    try:
        raw = await call_llm(provider, model, api_key, _SYSTEM, user,
                             locale=locale, max_tokens=1200)
    except Exception:
        logger.exception("onboarding suggest LLM call failed")
        return []
    return parse_list(raw, field)
