"""Characterisation tests for product_service.build_scene_prompt.

Originally written BEFORE routing build_scene_prompt through PromptBuilder
(see .superpowers/sdd/2026-07-28-product-ai-studio/task-2-brief.md, Step 1):
this function previously had zero test coverage anywhere in the suite.

Updated for Task 3, Part A (see
.superpowers/sdd/2026-07-28-product-ai-studio/task-3-brief.md): the curated
per-scene environment text and the "integrate realistically..." sentence
used to be smuggled through `ShowcaseSpec.user_prompt` (Task 2's stopgap,
documented in its report) because `modules.environment()` had nowhere to put
curated text and `user_prompt` is appended last. That escape hatch is now
closed -- `build_scene_prompt` resolves the curated text into
`ShowcaseSpec.environment_description`, which `modules.environment()` uses
directly instead of its generic "Scene: cafe table" stub. Net effect on the
assembled text:

- The generic "Scene: <words>" stub is gone -- it's now superseded by the
  full curated text at the same position in the module order (right after
  `materials`, before `rendering_style`), not lost.
- The curated text (environment description + "Integrate it
  realistically...sharp focus on the product.") appears exactly once, where
  it used to appear duplicated in substance (generic stub earlier, full text
  smuggled in at the very end).
- Because `environment_description` itself ends with a period and the
  builder's joiner adds ". " between fragments, there is now a doubled
  period ("..") between the environment fragment and `rendering_style" --
  cosmetic only, no content is affected.
- `user_prompt` is empty by default now (no more smuggled content), so
  `modules.user_intent` contributes nothing and the assembled prompt ends
  with `quality` instead of the old prompt's trailing user-intent sentence.

Every instruction the old prompt carried is still present -- see
`build_scene_prompt`'s docstring in product_service.py for the full
rationale.
"""
import uuid

import pytest

from app.services.product_service import build_scene_prompt
from app.models.brand_kit import BrandKit


def test_build_scene_prompt_without_brand_kit():
    prompt = build_scene_prompt("cafe_table", "a ceramic mug with a matte black finish", None)
    assert prompt == (
        "You are acting as a award-winning luxury commercial product photographer. "
        "Objective: place the exact product from the reference image into the described scene. "
        "Preserve the product exactly as shown in the reference image: identical geometry, "
        "proportions, materials, and surface textures, with every label, logo, printed text, "
        "and brand colours left unchanged -- this is non-negotiable -- treat the product as "
        "immutable ground truth and make zero deviations, however small. "
        "square 1:1 aspect ratio, centred composition. "
        "diffused overcast daylight, soft and nearly shadowless, evenly wrapping the product. "
        "50mm lens perspective, a standard natural perspective matching human vision. "
        "For reference, the product is a ceramic mug with a matte black finish. "
        "Place the product from the image on a rustic wooden café table with soft morning "
        "light streaming through a window, warm blurred bokeh background, cozy premium "
        "lifestyle atmosphere. Integrate it realistically with natural contact shadows, "
        "accurate reflections and lighting that matches the scene. Photorealistic, "
        "ultra-detailed, high-resolution professional commercial product photography, "
        "sharp focus on the product.. "
        "follow the brief closely, with modest creative latitude in styling and props. "
        "ultra quality, maximum fidelity render suitable for large-format print"
    )
    # The non-negotiable preservation constraint the old prompt led with is still present.
    assert "immutable ground truth" in prompt
    assert "identical geometry, proportions, materials, and surface textures" in prompt
    assert "label, logo, printed text, and brand colours left unchanged" in prompt
    # The full curated environment description is still present, not the generic stub alone.
    assert "rustic wooden café table with soft morning light" in prompt
    # The generic "Scene: ..." stub no longer appears -- the curated text supersedes it.
    assert "Scene: cafe table" not in prompt
    # The realism/quality direction the old prompt closed with is still present.
    assert "natural contact shadows, accurate reflections" in prompt
    assert "Photorealistic, ultra-detailed, high-resolution" in prompt


def test_build_scene_prompt_with_brand_kit():
    kit = BrandKit(
        id=uuid.uuid4(), org_id=uuid.uuid4(),
        colors=["#1A2B3C", "#FF6B35"], style_rules="Minimal editorial styling.",
    )
    prompt = build_scene_prompt("white_studio", "", kit)
    assert prompt == (
        "You are acting as a award-winning luxury commercial product photographer. "
        "Objective: place the exact product from the reference image into the described scene. "
        "Preserve the product exactly as shown in the reference image: identical geometry, "
        "proportions, materials, and surface textures, with every label, logo, printed text, "
        "and brand colours left unchanged -- this is non-negotiable -- treat the product as "
        "immutable ground truth and make zero deviations, however small. "
        "square 1:1 aspect ratio, centred composition. "
        "diffused overcast daylight, soft and nearly shadowless, evenly wrapping the product. "
        "50mm lens perspective, a standard natural perspective matching human vision. "
        "Place the product from the image on a seamless pure white studio background with "
        "soft even professional lighting and a subtle natural contact shadow, clean "
        "ecommerce packshot. Integrate it realistically with natural contact shadows, "
        "accurate reflections and lighting that matches the scene. Photorealistic, "
        "ultra-detailed, high-resolution professional commercial product photography, "
        "sharp focus on the product.. "
        "follow the brief closely, with modest creative latitude in styling and props. "
        "echo the brand palette (#1A2B3C, #FF6B35) subtly in the styling and props; "
        "Minimal editorial styling.. "
        "ultra quality, maximum fidelity render suitable for large-format print"
    )
    assert "#1A2B3C, #FF6B35" in prompt
    assert "Minimal editorial styling." in prompt
    assert "Scene: white studio" not in prompt


def test_build_scene_prompt_with_brand_kit_no_colors():
    kit = BrandKit(id=uuid.uuid4(), org_id=uuid.uuid4(), colors=[], style_rules=None)
    prompt = build_scene_prompt("marble_countertop", "a glass bottle", kit)
    assert "Brand palette" not in prompt
    assert "echo the brand palette" not in prompt
    assert "For reference, the product is a glass bottle" in prompt
    assert "polished white marble countertop" in prompt


def test_build_scene_prompt_with_brand_kit_tone():
    """Brand-kit `tone` used to be silently dropped for the showcase pipeline
    (build_scene_prompt never referenced it, and modules.brand_style had no
    field for it). It now flows through as part of the brand fragment."""
    kit = BrandKit(id=uuid.uuid4(), org_id=uuid.uuid4(), colors=[], style_rules=None, tone="Playful")
    prompt = build_scene_prompt("cafe_table", "a mug", kit)
    assert "Tone: Playful" in prompt


def test_build_scene_prompt_unknown_scene_raises():
    with pytest.raises(ValueError):
        build_scene_prompt("not_a_real_scene", "", None)


def test_build_scene_prompt_curated_environment_and_user_prompt_coexist():
    """Proves the fix: the curated per-scene environment text and a genuine
    user_prompt no longer collide in one slot. Both appear, and the user's
    text comes last -- it refines the curated direction, it doesn't replace
    it (and isn't replaced by it either)."""
    prompt = build_scene_prompt(
        "cafe_table",
        "a ceramic mug",
        None,
        user_prompt="Make it feel expensive, with subtle rim lighting on the mug.",
    )
    assert "rustic wooden café table with soft morning light" in prompt
    assert prompt.endswith("Make it feel expensive, with subtle rim lighting on the mug.")
    assert prompt.index("rustic wooden café table") < prompt.index("Make it feel expensive")
