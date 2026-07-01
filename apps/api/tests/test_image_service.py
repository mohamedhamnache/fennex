import uuid
from app.services.image_service import build_image_prompt
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
