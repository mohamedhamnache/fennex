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

    @property
    def transport(self) -> str:
        return "http" if self.url else "stdio"


# Catalogue of servers Fennex knows how to talk to. A server is only usable
# when its endpoint is configured -- declaring one costs nothing at rest.
CATALOGUE: dict[str, MCPServer] = {
    "notion": MCPServer(app="notion", label="Notion",
                        url=os.getenv("MCP_NOTION_URL", ""),
                        permission=P_READ_CONTENT),
    "slack": MCPServer(app="slack", label="Slack",
                       url=os.getenv("MCP_SLACK_URL", ""),
                       permission=P_WRITE_SOCIAL),
    "github": MCPServer(app="github", label="GitHub",
                        url=os.getenv("MCP_GITHUB_URL", ""),
                        permission=P_READ_CONTENT),
    "google-drive": MCPServer(app="google-drive", label="Google Drive",
                              url=os.getenv("MCP_GDRIVE_URL", ""),
                              permission=P_READ_CONTENT),
    "canva": MCPServer(app="canva", label="Canva",
                       url=os.getenv("MCP_CANVA_URL", ""),
                       permission=P_PUBLISH_EXTERNAL),
    "linkedin": MCPServer(app="linkedin", label="LinkedIn",
                          url=os.getenv("MCP_LINKEDIN_URL", ""),
                          permission=P_PUBLISH_EXTERNAL),
    "email": MCPServer(app="email", label="Email",
                       url=os.getenv("MCP_EMAIL_URL", ""),
                       permission=P_SEND_EMAIL),
}


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
