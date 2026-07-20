"""project theme (per-project accent palette)

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-07-20
"""
from alembic import op

revision = "c5d6e7f8a9b0"
down_revision = "b4c5d6e7f8a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS theme VARCHAR(20)")


def downgrade() -> None:
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS theme")
