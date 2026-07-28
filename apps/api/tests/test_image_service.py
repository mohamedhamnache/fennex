import uuid
from app.services.image_service import build_image_prompt, build_social_prompt
from app.models.brand_kit import BrandKit


def test_build_prompt_without_brand_kit():
    prompt = build_image_prompt("Article", "seo", "professional", "article_cover")
    assert "Article" in prompt
    assert "Brand palette" not in prompt


def test_build_prompt_with_brand_kit():
    # Task 3, Part A: brand-kit rendering (palette, style rules, tone) now
    # flows through PromptBuilder.build_image's brand_style module via the
    # real brand_kit object, instead of being hand-rendered as
    # "Brand palette: X. Style: Y. Tone: Z." and smuggled through
    # user_prompt (Task 2's stopgap for the tone gap in modules.brand_style).
    # Wording changed (brand_style's own phrasing, no "Style:" label prefix
    # on style_rules) but every instruction is still present: the color
    # values, the style-rules text, and the tone are all in the output.
    kit = BrandKit(id=uuid.uuid4(), org_id=uuid.uuid4(),
                   colors=["#1A2B3C", "#FF6B35"], style_rules="Minimal", tone="Premium")
    prompt = build_image_prompt("Article", None, "professional", "article_cover", brand_kit=kit)
    assert "#1A2B3C, #FF6B35" in prompt
    assert "Minimal" in prompt
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
# Updated post-refactor (Task 2): expected text was PromptBuilder.build_image's
# assembled output with the platform label/aspect descriptor and brand `tone`
# -- which `modules.brand_style` couldn't represent -- carried verbatim via
# `user_prompt`.
#
# Updated again for Task 3, Part A: `modules.brand_style` now reads `tone`
# directly off `brand_kit`, so brand-kit rendering (palette + tone, and now
# also style_rules -- see build_social_prompt's docstring for why that's an
# intentional, additive change) flows through the module via the real
# `brand_kit` object instead of being hand-rendered and smuggled through
# `user_prompt`. Only the platform label/aspect descriptor and the
# "No text overlays..." line remain in `user_prompt` now.

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
        "echo the brand palette (#1A2B3C, #FF6B35) subtly in the styling and props; "
        "Minimal; Tone: Premium. "
        "Professional LinkedIn Banner image (4:1 aspect ratio). "
        "No text overlays. High quality, vibrant."
    )
    assert "#1A2B3C, #FF6B35" in prompt
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
