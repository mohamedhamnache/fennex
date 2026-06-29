import uuid
import enum

from sqlalchemy import String, Boolean, Enum as SAEnum, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin


class UserRole(str, enum.Enum):
    OWNER = "owner"
    ADMIN = "admin"
    SEO_MANAGER = "seo_manager"
    CONTENT_WRITER = "content_writer"
    EDITOR = "editor"
    DESIGNER = "designer"
    MARKETING_MANAGER = "marketing_manager"
    VIEWER = "viewer"


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    role: Mapped[UserRole] = mapped_column(
        SAEnum(UserRole, name="user_role_enum"), default=UserRole.VIEWER
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    locked_reason: Mapped[str | None] = mapped_column(String(50), nullable=True)

    organization: Mapped["Organization"] = relationship("Organization", back_populates="users")
