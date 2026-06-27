"""Add failed to article_status_enum

Revision ID: j5e6f7a8b9c0d1e2
Revises: i4d5e6f7a8b9
Create Date: 2026-06-27
"""
from alembic import op
import sqlalchemy as sa

revision = "j5e6f7a8b9c0d1e2"
down_revision = "i4d5e6f7a8b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TYPE article_status_enum ADD VALUE IF NOT EXISTS 'failed';"))


def downgrade() -> None:
    # Postgres does not support removing enum values; downgrade is a no-op
    pass
