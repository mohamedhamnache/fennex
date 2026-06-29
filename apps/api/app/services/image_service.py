"""Image generation service — gpt-image-1 with placeholder fallback."""
import httpx
import logging
from typing import Literal

logger = logging.getLogger(__name__)

PLACEHOLDER_BASE = "https://placehold.co"


def build_image_prompt(
    title: str,
    keyword: str | None,
    style: str,
    usage: str,
) -> str:
    """
    Build a DALL-E prompt from article/post metadata.
    """
    if usage == "article_cover":
        kw_part = f" Topic: {keyword}." if keyword else ""
        return (
            f"Professional blog cover image for an article titled '{title}'."
            f"{kw_part} Style: {style}. Wide format, no text overlays, "
            f"suitable for a tech/marketing blog."
        )
    elif usage == "social_post":
        subject = keyword or title
        return (
            f"Social media visual for content about '{subject}'."
            f" Style: {style}. Square format, bold and eye-catching."
        )
    elif usage == "brand_asset":
        return f"Brand visual asset. Style: {style}. Clean, professional."
    else:
        # custom
        return f"'{title}'. Style: {style}."


async def generate_image_dalle(
    prompt: str,
    style: str,
    usage: str,
    openai_api_key: str,
    quality: Literal["standard", "hd"] = "standard",
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
    if usage == "article_cover":
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
