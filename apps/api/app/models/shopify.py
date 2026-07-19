import uuid
from sqlalchemy import String, ForeignKey, Text, Boolean, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import TimestampMixin


class ShopifyConnection(Base, TimestampMixin):
    """A project's connection to a Shopify store.

    Shopify deprecated permanent Admin API tokens (shpat_) for admin-created
    custom apps on 2026-01-01. New Dev Dashboard apps use the client-credentials
    grant: we store the app's Client ID + Client Secret and exchange them for a
    short-lived (~24h) access token on demand, caching it until it nears expiry.

    A directly-supplied Admin API token (legacy admin custom apps that still
    have one) is also supported: it is stored as access_token with no client
    credentials and never refreshed.

    Secrets and tokens are encrypted at rest with the app's Fernet key.
    """
    __tablename__ = "shopify_connections"
    __table_args__ = (UniqueConstraint("project_id", name="uq_shopify_connection_project"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    shop_domain: Mapped[str] = mapped_column(String(255), nullable=False)   # e.g. myshop.myshopify.com
    # Client-credentials app (new 2026 model)
    client_id: Mapped[str | None] = mapped_column(String(255))
    client_secret_encrypted: Mapped[str | None] = mapped_column(Text)
    # Cached access token (from exchange, or a legacy pasted token)
    access_token_encrypted: Mapped[str | None] = mapped_column(Text)
    token_expires_at: Mapped[str | None] = mapped_column(String(50))        # ISO; null = never expires (legacy)
    shop_name: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_tested_at: Mapped[str | None] = mapped_column(String(50))
    last_test_ok: Mapped[bool | None] = mapped_column(Boolean)
