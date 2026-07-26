import pytest

from app.api.v1.routers import model_catalog as router_module


def test_every_write_route_invalidates_the_snapshot():
    """A stale snapshot would keep routing to the old model after an admin edit."""
    import inspect
    for name in ("create_entry", "update_entry", "delete_entry"):
        source = inspect.getsource(getattr(router_module, name))
        assert "invalidate_snapshot" in source or "refresh_snapshot" in source, name


def test_every_route_is_staff_guarded():
    import inspect
    for name in ("list_entries", "create_entry", "update_entry", "delete_entry"):
        source = inspect.getsource(getattr(router_module, name))
        assert "_require_staff" in source, name


def test_band_is_validated():
    with pytest.raises(Exception):
        router_module._validate_band("not-a-band")
    assert router_module._validate_band("cheap") == "cheap"
