"""organization suspended_at / suspended_reason

Revision ID: q2b3c4d5e6f7
Revises: p1a2b3c4d5e6
Create Date: 2026-07-27

"""
from alembic import op
import sqlalchemy as sa

revision = "q2b3c4d5e6f7"
down_revision = "p1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "organizations",
        sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "organizations",
        sa.Column("suspended_reason", sa.String(120), nullable=True),
    )


def downgrade():
    op.drop_column("organizations", "suspended_reason")
    op.drop_column("organizations", "suspended_at")
