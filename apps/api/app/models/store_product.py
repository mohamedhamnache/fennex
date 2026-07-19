import uuid
from sqlalchemy import String, ForeignKey, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import TimestampMixin


class StoreProduct(Base, TimestampMixin):
    """A product synced from a connected store (currently Shopify).

    Mirrors the store's catalog so the e-commerce persona can generate shots
    and copy against real SKUs. Refreshed by re-running a sync; rows are keyed
    by (project_id, external_id) so a sync upserts rather than duplicates.
    """
    __tablename__ = "store_products"
    __table_args__ = (UniqueConstraint("project_id", "external_id", name="uq_store_product_external"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    source: Mapped[str] = mapped_column(String(30), default="shopify")     # store platform
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)   # Shopify product id
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    handle: Mapped[str | None] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)                  # plain-text, from body_html
    image_url: Mapped[str | None] = mapped_column(String(1000))           # featured image
    price: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str | None] = mapped_column(String(30))                # active | draft | archived
    synced_at: Mapped[str | None] = mapped_column(String(50))
