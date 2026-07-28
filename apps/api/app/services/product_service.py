"""Product photography scene catalog and prompt builder."""
from typing import Optional, TYPE_CHECKING

from app.services.prompting import PromptBuilder, ShowcaseSpec

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
    """Thin wrapper: builds a ShowcaseSpec and delegates to PromptBuilder.

    Preservation, quality and photography direction now come from the shared
    `prompting` modules (role, product_preservation, composition, lighting,
    camera, rendering_style, quality) instead of a single hand-rolled
    f-string. Two pieces of this scene's direction aren't representable by
    those modules without loss, so they're carried verbatim through
    `ShowcaseSpec.user_prompt` (appended last by the builder, so it still
    reads as instruction rather than being overridden):

    - The curated environment description in `PRODUCT_SCENES[...]
      ["prompt_template"]`. `modules.environment()` only turns the scene id
      into a generic "Scene: cafe table" stub -- resolving the full
      description is explicitly documented as the caller's job.
    - The "integrate realistically with natural contact shadows, accurate
      reflections..." sentence: this instruction lives in
      `vocab.SHOWCASE_SYSTEM_PROMPT` (`PromptResult.system_prompt`), but this
      function's return type is a single `str` and its only caller
      (`routers/product.py`, not touched by this refactor) only ever sends
      the `.prompt` half to the model, never the system prompt. Dropping it
      here would silently lose the instruction, so it stays in the prompt
      body.

    Fixed defaults below (lighting, camera, aspect_ratio, creativity,
    quality) are new controls the old signature never exposed. They're
    chosen to be neutral/non-contradictory with every existing scene
    description and consistent with what the caller already does today:
    `_run_flux_kontext` hard-codes `aspect_ratio="1:1"` on the Replicate call
    regardless of prompt text, so stating it here matches real output rather
    than introducing a new one.
    """
    scene = PRODUCT_SCENES.get(scene_id)
    if not scene:
        raise ValueError(f"Unknown scene: {scene_id}")

    scene_instruction = (
        f"Place the product from the image {scene['prompt_template']}. "
        "Integrate it realistically with natural contact shadows, accurate reflections and "
        "lighting that matches the scene. Photorealistic, ultra-detailed, high-resolution "
        "professional commercial product photography, sharp focus on the product."
    )

    spec = ShowcaseSpec(
        scene_id=scene_id,
        lighting="diffused_daylight",
        camera="50mm",
        aspect_ratio="1:1",
        creativity=30,
        product_preservation=100,
        user_prompt=scene_instruction,
        negative_prompt="",
        seed=None,
        quality="ultra",
        product_description=product_description,
    )
    return PromptBuilder.build_product_showcase(spec, brand_kit).prompt
