from sqlalchemy import String, Integer, Boolean, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class ModelCatalog(Base):
    """Maps a capability band to concrete supplier models, in preference order.
    priority 1 is the primary; higher values are fallbacks. `supports` carries
    capability flags (json_output, vision, tools) so the resolver can skip a
    model that cannot serve a request. Bands are supplier-neutral: adding or
    repointing a supplier is a row change, not a code change."""
    __tablename__ = "model_catalog"

    band: Mapped[str] = mapped_column(String(20), primary_key=True)      # cheap|standard|premium
    provider: Mapped[str] = mapped_column(String(50), primary_key=True)  # openai|anthropic|google
    model: Mapped[str] = mapped_column(String(80), primary_key=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    # JSON, not JSONB: the SQLite test engine cannot create JSONB columns.
    supports: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
