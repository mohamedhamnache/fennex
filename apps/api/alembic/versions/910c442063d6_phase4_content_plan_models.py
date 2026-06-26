"""phase4_content_plan_models

Revision ID: 910c442063d6
Revises: a1b2c3d4e5f6
Create Date: 2026-06-26 09:09:41.033935

Creates tables: content_plans, content_items
and enums: content_item_status_enum, content_item_type_enum
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '910c442063d6'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── enums ─────────────────────────────────────────────────────────────────
    content_item_status_enum = sa.Enum(
        "idea", "draft", "in_review", "approved", "published",
        name="content_item_status_enum",
    )
    content_item_type_enum = sa.Enum(
        "article", "landing_page", "social_post", "email",
        name="content_item_type_enum",
    )
    content_item_status_enum.create(op.get_bind(), checkfirst=True)
    content_item_type_enum.create(op.get_bind(), checkfirst=True)

    # ── content_plans ─────────────────────────────────────────────────────────
    op.create_table(
        "content_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_content_plans_org_id", "content_plans", ["org_id"])
    op.create_index("ix_content_plans_project_id", "content_plans", ["project_id"])

    # ── content_items ─────────────────────────────────────────────────────────
    op.create_table(
        "content_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("content_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("content_type", content_item_type_enum, nullable=True),
        sa.Column("status", content_item_status_enum, nullable=True),
        sa.Column("target_keyword", sa.String(500), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("scheduled_date", sa.String(20), nullable=True),
        sa.Column("word_count_target", sa.Integer(), nullable=True),
        sa.Column("meta", postgresql.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_content_items_plan_id", "content_items", ["plan_id"])
    op.create_index("ix_content_items_org_id", "content_items", ["org_id"])
    op.create_index("ix_content_items_project_id", "content_items", ["project_id"])


def downgrade() -> None:
    op.drop_table("content_items")
    op.drop_table("content_plans")
    sa.Enum(name="content_item_type_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="content_item_status_enum").drop(op.get_bind(), checkfirst=True)
