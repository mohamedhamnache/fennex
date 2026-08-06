"""Every route that acts on a resource id must scope it to the caller's org.

WHY THIS EXISTS. Two cross-tenant holes reached working code, and both were
found by accident rather than by review:

  * /shopify/orders/revenue read another organisation's revenue, order count
    and article titles from a guessed project_id. Found because a throwaway
    token minted for screenshots happened to belong to the wrong user.
  * /backlinks/analyze queued a paid backlink sync against a guessed
    project_id. The worker loads org_id FROM THE PROJECT and bills it, so the
    caller spent someone else's SEO credits and wrote rows into their project.
    Confirmed live: a caller in one org got 202 for a project in another.

Grep cannot prove the absence of this. `current_user.org_id` appears 379 times
across the routers, which tells you nothing about the handful that omit it.
So this is an AST check, in the same spirit as metering_audit: it walks every
route handler and asserts that a handler taking a resource identifier also
constrains it to the caller's organisation.

NOT ONLY project_id. The first version of this audit checked project_id alone
and passed clean while /exchange/requests/{request_id}/verify let any
authenticated user flip the verification flags on two other organisations'
agreement. Any id naming somebody's row is a tenancy boundary.
"""
from __future__ import annotations

import ast
import logging
import pathlib

logger = logging.getLogger(__name__)

ROUTERS = pathlib.Path(__file__).resolve().parents[1] / "api" / "v1" / "routers"

# A parameter whose value names a row somebody owns. `id`-suffixed path and
# query parameters are the whole attack surface: they arrive from the client
# and are guessable.
_RESOURCE_ARG = ("project_id", "article_id", "image_id", "request_id", "campaign_id",
                 "opportunity_id", "listing_id", "job_id", "document_id", "keyword_id",
                 "connection_id", "order_id", "product_id", "post_id", "plan_id")

# Evidence that a handler constrains the resource to the caller. Any one of
# these appearing in the body is enough -- the audit proves that scoping was
# CONSIDERED, not that it is correct. A reviewer still has to read it.
_SCOPE_MARKERS = ("org_id", "current_user.org_id", "acting_org_id", "_require_project",
                  "require_project")

# Handlers that legitimately take a resource id without scoping it, each with
# the reason. Anything not listed here must scope, or this fails.
ALLOWLIST = {
    # project_id here is exclude_project_id: it filters the caller's own
    # listing out of a marketplace board that is public to every user by
    # design. Passing a foreign id only hides someone else's listing from
    # your own view, which discloses nothing.
    "backlinks.py::exchange_board",
}


def _is_route(fn: ast.AST) -> bool:
    return any("router." in ast.unparse(d) for d in getattr(fn, "decorator_list", []))


def _scoping_helpers(tree: ast.Module) -> set[str]:
    """Module-level helpers that scope to the org themselves.

    Derived, not listed. Most routers push the check into a loader
    (`_get_post_or_404`, `_load_article_and_project`) and the handler then
    contains no `org_id` of its own -- which is good practice, and which the
    first version of this audit reported as twelve violations. Reading the
    helper is what tells them apart from a genuine omission, and deriving it
    means a new helper never has to be added to a list here.
    """
    return {fn.name for fn in tree.body
            if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef))
            and any(m in ast.unparse(fn) for m in _SCOPE_MARKERS)}


def unscoped_routes() -> list[str]:
    """Route handlers taking a resource id with no sign of org scoping."""
    out: list[str] = []
    for path in sorted(ROUTERS.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text())
        except SyntaxError:  # pragma: no cover - a broken file fails elsewhere
            continue
        helpers = _scoping_helpers(tree)
        for fn in ast.walk(tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)) or not _is_route(fn):
                continue
            args = [a.arg for a in fn.args.args + fn.args.kwonlyargs]
            if not any(a in _RESOURCE_ARG for a in args):
                continue
            # A handler with no database session cannot read or write anyone's
            # row. Unimplemented stubs live here; so would a pure computation.
            if not any(a in ("db", "session") for a in args):
                continue
            key = f"{path.name}::{fn.name}"
            if key in ALLOWLIST:
                continue
            body = ast.unparse(fn)
            if any(m in body for m in _SCOPE_MARKERS):
                continue
            if any(f"{h}(" in body for h in helpers):
                continue
            out.append(key)
    return out


def assert_routes_are_tenant_scoped() -> list[str]:
    """Log any unscoped route. Never fatal at startup.

    Refusing to boot on a finding would turn a reviewable warning into an
    outage; CI is where this blocks a merge (tests/test_tenant_audit.py).
    """
    found = unscoped_routes()
    if found:
        logger.error("TENANT SCOPE: %d route(s) take a resource id without scoping it to the "
                     "caller's organisation: %s", len(found), ", ".join(found))
    else:
        logger.info("tenant scope audit: all resource-id routes are org-scoped")
    return found
