from app.models.brand_kit import BrandKit
from app.models.brand_voice import BrandVoice


def test_brand_models_have_project_id():
    assert hasattr(BrandKit, "project_id")
    assert hasattr(BrandVoice, "project_id")
