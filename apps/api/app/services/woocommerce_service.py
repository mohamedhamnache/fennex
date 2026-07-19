"""WooCommerce store connection: connect, verify, status, disconnect, sync, publish.

WooCommerce authenticates with a REST API Consumer Key + Consumer Secret used
as HTTP Basic auth over HTTPS against {store_url}/wp-json/wc/v3/. Products are
mirrored into the shared StoreProduct table (source="woocommerce") so the
product studio and copy tools work across stores. Secrets are encrypted at rest.
"""
import logging
import re
import uuid
from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import encrypt_value, decrypt_value
from app.models.woocommerce import WooConnection
from app.models.store_product import StoreProduct

logger = logging.getLogger(__name__)

WC_API_BASE = "/wp-json/wc/v3"

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _strip_html(html: str | None) -> str:
    if not html:
        return ""
    return _WS_RE.sub(" ", _TAG_RE.sub(" ", html)).strip()


def _normalize_url(raw: str) -> str:
    """Normalize a store URL to 'https://host[/path]' with no trailing slash."""
    u = (raw or "").strip()
    if not u:
        return ""
    if not re.match(r"^https?://", u):
        u = f"https://{u}"
    u = re.sub(r"^http://", "https://", u)  # WooCommerce REST keys require HTTPS
    return u.rstrip("/")


async def _wc_get(store_url: str, ck: str, cs: str, path: str, params: dict | None = None) -> httpx.Response:
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        return await client.get(f"{store_url}{WC_API_BASE}{path}", params=params or {}, auth=(ck, cs))


async def get_connection(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> WooConnection | None:
    result = await db.execute(
        select(WooConnection).where(
            WooConnection.project_id == project_id,
            WooConnection.org_id == org_id,
        )
    )
    return result.scalar_one_or_none()


async def get_status(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> dict:
    conn = await get_connection(project_id, org_id, db)
    if not conn or not conn.is_active:
        return {"connected": False, "store_url": None, "shop_name": None, "last_tested_at": None}
    return {
        "connected": True,
        "store_url": conn.store_url,
        "shop_name": conn.shop_name,
        "last_tested_at": conn.last_tested_at,
    }


async def connect(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    store_url: str,
    consumer_key: str,
    consumer_secret: str,
    db: AsyncSession,
) -> dict:
    """Validate the REST keys against the store and upsert the connection."""
    url = _normalize_url(store_url)
    ck = (consumer_key or "").strip()
    cs = (consumer_secret or "").strip()
    if not url:
        return {"ok": False, "error": "invalid_url"}
    if not ck or not cs:
        return {"ok": False, "error": "missing_credentials"}

    try:
        resp = await _wc_get(url, ck, cs, "/products", {"per_page": 1})
    except Exception as e:  # noqa: BLE001
        logger.warning("WooCommerce connect error for %s: %s", url, e)
        return {"ok": False, "error": "unreachable", "detail": str(e)}
    if resp.status_code in (401, 403):
        return {"ok": False, "error": "unauthorized"}
    if resp.status_code == 404:
        return {"ok": False, "error": "not_woocommerce", "detail": "wc/v3 API not found at this URL"}
    if resp.status_code >= 400:
        return {"ok": False, "error": f"http_{resp.status_code}", "detail": resp.text[:400]}

    now = datetime.now(timezone.utc).isoformat()
    conn = await get_connection(project_id, org_id, db)
    if conn is None:
        conn = WooConnection(org_id=org_id, project_id=project_id)
        db.add(conn)
    conn.store_url = url
    conn.consumer_key = ck
    conn.consumer_secret_encrypted = encrypt_value(cs)
    conn.shop_name = re.sub(r"^https?://", "", url).split("/")[0]
    conn.is_active = True
    conn.last_tested_at = now
    conn.last_test_ok = True
    await db.commit()
    return {"ok": True, "store_url": url, "shop_name": conn.shop_name}


async def disconnect(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> None:
    conn = await get_connection(project_id, org_id, db)
    if conn is not None:
        await db.delete(conn)
        await db.commit()


async def get_credentials(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> tuple[str, str, str] | None:
    """Return (store_url, consumer_key, consumer_secret) for an active connection, or None."""
    conn = await get_connection(project_id, org_id, db)
    if not conn or not conn.is_active:
        return None
    return conn.store_url, conn.consumer_key, decrypt_value(conn.consumer_secret_encrypted)


def _parse_product(p: dict) -> dict:
    images = p.get("images") or []
    image = images[0].get("src") if images else None
    body = p.get("description") or p.get("short_description") or ""
    return {
        "external_id": str(p.get("id", "")),
        "title": (p.get("name") or "").strip()[:500] or "Untitled product",
        "handle": (p.get("slug") or None),
        "description": _strip_html(body)[:4000] or None,
        "image_url": image,
        "price": (str(p.get("price")) if p.get("price") not in (None, "") else None),
        "status": p.get("status"),
    }


async def sync_products(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession, limit: int = 100) -> dict:
    """Pull the store's products via the REST API and upsert them locally."""
    creds = await get_credentials(project_id, org_id, db)
    if not creds:
        return {"ok": False, "error": "not_connected", "synced": 0}
    url, ck, cs = creds
    try:
        resp = await _wc_get(url, ck, cs, "/products", {"per_page": max(1, min(limit, 100))})
        resp.raise_for_status()
        products = resp.json()
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
                StoreProduct.source == "woocommerce",
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
            row = StoreProduct(org_id=org_id, project_id=project_id, source="woocommerce", external_id=fields["external_id"])
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


async def publish_copy(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    product: StoreProduct,
    title: str,
    description_html: str,
    db: AsyncSession,
) -> dict:
    """Push edited copy back to the WooCommerce product (name + description)."""
    creds = await get_credentials(project_id, org_id, db)
    if not creds:
        return {"ok": False, "error": "not_connected"}
    url, ck, cs = creds
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.put(
                f"{url}{WC_API_BASE}/products/{product.external_id}",
                json={"name": title.strip(), "description": description_html},
                auth=(ck, cs),
            )
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        code = e.response.status_code
        return {"ok": False, "error": "unauthorized" if code in (401, 403) else f"http_{code}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}

    product.title = title.strip()[:500]
    product.description = _strip_html(description_html)[:4000] or None
    await db.commit()
    return {"ok": True}
