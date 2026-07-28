"""Characterisation tests for product_service.build_scene_prompt.

Originally written BEFORE routing build_scene_prompt through PromptBuilder
(see .superpowers/sdd/2026-07-28-product-ai-studio/task-2-brief.md, Step 1):
this function previously had zero test coverage anywhere in the suite.

Updated post-refactor: the expected text below is the assembled output of
`PromptBuilder.build_product_showcase`, not the old hand-rolled f-string.
Every instruction the old prompt carried is still present -- see
`build_scene_prompt`'s docstring in product_service.py for exactly how each
piece maps (role/objective/product_preservation/composition/lighting/camera/
quality are new layered direction from the shared modules; the curated
per-scene environment description and the "integrate realistically..."
sentence are carried verbatim via `user_prompt` since no shared module can
represent them without loss).
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
        "Scene: cafe table. "
        "follow the brief closely, with modest creative latitude in styling and props. "
        "ultra quality, maximum fidelity render suitable for large-format print. "
        "Place the product from the image on a rustic wooden café table with soft morning "
        "light streaming through a window, warm blurred bokeh background, cozy premium "
        "lifestyle atmosphere. Integrate it realistically with natural contact shadows, "
        "accurate reflections and lighting that matches the scene. Photorealistic, "
        "ultra-detailed, high-resolution professional commercial product photography, "
        "sharp focus on the product."
    )
    # The non-negotiable preservation constraint the old prompt led with is still present.
    assert "immutable ground truth" in prompt
    assert "identical geometry, proportions, materials, and surface textures" in prompt
    assert "label, logo, printed text, and brand colours left unchanged" in prompt
    # The full curated environment description is still present, not the generic stub alone.
    assert "rustic wooden café table with soft morning light" in prompt
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
        "Scene: white studio. "
        "follow the brief closely, with modest creative latitude in styling and props. "
        "echo the brand palette (#1A2B3C, #FF6B35) subtly in the styling and props; "
        "Minimal editorial styling.. "
        "ultra quality, maximum fidelity render suitable for large-format print. "
        "Place the product from the image on a seamless pure white studio background with "
        "soft even professional lighting and a subtle natural contact shadow, clean "
        "ecommerce packshot. Integrate it realistically with natural contact shadows, "
        "accurate reflections and lighting that matches the scene. Photorealistic, "
        "ultra-detailed, high-resolution professional commercial product photography, "
        "sharp focus on the product."
    )
    assert "#1A2B3C, #FF6B35" in prompt
    assert "Minimal editorial styling." in prompt


def test_build_scene_prompt_with_brand_kit_no_colors():
    kit = BrandKit(id=uuid.uuid4(), org_id=uuid.uuid4(), colors=[], style_rules=None)
    prompt = build_scene_prompt("marble_countertop", "a glass bottle", kit)
    assert "Brand palette" not in prompt
    assert "echo the brand palette" not in prompt
    assert "For reference, the product is a glass bottle" in prompt
    assert "polished white marble countertop" in prompt


def test_build_scene_prompt_unknown_scene_raises():
    with pytest.raises(ValueError):
        build_scene_prompt("not_a_real_scene", "", None)
