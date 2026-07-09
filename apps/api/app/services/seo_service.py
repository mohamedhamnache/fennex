"""LLM-powered SEO metadata generation for images."""
import json
import re
import uuid

from app.services.llm_service import get_org_llm_keys, call_llm

_SEO_SYSTEM = (
    "You are an SEO expert specializing in image optimization. "
    "Given an image prompt and usage context, generate: "
    "1) A concise, descriptive alt text (max 125 chars, no 'image of' prefix). "
    "2) A short caption suitable for a blog or product page (max 200 chars). "
    "3) A slug for the filename (lowercase, hyphens only, max 60 chars, no file extension). "
    "Respond with ONLY a JSON object: {\"alt_text\": \"...\", \"caption\": \"...\", \"seo_filename\": \"...\"}. "
    "No markdown, no explanation."
)

_PROVIDERS = [
    ("anthropic", "claude-haiku-4-5-20251001"),
    ("openai", "gpt-4o-mini"),
]


def _slugify(text: str) -> str:
    slug = text.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s-]+", "-", slug).strip("-")
    return slug[:60]


async def generate_seo_data(
    prompt: str,
    usage: str,
    org_id: uuid.UUID,
    db,
    locale: str = "en",
) -> dict:
    keys = await get_org_llm_keys(org_id, db)
    if not keys:
        return {"alt_text": None, "caption": None, "seo_filename": None, "error": "no_llm_keys"}

    user_msg = f"Image prompt: {prompt}\nUsage: {usage.replace('_', ' ')}"

    for provider, model in _PROVIDERS:
        if provider not in keys:
            continue
        try:
            raw = await call_llm(provider, model, keys[provider], _SEO_SYSTEM, user_msg, locale=locale)
            data = json.loads(raw.strip())
            return {
                "alt_text": str(data.get("alt_text", ""))[:125] or None,
                "caption": str(data.get("caption", ""))[:200] or None,
                "seo_filename": _slugify(str(data.get("seo_filename", ""))) or None,
            }
        except Exception:
            continue

    return {"alt_text": None, "caption": None, "seo_filename": None, "error": "llm_failed"}
