"""Characterisation tests for product_service.build_scene_prompt.

Written BEFORE routing build_scene_prompt through PromptBuilder (see
.superpowers/sdd/2026-07-28-product-ai-studio/task-2-brief.md, Step 1): this
function previously had zero test coverage anywhere in the suite. These pin
its exact current (pre-refactor) output so the refactor can be verified not
to drop any instruction.
"""
import uuid

import pytest

from app.services.product_service import build_scene_prompt
from app.models.brand_kit import BrandKit


def test_build_scene_prompt_without_brand_kit():
    prompt = build_scene_prompt("cafe_table", "a ceramic mug with a matte black finish", None)
    assert prompt == (
        "Place the product from the image on a rustic wooden café table with soft morning "
        "light streaming through a window, warm blurred bokeh background, cozy premium "
        "lifestyle atmosphere. Keep the product itself completely unchanged — identical "
        "shape, colours, materials, proportions, textures, and any text, logo or label. "
        "Do not redesign, distort, recolour, or replace the product; only change the "
        "environment around it. Integrate it realistically with natural contact shadows, "
        "accurate reflections and lighting that matches the scene. Photorealistic, "
        "ultra-detailed, high-resolution professional commercial product photography, "
        "sharp focus on the product. For reference, the product is a ceramic mug with a "
        "matte black finish."
    )


def test_build_scene_prompt_with_brand_kit():
    kit = BrandKit(
        id=uuid.uuid4(), org_id=uuid.uuid4(),
        colors=["#1A2B3C", "#FF6B35"], style_rules="Minimal editorial styling.",
    )
    prompt = build_scene_prompt("white_studio", "", kit)
    assert prompt == (
        "Place the product from the image on a seamless pure white studio background with "
        "soft even professional lighting and a subtle natural contact shadow, clean "
        "ecommerce packshot. Keep the product itself completely unchanged — identical "
        "shape, colours, materials, proportions, textures, and any text, logo or label. "
        "Do not redesign, distort, recolour, or replace the product; only change the "
        "environment around it. Integrate it realistically with natural contact shadows, "
        "accurate reflections and lighting that matches the scene. Photorealistic, "
        "ultra-detailed, high-resolution professional commercial product photography, "
        "sharp focus on the product. echo the brand palette (#1A2B3C, #FF6B35) subtly in "
        "the styling and props. Minimal editorial styling.."
    )


def test_build_scene_prompt_with_brand_kit_no_colors():
    kit = BrandKit(id=uuid.uuid4(), org_id=uuid.uuid4(), colors=[], style_rules=None)
    prompt = build_scene_prompt("marble_countertop", "a glass bottle", kit)
    assert prompt == (
        "Place the product from the image on a polished white marble countertop, clean "
        "minimal styling, soft diffused natural window light, bright airy luxury setting. "
        "Keep the product itself completely unchanged — identical shape, colours, "
        "materials, proportions, textures, and any text, logo or label. Do not redesign, "
        "distort, recolour, or replace the product; only change the environment around it. "
        "Integrate it realistically with natural contact shadows, accurate reflections and "
        "lighting that matches the scene. Photorealistic, ultra-detailed, high-resolution "
        "professional commercial product photography, sharp focus on the product. For "
        "reference, the product is a glass bottle."
    )


def test_build_scene_prompt_unknown_scene_raises():
    with pytest.raises(ValueError):
        build_scene_prompt("not_a_real_scene", "", None)
