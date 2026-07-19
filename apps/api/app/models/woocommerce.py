import uuid
from sqlalchemy import String, ForeignKey, Text, Boolean, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import TimestampMixin


class WooConnection(Base, TimestampMixin):
    """A project's connection to a WooCommerce store via REST API keys.

    WooCommerce authenticates with a Consumer Key + Consumer Secret (generated
    in WP admin → WooCommerce → Settings → Advanced → REST API) used as HTTP
    Basic auth over HTTPS. Unlike Shopify, Woo runs on the site's own domain, so
    we store the full store URL. The secret is encrypted at rest.
    """
    __tablename__ = "woo_connections"
    __table_args__ = (UniqueConstraint("project_id", name="uq_woo_connection_project"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    store_url: Mapped[str] = mapped_column(String(500), nullable=False)     # e.g. https://shop.example.com
    consumer_key: Mapped[str] = mapped_column(String(255), nullable=False)
    consumer_secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    shop_name: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_tested_at: Mapped[str | None] = mapped_column(String(50))
    last_test_ok: Mapped[bool | None] = mapped_column(Boolean)
