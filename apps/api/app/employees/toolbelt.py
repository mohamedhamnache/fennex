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
    # The input key this tool reads. Adapted legacy tools expect their own name
    # ("competitor_url", "article_id"); the bridge hands the model's argument
    # under both this key and "query" so either convention works.
    arg: str = "query"
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
        "crawl_competitor": ("Crawl a competitor",
                             "Fetch and analyse a competitor page. Give the full URL.",
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
    register_tool(Tool(
        name="discover_competitors", label="Find this project's competitors",
        description="Find who competes with THIS project, worked out from the topics "
                    "it actually ranks for. Use this before searching manually -- it "
                    "excludes our own site and ranks rivals by how many of our topics "
                    "they appear on.",
        kind=KIND_DATA, permission=P_READ_COMPETITORS, handler=_discover_competitors))
    register_tool(Tool(
        name="known_competitors", label="Known competitors",
        description="The competitors already tracked for this project. Start here "
                    "before searching for new ones.",
        kind=KIND_DATA, permission=P_READ_COMPETITORS, handler=_known_competitors))
    register_tool(Tool(
        name="serp_lookup", label="Search the web",
        description="Search a keyword and return the real ranking pages: title, URL and "
                    "domain. Use this to find sources you can actually cite.",
        kind=KIND_DATA, permission=P_READ_COMPETITORS, handler=_serp_lookup))
    register_tool(Tool(
        name="fetch_page", label="Read a page",
        description="Fetch a URL and return its text, so a claim can be checked against "
                    "what the page actually says before you cite it.",
        kind=KIND_DATA, permission=P_READ_COMPETITORS, handler=_fetch_page))

    # Input key each adapted tool reads, where it is not "query".
    args = {"crawl_competitor": "competitor_url",
            "article_context": "article_id",
            "seo_grounding": "article_id"}

    for name, fn in legacy.TOOLS.items():
        label, desc, perm = meta.get(name, (name.replace("_", " ").title(), "", P_READ_CONTENT))
        register_tool(Tool(name=name, label=label, description=desc, kind=KIND_DATA,
                           permission=perm, handler=fn, arg=args.get(name, "query")))


# --- connected apps -----------------------------------------------------------


async def _known_competitors(ctx, db, inputs):
    """Competitors already tracked for this project.

    Sable could previously only crawl a URL it was handed, so a request like
    "analyse my competitors" left it with nothing to look at. This is the
    starting point: who we already know about.
    """
    from sqlalchemy import select

    found: list[dict] = []
    try:
        from app.models.seo_intel import Competitor
        rows = (await db.execute(
            select(Competitor).where(Competitor.project_id == ctx.project_id).limit(25)
        )).scalars().all()
        found += [{"domain": r.domain, "source": "tracked"} for r in rows if r.domain]
    except Exception:
        pass
    try:
        from app.models.monitoring import WatchedCompetitor
        rows = (await db.execute(
            select(WatchedCompetitor).where(
                WatchedCompetitor.project_id == ctx.project_id).limit(25)
        )).scalars().all()
        for r in rows:
            domain = getattr(r, "domain", None) or getattr(r, "url", None)
            if domain and not any(f["domain"] == domain for f in found):
                found.append({"domain": domain, "source": "watched"})
    except Exception:
        pass

    if not found:
        return {"competitors": [],
                "note": "None are tracked for this project. Use the search tool on a "
                        "topic this project targets and treat the ranking domains as "
                        "the competitors."}
    return {"competitors": found}


async def _discover_competitors(ctx, db, inputs):
    """Who competes with THIS project, derived from its own demand.

    Letting the model pick a keyword to search produces whoever ranks for
    something it guessed, which is how an unrelated site ends up being
    "analysed". This instead takes the topics the project actually earns
    impressions on, sees who ranks against it there, and counts the domains
    that recur -- a site appearing across several of our topics is a
    competitor; one appearing on a single query is noise.
    """
    from app.models.project import Project
    from app.services.analytics_service import get_market_insights
    from app.services.serp_service import (
        _norm_domain, _project_domain, fetch_serp, language_for_project,
        location_for_project,
    )

    project = await db.get(Project, ctx.project_id)
    if project is None:
        return {"competitors": [], "error": "Project not found."}

    # The project's real topics, best first.
    topics: list[str] = []
    try:
        insights = await get_market_insights(ctx.project_id, ctx.org_id, db)
        topics = [c.topic for c in (insights.clusters or [])[:3] if c.topic]
        if not topics:
            topics = [i.query for i in (insights.ideas or [])[:3] if i.query]
    except Exception:
        topics = []
    # Fall back to what the caller asked about, then the project's niche.
    if not topics:
        seed = str((inputs or {}).get("query") or "").strip()
        niche = getattr(project, "industry", None) or getattr(project, "niche", None)
        topics = [t for t in (seed, niche) if t][:2]
    if not topics:
        return {"competitors": [],
                "note": "This project has no Search Console demand and no niche set, "
                        "so there is nothing to measure competitors against. Connect "
                        "Search Console or name the competitor to analyse."}

    ours = _project_domain(project)
    tally: dict[str, dict] = {}
    checked: list[str] = []

    # Capped deliberately: each lookup is a paid call.
    for topic in topics[:3]:
        try:
            data = await fetch_serp(project, topic, db)
        except Exception:
            continue
        if not data:
            continue
        checked.append(topic)
        for row in (data.get("top10") or [])[:10]:
            domain = _norm_domain(row.get("domain") or "")
            # Our own site is not a competitor.
            if not domain or domain == ours or domain.endswith("." + ours):
                continue
            entry = tally.setdefault(domain, {"domain": domain, "topics": [],
                                              "best_rank": 99, "url": row.get("url") or ""})
            if topic not in entry["topics"]:
                entry["topics"].append(topic)
            entry["best_rank"] = min(entry["best_rank"], int(row.get("rank") or 99))

    if not checked:
        return {"competitors": [],
                "error": "The search provider returned nothing for this project's "
                         "topics. Check the DataForSEO plan and balance."}

    # Recurring across topics beats ranking once, then rank breaks ties.
    ranked = sorted(tally.values(), key=lambda e: (-len(e["topics"]), e["best_rank"]))
    return {"ourDomain": ours, "topicsChecked": checked,
            "competitors": ranked[:8],
            "note": "Ranked by how many of this project's own topics each domain "
                    "competes on. Prefer those appearing on more than one."}


async def _serp_lookup(ctx, db, inputs):
    """Real search results for a keyword: ranked URLs and titles.

    This is what makes a citation checkable. Without it a writer asked for
    sources invents plausible URLs, which is worse than no sources at all.
    """
    from app.models.project import Project
    from app.services.serp_service import fetch_serp

    keyword = str((inputs or {}).get("query") or "").strip()
    if not keyword:
        return {"error": "Give the keyword to search for."}
    project = await db.get(Project, ctx.project_id)
    if project is None:
        return {"results": []}
    try:
        data = await fetch_serp(project, keyword, db)
    except Exception as exc:   # noqa: BLE001
        # A provider rejection is actionable information, not a dead end -- the
        # employee should be able to tell the user why it could not look, and a
        # raised exception here just becomes "unavailable".
        detail = str(exc)
        if "403" in detail or "401" in detail:
            return {"results": [],
                    "error": "The SEO provider rejected the request. Check that the "
                             "DataForSEO account is funded and its plan includes the "
                             "SERP API."}
        return {"results": [], "error": f"The search provider failed: {detail[:200]}"}

    if not data:
        return {"results": [],
                "note": "No SEO provider is connected, so live results are unavailable. "
                        "Connect one in Integrations."}
    if not data.get("top10"):
        return {"keyword": keyword, "results": [],
                "note": "The provider returned no organic results for this keyword in "
                        "this market."}
    return {"keyword": keyword,
            "results": [{"rank": r["rank"], "title": r["title"], "url": r["url"],
                         "domain": r["domain"]} for r in data.get("top10", [])],
            "features": data.get("features", [])}


async def _fetch_page(ctx, db, inputs):
    """Fetch a page so a claim can be checked against what it actually says."""
    from app.services.competitor_service import _crawl

    url = str((inputs or {}).get("query") or "").strip()
    if not url.startswith(("http://", "https://")):
        return {"error": "Give a full URL beginning with http:// or https://."}
    try:
        page = await _crawl(url)
    except Exception as exc:   # noqa: BLE001
        return {"error": f"Could not fetch that page: {exc}"}
    content = page.get("content") if isinstance(page, dict) else None
    text = ""
    if isinstance(content, dict):
        text = str(content.get("text") or content.get("body") or "")
    return {"url": url,
            "title": (content or {}).get("title") if isinstance(content, dict) else None,
            "text": text[:5000]}


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
