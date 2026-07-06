"""Marketing banner format catalog and prompt builder."""
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.brand_kit import BrandKit

# generation_size: nearest gpt-image-1 supported size (1024x1024, 1536x1024, 1024x1536)
BANNER_FORMATS: dict[str, dict] = {
    "hero_banner": {
        "label": "Hero Banner",
        "width": 1920,
        "height": 600,
        "generation_size": "1536x1024",
        "description": "Wide website hero section",
        "prompt_style": "Wide cinematic composition, product hero image, dramatic lighting, clean background with space for headline text",
    },
    "promo_ad_square": {
        "label": "Promo Ad (Square)",
        "width": 1080,
        "height": 1080,
        "generation_size": "1024x1024",
        "description": "Social media promo ad",
        "prompt_style": "Bold promotional graphic, product centered, high contrast, eye-catching colors, space for offer text at bottom",
    },
    "sale_poster": {
        "label": "Sale Poster",
        "width": 800,
        "height": 1200,
        "generation_size": "1024x1536",
        "description": "Tall sale / promotional poster",
        "prompt_style": "Vertical promotional poster layout, product featured prominently, vibrant sale atmosphere, energetic composition",
    },
    "email_header": {
        "label": "Email Header",
        "width": 600,
        "height": 200,
        "generation_size": "1536x1024",
        "description": "Email newsletter header",
        "prompt_style": "Horizontal email banner, clean minimal product image, professional and trustworthy, subtle background",
    },
    "display_ad_rectangle": {
        "label": "Display Ad (Rectangle)",
        "width": 728,
        "height": 90,
        "generation_size": "1536x1024",
        "description": "Leaderboard display ad",
        "prompt_style": "Ultra-wide banner, product image on left, clean background, professional advertising layout",
    },
    "story_ad": {
        "label": "Story Ad (9:16)",
        "width": 1080,
        "height": 1920,
        "generation_size": "1024x1536",
        "description": "Instagram / TikTok story ad",
        "prompt_style": "Full-screen vertical story format, immersive lifestyle product image, bold and engaging",
    },
}


def build_banner_prompts(
    product: str,
    offer: str,
    cta: str,
    style: str,
    brand_kit: Optional["BrandKit"],
    format_ids: Optional[list[str]] = None,
) -> list[dict]:
    formats = {k: v for k, v in BANNER_FORMATS.items() if not format_ids or k in format_ids}
    result = []
    for fmt_id, fmt in formats.items():
        base = (
            f"Marketing creative for {product}. Offer: {offer}. CTA: {cta}. "
            f"{fmt['prompt_style']}. "
            f"Style: {style.replace('_', ' ')}. "
            f"Professional advertising photography. No text overlays — image only."
        )
        if brand_kit:
            parts = []
            if brand_kit.colors:
                parts.append(f"Brand palette: {', '.join(brand_kit.colors)}")
            if brand_kit.tone:
                parts.append(f"Tone: {brand_kit.tone}")
            if brand_kit.style_rules:
                parts.append(f"Style rules: {brand_kit.style_rules}")
            if parts:
                base = f"{base} {'. '.join(parts)}."
        result.append({
            "format_id": fmt_id,
            "label": fmt["label"],
            "prompt": base,
            "width": fmt["width"],
            "height": fmt["height"],
            "generation_size": fmt["generation_size"],
        })
    return result
