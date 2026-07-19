import uuid
from sqlalchemy import String, ForeignKey, Text, Boolean, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import TimestampMixin


class ShopifyConnection(Base, TimestampMixin):
    """A project's connection to a Shopify store via a custom-app Admin API token.

    Uses the store admin's own custom-app access token (no Partner-app OAuth):
    the token and shop domain are all that's needed to call the Admin API. The
    token is encrypted at rest with the app's Fernet key.
    """
    __tablename__ = "shopify_connections"
    __table_args__ = (UniqueConstraint("project_id", name="uq_shopify_connection_project"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    shop_domain: Mapped[str] = mapped_column(String(255), nullable=False)   # e.g. myshop.myshopify.com
    access_token_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    shop_name: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_tested_at: Mapped[str | None] = mapped_column(String(50))
    last_test_ok: Mapped[bool | None] = mapped_column(Boolean)
