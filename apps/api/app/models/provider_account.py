import uuid
from sqlalchemy import String, Integer, Boolean, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import TimestampMixin


class ProviderAccount(Base, TimestampMixin):
    """A platform-owned provider credential (the reseller accounts). LLM keys and
    the DataForSEO login live here; the registry resolves platform creds from this
    table first, then env bootstrap."""
    __tablename__ = "provider_accounts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)          # 'llm' | 'seo'
    provider: Mapped[str] = mapped_column(String(50), nullable=False)      # 'openai','dataforseo',...
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    encrypted_credentials: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    monthly_budget_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
