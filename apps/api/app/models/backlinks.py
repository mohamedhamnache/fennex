import uuid
from sqlalchemy import Boolean, Date, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import TimestampMixin


class BacklinkProfile(Base, TimestampMixin):
    __tablename__ = "backlink_profiles"
    __table_args__ = (UniqueConstraint("project_id", name="uq_backlink_profile_project"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    domain: Mapped[str | None] = mapped_column(String(255))
    total_backlinks: Mapped[int] = mapped_column(Integer, default=0)
    domain_authority: Mapped[float | None] = mapped_column(Float)
    trust_score: Mapped[float | None] = mapped_column(Float)
    spam_score: Mapped[float | None] = mapped_column(Float)
    referring_domains: Mapped[int] = mapped_column(Integer, default=0)
    last_synced_at: Mapped[str | None] = mapped_column(String(50))


class Backlink(Base, TimestampMixin):
    __tablename__ = "backlinks"
    __table_args__ = (UniqueConstraint("project_id", "source_url", name="uq_backlink_project_source"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("backlink_profiles.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    source_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    source_domain: Mapped[str | None] = mapped_column(String(255))
    target_url: Mapped[str | None] = mapped_column(String(2048))
    anchor_text: Mapped[str | None] = mapped_column(String(500))
    domain_authority: Mapped[float | None] = mapped_column(Float)
    trust_score: Mapped[float | None] = mapped_column(Float)
    spam_score: Mapped[float | None] = mapped_column(Float)
    is_spam: Mapped[bool] = mapped_column(Boolean, default=False)
    link_type: Mapped[str] = mapped_column(String(20), default="dofollow")
    first_seen: Mapped[str | None] = mapped_column(String(20))
    last_seen: Mapped[str | None] = mapped_column(String(20))


class BacklinkOpportunity(Base, TimestampMixin):
    __tablename__ = "backlink_opportunities"
    __table_args__ = (UniqueConstraint("project_id", "source_url", name="uq_opportunity_project_source"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    source_domain: Mapped[str | None] = mapped_column(String(255))
    source_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    domain_authority: Mapped[float | None] = mapped_column(Float)
    trust_score: Mapped[float | None] = mapped_column(Float)
    spam_score: Mapped[float | None] = mapped_column(Float)
    is_spam: Mapped[bool] = mapped_column(Boolean, default=False)
    linking_to_competitor: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20), default="new")


class ExchangeListing(Base, TimestampMixin):
    __tablename__ = "exchange_listings"
    __table_args__ = (UniqueConstraint("project_id", name="uq_exchange_listing_project"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    site_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    niche: Mapped[str | None] = mapped_column(String(100))
    language: Mapped[str | None] = mapped_column(String(10))
    domain_authority: Mapped[float | None] = mapped_column(Float)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class ExchangeRequest(Base, TimestampMixin):
    __tablename__ = "exchange_requests"
    __table_args__ = (UniqueConstraint("requester_project_id", "target_project_id", name="uq_exchange_request_pair"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    requester_project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    target_project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    requester_org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    target_org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    requester_url: Mapped[str | None] = mapped_column(String(2048))
    target_url: Mapped[str | None] = mapped_column(String(2048))
    requester_link_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    target_link_verified: Mapped[bool] = mapped_column(Boolean, default=False)


class ExchangeMessage(Base, TimestampMixin):
    __tablename__ = "exchange_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("exchange_requests.id", ondelete="CASCADE"), nullable=False)
    sender_org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
