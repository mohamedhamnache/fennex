"""Declared links must resolve.

`produces_for` drives the follow-on buttons. Souk declared
"content.product_copy" -- not a slug; the capability is
content.product_description -- and resolve_action() skipped it in silence, so
the whole product-copy handoff vanished with no error anywhere. Nothing
validates these two fields the way `capabilities` is validated at import.
"""
from app.employees import coherence


def test_no_link_names_a_capability_that_does_not_exist():
    """Always a typo, always a silent behaviour loss."""
    unknown = coherence.unknown_links()
    assert unknown == [], f"links naming non-existent capabilities: {unknown}"


def test_unbacked_links_are_reported_but_do_not_fail():
    """A produces_for slug nobody can act on is a dead end -- the button never
    appears. It is NOT automatically a bug: declaring an intent the company
    cannot yet serve is how a gap gets recorded. So this asserts the check
    RUNS and returns a list, rather than demanding the list be empty and
    inviting an allowlist that would hide the roster's real holes."""
    unbacked = coherence.unbacked_links()
    assert isinstance(unbacked, list)
    for entry in unbacked:
        assert ".produces_for: " in entry


def test_the_audit_covers_both_fields():
    import inspect
    src = inspect.getsource(coherence.unknown_links)
    assert "produces_for" in src and "consumes" in src
