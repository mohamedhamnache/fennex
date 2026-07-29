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
        "category": "premium",
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

    # -------------------------------------------------------------------
    # Premium environments (category: "premium"). `white_studio` above is
    # also part of this set (recategorised from "packshot", its id and
    # label unchanged). The other 14 ids below are new. `marble` here is
    # deliberately distinct from `marble_countertop` above (a bright white
    # kitchen counter) -- this one is a darker, gallery-lit stone pedestal
    # treatment. `lifestyle` here is a scene id, distinct from the
    # `category: "lifestyle"` used by cafe_table/marble_countertop/etc.
    # above; both keep working since scene ids and category values are
    # independent namespaces.
    # -------------------------------------------------------------------
    "luxury_studio": {
        "label": "Luxury Studio",
        "category": "premium",
        "prompt_template": "on a sculptural pedestal within a hushed, minimalist luxury studio, deep charcoal backdrop with a single controlled key light and a mirror-polished floor reflection, gallery-grade premium presentation",
    },
    "bathroom": {
        "label": "Bathroom",
        "category": "premium",
        "prompt_template": "beside a matte stone bathroom vanity with a folded white linen towel and a sprig of eucalyptus, soft diffused light through a frosted window, serene spa-clean atmosphere",
    },
    "spa": {
        "label": "Spa",
        "category": "premium",
        "prompt_template": "on a woven bamboo tray beside smooth river stones and a single lit candle, warm low-key ambient light with a faint steam haze, tranquil wellness-retreat mood",
    },
    "travertine": {
        "label": "Travertine",
        "category": "premium",
        "prompt_template": "resting on a raw-edged travertine slab, its warm honeycombed texture catching soft directional light, sand-toned minimalist backdrop, quarried-stone editorial mood",
    },
    "marble": {
        "label": "Marble",
        "category": "premium",
        "prompt_template": "on a dark veined marble pedestal with dramatic raking sidelight tracing the stone's natural pattern, deep shadow falloff into a near-black backdrop, gallery-grade luxury mood",
    },
    "limestone": {
        "label": "Limestone",
        "category": "premium",
        "prompt_template": "on a pale limestone block with a chalky matte texture, soft overcast daylight and a faint natural shadow, quiet Mediterranean-quarry aesthetic",
    },
    "botanical": {
        "label": "Botanical",
        "category": "premium",
        "prompt_template": "nestled among lush trailing botanicals and glossy monstera leaves, dappled natural light filtering through foliage, lush greenhouse-editorial atmosphere",
    },
    "mediterranean": {
        "label": "Mediterranean",
        "category": "premium",
        "prompt_template": "on a sun-bleached whitewashed terrace ledge overlooking a soft-focus turquoise coastline, bright clean midday Mediterranean light, breezy coastal-luxury mood",
    },
    "luxury_hotel": {
        "label": "Luxury Hotel",
        "category": "premium",
        "prompt_template": "on a lacquered console table in a five-star hotel suite, warm ambient designer lamplight with a soft-focus skyline visible beyond sheer curtains, discreet five-star hospitality mood",
    },
    "editorial": {
        "label": "Editorial",
        "category": "premium",
        "prompt_template": "isolated against a bold graphic studio backdrop with hard directional light and a crisp graphic shadow, high-contrast fashion-magazine editorial styling",
    },
    "lifestyle": {
        "label": "Lifestyle",
        "category": "premium",
        "prompt_template": "held in use within a candid, sunlit everyday moment, natural home surroundings softly out of focus, authentic warm lifestyle-editorial feel",
    },
    "minimal": {
        "label": "Minimal",
        "category": "premium",
        "prompt_template": "centred alone against a single seamless pastel backdrop with a barely-there shadow, restrained negative space, quiet minimalist gallery presentation",
    },
    "scandinavian": {
        "label": "Scandinavian",
        "category": "premium",
        "prompt_template": "on a pale oak side table beside a linen-draped armchair, soft northern daylight through sheer curtains, calm airy Scandinavian interior mood",
    },
    "dark_luxury": {
        "label": "Dark Luxury",
        "category": "premium",
        "prompt_template": "on a black lacquered surface under a single dramatic spotlight with deep velvety shadow, moody chiaroscuro contrast, dark-luxury campaign mood",
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
    """Thin wrapper: builds a ShowcaseSpec, delegates to PromptBuilder, and
    assembles the FINAL text sent to flux-kontext.

    flux-kontext-pro takes a single prompt string -- there is no separate
    system-prompt field on the model -- so the returned string is not just
    `PromptResult.prompt`. It is three parts, in this order:

    1. `PromptResult.system_prompt` (`vocab.SHOWCASE_SYSTEM_PROMPT`, the
       owner's verbatim never-modify list). Fix-round-1 CRITICAL: this used
       to be computed by `PromptBuilder.build_product_showcase` and then
       discarded -- only `.prompt` was returned -- so the owner's system
       prompt never reached the model at all. It is now prepended so it
       actually ships.
    2. The assembled instruction (`PromptResult.prompt`: role, objective,
       preservation, composition, lighting, camera, materials, environment,
       rendering style, brand style, quality, user intent) followed by an
       explicit do-not-redesign clause. Fix-round-1 CRITICAL: the
       pre-PromptBuilder version of this function led with "Keep the
       product itself completely unchanged ... Do not redesign, distort,
       recolour, or replace the product; only change the environment around
       it." That sentence has no home in `vocab.SHOWCASE_SYSTEM_PROMPT`
       (whose "Never modify" list is a noun list, not this "only change the
       environment" instruction) and nothing in the PromptBuilder pipeline
       ever restated it, so the refactor silently dropped it -- the live
       endpoint was sending LESS preservation direction than before the
       refactor. It is reinstated here, verbatim, rather than folded into
       `modules.product_preservation` because it is showcase-specific
       (it talks about swapping the *environment*, which has no meaning for
       the Product-to-3D pipeline that also calls `product_preservation`).
    3. `PromptResult.negative_prompt` (the 11 required exclusions plus any
       user-supplied `negative_prompt`), folded into an explicit "Avoid:"
       clause. Fix-round-1 CRITICAL: flux-kontext-pro has no negative-prompt
       input, and `PromptResult.negative_prompt` used to be computed by
       PromptBuilder and then discarded -- the `negative_prompt` API field
       and the UI's negative-prompt textarea controlled nothing. Folding it
       into the instruction text as an explicit avoid-clause is the only way
       to make it do anything against this model.

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
    them keep exercising the same module inputs as before -- the OUTPUT
    string is no longer byte-identical to pre-fix-round-1 (it now carries
    the system prompt and the avoid-clause too; see the fix-round-1 notes
    above), but every module contribution is unchanged. `aspect_ratio="1:1"`
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
    result = PromptBuilder.build_product_showcase(spec, brand_kit)

    # See the docstring's fix-round-1 notes: the pre-PromptBuilder version of
    # this function led with this exact sentence and it was silently dropped
    # by the refactor. Reinstated verbatim, immediately after the assembled
    # instruction, so it reads as part of the same directive.
    preservation_clause = (
        "Do not redesign, distort, recolour, or replace the product; only "
        "change the environment around it."
    )

    avoid_clause = f"Avoid: {result.negative_prompt}."

    return f"{result.system_prompt}\n\n{result.prompt} {preservation_clause}\n\n{avoid_clause}"
