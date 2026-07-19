"""Shopify store connection: connect, verify, status, disconnect.

Uses a custom-app Admin API access token (no Partner-app OAuth). The store
admin creates a custom app in Shopify admin, grants the needed scopes, and
pastes the shop domain + Admin API access token. We verify the token against
the Admin API and persist it encrypted.
"""
import re
import uuid
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import encrypt_value, decrypt_value
from app.models.shopify import ShopifyConnection
from app.models.store_product import StoreProduct

SHOPIFY_API_VERSION = "2024-01"

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _strip_html(html: str | None) -> str:
    if not html:
        return ""
    return _WS_RE.sub(" ", _TAG_RE.sub(" ", html)).strip()


def _normalize_domain(raw: str) -> str:
    """Accept 'myshop', 'myshop.myshopify.com' or a full URL → 'myshop.myshopify.com'."""
    d = (raw or "").strip().lower()
    d = re.sub(r"^https?://", "", d)
    d = d.split("/")[0].strip()
    if not d:
        return ""
    if not d.endswith(".myshopify.com"):
        d = f"{d.split('.myshopify.com')[0]}.myshopify.com"
    return d


async def _fetch_shop(domain: str, token: str) -> dict:
    """Call Admin API GET /shop.json to validate the token and read shop metadata."""
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            f"https://{domain}/admin/api/{SHOPIFY_API_VERSION}/shop.json",
            headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"},
        )
    resp.raise_for_status()
    return resp.json().get("shop", {})


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
        return {"connected": False, "shop_domain": None, "shop_name": None, "last_tested_at": None}
    return {
        "connected": True,
        "shop_domain": conn.shop_domain,
        "shop_name": conn.shop_name,
        "last_tested_at": conn.last_tested_at,
    }


async def connect(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    shop_domain: str,
    access_token: str,
    db: AsyncSession,
) -> dict:
    """Validate credentials against the Admin API and upsert the connection."""
    domain = _normalize_domain(shop_domain)
    token = (access_token or "").strip()
    if not domain:
        return {"ok": False, "error": "invalid_domain"}
    if not token:
        return {"ok": False, "error": "missing_token"}

    try:
        shop = await _fetch_shop(domain, token)
    except httpx.HTTPStatusError as e:
        code = e.response.status_code
        return {"ok": False, "error": "unauthorized" if code in (401, 403) else f"http_{code}"}
    except Exception as e:  # noqa: BLE001 — surface a clean message to the client
        return {"ok": False, "error": str(e)}

    now = datetime.now(timezone.utc).isoformat()
    conn = await get_connection(project_id, org_id, db)
    if conn is None:
        conn = ShopifyConnection(org_id=org_id, project_id=project_id)
        db.add(conn)
    conn.shop_domain = domain
    conn.access_token_encrypted = encrypt_value(token)
    conn.shop_name = shop.get("name") or domain
    conn.is_active = True
    conn.last_tested_at = now
    conn.last_test_ok = True
    await db.commit()
    return {"ok": True, "shop_domain": domain, "shop_name": conn.shop_name}


async def disconnect(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> None:
    conn = await get_connection(project_id, org_id, db)
    if conn is not None:
        await db.delete(conn)
        await db.commit()


async def get_credentials(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> tuple[str, str] | None:
    """Return (shop_domain, access_token) for an active connection, decrypted, or None."""
    conn = await get_connection(project_id, org_id, db)
    if not conn or not conn.is_active:
        return None
    return conn.shop_domain, decrypt_value(conn.access_token_encrypted)


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
