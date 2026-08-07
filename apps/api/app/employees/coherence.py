"""Is the roster actually wired to itself?

An employee declares what it consumes and what it produces for. Those slugs
drive real behaviour -- `produces_for` is what offers the next specialist as a
button after an answer -- and NOTHING validates them. `capabilities` is checked
at import and raises on an unknown slug; these two are not, and
`resolve_action()` skips what it cannot resolve in silence.

That silence cost real behaviour: Souk declared "content.product_copy", which
is not a slug (the capability is content.product_description), so its entire
product-copy handoff vanished with no error anywhere. The merchant simply never
saw the button, and nothing in the logs said why.

Two kinds of break, and they are different faults:

    unknown    the slug is not in the taxonomy at all -- always a typo
    unbacked   the slug exists but no employee has an action for it, so the
               link is a dead end until someone is hired for it

Unbacked is not always a bug: declaring an intent the company cannot yet serve
is how a gap gets recorded. It is reported separately so the roster's real
holes stay visible instead of being hidden by an allowlist.
"""
from __future__ import annotations

import logging

from app.employees import capabilities as caps
from app.employees import registry

logger = logging.getLogger(__name__)


def unknown_links() -> list[str]:
    """Slugs that are not capabilities at all. Always a mistake."""
    out = []
    for employee in registry.all_employees():
        for field in ("produces_for", "consumes"):
            for slug in getattr(employee, field, None) or []:
                if not caps.is_known(slug):
                    out.append(f"{employee.id}.{field}: {slug}")
    return sorted(out)


def unbacked_links() -> list[str]:
    """`produces_for` slugs no employee can act on -- the button never appears."""
    out = []
    for employee in registry.all_employees():
        for slug in employee.produces_for or []:
            if caps.is_known(slug) and registry.resolve_action(slug)[0] is None:
                out.append(f"{employee.id}.produces_for: {slug}")
    return sorted(out)


def assert_roster_is_coherent() -> dict:
    """Log both kinds at startup. Never fatal -- CI blocks the merge."""
    unknown, unbacked = unknown_links(), unbacked_links()
    if unknown:
        logger.error("ROSTER: %d link(s) name a capability that does not exist: %s",
                     len(unknown), ", ".join(unknown))
    if unbacked:
        logger.warning("ROSTER: %d produces_for link(s) no employee can act on, so the "
                       "follow-on never appears: %s", len(unbacked), ", ".join(unbacked))
    if not unknown and not unbacked:
        logger.info("roster coherence: every declared link resolves")
    return {"unknown": unknown, "unbacked": unbacked}
