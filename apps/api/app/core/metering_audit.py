"""Every paid supplier call must be metered. This is how that stays true.

Four unmetered paths were found in one week, and three greps produced three
different wrong answers looking for them: a false positive, a false negative
from searching the wrong directory, and a miss on the largest leak of all
(`stream_llm`, then the path behind ALL article generation, article chat, the
writing service and the employee chat -- the customer billed nothing while the
supplier billed us).

The lesson is not "grep more carefully". It is that "every paid call is
metered" cannot be established by reading code, so it is asserted instead.

WHAT THIS KEYS ON. The outbound call, not the module. Every leak found was a
paid HTTP request that no chokepoint saw -- an SDK stream, a raw httpx POST in
a router, an SDK embeddings call in a service. Two of them lived in files whose
OTHER functions were properly metered, which is exactly why "this module is
metered" is not a safe unit of reasoning.

HOW IT FAILS. It reports every function that reaches a supplier and is not on
the allowlist below. A new supplier call is therefore a deliberate decision:
either meter it, or record here why it needs none. Adding a call and saying
nothing is the one thing it makes impossible.
"""
from __future__ import annotations

import ast
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

APP_ROOT = Path(__file__).resolve().parent.parent

# Hosts we pay. A string literal naming one of these inside a function is an
# outbound supplier call however it is dispatched -- httpx, requests, an SDK.
SUPPLIER_HOSTS = (
    "api.openai.com",
    "api.anthropic.com",
    "api.replicate.com",
    "generativelanguage.googleapis.com",
    "api.remove.bg",
    "api.dataforseo.com",
)

# Provider SDK methods that spend money. Matched on the attribute chain, so
# `client.chat.completions.create(...)` and `self.messages.stream(...)` both
# count regardless of how the client was obtained.
SUPPLIER_SDK_CALLS = (
    ("messages", "create"),
    ("messages", "stream"),
    ("completions", "create"),
    ("embeddings", "create"),
    ("images", "generate"),
    ("responses", "create"),
    ("batches", "create"),
)

# Functions that reach a supplier AND are accounted for. The note is the point:
# it says WHERE the money is recorded, so a reviewer can check the claim.
ALLOWLIST: dict[str, str] = {
    # ── the chokepoints themselves ──────────────────────────────────────────
    "app.services.llm_service:_call_openai": "text discarded; usage path is _openai_usage",
    "app.services.llm_service:_openai_usage": "returns LLMUsage to call_llm, which meters",
    "app.services.llm_service:_call_anthropic": "text discarded; usage path is _anthropic_usage",
    "app.services.llm_service:_anthropic_usage": "returns LLMUsage to call_llm, which meters",
    "app.services.llm_service:_google_usage": "returns LLMUsage to call_llm, which meters",
    "app.services.llm_service:_call_google": "wrapped by _google_usage on every metered path",
    "app.services.llm_service:stream_llm": "meters in its finally via _meter_ambient",
    "app.services.llm_service:call_llm_vision": "meters via _meter_ambient",
    "app.services.llm_service:call_llm_vision_usage": "returns LLMUsage to call_llm_vision, which meters",
    "app.services.editing_service:_create_prediction": "polled by _replicate_run, which meters",
    "app.services.editing_service:_replicate_run": "meters via record_replicate on success",
    # ── metered at the call site ────────────────────────────────────────────
    "app.services.knowledge_service:embed": "meters via _meter_ambient (knowledge_embed)",
    "app.api.v1.routers.product:_analyze_product_image": "meters via _meter_ambient",
    "app.services.image_service:generate_image_dalle": "meters via record_image",
    # ── batch ───────────────────────────────────────────────────────────────
    "app.services.batch.client:run_batched": "returns LLMUsage to call_llm_usage, which meters",
    # ── SEO: a separate credit bucket, metered by its CALLERS ───────────────
    # The provider is a thin HTTP client with no metering of its own; every
    # caller records the task through record_seo. Listed individually so a NEW
    # provider method cannot be added and left unbilled.
    "app.integrations.seo_apis.dataforseo:__init__": "stores credentials; makes no call",
    "app.integrations.seo_apis.dataforseo:get_keyword_ideas": "callers meter (keyword_tasks -> record_seo)",
    "app.integrations.seo_apis.dataforseo:serp": "callers meter (serp_service.fetch_serp -> record_seo)",
    "app.integrations.seo_apis.dataforseo:serp_batch": "caller meters count=len(keywords) (discovery/competitors)",
    "app.integrations.seo_apis.dataforseo:serp_standard": "callers meter (fetch_serp -> record_seo, serp_standard unit)",
}


