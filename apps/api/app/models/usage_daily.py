import uuid
from datetime import date

from sqlalchemy import String, BigInteger, Date
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class UsageDaily(Base):
    """Per-org, per-provider/model/unit daily rollup of usage_events, computed by
    the nightly aggregation job. Powers the admin usage dashboards without
    scanning the append-only usage_events ledger. Money is micro-dollars
    ($1 = 1_000_000)."""
    __tablename__ = "usage_daily"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    provider: Mapped[str] = mapped_column(String(50), primary_key=True)
    model: Mapped[str] = mapped_column(String(80), primary_key=True, default="")
    unit: Mapped[str] = mapped_column(String(30), primary_key=True)
    requests: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    input_tokens: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    cache_read_tokens: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    seo_count: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    cost_micros: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
