"""MCP servers as employee tools.

An employee declares an MCP server in `connected_apps` the same way it declares
a native Fennex tool, and the runtime attaches whatever that server exposes.
This is how a toolless employee -- the creative director, the outreach agent --
gains real reach without anyone writing an integration by hand.

Servers are configured per organisation, not per employee, so connecting a
workspace once makes it available to everyone entitled to it. An employee still
only receives servers it declared, and only if the run holds the permission.

Nothing here leaks upward: the registry and router know an employee "uses
notion", not that Notion happens to arrive over MCP.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Optional

from app.employees.spec import (
    P_PUBLISH_EXTERNAL, P_READ_CONTENT, P_SEND_EMAIL, P_WRITE_SOCIAL,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MCPServer:
    """One configured MCP server."""

    app: str                      # the name an employee declares
    label: str
    url: str = ""                 # streamable HTTP endpoint
    command: str = ""             # or a stdio command
    args: list[str] = field(default_factory=list)
    permission: str = P_READ_CONTENT
    headers: dict = field(default_factory=dict)
    # Presentation, so the integrations page can group and explain without a
    # second table that drifts from this one.
    category: str = "Other"
    description: str = ""
    # True when Fennex already reaches this app through a NATIVE tool. MCP
    # would then be a second, unmetered route to the same paid API -- exactly
    # what the metering audit exists to catch -- so the UI must say which path
    # is live rather than offering both as equals.
    native_tool: str = ""

    @property
    def transport(self) -> str:
        return "http" if self.url else "stdio"

    def to_dict(self) -> dict:
        return {"app": self.app, "label": self.label, "category": self.category,
                "description": self.description, "permission": self.permission,
                "transport": self.transport, "configured": bool(self.url or self.command),
                "nativeTool": self.native_tool}


# Catalogue of servers Fennex knows how to talk to. A server is only usable
# when its endpoint is configured -- declaring one costs nothing at rest.
CATALOGUE: dict[str, MCPServer] = {
    # ── Commerce ─────────────────────────────────────────────────────────────
    # These already have native, metered tools. Listed so an employee that
    # declares them resolves, and so the UI can show a connected state -- but
    # `native_tool` marks that the paid path is the native one.
    "shopify": MCPServer(app="shopify", label="Shopify", category="Commerce",
                         description="Products, orders and customers from your store.",
                         url=os.getenv("MCP_SHOPIFY_URL", ""),
                         permission=P_READ_CONTENT, native_tool="shopify.products"),
    "woocommerce": MCPServer(app="woocommerce", label="WooCommerce", category="Commerce",
                             description="Products and orders from a WooCommerce site.",
                             url=os.getenv("MCP_WOOCOMMERCE_URL", ""),
                             permission=P_READ_CONTENT, native_tool="woocommerce.products"),
    "stripe": MCPServer(app="stripe", label="Stripe", category="Commerce",
                        description="Payments, subscriptions and revenue.",
                        url=os.getenv("MCP_STRIPE_URL", ""), permission=P_READ_CONTENT),

    # ── Publishing ───────────────────────────────────────────────────────────
    "wordpress": MCPServer(app="wordpress", label="WordPress", category="Publishing",
                           description="Publish and update posts and pages.",
                           url=os.getenv("MCP_WORDPRESS_URL", ""),
                           permission=P_PUBLISH_EXTERNAL, native_tool="wordpress.publish"),
    "webflow": MCPServer(app="webflow", label="Webflow", category="Publishing",
                         description="CMS collections and site content.",
                         url=os.getenv("MCP_WEBFLOW_URL", ""), permission=P_PUBLISH_EXTERNAL),
    "ghost": MCPServer(app="ghost", label="Ghost", category="Publishing",
                       description="Posts and newsletters on a Ghost site.",
                       url=os.getenv("MCP_GHOST_URL", ""), permission=P_PUBLISH_EXTERNAL),

    # ── Analytics ────────────────────────────────────────────────────────────
    "google-search-console": MCPServer(
        app="google-search-console", label="Search Console", category="Analytics",
        description="Queries, pages, clicks and impressions.",
        url=os.getenv("MCP_GSC_URL", ""), permission=P_READ_CONTENT,
        native_tool="gsc_opportunities"),
    "google-analytics": MCPServer(app="google-analytics", label="Google Analytics",
                                  category="Analytics",
                                  description="Sessions, conversions and audience.",
                                  url=os.getenv("MCP_GA_URL", ""), permission=P_READ_CONTENT),
    "posthog": MCPServer(app="posthog", label="PostHog", category="Analytics",
                         description="Product analytics, funnels and session data.",
                         url=os.getenv("MCP_POSTHOG_URL", ""), permission=P_READ_CONTENT),

    # ── Advertising ──────────────────────────────────────────────────────────
    # The connectors that would turn the dashboard's sample ROAS, CAC and MER
    # into measured figures.
    "meta-ads": MCPServer(app="meta-ads", label="Meta Ads", category="Advertising",
                          description="Spend, ROAS and campaign performance.",
                          url=os.getenv("MCP_META_ADS_URL", ""), permission=P_READ_CONTENT),
    "google-ads": MCPServer(app="google-ads", label="Google Ads", category="Advertising",
                            description="Spend, conversions and campaign performance.",
                            url=os.getenv("MCP_GOOGLE_ADS_URL", ""), permission=P_READ_CONTENT),
    "tiktok-ads": MCPServer(app="tiktok-ads", label="TikTok Ads", category="Advertising",
                            description="Spend and performance for TikTok campaigns.",
                            url=os.getenv("MCP_TIKTOK_ADS_URL", ""), permission=P_READ_CONTENT),

    # ── Social ───────────────────────────────────────────────────────────────
    "instagram": MCPServer(app="instagram", label="Instagram", category="Social",
                           description="Publish posts, reels and stories.",
                           url=os.getenv("MCP_INSTAGRAM_URL", ""), permission=P_WRITE_SOCIAL),
    "facebook": MCPServer(app="facebook", label="Facebook", category="Social",
                          description="Publish to a Facebook page.",
                          url=os.getenv("MCP_FACEBOOK_URL", ""), permission=P_WRITE_SOCIAL),
    "linkedin": MCPServer(app="linkedin", label="LinkedIn", category="Social",
                          description="Publish posts and send connection messages.",
                          url=os.getenv("MCP_LINKEDIN_URL", ""), permission=P_PUBLISH_EXTERNAL),
    "pinterest": MCPServer(app="pinterest", label="Pinterest", category="Social",
                           description="Publish pins to a board.",
                           url=os.getenv("MCP_PINTEREST_URL", ""), permission=P_WRITE_SOCIAL),
    "x": MCPServer(app="x", label="X", category="Social",
                   description="Publish posts to X.",
                   url=os.getenv("MCP_X_URL", ""), permission=P_WRITE_SOCIAL),
    "threads": MCPServer(app="threads", label="Threads", category="Social",
                         description="Publish posts to Threads.",
                         url=os.getenv("MCP_THREADS_URL", ""), permission=P_WRITE_SOCIAL),
    "youtube": MCPServer(app="youtube", label="YouTube", category="Social",
                         description="Video metadata, descriptions and performance.",
                         url=os.getenv("MCP_YOUTUBE_URL", ""), permission=P_WRITE_SOCIAL),

    # ── Lifecycle ────────────────────────────────────────────────────────────
    "klaviyo": MCPServer(app="klaviyo", label="Klaviyo", category="Lifecycle",
                         description="Email and SMS flows, lists and campaign results.",
                         url=os.getenv("MCP_KLAVIYO_URL", ""), permission=P_SEND_EMAIL),
    "mailchimp": MCPServer(app="mailchimp", label="Mailchimp", category="Lifecycle",
                           description="Audiences, campaigns and reports.",
                           url=os.getenv("MCP_MAILCHIMP_URL", ""), permission=P_SEND_EMAIL),
    "gmail": MCPServer(app="gmail", label="Gmail", category="Lifecycle",
                       description="Send email from your own Google account.",
                       url=os.getenv("MCP_GMAIL_URL", ""), permission=P_SEND_EMAIL),
    "email": MCPServer(app="email", label="Email", category="Lifecycle",
                       description="Send email through the configured provider.",
                       url=os.getenv("MCP_EMAIL_URL", ""), permission=P_SEND_EMAIL,
                       native_tool="email.send"),

    # ── Workspace ────────────────────────────────────────────────────────────
    "notion": MCPServer(app="notion", label="Notion", category="Workspace",
                        description="Pages and databases the team writes in.",
                        url=os.getenv("MCP_NOTION_URL", ""), permission=P_READ_CONTENT),
    "slack": MCPServer(app="slack", label="Slack", category="Workspace",
                       description="Post updates and read channel context.",
                       url=os.getenv("MCP_SLACK_URL", ""), permission=P_WRITE_SOCIAL),
    "google-drive": MCPServer(app="google-drive", label="Google Drive", category="Workspace",
                              description="Documents and sheets the team keeps.",
                              url=os.getenv("MCP_GDRIVE_URL", ""), permission=P_READ_CONTENT),
    "github": MCPServer(app="github", label="GitHub", category="Workspace",
                        description="Repositories, issues and docs.",
                        url=os.getenv("MCP_GITHUB_URL", ""), permission=P_READ_CONTENT),
    "airtable": MCPServer(app="airtable", label="Airtable", category="Workspace",
                          description="Bases and records used as a content calendar.",
                          url=os.getenv("MCP_AIRTABLE_URL", ""), permission=P_READ_CONTENT),
    "hubspot": MCPServer(app="hubspot", label="HubSpot", category="Lifecycle",
                         description="CRM contacts, deals and marketing data.",
                         url=os.getenv("MCP_HUBSPOT_URL", ""), permission=P_READ_CONTENT),
    "canva": MCPServer(app="canva", label="Canva", category="Creative",
                       description="Brand templates and design assets.",
                       url=os.getenv("MCP_CANVA_URL", ""), permission=P_PUBLISH_EXTERNAL),
}


def catalogue_dicts() -> list[dict]:
    """The whole catalogue for the integrations page, grouped-ready."""
    return [s.to_dict() for s in
            sorted(CATALOGUE.values(), key=lambda s: (s.category, s.label))]


def declared_apps() -> set[str]:
    """Every app some employee declares. The catalogue must cover all of them
    or that employee's `connected_apps` entry silently resolves to nothing."""
    from app.employees import registry
    return {a for e in registry.all_employees() for a in e.connected_apps}


