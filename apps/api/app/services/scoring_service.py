"""LLM-powered image quality and performance scoring."""
import json
import uuid
from typing import Optional, TYPE_CHECKING

from app.services.llm_service import get_org_llm_keys, call_llm

if TYPE_CHECKING:
    from app.models.image import GeneratedImage
    from app.models.brand_kit import BrandKit

_SCORING_SYSTEM = (
    "You are an expert image marketing analyst. "
    "Evaluate an AI-generated image based on its generation prompt, metadata, and context. "
    "Score it on 4 dimensions (each 0-100) and provide actionable feedback. "
    "Respond ONLY with a JSON object with keys: "
    "visual_quality (composition, lighting, realism), "
    "brand_consistency (alignment with brand guidelines if provided, otherwise 70), "
    "seo_score (alt text quality, filename quality, usage context), "
    "ad_performance (predicted engagement, CTA visibility potential, emotional impact), "
    "overall (weighted average), "
    "feedback (2-3 sentence actionable summary). "
    "No markdown, no explanation outside JSON."
)

_PROVIDERS = [
    ("anthropic", "claude-haiku-4-5-20251001"),
    ("openai", "gpt-4o-mini"),
]


async def score_image(
    image,
    brand_kit: Optional["BrandKit"],
    org_id: uuid.UUID,
    db,
) -> dict:
    keys = await get_org_llm_keys(org_id, db)
    if not keys:
        return {"error": "no_llm_keys"}

    context_parts = [
        f"Prompt: {image.prompt or 'Not provided'}",
        f"Usage: {(image.usage or 'unknown').replace('_', ' ')}",
        f"Style: {image.style or 'unknown'}",
        f"Alt text: {image.alt_text or 'MISSING — SEO issue'}",
        f"SEO filename: {image.seo_filename or 'MISSING'}",
    ]

    if brand_kit:
        brand_parts = []
        if brand_kit.colors:
            brand_parts.append(f"Colors: {', '.join(brand_kit.colors)}")
        if brand_kit.style_rules:
            brand_parts.append(f"Style rules: {brand_kit.style_rules}")
        if brand_kit.tone:
            brand_parts.append(f"Tone: {brand_kit.tone}")
        if brand_parts:
            context_parts.append(f"Brand kit: {'; '.join(brand_parts)}")
    else:
        context_parts.append("Brand kit: not configured")

    user_msg = "\n".join(context_parts)

    for provider, model in _PROVIDERS:
        if provider not in keys:
            continue
        try:
            raw = await call_llm(provider, model, keys[provider], _SCORING_SYSTEM, user_msg)
            data = json.loads(raw.strip())
            for key in ("visual_quality", "brand_consistency", "seo_score", "ad_performance", "overall"):
                if key in data:
                    data[key] = max(0.0, min(100.0, float(data[key])))
            return data
        except Exception:
            continue

    return {"error": "Scoring failed — LLM returned invalid response"}
