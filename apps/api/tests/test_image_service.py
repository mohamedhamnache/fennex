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
# Written BEFORE routing build_social_prompt through PromptBuilder (see
# .superpowers/sdd/2026-07-28-product-ai-studio/task-2-brief.md, Step 1):
# this function previously had zero test coverage anywhere in the suite.
# These pin its exact current (pre-refactor) output.

def test_build_social_prompt_without_brand_kit():
    prompt = build_social_prompt("instagram_post", "New Product Launch")
    assert prompt == (
        "Professional Instagram Post image (1:1 aspect ratio). "
        "Subject: New Product Launch. "
        "Bold, eye-catching composition optimised for social media engagement. "
        "No text overlays. High quality, vibrant."
    )


def test_build_social_prompt_with_brand_kit():
    kit = BrandKit(id=uuid.uuid4(), org_id=uuid.uuid4(),
                   colors=["#1A2B3C", "#FF6B35"], style_rules="Minimal", tone="Premium")
    prompt = build_social_prompt("linkedin_banner", "Q3 results", brand_kit=kit)
    assert prompt == (
        "Professional LinkedIn Banner image (4:1 aspect ratio). "
        "Subject: Q3 results. "
        "Bold, eye-catching composition optimised for social media engagement. "
        "No text overlays. High quality, vibrant. "
        "Brand palette: #1A2B3C, #FF6B35. Tone: Premium."
    )


def test_build_social_prompt_unknown_platform_falls_back_to_title_case():
    prompt = build_social_prompt("unknown_platform_xyz", "Something")
    assert prompt == (
        "Professional Unknown Platform Xyz image ( aspect ratio). "
        "Subject: Something. "
        "Bold, eye-catching composition optimised for social media engagement. "
        "No text overlays. High quality, vibrant."
    )
