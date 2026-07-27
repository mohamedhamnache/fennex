"""add scale to plan_tier_enum

Revision ID: r5scaletier1
Revises: q2b3c4d5e6f7
Create Date: 2026-07-27

Re-ided from m9i0j1k2l3m4 (which collided with the admin_rbac migration that
independently used the same revision id) and re-parented onto the current head
so the migration history is single-linear again. The op is an idempotent
`ADD VALUE IF NOT EXISTS`, so re-parenting is safe regardless of prior apply order.
"""
from alembic import op

revision = "r5scaletier1"
down_revision = "q2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PG 12+ allows ADD VALUE inside a transaction; IF NOT EXISTS keeps it idempotent.
    op.execute("ALTER TYPE plan_tier_enum ADD VALUE IF NOT EXISTS 'scale'")


def downgrade() -> None:
    # Postgres cannot drop an enum value; no-op.
    pass
