"""Image generation service — gpt-image-1 with placeholder fallback."""
import httpx
import logging
from typing import Literal, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.brand_kit import BrandKit

logger = logging.getLogger(__name__)

PLACEHOLDER_BASE = "https://placehold.co"


def build_image_prompt(
    title: str,
    keyword: str | None,
    style: str,
    usage: str,
    brand_kit: Optional["BrandKit"] = None,
) -> str:
    if usage == "article_cover":
        kw_part = f" Topic: {keyword}." if keyword else ""
        base = (
            f"Professional blog cover image for an article titled '{title}'."
            f"{kw_part} Style: {style}. Wide format, no text overlays, "
            f"suitable for a tech/marketing blog."
        )
    elif usage == "social_post":
        subject = keyword or title
        base = (
            f"Social media visual for content about '{subject}'."
            f" Style: {style}. Square format, bold and eye-catching."
        )
    elif usage == "brand_asset":
        base = f"Brand visual asset. Style: {style}. Clean, professional."
    else:
        base = f"'{title}'. Style: {style}."

    if brand_kit:
        parts = []
        if brand_kit.colors:
            parts.append(f"Brand palette: {', '.join(brand_kit.colors)}")
        if brand_kit.style_rules:
            parts.append(f"Style: {brand_kit.style_rules}")
        if brand_kit.tone:
            parts.append(f"Tone: {brand_kit.tone}")
        if parts:
            base = f"{base} {'. '.join(parts)}."

    return base


SOCIAL_PRESETS: dict[str, dict] = {
    "instagram_post":    {"width": 1080, "height": 1080, "label": "Instagram Post",    "aspect": "1:1",     "dalle_size": "1024x1024"},
    "instagram_story":   {"width": 1080, "height": 1920, "label": "Instagram Story",   "aspect": "9:16",    "dalle_size": "1024x1536"},
    "instagram_reel":    {"width": 1080, "height": 1920, "label": "Instagram Reel",    "aspect": "9:16",    "dalle_size": "1024x1536"},
    "youtube_thumbnail": {"width": 1280, "height": 720,  "label": "YouTube Thumbnail", "aspect": "16:9",   "dalle_size": "1536x1024"},
    "linkedin_banner":   {"width": 1584, "height": 396,  "label": "LinkedIn Banner",   "aspect": "4:1",    "dalle_size": "1536x1024"},
    "linkedin_post":     {"width": 1200, "height": 627,  "label": "LinkedIn Post",     "aspect": "1.91:1", "dalle_size": "1536x1024"},
    "facebook_ad":       {"width": 1200, "height": 628,  "label": "Facebook Ad",       "aspect": "1.91:1", "dalle_size": "1536x1024"},
    "tiktok_cover":      {"width": 1080, "height": 1920, "label": "TikTok Cover",      "aspect": "9:16",   "dalle_size": "1024x1536"},
    "pinterest_pin":     {"width": 1000, "height": 1500, "label": "Pinterest Pin",     "aspect": "2:3",    "dalle_size": "1024x1536"},
}


def build_social_prompt(
    platform: str,
    subject: str,
    brand_kit=None,
) -> str:
    meta = SOCIAL_PRESETS.get(platform, {})
    label = meta.get("label", platform.replace("_", " ").title())
    aspect = meta.get("aspect", "")
    base = (
        f"Professional {label} image ({aspect} aspect ratio). "
        f"Subject: {subject}. "
        f"Bold, eye-catching composition optimised for social media engagement. "
        f"No text overlays. High quality, vibrant."
    )
    if brand_kit:
        parts = []
        if brand_kit.colors:
            parts.append(f"Brand palette: {', '.join(brand_kit.colors)}")
        if brand_kit.tone:
            parts.append(f"Tone: {brand_kit.tone}")
        if parts:
            base = f"{base} {'. '.join(parts)}."
    return base


async def generate_image_dalle(
    prompt: str,
    style: str,
    usage: str,
    openai_api_key: str,
    quality: Literal["standard", "hd"] = "standard",
    size_override: Optional[str] = None,
) -> dict:
    """
    Generate image via gpt-image-1 API (replaces deprecated dall-e-3).

    Returns: {ok: True, image_url, revised_prompt, width, height, cost_usd}
    Or: {ok: False, error: str}

    Timeout: 60s. image_url is a data URI (base64 PNG).
    """
    if quality not in {"standard", "hd"}:
        return {"ok": False, "error": f"Invalid quality '{quality}': must be 'standard' or 'hd'"}

    # gpt-image-1 uses "medium"/"high" instead of "standard"/"hd"
    gpt_quality = "high" if quality == "hd" else "medium"

    # Approximate gpt-image-1 costs — check OpenAI pricing for exact values
    if size_override:
        size = size_override
        w_str, h_str = size_override.split("x")
        width, height = int(w_str), int(h_str)
        cost_usd = 0.25 if quality == "hd" else 0.06
    elif usage == "article_cover":
        size = "1536x1024"  # gpt-image-1 landscape; 1792x1024 no longer supported
        width = 1536
        height = 1024
        cost_usd = 0.25 if quality == "hd" else 0.06  # high/medium at 1536x1024
    else:
        size = "1024x1024"
        width = 1024
        height = 1024
        cost_usd = 0.17 if quality == "hd" else 0.04  # high/medium at 1024x1024

    payload = {
        "model": "gpt-image-1",
        "prompt": prompt,
        "n": 1,
        "size": size,
        "quality": gpt_quality,
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/images/generations",
                headers={
                    "Authorization": f"Bearer {openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            image_data = data["data"][0]
            # gpt-image-1 returns b64_json; wrap as data URI for frontend display
            if image_data.get("b64_json"):
                image_url = f"data:image/png;base64,{image_data['b64_json']}"
            else:
                image_url = image_data.get("url", "")
            return {
                "ok": True,
                "image_url": image_url,
                "revised_prompt": image_data.get("revised_prompt"),
                "width": width,
                "height": height,
                "cost_usd": cost_usd,
            }
    except httpx.HTTPStatusError as e:
        try:
            error_body = e.response.json()
            error_msg = error_body.get("error", {}).get("message", f"HTTP {e.response.status_code}")
        except Exception:
            error_msg = f"HTTP {e.response.status_code}"
        logger.error("Image API HTTP error %s: %s", e.response.status_code, error_msg)
        return {"ok": False, "error": f"Image generation error: {error_msg}"}
    except Exception as e:
        logger.error("Image API error: %s", e)
        return {"ok": False, "error": str(e)}


def get_placeholder_url(usage: str) -> dict:
    """
    Returns a placeholder image dict when no API key is available.

    Sizes: article_cover → 1536x1024, social_post → 1024x1024, default → 1200x630
    """
    if usage == "article_cover":
        width, height = 1792, 1024
    elif usage == "social_post":
        width, height = 1024, 1024
    else:
        width, height = 1200, 630

    image_url = f"{PLACEHOLDER_BASE}/{width}x{height}"

    return {
        "ok": True,
        "image_url": image_url,
        "revised_prompt": None,
        "width": width,
        "height": height,
        "cost_usd": 0.0,
    }
