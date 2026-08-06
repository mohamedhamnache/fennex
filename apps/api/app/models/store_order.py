import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, Numeric, DateTime, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class StoreOrder(Base, TimestampMixin):
    """An order synced from a connected store, kept for revenue attribution.

    This is what turns "the article gained 400 clicks" into "the article earned
    2,300" -- the join every other number in analytics is missing. Mirrors
    StoreProduct's shape: keyed by (project_id, external_id) so a sync upserts
    rather than duplicates, and re-running one is safe.

    Deliberately NOT a full order record. It carries what attribution needs and
    nothing else: no line items, no customer, no address. Storing a merchant's
    customer data to answer "which article earned this" would be collecting
    personal information the feature does not use.
    """
    __tablename__ = "store_orders"
    __table_args__ = (
        UniqueConstraint("project_id", "external_id", name="uq_store_order_external"),
        # Every analytics read is "this project, this date range".
        Index("ix_store_order_project_date", "project_id", "ordered_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    source: Mapped[str] = mapped_column(String(30), default="shopify")
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)

    # Money as NUMERIC, never float. A rounding drift in a revenue figure is a
    # number the customer will reconcile against their own dashboard and lose
    # confidence over.
    total_price: Mapped[float | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str | None] = mapped_column(String(10))
    ordered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # ── attribution, straight from Shopify ────────────────────────────────
    # The first page of the session that led to the order, and the external
    # referrer. Confirmed present on the Admin API Order resource (2024-01).
    landing_site: Mapped[str | None] = mapped_column(String(2000))
    referring_site: Mapped[str | None] = mapped_column(String(2000))
    # "web", "instagram", "pos"... A point-of-sale order has no landing page and
    # must never be attributed to content.
    source_name: Mapped[str | None] = mapped_column(String(60))

    # ── the join we derive ────────────────────────────────────────────────
    # Set when landing_site matches a piece of content. Nullable because most
    # orders will not match, and an unmatched order is a normal outcome rather
    # than a failure -- it means the sale did not start on a page we wrote.
    attributed_article_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("articles.id", ondelete="SET NULL"), nullable=True)
    # The normalised path the match was made on, kept so a wrong attribution can
    # be explained rather than merely disbelieved.
    attributed_path: Mapped[str | None] = mapped_column(String(1000))
