from datetime import datetime, timezone
from sqlalchemy import String, Float, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class CostRate(Base):
    """Per-unit provider cost, used to price usage_events. Money is micro-dollars
    ($1 = 1_000_000). unit ∈ input_token|output_token|cache_read_token|serp|
    keyword_ideas. model is NULL for SEO units. Rates are versioned by
    effective_from so a price change never rewrites history."""
    __tablename__ = "cost_rates"

    provider: Mapped[str] = mapped_column(String(50), primary_key=True)
    unit: Mapped[str] = mapped_column(String(30), primary_key=True)
    model: Mapped[str] = mapped_column(String(80), primary_key=True, default="")
    # Python-side default (in addition to the DB server_default used by raw SQL
    # inserts, e.g. the migration seed) so ORM-driven inserts don't round-trip
    # effective_from through SQLite's server-side CURRENT_TIMESTAMP: SQLite stores
    # that as a TEXT value without microseconds, but SQLAlchemy re-serializes a
    # DateTime bind parameter with microsecond precision, so a subsequent
    # composite-PK lookup (e.g. db.refresh()) using the truncated server value
    # can silently fail to match the stored row.
    effective_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        primary_key=True,
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )
    micro_dollars_per_unit: Mapped[float] = mapped_column(Float, nullable=False)
