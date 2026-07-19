"""add tiktok to social_platform_enum

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-07-19
"""
from alembic import op

revision = "b4c5d6e7f8a9"
down_revision = "a3b4c5d6e7f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PG 12+ allows ADD VALUE inside a transaction; IF NOT EXISTS keeps it idempotent.
    op.execute("ALTER TYPE social_platform_enum ADD VALUE IF NOT EXISTS 'tiktok'")


def downgrade() -> None:
    # Postgres cannot drop an enum value; no-op.
    pass
