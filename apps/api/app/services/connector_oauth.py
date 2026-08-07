"""One-click connection for MCP connectors.

The pattern already existed for Shopify and Search Console, written twice. This
generalises it so a new provider is a table entry rather than a second copy of
the same redirect dance:

    start()     -> the provider's consent URL, carrying a SIGNED state
    exchange()  -> code + state -> access token, stored encrypted per org

WHY THE STATE IS SIGNED. It carries the org and project the callback will write
to. Unsigned, anyone could hand a victim a callback URL naming THEIR org and
have the victim's authorisation stored against it -- the classic OAuth CSRF,
and here it would mean an attacker's Notion workspace connected to someone
else's Fennex. The signature is over the payload AND a nonce, with a short
expiry, so a captured state cannot be replayed later.

A provider with no client credentials configured is NOT offered. A Connect
button that dead-ends because nobody registered the app is the same broken
promise as a button that does nothing.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# A consent round trip is a person clicking a button; ten minutes is generous
# for that and short enough that a leaked state is worthless by the time it is
# found.
STATE_TTL_SECONDS = 600


@dataclass(frozen=True)
class OAuthProvider:
    app: str
    authorize_url: str
    token_url: str
    scopes: str = ""
    client_id: str = ""
    client_secret: str = ""
    # Some providers want the credentials as HTTP Basic rather than form body.
    basic_auth: bool = False
    # Extra params the provider requires on the authorize URL.
    extra_authorize: dict = field(default_factory=dict)

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret)


def _providers() -> dict[str, OAuthProvider]:
    """Read credentials at call time, not at import.

    Settings are patched in tests and can be set after import in a running
    process; a module-level snapshot would freeze "not configured" forever.
    """
    return {
        "notion": OAuthProvider(
            app="notion",
            authorize_url="https://api.notion.com/v1/oauth/authorize",
            token_url="https://api.notion.com/v1/oauth/token",
            client_id=getattr(settings, "NOTION_CLIENT_ID", "") or "",
            client_secret=getattr(settings, "NOTION_CLIENT_SECRET", "") or "",
            # Notion authenticates the token exchange with HTTP Basic and takes
            # no scope parameter -- access is chosen by the user in its own
            # picker, not by us.
            basic_auth=True,
            extra_authorize={"owner": "user"},
        ),
        "stripe": OAuthProvider(
            app="stripe",
            authorize_url="https://connect.stripe.com/oauth/authorize",
            token_url="https://connect.stripe.com/oauth/token",
            scopes="read_only",     # analytics only; never write to payments
            client_id=getattr(settings, "STRIPE_CONNECT_CLIENT_ID", "") or "",
            client_secret=getattr(settings, "STRIPE_SECRET_KEY", "") or "",
        ),
        "shopify": OAuthProvider(
            app="shopify",
            # Per-shop, so the URL is completed in start() from the shop domain.
            authorize_url="https://{shop}/admin/oauth/authorize",
            token_url="https://{shop}/admin/oauth/access_token",
            scopes=getattr(settings, "SHOPIFY_APP_SCOPES", "") or "read_products,read_orders",
            client_id=getattr(settings, "SHOPIFY_CLIENT_ID", "") or "",
            client_secret=getattr(settings, "SHOPIFY_CLIENT_SECRET", "") or "",
        ),
    }


def get(app: str) -> Optional[OAuthProvider]:
    return _providers().get(app)


def available() -> list[str]:
    """Apps a user can actually connect right now."""
    return sorted(a for a, p in _providers().items() if p.configured)


def redirect_uri(app: str) -> str:
    base = (getattr(settings, "API_URL", "") or "http://localhost:8000").rstrip("/")
    return f"{base}/api/v1/connectors/{app}/oauth/callback"


# --- state --------------------------------------------------------------------

def _sign(payload: bytes) -> str:
    mac = hmac.new(settings.SECRET_KEY.encode(), payload, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode().rstrip("=")


def make_state(org_id: uuid.UUID, project_id: uuid.UUID | None) -> str:
    body = json.dumps({
        "o": str(org_id),
        "p": str(project_id) if project_id else None,
        "n": uuid.uuid4().hex[:12],      # nonce: two states are never equal
        "t": int(time.time()),
    }, separators=(",", ":")).encode()
    return f"{base64.urlsafe_b64encode(body).decode().rstrip('=')}.{_sign(body)}"


def read_state(state: str) -> Optional[dict]:
    """Verify and decode, or None. Never trust the payload before the MAC."""
    try:
        encoded, _, signature = state.partition(".")
        if not encoded or not signature:
            return None
        padded = encoded + "=" * (-len(encoded) % 4)
        body = base64.urlsafe_b64decode(padded)
        # compare_digest, not ==: a timing-variable comparison on a MAC is how
        # a signature gets forged one byte at a time.
        if not hmac.compare_digest(_sign(body), signature):
            return None
        data = json.loads(body)
        if int(time.time()) - int(data.get("t", 0)) > STATE_TTL_SECONDS:
            return None
        return data
    except Exception:  # noqa: BLE001 - a malformed state is a rejected state
        return None


# --- the flow -----------------------------------------------------------------

def start(app: str, org_id: uuid.UUID, project_id: uuid.UUID | None = None,
          *, shop: str = "") -> dict:
    """The consent URL to send the user to."""
    provider = get(app)
    if provider is None:
        return {"ok": False, "error": "unknown_connector"}
    if not provider.configured:
        # Named explicitly so the UI can say "setup required" rather than
        # showing a button that fails after the redirect.
        return {"ok": False, "error": "not_configured"}

    authorize = provider.authorize_url
    if "{shop}" in authorize:
        if not shop:
            return {"ok": False, "error": "shop_required"}
        authorize = authorize.format(shop=shop)

    from urllib.parse import urlencode

    params = {
        "client_id": provider.client_id,
        "redirect_uri": redirect_uri(app),
        "response_type": "code",
        "state": make_state(org_id, project_id),
        **provider.extra_authorize,
    }
    if provider.scopes:
        params["scope"] = provider.scopes
    return {"ok": True, "redirect_url": f"{authorize}?{urlencode(params)}"}


async def exchange(app: str, code: str, *, shop: str = "") -> dict:
    """Trade the authorization code for an access token."""
    provider = get(app)
    if provider is None or not provider.configured:
        return {"ok": False, "error": "not_configured"}

    token_url = provider.token_url
    if "{shop}" in token_url:
        if not shop:
            return {"ok": False, "error": "shop_required"}
        token_url = token_url.format(shop=shop)

    data = {"grant_type": "authorization_code", "code": code,
            "redirect_uri": redirect_uri(app)}
    headers = {"Accept": "application/json"}
    auth = None
    if provider.basic_auth:
        auth = (provider.client_id, provider.client_secret)
    else:
        data["client_id"] = provider.client_id
        data["client_secret"] = provider.client_secret

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(token_url, data=data, headers=headers, auth=auth)
            resp.raise_for_status()
            payload = resp.json() or {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("oauth exchange failed for %s: %s", app, str(exc)[:200])
        return {"ok": False, "error": "exchange_failed"}

    token = payload.get("access_token") or payload.get("stripe_user_id")
    if not token:
        return {"ok": False, "error": "no_token"}
    return {"ok": True, "access_token": token,
            "refresh_token": payload.get("refresh_token"),
            "workspace": payload.get("workspace_name") or payload.get("stripe_user_id")}