def configured() -> list[MCPServer]:
    """Servers with an endpoint set, so actually reachable."""
    return [s for s in CATALOGUE.values() if s.url or s.command]


def servers_for(employee, granted: list[str],
                configured: Optional[dict] = None) -> list[MCPServer]:
    """Which servers this employee may use on this run.

    Same two gates as native tools: the employee must have declared the app,
    and the run must hold the permission it needs.

    `configured` carries the organisation's own connectors and takes priority
    over the environment, so a connector added in the UI is live immediately.
    """
    out = []
    for app in employee.connected_apps:
        server = (configured or {}).get(app) or CATALOGUE.get(app)
        if server is None or not (server.url or server.command):
            continue
        if server.permission not in granted:
            logger.info("mcp %s withheld from %s: %s not granted",
                        app, employee.id, server.permission)
            continue
        out.append(server)
    return out


def _transport(server: MCPServer):
    """A callable that opens this server's transport, as Strands expects."""
    if server.url:
        from mcp.client.streamable_http import streamablehttp_client
        return lambda: streamablehttp_client(server.url, headers=server.headers or None)

    from mcp import StdioServerParameters, stdio_client
    params = StdioServerParameters(command=server.command, args=list(server.args))
    return lambda: stdio_client(params)


def clients_for(employee, granted: list[str], configured: Optional[dict] = None) -> list:
    """Open MCP clients for this employee. Caller owns their lifetime.

    A server that cannot be reached is skipped with a warning rather than
    failing the turn -- a broken integration must never cost the user their
    answer.
    """
    from strands.tools.mcp import MCPClient

    clients = []
    for server in servers_for(employee, granted, configured):
        try:
            clients.append((server, MCPClient(
                _transport(server),
                prefix=server.app.replace("-", "_"),
                continue_on_error=True,
            )))
        except Exception:
            logger.exception("could not construct MCP client for %s", server.app)
    return clients


def describe(employee) -> list[dict]:
    """What MCP reach this employee has -- for the UI and health board."""
    out = []
    for app in employee.connected_apps:
        server = CATALOGUE.get(app)
        if server is None:
            continue
        out.append({"app": app, "label": server.label,
                    "transport": server.transport,
                    "configured": bool(server.url or server.command),
                    "permission": server.permission})
    return out
