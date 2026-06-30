"""Add language column to users

Revision ID: l7g8b9c0d1e2
Revises: k6f7a8b9c0d1
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa

revision = "l7g8b9c0d1e2"
down_revision = "k6f7a8b9c0d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("language", sa.String(5), nullable=False, server_default="en"),
    )


def downgrade() -> None:
    op.drop_column("users", "language")
