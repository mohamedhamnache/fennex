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
directly instead of its generic "Scene: cafe table" stub.

RE-PINNED for fix-round-1 (see
.superpowers/sdd/2026-07-28-product-ai-studio/fix-round-1-report.md), Fixes
1 and 2: `build_scene_prompt` used to return only
`PromptBuilder.build_product_showcase(...).prompt`, discarding
`PromptResult.system_prompt` (the owner's verbatim never-modify list, sent
to flux-kontext for the FIRST time by this fix) and `PromptResult.negative_prompt`
(the 11 required exclusions, previously computed and thrown away -- the
`negative_prompt` field and the UI's negative-prompt textarea controlled
nothing). It also reinstates the pre-PromptBuilder "Do not redesign,
distort, recolour, or replace the product; only change the environment
around it." sentence, which the original PromptBuilder refactor (Task 2)
silently dropped with no replacement anywhere in the assembled text. Every
`assert prompt == (...)` block below was rewritten to match; every
`assert "..." in prompt` substring check from before Task 3 still holds
(nothing already-present was removed, only prepended/appended around).
"""
import uuid

import pytest

from app.services.product_service import build_scene_prompt
from app.services.prompting import vocab
from app.models.brand_kit import BrandKit


def test_build_scene_prompt_without_brand_kit():
    prompt = build_scene_prompt("cafe_table", "a ceramic mug with a matte black finish", None)
    assert prompt == (
        "You are an award-winning luxury commercial product photographer and CGI artist.\n\n"
        "Your primary objective is to transform the uploaded product into a world-class "
        "commercial advertising image while preserving its exact identity.\n\n"
        "The uploaded product is the source of truth.\n\n"
        "Never modify\n\n"
        "- geometry\n- proportions\n- dimensions\n- packaging\n- label\n- logo\n- typography\n"
        "- materials\n- finish\n- colours\n- branding\n\n"
        "Never redesign the product.\n\n"
        "Generate\n\n"
        "- physically accurate lighting\n- ray-traced reflections\n- realistic shadows\n"
        "- premium composition\n- editorial photography\n- macro detail\n- HDR\n"
        "- luxury styling\n- global illumination\n- realistic optics\n- 8K quality\n\n"
        "The output should resemble a premium commercial campaign created for Apple, "
        "Aesop, Dior or Le Labo.\n\n"
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
        "ultra quality, maximum fidelity render suitable for large-format print "
        "Do not redesign, distort, recolour, or replace the product; only change the "
        "environment around it.\n\n"
        "Avoid: blur, noise, duplicate products, wrong labels, cropped products, deformed "
        "packaging, incorrect reflections, bad shadows, low resolution, text artefacts, "
        "watermarks."
    )
    # Fix 1: the owner's verbatim system prompt now reaches the sent text.
    assert vocab.SHOWCASE_SYSTEM_PROMPT in prompt
    assert "Never modify" in prompt
    assert "Never redesign the product." in prompt
    # Fix 1: the pre-refactor do-not-redesign clause is restored.
    assert "Do not redesign, distort, recolour, or replace the product" in prompt
    # Fix 2: every required exclusion is folded into an explicit avoid-clause.
    assert "Avoid:" in prompt
    for term in vocab.NEGATIVE_TERMS:
        assert term in prompt
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
        f"{vocab.SHOWCASE_SYSTEM_PROMPT}\n\n"
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
        "ultra quality, maximum fidelity render suitable for large-format print "
        "Do not redesign, distort, recolour, or replace the product; only change the "
        "environment around it.\n\n"
        "Avoid: blur, noise, duplicate products, wrong labels, cropped products, deformed "
        "packaging, incorrect reflections, bad shadows, low resolution, text artefacts, "
        "watermarks."
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
    text comes before the do-not-redesign/avoid-clause tail that fix-round-1
    added -- it still refines the curated direction, it doesn't replace it
    (and isn't replaced by it either)."""
    prompt = build_scene_prompt(
        "cafe_table",
        "a ceramic mug",
        None,
        user_prompt="Make it feel expensive, with subtle rim lighting on the mug.",
    )
    assert "rustic wooden café table with soft morning light" in prompt
    assert "Make it feel expensive, with subtle rim lighting on the mug." in prompt
    assert prompt.index("rustic wooden café table") < prompt.index("Make it feel expensive")
    # The user's text still lands before the do-not-redesign clause and the
    # avoid-clause that now close out the prompt (fix-round-1).
    assert prompt.index("Make it feel expensive") < prompt.index("Do not redesign")
    assert prompt.index("Do not redesign") < prompt.index("Avoid:")


def test_build_scene_prompt_user_supplied_negative_reaches_the_sent_prompt():
    """Fix 2: negative_prompt was assembled by PromptBuilder and discarded --
    a user's negative text never reached flux-kontext. It now lands inside
    the explicit avoid-clause, appended after the 11 required exclusions."""
    prompt = build_scene_prompt(
        "cafe_table",
        "a ceramic mug",
        None,
        negative_prompt="plastic-looking, oversaturated colours",
    )
    assert "Avoid:" in prompt
    assert "plastic-looking, oversaturated colours" in prompt
    # required exclusions still present, and still precede the user's addition
    assert prompt.index("blur") < prompt.index("plastic-looking")
