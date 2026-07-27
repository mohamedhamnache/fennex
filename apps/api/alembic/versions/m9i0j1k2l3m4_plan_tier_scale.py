"""add scale to plan_tier_enum

Revision ID: m9i0j1k2l3m4
Revises: l8h9i0j1k2l3
Create Date: 2026-07-27
"""
from alembic import op

revision = "m9i0j1k2l3m4"
down_revision = "l8h9i0j1k2l3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PG 12+ allows ADD VALUE inside a transaction; IF NOT EXISTS keeps it idempotent.
    op.execute("ALTER TYPE plan_tier_enum ADD VALUE IF NOT EXISTS 'scale'")


def downgrade() -> None:
    # Postgres cannot drop an enum value; no-op.
    pass
