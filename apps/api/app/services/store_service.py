"""Cross-platform store operations (Shopify + WooCommerce).

Products from every connected store live in the shared StoreProduct table
(distinguished by `source`). This module fans sync out to each connected
platform, lists the merged catalog, and dispatches copy publish-back to the
right platform. Copy *generation* is platform-agnostic and reused as-is.
"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.store_product import StoreProduct
from app.services import shopify_service, woocommerce_service
from app.services.shopify_service import generate_copy  # platform-agnostic; re-exported

__all__ = ["generate_copy", "list_products", "sync_all", "publish_copy"]


async def list_products(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> list[StoreProduct]:
    """Every synced product across all connected stores, for this project."""
    result = await db.execute(
        select(StoreProduct)
        .where(StoreProduct.project_id == project_id, StoreProduct.org_id == org_id)
        .order_by(StoreProduct.title)
    )
    return list(result.scalars().all())


async def sync_all(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> dict:
    """Sync every connected store; aggregate the counts."""
    results: dict[str, dict] = {}
    total = 0

    sh = await shopify_service.get_connection(project_id, org_id, db)
    if sh and sh.is_active:
        r = await shopify_service.sync_products(project_id, org_id, db)
        results["shopify"] = r
        total += r.get("synced", 0)

    wc = await woocommerce_service.get_connection(project_id, org_id, db)
    if wc and wc.is_active:
        r = await woocommerce_service.sync_products(project_id, org_id, db)
        results["woocommerce"] = r
        total += r.get("synced", 0)

    if not results:
        return {"ok": False, "error": "not_connected", "synced": 0}
    return {"ok": any(v.get("ok") for v in results.values()), "synced": total, "sources": results}


async def publish_copy(
    product_id: uuid.UUID,
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    title: str,
    description_html: str,
    db: AsyncSession,
) -> dict:
    """Publish edited copy back to whichever store the product came from."""
    product = (await db.execute(
        select(StoreProduct).where(
            StoreProduct.id == product_id,
            StoreProduct.project_id == project_id,
            StoreProduct.org_id == org_id,
        )
    )).scalar_one_or_none()
    if product is None:
        return {"ok": False, "error": "not_found"}
    if product.source == "woocommerce":
        return await woocommerce_service.publish_copy(project_id, org_id, product, title, description_html, db)
    return await shopify_service.publish_copy(product_id, project_id, org_id, title, description_html, db)
