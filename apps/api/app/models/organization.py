import uuid
import enum
from datetime import datetime

from sqlalchemy import String, Enum as SAEnum, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin


class PlanTier(str, enum.Enum):
    FREE = "free"        # retained for existing orgs; no longer sold
    STARTER = "starter"
    PRO = "pro"
    AGENCY = "agency"
    SCALE = "scale"
    ENTERPRISE = "enterprise"


class Organization(Base, TimestampMixin):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    plan_tier: Mapped[PlanTier] = mapped_column(
        SAEnum(PlanTier, name="plan_tier_enum"), default=PlanTier.FREE
    )
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255))
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255))
    trial_ends_at: Mapped[datetime | None] = mapped_column(nullable=True)
    plan_locked_at: Mapped[datetime | None] = mapped_column(nullable=True)
    agent_tier: Mapped[str | None] = mapped_column(String(20), nullable=True)  # economy | balanced | max
    byok_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    premium_models_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    suspended_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)

    users: Mapped[list["User"]] = relationship("User", back_populates="organization")
    projects: Mapped[list["Project"]] = relationship("Project", back_populates="organization")
