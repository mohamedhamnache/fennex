"""Shopify store connection: connect, verify, status, disconnect.

Shopify deprecated permanent admin custom-app tokens on 2026-01-01. New Dev
Dashboard apps use the client-credentials grant: the merchant supplies the
app's Client ID + Client Secret (same Shopify org as the store, app installed),
and we exchange them at /admin/oauth/access_token for a short-lived (~24h)
access token, caching it and re-minting before it expires. A directly-supplied
legacy Admin API token is still accepted and used as-is (never refreshed).
All secrets and tokens are encrypted at rest.
"""
import hashlib
import hmac
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from app.agents.registry import agent_persona
from app.core.config import settings
from app.core.security import encrypt_value, decrypt_value
from app.models.shopify import ShopifyConnection
from app.models.store_product import StoreProduct
from app.services.llm_service import call_llm, get_org_llm_keys, project_locale

SHOPIFY_API_VERSION = "2024-01"
# Re-mint the token once it's within this window of expiry.
_TOKEN_REFRESH_MARGIN = timedelta(minutes=60)

# Preference order for the copywriter (Dune). Cheap models suffice for a product blurb.
_COPY_PROVIDERS = [("anthropic", "claude-haiku-4-5-20251001"), ("openai", "gpt-4o-mini")]

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _strip_html(html: str | None) -> str:
    if not html:
        return ""
    return _WS_RE.sub(" ", _TAG_RE.sub(" ", html)).strip()


def _normalize_domain(raw: str) -> str:
    """Resolve a store's *.myshopify.com admin domain from user input.

    Accepts a bare handle ('myshop'), the full admin domain
    ('myshop.myshopify.com'), or a URL to either. A custom storefront domain
    (e.g. 'www.example.com') cannot be mapped to the myshopify.com admin domain
    programmatically, so it is rejected (returns '') — OAuth and the Admin API
    only work on the *.myshopify.com domain.
    """
    d = (raw or "").strip().lower()
    d = re.sub(r"^https?://", "", d)
    d = d.split("/")[0].strip()
    d = re.sub(r"^www\.", "", d)
    if not d:
        return ""
    if d.endswith(".myshopify.com"):
        return d
    if "." not in d:  # bare store handle
        return f"{d}.myshopify.com"
    return ""  # a custom domain we can't resolve — caller reports invalid_domain


async def _fetch_shop(domain: str, token: str) -> dict:
    """Call Admin API GET /shop.json to validate the token and read shop metadata."""
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            f"https://{domain}/admin/api/{SHOPIFY_API_VERSION}/shop.json",
            headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"},
        )
    resp.raise_for_status()
    return resp.json().get("shop", {})


async def _exchange_token(domain: str, client_id: str, client_secret: str) -> tuple[str, int]:
    """Client-credentials grant → (access_token, expires_in seconds). Raises on failure."""
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            f"https://{domain}/admin/oauth/access_token",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
            },
        )
    resp.raise_for_status()
    body = resp.json()
    return body["access_token"], int(body.get("expires_in", 86399))


def _needs_refresh(expires_at: str | None) -> bool:
    """A client-credentials token nearing expiry needs a refresh. A legacy token
    (no expiry recorded) never does."""
    if not expires_at:
        return False
    try:
        exp = datetime.fromisoformat(expires_at)
    except ValueError:
        return True
    return datetime.now(timezone.utc) >= exp - _TOKEN_REFRESH_MARGIN


async def _ensure_token(conn: ShopifyConnection, db: AsyncSession) -> str | None:
    """Return a currently-valid access token, re-minting via client credentials
    when the cached one is missing or about to expire."""
    has_client_creds = bool(conn.client_id and conn.client_secret_encrypted)
    if has_client_creds and (not conn.access_token_encrypted or _needs_refresh(conn.token_expires_at)):
        secret = decrypt_value(conn.client_secret_encrypted)
        try:
            token, expires_in = await _exchange_token(conn.shop_domain, conn.client_id, secret)
        except Exception:  # noqa: BLE001 — fall back to any cached token
            return decrypt_value(conn.access_token_encrypted) if conn.access_token_encrypted else None
        conn.access_token_encrypted = encrypt_value(token)
        conn.token_expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()
        await db.commit()
        return token
    return decrypt_value(conn.access_token_encrypted) if conn.access_token_encrypted else None


