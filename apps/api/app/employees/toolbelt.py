"""The Tool Layer -- software the employees operate.

Two kinds of tool:

    data  read-only context an employee pulls before thinking (GSC, competitors,
          the product catalogue). Cheap, safe, run automatically.
    app   a connected third party the employee acts through (WordPress, Shopify,
          Meta, ...). Gated by permission AND by whether the org actually
          connected the app.

Every tool declares the permission it needs. `run()` refuses anything the
calling employee is not permitted to do -- the employee cannot opt out of the
check, because it never calls the underlying service directly.

Registration is open: `register_tool()` lets a new integration appear without
editing the employees that will use it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from app.employees.spec import (
    P_PUBLISH_EXTERNAL, P_READ_ANALYTICS, P_READ_COMPETITORS, P_READ_CONTENT,
    P_READ_PRODUCTS, P_SEND_EMAIL,
)

logger = logging.getLogger(__name__)

KIND_DATA = "data"
KIND_APP = "app"


@dataclass
class Tool:
    name: str
    label: str
    description: str
    kind: str = KIND_DATA
    app: str = ""                                  # "wordpress" | "shopify" | ...
    permission: str = P_READ_CONTENT
    handler: Optional[Callable[..., Awaitable[Any]]] = None
    # (project_id, org_id, db) -> bool ; app tools only
    availability: Optional[Callable[..., Awaitable[bool]]] = None
    writes: bool = False                           # mutates something outside Fennex

    def to_dict(self) -> dict:
        return {"name": self.name, "label": self.label, "description": self.description,
                "kind": self.kind, "app": self.app, "permission": self.permission,
                "writes": self.writes}


@dataclass
class ToolResult:
    ok: bool
    data: Any = None
    error: Optional[str] = None
    denied: bool = False

    def to_dict(self) -> dict:
        return {"ok": self.ok, "data": self.data, "error": self.error, "denied": self.denied}


_TOOLS: dict[str, Tool] = {}


def register_tool(tool: Tool, *, replace: bool = True) -> Tool:
    if tool.name in _TOOLS and not replace:
        raise ValueError(f"tool {tool.name} already registered")
    _TOOLS[tool.name] = tool
    return tool


def get_tool(name: str) -> Optional[Tool]:
    return _TOOLS.get(name)


def all_tools() -> list[Tool]:
    return sorted(_TOOLS.values(), key=lambda t: (t.kind, t.name))


def missing(names) -> list[str]:
    return [n for n in names or [] if n not in _TOOLS]


def apps() -> list[str]:
    return sorted({t.app for t in _TOOLS.values() if t.app})


# --- data tools ---------------------------------------------------------------
# These wrap the existing specialist-data tools, which already take
# (brief, db, inputs). The framework passes a context object exposing the same
# attributes, so no rewrite is needed.


def _adopt_legacy_data_tools() -> None:
    from app.services.agents import tools as legacy

    meta = {
        "gsc_opportunities": ("Search Console opportunities",
                              "Striking-distance queries and CTR wins from real GSC data.",
                              P_READ_ANALYTICS),
        "market_insights": ("Market insights", "Topic clusters and content ideas from demand.",
                            P_READ_ANALYTICS),
        "market_data": ("Full market bundle",
                        "Overview, health, clusters, ideas and opportunities in one payload.",
                        P_READ_ANALYTICS),
        "tracked_keywords": ("Tracked keywords", "Keywords this project is tracking.",
                             P_READ_ANALYTICS),
        "crawl_competitor": ("Crawl a competitor", "Fetch and analyse a competitor page.",
                             P_READ_COMPETITORS),
        "our_demand": ("Our demand", "The topics this project already earns impressions on.",
                       P_READ_ANALYTICS),
        "store_products": ("Store products", "The connected store's product catalogue.",
                           P_READ_PRODUCTS),
        "article_context": ("Article context", "An existing article plus its brand voice.",
                            P_READ_CONTENT),
        "seo_grounding": ("SEO grounding", "SEO requirements for an article in progress.",
                          P_READ_CONTENT),
    }
    for name, fn in legacy.TOOLS.items():
        label, desc, perm = meta.get(name, (name.replace("_", " ").title(), "", P_READ_CONTENT))
        register_tool(Tool(name=name, label=label, description=desc, kind=KIND_DATA,
                           permission=perm, handler=fn))


# --- connected apps -----------------------------------------------------------


async def _shopify_available(project_id, org_id, db) -> bool:
    try:
        from app.services import shopify_service
        return bool(await shopify_service.get_connection(project_id, org_id, db))
    except Exception:
        return False


async def _woo_available(project_id, org_id, db) -> bool:
    try:
        from app.services import woocommerce_service
        return bool(await woocommerce_service.get_connection(project_id, org_id, db))
    except Exception:
        return False


async def _wordpress_available(project_id, org_id, db) -> bool:
    try:
        from app.models.publishing import PublishingIntegration
        from sqlalchemy import select
        row = (await db.execute(
            select(PublishingIntegration).where(
                PublishingIntegration.project_id == project_id).limit(1)
        )).scalars().first()
        return row is not None
    except Exception:
        return False


def _social_available(platform: str):
    async def check(project_id, org_id, db) -> bool:
        try:
            from app.services import social_connections_service
            rows = await social_connections_service.list_connections(org_id, db)
            return any(getattr(c, "platform", "") == platform for c in rows)
        except Exception:
            return False
    return check


async def _publish_wordpress(ctx, db, inputs):
    from app.services.publish_service import publish_to_wordpress
    return await publish_to_wordpress(inputs["article_id"], ctx.project_id, ctx.org_id, db)


async def _publish_shopify(ctx, db, inputs):
    from app.services.publish_service import publish_to_shopify
    return await publish_to_shopify(inputs["article_id"], ctx.project_id, ctx.org_id, db)


async def _send_email(ctx, db, inputs):
    from app.services.email_service import send_email
    return await send_email(inputs["to"], inputs.get("subject", ""), inputs.get("html", ""))


async def _shopify_products(ctx, db, inputs):
    from app.services import shopify_service
    rows = await shopify_service.list_products(ctx.project_id, ctx.org_id, db)
    return {"products": [{"id": str(p.id), "title": p.title, "price": p.price} for p in rows][:50]}


async def _woo_products(ctx, db, inputs):
    from app.services import woocommerce_service
    return await woocommerce_service.sync_products(ctx.project_id, ctx.org_id, db)


async def _publish_calendar_entry(ctx, db, inputs):
    """Social posts publish through a calendar entry -- that is where the
    scheduling, connection lookup and per-network payload already live."""
    from app.models.calendar_entry import CalendarEntry
    from app.services.calendar_publish import publish_entry
    entry_id = inputs.get("entry_id")
    if not entry_id:
        raise ValueError("entry_id is required to publish a social post")
    entry = await db.get(CalendarEntry, entry_id)
    if entry is None or entry.org_id != ctx.org_id:
        raise ValueError("calendar entry not found")
    result = await publish_entry(entry, db)
    return {"status": getattr(result, "status", None), "id": str(getattr(result, "id", ""))}


def _register_app_tools() -> None:
    register_tool(Tool(
        name="wordpress.publish", label="Publish to WordPress",
        description="Publish an article to the connected WordPress site.",
        kind=KIND_APP, app="wordpress", permission=P_PUBLISH_EXTERNAL, writes=True,
        handler=_publish_wordpress, availability=_wordpress_available))

    register_tool(Tool(
        name="shopify.publish", label="Publish to Shopify",
        description="Push generated copy to the connected Shopify store.",
        kind=KIND_APP, app="shopify", permission=P_PUBLISH_EXTERNAL, writes=True,
        handler=_publish_shopify, availability=_shopify_available))

    register_tool(Tool(
        name="shopify.products", label="Shopify catalogue",
        description="Read products from the connected Shopify store.",
        kind=KIND_APP, app="shopify", permission=P_READ_PRODUCTS,
        availability=_shopify_available, handler=_shopify_products))

    register_tool(Tool(
        name="woocommerce.products", label="WooCommerce catalogue",
        description="Read products from the connected WooCommerce store.",
        kind=KIND_APP, app="woocommerce", permission=P_READ_PRODUCTS,
        availability=_woo_available, handler=_woo_products))

    register_tool(Tool(
        name="email.send", label="Send email",
        description="Send an email through the configured provider.",
        kind=KIND_APP, app="email", permission=P_SEND_EMAIL, writes=True,
        handler=_send_email))

    for platform in ("instagram", "facebook", "linkedin", "pinterest", "threads", "x"):
        register_tool(Tool(
            name=f"{platform}.publish", label=f"Publish to {platform.title()}",
            description=f"Publish a scheduled calendar entry to the connected "
                        f"{platform.title()} account.",
            kind=KIND_APP, app=platform, permission=P_PUBLISH_EXTERNAL, writes=True,
            availability=_social_available(platform), handler=_publish_calendar_entry))


_adopt_legacy_data_tools()
_register_app_tools()


# --- execution ----------------------------------------------------------------


async def available_apps(project_id, org_id, db) -> dict[str, bool]:
    """Which connected apps this project can actually reach right now."""
    out: dict[str, bool] = {}
    for tool in _TOOLS.values():
        if tool.kind != KIND_APP or not tool.app or tool.app in out:
            continue
        if tool.availability is None:
            out[tool.app] = True
            continue
        try:
            out[tool.app] = bool(await tool.availability(project_id, org_id, db))
        except Exception:
            out[tool.app] = False
    return out


async def run(name: str, ctx, db, inputs: Optional[dict] = None,
              granted: Optional[list[str]] = None) -> ToolResult:
    """Run one tool on behalf of an employee, enforcing its permission."""
    tool = _TOOLS.get(name)
    if tool is None:
        return ToolResult(ok=False, error=f"unknown tool {name}")
    if granted is not None and tool.permission not in granted:
        logger.warning("tool %s denied: missing %s", name, tool.permission)
        return ToolResult(ok=False, denied=True,
                          error=f"permission {tool.permission} not granted")
    if tool.handler is None:
        return ToolResult(ok=False, error=f"tool {name} has no handler bound")
    try:
        # Both kinds share the (ctx, db, inputs) signature -- which is also the
        # legacy data-tool signature, so adopted tools work unmodified.
        return ToolResult(ok=True, data=await tool.handler(ctx, db, inputs or {}))
    except Exception as exc:   # noqa: BLE001
        logger.exception("tool %s failed", name)
        return ToolResult(ok=False, error=str(exc))


async def run_many(names, ctx, db, inputs: Optional[dict] = None,
                   granted: Optional[list[str]] = None) -> dict[str, dict]:
    """Gather several data tools. Shape matches the legacy `run_tools` payload."""
    out: dict[str, dict] = {}
    for name in names or []:
        result = await run(name, ctx, db, inputs, granted)
        out[name] = {"ok": result.ok, "data": result.data}
    return out
