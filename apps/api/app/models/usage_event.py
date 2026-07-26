import uuid
from datetime import datetime
from sqlalchemy import String, BigInteger, Integer, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class UsageEvent(Base):
    """Append-only ledger of one metered AI or SEO action. Source of truth for
    reconciliation and the cost dashboard; never mutated."""
    __tablename__ = "usage_events"

    # BigInteger with a SQLite variant of Integer: SQLite only grants the
    # rowid-alias autoincrement behavior to a bare "INTEGER PRIMARY KEY"
    # column, not "BIGINT PRIMARY KEY" -- without this, id stays NULL on
    # SQLite. Postgres still gets BIGINT, matching the migration's BIGSERIAL.
    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    project_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)      # 'llm' | 'seo'
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    feature: Mapped[str | None] = mapped_column(String(60), nullable=True)
    input_tokens: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    cache_read_tokens: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    seo_unit: Mapped[str | None] = mapped_column(String(30), nullable=True)
    seo_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cost_micros: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