def _names_a_supplier_host(node: ast.AST) -> bool:
    """True when any string literal under this node names a host we pay."""
    for child in ast.walk(node):
        if isinstance(child, ast.Constant) and isinstance(child.value, str):
            if any(host in child.value for host in SUPPLIER_HOSTS):
                return True
    return False


def _supplier_host_holders(tree: ast.AST) -> set[str]:
    """Classes that hold a supplier host in a CLASS-LEVEL constant.

    Found the hard way. `DataForSEOProvider` keeps its endpoint in
    `BASE_URL = "https://api.dataforseo.com/v3"` and its methods build URLs with
    `f"{self.BASE_URL}/..."`, so no method body contains a supplier literal and
    a body-only scan declared the whole file clean. Every paid SEO call in the
    product was invisible to this audit until the class itself was considered.
    """
    holders: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        for stmt in node.body:
            if isinstance(stmt, (ast.Assign, ast.AnnAssign)) and stmt.value is not None:
                if _names_a_supplier_host(stmt.value):
                    holders.add(node.name)
    return holders


def _reaches_a_supplier(node: ast.AST, source: str) -> bool:
    """True when this function body makes an outbound call we pay for."""
    if _names_a_supplier_host(node):
        return True
    for child in ast.walk(node):
        if isinstance(child, ast.Call) and isinstance(child.func, ast.Attribute):
            attr = child.func
            if isinstance(attr.value, ast.Attribute):
                if (attr.value.attr, attr.attr) in SUPPLIER_SDK_CALLS:
                    return True
    return False


def find_unmetered_supplier_calls() -> list[str]:
    """Every `module:function` that reaches a supplier without being accounted
    for. Empty means the invariant holds."""
    violations: list[str] = []
    for path in sorted(APP_ROOT.rglob("*.py")):
        rel = path.relative_to(APP_ROOT.parent)
        module = str(rel.with_suffix("")).replace("/", ".")
        # This module names every supplier host by definition.
        if module == "app.core.metering_audit":
            continue
        try:
            source = path.read_text(encoding="utf-8")
            tree = ast.parse(source)
        except (OSError, SyntaxError):
            continue
        holders = _supplier_host_holders(tree)
        for parent in ast.walk(tree):
            owner = parent.name if isinstance(parent, ast.ClassDef) else None
            for node in ast.iter_child_nodes(parent):
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                # A method of a class that holds a supplier endpoint reaches that
                # supplier even if its own body only interpolates the constant.
                if not (_reaches_a_supplier(node, source) or owner in holders):
                    continue
                key = f"{module}:{node.name}"
                if key not in ALLOWLIST:
                    violations.append(f"{key} (line {node.lineno})")
    return violations


def assert_supplier_calls_are_metered() -> None:
    """Log loudly if any paid call path is unaccounted for.

    Logs rather than raises: refusing to boot the API over a billing-audit
    finding would turn a margin problem into an outage. The test suite asserts
    the same list is empty, so this never reaches production silently -- CI is
    where it stops a change, and this is the backstop for a path that only
    exists at runtime.
    """
    violations = find_unmetered_supplier_calls()
    if not violations:
        return
    logger.error(
        "UNMETERED SUPPLIER CALLS (%d). Each of these spends money with no "
        "usage event: %s. Meter it, or add it to ALLOWLIST in "
        "app/core/metering_audit.py with a note saying where it is recorded.",
        len(violations), ", ".join(violations),
    )
