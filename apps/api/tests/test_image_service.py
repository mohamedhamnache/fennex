import uuid
from app.services.image_service import build_image_prompt, build_social_prompt
from app.models.brand_kit import BrandKit


def test_build_prompt_without_brand_kit():
    prompt = build_image_prompt("Article", "seo", "professional", "article_cover")
    assert "Article" in prompt
    assert "Brand palette" not in prompt


def test_build_prompt_with_brand_kit():
    kit = BrandKit(id=uuid.uuid4(), org_id=uuid.uuid4(),
                   colors=["#1A2B3C", "#FF6B35"], style_rules="Minimal", tone="Premium")
    prompt = build_image_prompt("Article", None, "professional", "article_cover", brand_kit=kit)
    assert "Brand palette: #1A2B3C, #FF6B35" in prompt
    assert "Style: Minimal" in prompt
    assert "Tone: Premium" in prompt


def test_build_prompt_with_empty_brand_kit():
    kit = BrandKit(id=uuid.uuid4(), org_id=uuid.uuid4(), colors=[])
    prompt = build_image_prompt("Title", None, "professional", "article_cover", brand_kit=kit)
    assert "Brand palette" not in prompt


# --- Characterisation tests for build_social_prompt -------------------------
# Originally written BEFORE routing build_social_prompt through PromptBuilder
# (see .superpowers/sdd/2026-07-28-product-ai-studio/task-2-brief.md, Step
# 1): this function previously had zero test coverage anywhere in the suite.
#
# Updated post-refactor: expected text is now PromptBuilder.build_image's
# assembled output (role/objective/rendering_style carry subject and the
# "Bold, eye-catching..." composition direction; the platform label/aspect
# descriptor and brand `tone` -- which `modules.brand_style` can't represent
# -- are carried verbatim via `user_prompt`; see build_social_prompt's
# docstring in image_service.py).

def test_build_social_prompt_without_brand_kit():
    prompt = build_social_prompt("instagram_post", "New Product Launch")
    assert prompt == (
        "You are acting as a professional commercial image generator. "
        "Objective: produce a social post for 'New Product Launch'. "
        "Objective: Style: Bold, eye-catching composition optimised for social media engagement. "
        "Professional Instagram Post image (1:1 aspect ratio). "
        "No text overlays. High quality, vibrant."
    )
    assert "New Product Launch" in prompt
    assert "Bold, eye-catching composition optimised for social media engagement" in prompt
    assert "1:1 aspect ratio" in prompt
    assert "No text overlays. High quality, vibrant." in prompt


def test_build_social_prompt_with_brand_kit():
    kit = BrandKit(id=uuid.uuid4(), org_id=uuid.uuid4(),
                   colors=["#1A2B3C", "#FF6B35"], style_rules="Minimal", tone="Premium")
    prompt = build_social_prompt("linkedin_banner", "Q3 results", brand_kit=kit)
    assert prompt == (
        "You are acting as a professional commercial image generator. "
        "Objective: produce a social post for 'Q3 results'. "
        "Objective: Style: Bold, eye-catching composition optimised for social media engagement. "
        "Professional LinkedIn Banner image (4:1 aspect ratio). "
        "No text overlays. High quality, vibrant. "
        "Brand palette: #1A2B3C, #FF6B35. Tone: Premium."
    )
    assert "Brand palette: #1A2B3C, #FF6B35" in prompt
    assert "Tone: Premium" in prompt


def test_build_social_prompt_unknown_platform_falls_back_to_title_case():
    prompt = build_social_prompt("unknown_platform_xyz", "Something")
    assert prompt == (
        "You are acting as a professional commercial image generator. "
        "Objective: produce a social post for 'Something'. "
        "Objective: Style: Bold, eye-catching composition optimised for social media engagement. "
        "Professional Unknown Platform Xyz image ( aspect ratio). "
        "No text overlays. High quality, vibrant."
    )
