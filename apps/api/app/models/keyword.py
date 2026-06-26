import uuid
from enum import Enum as PyEnum
from sqlalchemy import String, ForeignKey, Integer, JSON, Text, Enum as SAEnum, Float, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.base import TimestampMixin


class ResearchStatus(str, PyEnum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class KeywordIntent(str, PyEnum):
    informational = "informational"
    navigational = "navigational"
    commercial = "commercial"
    transactional = "transactional"


class KeywordResearchJob(Base, TimestampMixin):
    __tablename__ = "keyword_research_jobs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    seed_keyword: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[ResearchStatus] = mapped_column(SAEnum(ResearchStatus, name="research_status_enum"), default=ResearchStatus.pending)
    keywords_found: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    keywords: Mapped[list["Keyword"]] = relationship("Keyword", back_populates="job", cascade="all, delete-orphan")
    clusters: Mapped[list["KeywordCluster"]] = relationship("KeywordCluster", back_populates="job", cascade="all, delete-orphan")


class Keyword(Base, TimestampMixin):
    __tablename__ = "keywords"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("keyword_research_jobs.id", ondelete="CASCADE"), nullable=False)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    keyword: Mapped[str] = mapped_column(String(500), nullable=False)
    search_volume: Mapped[int | None] = mapped_column(Integer)
    difficulty: Mapped[float | None] = mapped_column(Float)   # 0–100
    cpc: Mapped[float | None] = mapped_column(Float)           # cost per click USD
    intent: Mapped[KeywordIntent | None] = mapped_column(SAEnum(KeywordIntent, name="keyword_intent_enum"))
    cluster_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("keyword_clusters.id"), nullable=True)
    is_seed: Mapped[bool] = mapped_column(Boolean, default=False)
    serp_features: Mapped[list | None] = mapped_column(JSON)
    job: Mapped["KeywordResearchJob"] = relationship("KeywordResearchJob", back_populates="keywords")
    cluster: Mapped["KeywordCluster | None"] = relationship("KeywordCluster", back_populates="keywords")


class KeywordCluster(Base, TimestampMixin):
    __tablename__ = "keyword_clusters"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("keyword_research_jobs.id", ondelete="CASCADE"), nullable=False)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    topic: Mapped[str | None] = mapped_column(String(500))
    total_volume: Mapped[int] = mapped_column(Integer, default=0)
    keyword_count: Mapped[int] = mapped_column(Integer, default=0)
    job: Mapped["KeywordResearchJob"] = relationship("KeywordResearchJob", back_populates="clusters")
    keywords: Mapped[list["Keyword"]] = relationship("Keyword", back_populates="cluster")