async def get_connection(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> ShopifyConnection | None:
    result = await db.execute(
        select(ShopifyConnection).where(
            ShopifyConnection.project_id == project_id,
            ShopifyConnection.org_id == org_id,
        )
    )
    return result.scalar_one_or_none()


async def get_status(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> dict:
    conn = await get_connection(project_id, org_id, db)
    if not conn or not conn.is_active:
        return {"connected": False, "shop_domain": None, "shop_name": None,
                "last_tested_at": None, "oauth_available": oauth_configured()}
    return {
        "connected": True,
        "shop_domain": conn.shop_domain,
        "shop_name": conn.shop_name,
        "last_tested_at": conn.last_tested_at,
        "oauth_available": oauth_configured(),
    }


async def connect(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    shop_domain: str,
    db: AsyncSession,
    *,
    client_id: str | None = None,
    client_secret: str | None = None,
    access_token: str | None = None,
) -> dict:
    """Establish a connection. Prefers the client-credentials app (Client ID +
    Secret); accepts a legacy Admin API token as a fallback. Validates against
    the store and upserts, storing secrets encrypted."""
    domain = _normalize_domain(shop_domain)
    if not domain:
        return {"ok": False, "error": "invalid_domain"}

    cid = (client_id or "").strip()
    csecret = (client_secret or "").strip()
    token = (access_token or "").strip()
    expires_at: str | None = None
    using_client_creds = bool(cid and csecret)

    if using_client_creds:
        # The exchange itself proves the credentials + org/install are valid.
        try:
            token, expires_in = await _exchange_token(domain, cid, csecret)
        except httpx.HTTPStatusError as e:
            body = e.response.text[:500]
            code = e.response.status_code
            logger.warning("Shopify token exchange failed for %s: HTTP %s %s", domain, code, body)
            return {"ok": False, "error": "unauthorized" if code in (400, 401, 403) else f"http_{code}", "detail": body}
        except Exception as e:  # noqa: BLE001
            logger.warning("Shopify token exchange error for %s: %s", domain, e, exc_info=True)
            return {"ok": False, "error": "exchange_failed", "detail": str(e)}
        expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()
    elif not token:
        return {"ok": False, "error": "missing_credentials"}

    # Read the shop name (best-effort). For a legacy token this also validates it;
    # for client creds the exchange already validated, so a scope 403 is tolerated.
    shop: dict = {}
    try:
        shop = await _fetch_shop(domain, token)
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403) and not using_client_creds:
            return {"ok": False, "error": "unauthorized"}
    except Exception as e:  # noqa: BLE001
        if not using_client_creds:
            return {"ok": False, "error": str(e)}

    now = datetime.now(timezone.utc).isoformat()
    conn = await get_connection(project_id, org_id, db)
    if conn is None:
        conn = ShopifyConnection(org_id=org_id, project_id=project_id)
        db.add(conn)
    conn.shop_domain = domain
    conn.client_id = cid or None
    conn.client_secret_encrypted = encrypt_value(csecret) if csecret else None
    conn.access_token_encrypted = encrypt_value(token)
    conn.token_expires_at = expires_at
    conn.shop_name = shop.get("name") or domain
    conn.is_active = True
    conn.last_tested_at = now
    conn.last_test_ok = True
    await db.commit()
    return {"ok": True, "shop_domain": domain, "shop_name": conn.shop_name}


# ── OAuth "Connect with Shopify" (single Fennex-owned app) ───────────────────

def oauth_configured() -> bool:
    return bool(settings.SHOPIFY_APP_CLIENT_ID and settings.SHOPIFY_APP_CLIENT_SECRET)


def build_authorize_url(shop: str, state: str) -> str:
    """The Shopify install/authorize URL the merchant is redirected to."""
    return (
        f"https://{shop}/admin/oauth/authorize"
        f"?client_id={settings.SHOPIFY_APP_CLIENT_ID}"
        f"&scope={quote(settings.SHOPIFY_APP_SCOPES)}"
        f"&redirect_uri={quote(settings.SHOPIFY_REDIRECT_URI, safe='')}"
        f"&state={quote(state)}"
    )


def verify_oauth_hmac(params: dict) -> bool:
    """Verify the HMAC Shopify appends to the callback, per the OAuth spec:
    drop hmac/signature, sort the rest, join as key=value with '&', HMAC-SHA256."""
    provided = params.get("hmac", "")
    if not provided:
        return False
    message = "&".join(
        f"{k}={v}" for k, v in sorted(params.items()) if k not in ("hmac", "signature")
    )
    digest = hmac.new(
        settings.SHOPIFY_APP_CLIENT_SECRET.encode(), message.encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(digest, provided)


async def exchange_oauth_code(shop: str, code: str) -> str:
    """Authorization-code grant → a permanent offline access token."""
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            f"https://{shop}/admin/oauth/access_token",
            json={
                "client_id": settings.SHOPIFY_APP_CLIENT_ID,
                "client_secret": settings.SHOPIFY_APP_CLIENT_SECRET,
                "code": code,
            },
        )
    resp.raise_for_status()
    return resp.json()["access_token"]


async def store_oauth_connection(
    project_id: uuid.UUID, org_id: uuid.UUID, shop: str, access_token: str, db: AsyncSession
) -> None:
    """Persist an OAuth (offline-token) connection — no client creds, never expires."""
    shop_name = shop
    try:
        info = await _fetch_shop(shop, access_token)
        shop_name = info.get("name") or shop
    except Exception:  # noqa: BLE001 — name is best-effort
        pass
    now = datetime.now(timezone.utc).isoformat()
    conn = await get_connection(project_id, org_id, db)
    if conn is None:
        conn = ShopifyConnection(org_id=org_id, project_id=project_id)
        db.add(conn)
    conn.shop_domain = shop
    conn.client_id = None
    conn.client_secret_encrypted = None
    conn.access_token_encrypted = encrypt_value(access_token)
    conn.token_expires_at = None  # offline token: permanent
    conn.shop_name = shop_name
    conn.is_active = True
    conn.last_tested_at = now
    conn.last_test_ok = True
    await db.commit()


async def disconnect(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> None:
    conn = await get_connection(project_id, org_id, db)
    if conn is not None:
        await db.delete(conn)
        await db.commit()


async def get_credentials(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> tuple[str, str] | None:
    """Return (shop_domain, valid_access_token) for an active connection, refreshing
    the token via client credentials when needed, or None."""
    conn = await get_connection(project_id, org_id, db)
    if not conn or not conn.is_active:
        return None
    token = await _ensure_token(conn, db)
    if not token:
        return None
    return conn.shop_domain, token


def _parse_product(p: dict) -> dict:
    """Map a Shopify Admin API product object to StoreProduct fields."""
    images = p.get("images") or []
    image = p.get("image") or (images[0] if images else None)
    variants = p.get("variants") or []
    price = variants[0].get("price") if variants else None
    return {
        "external_id": str(p.get("id", "")),
        "title": (p.get("title") or "").strip()[:500] or "Untitled product",
        "handle": (p.get("handle") or None),
        "description": _strip_html(p.get("body_html"))[:4000] or None,
        "image_url": (image.get("src") if image else None),
        "price": (str(price) if price is not None else None),
        "status": p.get("status"),
    }


async def sync_products(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession, limit: int = 250) -> dict:
    """Pull the store's products via the Admin API and upsert them locally."""
    creds = await get_credentials(project_id, org_id, db)
    if not creds:
        return {"ok": False, "error": "not_connected", "synced": 0}
    domain, token = creds
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"https://{domain}/admin/api/{SHOPIFY_API_VERSION}/products.json",
                params={"limit": max(1, min(limit, 250))},
                headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"},
            )
        resp.raise_for_status()
        products = resp.json().get("products", [])
    except httpx.HTTPStatusError as e:
        code = e.response.status_code
        return {"ok": False, "error": "unauthorized" if code in (401, 403) else f"http_{code}", "synced": 0}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e), "synced": 0}

    existing = {
        r.external_id: r
        for r in (await db.execute(
            select(StoreProduct).where(
                StoreProduct.project_id == project_id,
                StoreProduct.org_id == org_id,
            )
        )).scalars().all()
    }
    now = datetime.now(timezone.utc).isoformat()
    synced = 0
    for p in products:
        fields = _parse_product(p)
        if not fields["external_id"]:
            continue
        row = existing.get(fields["external_id"])
        if row is None:
            row = StoreProduct(org_id=org_id, project_id=project_id, source="shopify", external_id=fields["external_id"])
            db.add(row)
        row.title = fields["title"]
        row.handle = fields["handle"]
        row.description = fields["description"]
        row.image_url = fields["image_url"]
        row.price = fields["price"]
        row.status = fields["status"]
        row.synced_at = now
        synced += 1
    await db.commit()
    return {"ok": True, "synced": synced}


