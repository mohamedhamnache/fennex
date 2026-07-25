from app.models.organization import Organization

def test_org_has_byok_flag():
    assert hasattr(Organization, "byok_enabled")
