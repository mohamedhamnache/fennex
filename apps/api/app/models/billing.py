import uuid
from datetime import date, datetime

from sqlalchemy import Date, String, Integer, BigInteger, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class OrgUsage(Base):
    __tablename__ = "org_usage"
    __table_args__ = (UniqueConstraint("org_id", "period_start"),)

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True
    )
    period_start: Mapped[date] = mapped_column(Date, primary_key=True)
    articles_used: Mapped[int] = mapped_column(Integer, default=0)
    images_used: Mapped[int] = mapped_column(Integer, default=0)
    social_used: Mapped[int] = mapped_column(Integer, default=0)
    keywords_used: Mapped[int] = mapped_column(Integer, default=0)
    audits_used: Mapped[int] = mapped_column(Integer, default=0)
    backlinks_used: Mapped[int] = mapped_column(Integer, default=0)
    ai_input_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    ai_output_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    ai_requests: Mapped[int] = mapped_column(BigInteger, default=0)
    seo_serp: Mapped[int] = mapped_column(BigInteger, default=0)
    seo_keyword_analyses: Mapped[int] = mapped_column(BigInteger, default=0)
    cost_micros: Mapped[int] = mapped_column(BigInteger, default=0)


class SubscriptionEvent(Base):
    __tablename__ = "subscription_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    stripe_event_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    processed_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
