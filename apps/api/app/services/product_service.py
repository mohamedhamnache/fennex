"""Product photography scene catalog and prompt builder."""
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.brand_kit import BrandKit

# Each template describes only the ENVIRONMENT the product is placed into. The
# builder wraps it in a preservation-focused edit instruction for flux-kontext,
# so the product's identity is kept while the surroundings are re-rendered.
PRODUCT_SCENES: dict[str, dict] = {
    "cafe_table": {
        "label": "Café Table",
        "category": "lifestyle",
        "prompt_template": "on a rustic wooden café table with soft morning light streaming through a window, warm blurred bokeh background, cozy premium lifestyle atmosphere",
    },
    "marble_countertop": {
        "label": "Marble Countertop",
        "category": "lifestyle",
        "prompt_template": "on a polished white marble countertop, clean minimal styling, soft diffused natural window light, bright airy luxury setting",
    },
    "outdoor_nature": {
        "label": "Outdoor / Nature",
        "category": "lifestyle",
        "prompt_template": "in a natural outdoor setting with lush greenery softly blurred behind, fresh diffused daylight, vibrant organic aesthetic",
    },
    "home_living_room": {
        "label": "Living Room",
        "category": "lifestyle",
        "prompt_template": "on a side table in a bright modern Scandinavian living room, warm ambient light, cozy tasteful home atmosphere",
    },
    "athlete_action": {
        "label": "Athlete in Action",
        "category": "fashion",
        "prompt_template": "used by an athletic model in a dynamic action pose, energetic stadium or track setting with a sense of motion, vivid editorial sports photography",
    },
    "model_studio": {
        "label": "Model Studio Shot",
        "category": "fashion",
        "prompt_template": "presented by a professional model against a clean studio backdrop, flattering high-key lighting, polished fashion editorial style",
    },
    "white_studio": {
        "label": "White Studio",
        "category": "packshot",
        "prompt_template": "on a seamless pure white studio background with soft even professional lighting and a subtle natural contact shadow, clean ecommerce packshot",
    },
    "gradient_studio": {
        "label": "Gradient Background",
        "category": "packshot",
        "prompt_template": "centered on a smooth studio gradient backdrop with soft balanced lighting and a gentle reflection, modern ecommerce presentation",
    },
    "floating_shadow": {
        "label": "Floating with Shadow",
        "category": "packshot",
        "prompt_template": "floating slightly above a clean surface with a realistic soft drop shadow beneath, bright minimal background, premium ecommerce hero shot",
    },
    "food_table_scene": {
        "label": "Food Table Scene",
        "category": "food",
        "prompt_template": "styled on a table with complementary fresh ingredients and tasteful props, warm inviting restaurant lighting, appetizing editorial food photography",
    },
    "desk_setup": {
        "label": "Desk Setup",
        "category": "tech",
        "prompt_template": "on a clean modern desk with minimal tasteful accessories, soft neutral office lighting, professional tech product flat-lay feel",
    },
}


def build_scene_prompt(
    scene_id: str,
    product_description: str,
    brand_kit: Optional["BrandKit"],
) -> str:
    scene = PRODUCT_SCENES.get(scene_id)
    if not scene:
        raise ValueError(f"Unknown scene: {scene_id}")

    # Instruction-style prompt for flux-kontext: lead with the action, describe the
    # scene, then strongly constrain the model to preserve the product's identity.
    instruction = (
        f"Place the product from the image {scene['prompt_template']}. "
        "Keep the product itself completely unchanged — identical shape, colours, materials, "
        "proportions, textures, and any text, logo or label. Do not redesign, distort, recolour, "
        "or replace the product; only change the environment around it. "
        "Integrate it realistically with natural contact shadows, accurate reflections and "
        "lighting that matches the scene. Photorealistic, ultra-detailed, high-resolution "
        "professional commercial product photography, sharp focus on the product."
    )

    if product_description.strip():
        instruction += f" For reference, the product is {product_description.strip()}."

    if brand_kit:
        parts = []
        if brand_kit.colors:
            parts.append(f"echo the brand palette ({', '.join(brand_kit.colors)}) subtly in the styling and props")
        if brand_kit.style_rules:
            parts.append(brand_kit.style_rules)
        if parts:
            instruction += " " + ". ".join(parts) + "."

    return instruction