async def list_products(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> list[StoreProduct]:
    result = await db.execute(
        select(StoreProduct)
        .where(StoreProduct.project_id == project_id, StoreProduct.org_id == org_id)
        .order_by(StoreProduct.title)
    )
    return list(result.scalars().all())


async def _get_product(product_id: uuid.UUID, project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> StoreProduct | None:
    result = await db.execute(
        select(StoreProduct).where(
            StoreProduct.id == product_id,
            StoreProduct.project_id == project_id,
            StoreProduct.org_id == org_id,
        )
    )
    return result.scalar_one_or_none()


_TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)
_DESC_RE = re.compile(r"<description>(.*?)</description>", re.S)
_META_RE = re.compile(r"<meta_description>(.*?)</meta_description>", re.S)


async def generate_copy(product_id: uuid.UUID, project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> dict:
    """Dune writes SEO product copy from the real product data."""
    product = await _get_product(product_id, project_id, org_id, db)
    if product is None:
        return {"ok": False, "error": "not_found"}
    keys = await get_org_llm_keys(org_id, db)
    pm = next(((p, m) for p, m in _COPY_PROVIDERS if p in keys), None)
    if pm is None:
        return {"ok": False, "error": "no_ai_key"}

    system = (
        agent_persona("dune") +
        " You write SEO-optimized ecommerce product copy that ranks and converts. "
        "Return EXACTLY this structure and nothing else:\n"
        "<title>refined, keyword-rich product title (<=70 chars)</title>\n"
        "<description>2-4 short HTML paragraphs (<p>...</p>) with benefits, features and a light call to action</description>\n"
        "<meta_description>a compelling meta description (<=155 chars)</meta_description>"
    )
    ctx = f"Product: {product.title}"
    if product.price:
        ctx += f"\nPrice: {product.price}"
    if product.description:
        ctx += f"\nCurrent description: {product.description[:1500]}"
    try:
        raw = await call_llm(pm[0], pm[1], keys[pm[0]], system, ctx, locale=await project_locale(project_id, db))
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}

    tm, dm, mm = _TITLE_RE.search(raw), _DESC_RE.search(raw), _META_RE.search(raw)
    return {
        "ok": True,
        "title": (tm.group(1).strip() if tm else product.title),
        "description_html": (dm.group(1).strip() if dm else raw.strip()),
        "meta_description": (mm.group(1).strip() if mm else ""),
    }


async def publish_copy(
    product_id: uuid.UUID,
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    title: str,
    description_html: str,
    db: AsyncSession,
) -> dict:
    """Push edited copy back to the Shopify product (title + body_html)."""
    product = await _get_product(product_id, project_id, org_id, db)
    if product is None:
        return {"ok": False, "error": "not_found"}
    creds = await get_credentials(project_id, org_id, db)
    if not creds:
        return {"ok": False, "error": "not_connected"}
    domain, token = creds

    payload = {"product": {"id": int(product.external_id), "title": title.strip(), "body_html": description_html}}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.put(
                f"https://{domain}/admin/api/{SHOPIFY_API_VERSION}/products/{product.external_id}.json",
                json=payload,
                headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"},
            )
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        code = e.response.status_code
        return {"ok": False, "error": "unauthorized" if code in (401, 403) else f"http_{code}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}

    # Reflect the change locally so the picker shows the new copy immediately.
    product.title = title.strip()[:500]
    product.description = _strip_html(description_html)[:4000] or None
    await db.commit()
    return {"ok": True}
