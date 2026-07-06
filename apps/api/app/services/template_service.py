"""Pre-defined image generation templates with slot filling."""
import re
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.brand_kit import BrandKit

TEMPLATE_CATALOG: dict[str, dict] = {
    # Blog
    "blog_featured": {
        "label": "Blog Featured Image",
        "category": "blog",
        "description": "Wide hero image for blog articles",
        "slots": {"topic": "Article topic or title", "style": "Visual style (e.g. professional, abstract)"},
        "prompt_template": (
            "Professional blog featured image for an article about '{topic}'. "
            "Style: {style}. Wide landscape format, no text, atmospheric, editorial photography."
        ),
        "width": 1200, "height": 630,
    },
    "blog_infographic": {
        "label": "Blog Infographic Visual",
        "category": "blog",
        "description": "Illustrative visual to accompany data or statistics",
        "slots": {"topic": "Data topic", "style": "Visual style (e.g. flat illustration)"},
        "prompt_template": (
            "Clean flat illustration representing '{topic}' data. "
            "Style: {style}. Minimalist infographic aesthetic, icons, charts concept. No actual numbers."
        ),
        "width": 1200, "height": 800,
    },
    # Product
    "product_card": {
        "label": "Product Card",
        "category": "product",
        "description": "Square ecommerce product card",
        "slots": {"product": "Product name and description", "background": "Background setting"},
        "prompt_template": (
            "Professional ecommerce product photography of {product}. "
            "Background: {background}. Square format, clean lighting, premium product presentation."
        ),
        "width": 1080, "height": 1080,
    },
    "product_lifestyle": {
        "label": "Product Lifestyle Shot",
        "category": "product",
        "description": "Product in a real-world lifestyle context",
        "slots": {"product": "Product name", "scene": "Lifestyle scene description"},
        "prompt_template": (
            "Lifestyle product photography of {product} in {scene}. "
            "Natural lighting, aspirational lifestyle aesthetic, editorial quality."
        ),
        "width": 1200, "height": 800,
    },
    # Social
    "testimonial_card": {
        "label": "Testimonial Card",
        "category": "social",
        "description": "Background for testimonial or review graphic",
        "slots": {"mood": "Emotional tone (e.g. happy, professional, trustworthy)", "industry": "Customer industry"},
        "prompt_template": (
            "Clean modern background for a {mood} customer testimonial card in the {industry} industry. "
            "Soft gradient, bokeh, professional, suitable for overlaying white text. No people, no text."
        ),
        "width": 1080, "height": 1080,
    },
    "quote_graphic": {
        "label": "Quote Graphic",
        "category": "social",
        "description": "Atmospheric background for a quote image",
        "slots": {"theme": "Quote theme or emotion", "color_mood": "Color mood (e.g. warm, cool, neutral)"},
        "prompt_template": (
            "Artistic abstract background for a {theme} motivational quote. "
            "Color mood: {color_mood}. Bokeh, gradient, texture. Suitable for overlaying text. No text in image."
        ),
        "width": 1080, "height": 1080,
    },
    "carousel_slide_cover": {
        "label": "Carousel Cover Slide",
        "category": "social",
        "description": "First slide of an Instagram/LinkedIn carousel",
        "slots": {"topic": "Carousel topic", "industry": "Your industry"},
        "prompt_template": (
            "Eye-catching cover image for a '{topic}' educational carousel in the {industry} space. "
            "Bold, modern, professional. Space for large text overlay. Square format."
        ),
        "width": 1080, "height": 1080,
    },
    "carousel_slide_body": {
        "label": "Carousel Body Slide",
        "category": "social",
        "description": "Interior slide background for a carousel",
        "slots": {"style": "Visual style", "color": "Primary color theme"},
        "prompt_template": (
            "Clean minimal slide background. Style: {style}. Color theme: {color}. "
            "Simple, elegant, suitable for data or text overlay. Square format."
        ),
        "width": 1080, "height": 1080,
    },
    # Ad
    "ad_creative_square": {
        "label": "Ad Creative (Square)",
        "category": "ad",
        "description": "Social media ad background",
        "slots": {"product_category": "Product or service category", "mood": "Ad mood (e.g. energetic, luxurious, friendly)"},
        "prompt_template": (
            "High-impact advertising creative background for a {product_category} brand. "
            "Mood: {mood}. Bold, eye-catching, professional. Space for product and CTA text overlay."
        ),
        "width": 1080, "height": 1080,
    },
    "ad_creative_landscape": {
        "label": "Ad Creative (Landscape)",
        "category": "ad",
        "description": "Landscape ad for Facebook / display network",
        "slots": {"product_category": "Product or service category", "mood": "Ad mood"},
        "prompt_template": (
            "Professional landscape advertising banner for a {product_category} brand. "
            "Mood: {mood}. Bold, clean design with space for headline text. 1200x628 format."
        ),
        "width": 1200, "height": 628,
    },
    # Email
    "email_hero": {
        "label": "Email Hero Image",
        "category": "email",
        "description": "Email newsletter hero section image",
        "slots": {"campaign_theme": "Campaign theme or offer", "season": "Season or occasion"},
        "prompt_template": (
            "Professional email marketing hero image for a {campaign_theme} campaign during {season}. "
            "Horizontal format 600x300, clean and inviting, no text."
        ),
        "width": 600, "height": 300,
    },
    # Event
    "event_banner": {
        "label": "Event Banner",
        "category": "event",
        "description": "Banner for webinar, conference or event",
        "slots": {"event_type": "Type of event", "topic": "Event topic", "style": "Visual style"},
        "prompt_template": (
            "Professional event marketing banner for a {event_type} about '{topic}'. "
            "Style: {style}. Dynamic and engaging, suitable for text overlay. Landscape format."
        ),
        "width": 1920, "height": 600,
    },
}


def fill_template(
    template_id: str,
    slots: dict[str, str],
    brand_kit: Optional["BrandKit"],
) -> str:
    template = TEMPLATE_CATALOG.get(template_id)
    if not template:
        raise ValueError(f"Unknown template: {template_id}. Available: {list(TEMPLATE_CATALOG)}")

    prompt = template["prompt_template"]
    for key, value in slots.items():
        prompt = prompt.replace(f"{{{key}}}", value or "general")

    # Fill any remaining unfilled slots with defaults
    for key in re.findall(r"\{(\w+)\}", prompt):
        prompt = prompt.replace(f"{{{key}}}", "general")

    if brand_kit:
        parts = []
        if brand_kit.colors:
            parts.append(f"Brand palette: {', '.join(brand_kit.colors)}")
        if brand_kit.style_rules:
            parts.append(f"Style: {brand_kit.style_rules}")
        if brand_kit.tone:
            parts.append(f"Tone: {brand_kit.tone}")
        if parts:
            prompt = f"{prompt} {'. '.join(parts)}."

    return prompt
