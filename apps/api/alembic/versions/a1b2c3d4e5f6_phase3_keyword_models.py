"""phase3_keyword_models

Revision ID: a1b2c3d4e5f6
Revises: 08cba287fccb
Create Date: 2026-06-26 00:00:00.000000

Creates tables: keyword_research_jobs, keywords, keyword_clusters
and enums: research_status_enum, keyword_intent_enum
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "08cba287fccb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── enums ─────────────────────────────────────────────────────────────────
    research_status_enum = sa.Enum(
        "pending", "running", "completed", "failed",
        name="research_status_enum",
    )
    keyword_intent_enum = sa.Enum(
        "informational", "navigational", "commercial", "transactional",
        name="keyword_intent_enum",
    )
    research_status_enum.create(op.get_bind(), checkfirst=True)
    keyword_intent_enum.create(op.get_bind(), checkfirst=True)

    # ── keyword_research_jobs ─────────────────────────────────────────────────
    op.create_table(
        "keyword_research_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seed_keyword", sa.String(500), nullable=False),
        sa.Column("status", research_status_enum, nullable=False, server_default="pending"),
        sa.Column("keywords_found", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_keyword_research_jobs_org_id", "keyword_research_jobs", ["org_id"])
    op.create_index("ix_keyword_research_jobs_project_id", "keyword_research_jobs", ["project_id"])

    # ── keyword_clusters ─────────────────────────────────────────────────────
    op.create_table(
        "keyword_clusters",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("keyword_research_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("topic", sa.String(500), nullable=True),
        sa.Column("total_volume", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("keyword_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_keyword_clusters_job_id", "keyword_clusters", ["job_id"])

    # ── keywords ──────────────────────────────────────────────────────────────
    op.create_table(
        "keywords",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("keyword_research_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("keyword", sa.String(500), nullable=False),
        sa.Column("search_volume", sa.Integer(), nullable=True),
        sa.Column("difficulty", sa.Float(), nullable=True),
        sa.Column("cpc", sa.Float(), nullable=True),
        sa.Column("intent", keyword_intent_enum, nullable=True),
        sa.Column("cluster_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("keyword_clusters.id"), nullable=True),
        sa.Column("is_seed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("serp_features", postgresql.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_keywords_job_id", "keywords", ["job_id"])
    op.create_index("ix_keywords_project_id", "keywords", ["project_id"])
    op.create_index("ix_keywords_search_volume", "keywords", ["search_volume"])


def downgrade() -> None:
    op.drop_table("keywords")
    op.drop_table("keyword_clusters")
    op.drop_table("keyword_research_jobs")
    sa.Enum(name="keyword_intent_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="research_status_enum").drop(op.get_bind(), checkfirst=True)
