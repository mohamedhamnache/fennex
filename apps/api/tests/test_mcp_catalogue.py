"""The MCP catalogue must cover what the roster actually declares.

Before this, the catalogue held 7 servers and the roster declared 11 apps --
with an overlap of two. Souk declared "shopify", Zerda and Oasis declared
"google-search-console", Sirocco declared six social apps, and NONE of them
existed in the catalogue. servers_for() skips what it cannot find, so every
one of those declarations resolved to nothing, silently, forever.
"""
from app.employees.runtime import mcp


def test_every_declared_app_exists_in_the_catalogue():
    """An employee declaring an app the catalogue does not know gets no tools
    and no error -- the same silent-skip class as the roster's produces_for."""
    missing = mcp.declared_apps() - set(mcp.CATALOGUE)
    assert missing == set(), f"employees declare apps with no catalogue entry: {sorted(missing)}"


def test_every_entry_carries_what_the_integrations_page_needs():
    for app, server in mcp.CATALOGUE.items():
        assert server.app == app, f"{app}: key and app disagree"
        assert server.label, f"{app}: no label"
        assert server.category, f"{app}: no category"
        assert server.description, f"{app}: no description to explain it"
        assert server.permission, f"{app}: no permission gate"


def test_apps_with_a_native_tool_say_so():
    """MCP would be a SECOND, unmetered route to a paid API that already has a
    metered native tool. The UI has to show which path is live rather than
    offering both as equals -- otherwise spend escapes the meter."""
    from app.employees import toolbelt
    for server in mcp.CATALOGUE.values():
        if not server.native_tool:
            continue
        assert toolbelt.get_tool(server.native_tool) is not None, (
            f"{server.app} names native tool {server.native_tool}, which does not exist")


def test_the_advertising_category_covers_what_the_dashboard_cannot_measure(self=None):
    """ROAS, CAC and MER are sample data precisely because no ad platform is
    connected. These are the connectors that make them real."""
    ads = {a for a, s in mcp.CATALOGUE.items() if s.category == "Advertising"}
    assert {"meta-ads", "google-ads"} <= ads


def test_nothing_is_reachable_until_an_endpoint_is_set():
    """Declaring a server costs nothing at rest: configured() is what decides
    whether an agent can actually reach it."""
    for server in mcp.CATALOGUE.values():
        assert server.to_dict()["configured"] == bool(server.url or server.command)
