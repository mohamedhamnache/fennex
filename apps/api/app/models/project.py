import uuid

from sqlalchemy import String, Boolean, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin


class Project(Base, TimestampMixin):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    domain: Mapped[str] = mapped_column(String(255), nullable=False)
    locale: Mapped[str] = mapped_column(String(10), default="en")
    target_country: Mapped[str | None] = mapped_column(String(10))
    industry: Mapped[str | None] = mapped_column(String(100))
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    locked_reason: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Onboarding persona: "creator" | "ecommerce" | "freelancer"
    persona: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Persona-specific onboarding answers (niche, platforms, store type, services…)
    persona_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Per-project accent palette: desert (default) | indigo | teal | forest | amber | rose | plum
    theme: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Autopilot: opt-in per project for the Monday weekly-plan proposal
    autopilot_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="projects")
