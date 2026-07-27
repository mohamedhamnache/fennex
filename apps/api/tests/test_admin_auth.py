import uuid, pytest
from app.core.admin_auth import create_admin_token, ROLE_PERMISSIONS, permissions_for

def test_role_permissions_auditor_is_read_only():
    assert "read" in ROLE_PERMISSIONS["auditor"]
    assert not any(p for p in ROLE_PERMISSIONS["auditor"] if p.endswith(".write") or "." in p and p != "read")

def test_super_admin_has_everything():
    perms = permissions_for(["super_admin"])
    assert "org.suspend" in perms and "billing.write" in perms and "read" in perms

def test_permissions_union_across_roles():
    perms = permissions_for(["finance", "support"])
    assert "billing.write" in perms          # from finance
    assert "org.impersonate" in perms         # from support

def test_admin_token_roundtrip_carries_scope_and_roles():
    from jose import jwt
    from app.core.config import settings
    tok = create_admin_token(str(uuid.uuid4()), ["operations"])
    payload = jwt.decode(tok, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    assert payload["scope"] == "admin" and payload["roles"] == ["operations"]
