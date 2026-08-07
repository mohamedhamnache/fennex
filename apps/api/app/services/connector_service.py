"""Connecting tools to the AI employees.

A connector is an MCP server an organisation has connected. Connecting one makes
it *available*; it does not grant access. An employee still reaches a connector
only if it declared the app in `connected_apps` and the run holds the
permission the server needs -- the same two gates as a native tool.

Credentials are encrypted with the same helper as LLM keys and are never
returned to the client.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select

from app.core.security import decrypt_value, encrypt_value
from app.employees import registry
from app.employees.runtime import mcp as mcp_layer
from app.models.connector import Connector

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def list_connectors(org_id: uuid.UUID, db) -> list[Connector]:
    rows = (await db.execute(
        select(Connector).where(Connector.org_id == org_id)
    )).scalars().all()
    return list(rows)


async def get_connector(org_id: uuid.UUID, app: str, db) -> Optional[Connector]:
    return (await db.execute(
        select(Connector).where(Connector.org_id == org_id, Connector.app == app)
    )).scalars().first()


def _oauth_available() -> set:
    from app.services import connector_oauth
    return set(connector_oauth.available())


async def catalogue(org_id: uuid.UUID, db) -> list[dict]:
    """Every connectable tool, its state, and who would gain from it.

    Naming the employees is the point: a connector is abstract until you can
    see that connecting LinkedIn is what gives the Creative Director reach.
    """
    connected = {c.app: c for c in await list_connectors(org_id, db)}
    employees = registry.all_employees()

    out = []
    for app, server in sorted(mcp_layer.CATALOGUE.items()):
        row = connected.get(app)
        gains = [
            {"id": e.id, "name": e.name, "role": e.role, "icon": e.icon,
             "department": e.department}
            for e in employees if app in e.connected_apps
        ]
        out.append({
            "app": app,
            "label": server.label,
            # Category and description come from the catalogue rather than a
            # second table in the UI: one source, so a connector added to the
            # roster cannot appear ungrouped or unexplained.
            "category": server.category,
            "description": server.description,
            # Names the metered native tool when one already reaches this app.
            # MCP would otherwise be a second, unmetered route to the same paid
            # API, and the UI must say which path is live.
            "nativeTool": server.native_tool,
            # One-click is only offered when the provider's client credentials
            # are actually configured. A Connect button that dead-ends after
            # the redirect is worse than none.
            "oauth": app in _oauth_available(),
            "permission": server.permission,
            "transport": server.transport,
            # An env-configured server stays supported so existing deployments
            # keep working; the UI shows it as managed elsewhere.
            "fromEnvironment": bool(server.url) and row is None,
            "connected": bool(row and row.enabled and row.url),
            "enabled": bool(row.enabled) if row else False,
            "url": row.url if row else (server.url or ""),
            "hasToken": bool(row and row.encrypted_token),
            "lastStatus": row.last_status if row else None,
            "lastError": row.last_error if row else None,
            "lastCheckedAt": row.last_checked_at if row else None,
            "toolCount": row.tool_count if row else None,
            "usedBy": gains,
        })
    return out


async def connect(org_id: uuid.UUID, app: str, url: str, token: Optional[str],
                  db) -> Connector:
    """Connect or update a connector. Re-connecting without a token keeps the
    stored one, so a user can change the URL without re-entering a secret."""
    if app not in mcp_layer.CATALOGUE:
        raise ValueError(f"Unknown connector: {app}")
    url = (url or "").strip()
    if not url.startswith(("http://", "https://")):
        raise ValueError("The server URL must start with http:// or https://")

    row = await get_connector(org_id, app, db)
    if row is None:
        row = Connector(org_id=org_id, app=app)
        db.add(row)
    row.url = url
    if token:
        row.encrypted_token = encrypt_value(token.strip())
    row.enabled = True
    row.last_status = None
    row.last_error = None
    await db.commit()
    await db.refresh(row)
    return row


async def save_oauth_token(org_id: uuid.UUID, app: str, token: str, db,
                           label: Optional[str] = None) -> Connector:
    """Store a token obtained through the OAuth flow.

    Separate from connect() on purpose: connect() requires a server URL because
    a hand-configured MCP server has one, while an OAuth connector is
    identified by its provider and the URL comes from the catalogue. Forcing a
    URL here would mean inventing one.
    """
    if app not in mcp_layer.CATALOGUE:
        raise ValueError(f"Unknown connector: {app}")
    row = await get_connector(org_id, app, db)
    if row is None:
        row = Connector(org_id=org_id, app=app)
        db.add(row)
    row.encrypted_token = encrypt_value(token.strip())
    row.url = row.url or (mcp_layer.CATALOGUE[app].url or "")
    row.enabled = True
    row.last_status = "ok"
    row.last_error = None
    await db.commit()
    await db.refresh(row)
    logger.info("connected %s for org %s via oauth%s", app, org_id,
                f" ({label})" if label else "")
    return row


async def disconnect(org_id: uuid.UUID, app: str, db) -> bool:
    row = await get_connector(org_id, app, db)
    if row is None:
        return False
    await db.delete(row)
    await db.commit()
    return True


async def set_enabled(org_id: uuid.UUID, app: str, enabled: bool, db) -> Optional[Connector]:
    """Pause a connector without losing its credentials."""
    row = await get_connector(org_id, app, db)
    if row is None:
        return None
    row.enabled = enabled
    await db.commit()
    await db.refresh(row)
    return row


async def test(org_id: uuid.UUID, app: str, db) -> dict:
    """Open the server and list its tools, so a bad URL is caught here rather
    than mid-conversation."""
    row = await get_connector(org_id, app, db)
    if row is None or not row.url:
        return {"ok": False, "error": "Not connected."}

    server = mcp_layer.CATALOGUE.get(app)
    if server is None:
        return {"ok": False, "error": f"Unknown connector: {app}"}

    resolved = mcp_layer.MCPServer(
        app=app, label=server.label, url=row.url,
        permission=server.permission, headers=_headers(row))

    try:
        from strands.tools.mcp import MCPClient

        client = MCPClient(mcp_layer._transport(resolved),
                           prefix=app.replace("-", "_"), continue_on_error=True)
        with client:
            tools = client.list_tools_sync()
        row.last_status, row.last_error = "ok", None
        row.tool_count = str(len(tools))
        names = [getattr(t, "tool_name", None) or getattr(t, "name", "?") for t in tools]
    except Exception as exc:   # noqa: BLE001
        logger.warning("connector test failed for %s", app, exc_info=True)
        row.last_status, row.last_error = "error", str(exc)[:400]
        row.tool_count = None
        names = []
    row.last_checked_at = _now()
    await db.commit()

    return {"ok": row.last_status == "ok", "error": row.last_error,
            "toolCount": int(row.tool_count) if row.tool_count else 0,
            "tools": names[:25]}


def _headers(row: Connector) -> dict:
    if not row.encrypted_token:
        return {}
    try:
        return {"Authorization": f"Bearer {decrypt_value(row.encrypted_token)}"}
    except Exception:
        logger.warning("could not decrypt connector token for %s", row.app)
        return {}


async def resolved_servers(org_id: uuid.UUID, db) -> dict[str, "mcp_layer.MCPServer"]:
    """The org's connectors as runtime servers, keyed by app.

    This is what the runtime consumes, so a connector added in the UI is live
    on the next turn without a redeploy.
    """
    out: dict[str, mcp_layer.MCPServer] = {}
    try:
        rows = await list_connectors(org_id, db)
    except Exception:
        logger.exception("could not load connectors for org %s", org_id)
        return out

    for row in rows:
        base = mcp_layer.CATALOGUE.get(row.app)
        if base is None or not row.enabled or not row.url:
            continue
        out[row.app] = mcp_layer.MCPServer(
            app=row.app, label=base.label, url=row.url,
            permission=base.permission, headers=_headers(row))
    return out
