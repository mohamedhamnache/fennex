"""Product photography scene catalog and prompt builder."""
from typing import Optional, TYPE_CHECKING

from app.services.prompting import PromptBuilder, ShowcaseSpec, vocab

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
    *,
    lighting: vocab.LightingToken = "diffused_daylight",
    camera: vocab.CameraToken = "50mm",
    aspect_ratio: vocab.AspectRatioToken = "1:1",
    creativity: int = 30,
    product_preservation: int = 100,
    user_prompt: str = "",
    negative_prompt: str = "",
    seed: int | None = None,
    quality: vocab.QualityToken = "ultra",
) -> str:
    """Thin wrapper: builds a ShowcaseSpec and delegates to PromptBuilder.

    Preservation, quality and photography direction come from the shared
    `prompting` modules (role, product_preservation, composition, lighting,
    camera, rendering_style, quality, brand_style). Two pieces of direction
    used to have nowhere to live in those modules and were smuggled through
    `ShowcaseSpec.user_prompt` -- both gaps are now closed at the source:

    - The curated per-scene environment description
      (`PRODUCT_SCENES[...]["prompt_template"]`) plus the closing
      "integrate realistically... photorealistic, ultra-detailed..."
      direction is resolved *here* (the caller) into
      `environment_description`, a real `ShowcaseSpec` field.
      `modules.environment()` renders it verbatim when present instead of
      falling back to its generic "Scene: cafe table" stub. Both sentences
      are kept together because they're both scene-integration direction,
      not user intent, and the pure `prompting` package must not import
      `PRODUCT_SCENES` itself -- resolving the id to text is explicitly the
      caller's job.
    - Brand-kit `tone`: `modules.brand_style` now reads `tone` directly off
      `brand_kit` (part of `BrandKitLike`), so it no longer needs routing
      around via `user_prompt`.

    As a result `user_prompt` here carries only genuine user intent -- the
    caller-supplied `user_prompt` keyword, defaulted to "" for existing
    callers, and appended last by the builder so it refines rather than
    overrides everything above it.

    The keyword-only controls (lighting, camera, aspect_ratio, creativity,
    product_preservation, negative_prompt, seed, quality) default to the
    same fixed values this function always used, so callers that don't pass
    them keep getting byte-identical prompts to before. `aspect_ratio="1:1"`
    matches `routers/product.py::_run_flux_kontext`, which hard-codes
    `aspect_ratio="1:1"` on the Replicate call unless overridden.
    """
    scene = PRODUCT_SCENES.get(scene_id)
    if not scene:
        raise ValueError(f"Unknown scene: {scene_id}")

    environment_description = (
        f"Place the product from the image {scene['prompt_template']}. "
        "Integrate it realistically with natural contact shadows, accurate reflections and "
        "lighting that matches the scene. Photorealistic, ultra-detailed, high-resolution "
        "professional commercial product photography, sharp focus on the product."
    )

    spec = ShowcaseSpec(
        scene_id=scene_id,
        lighting=lighting,
        camera=camera,
        aspect_ratio=aspect_ratio,
        creativity=creativity,
        product_preservation=product_preservation,
        user_prompt=user_prompt,
        negative_prompt=negative_prompt,
        seed=seed,
        quality=quality,
        product_description=product_description,
        environment_description=environment_description,
    )
    return PromptBuilder.build_product_showcase(spec, brand_kit).prompt
