"""autopilot columns: campaigns.source/week_of, projects.autopilot_enabled

Revision ID: a7b8c9d0e1f2
Revises: d2c3a4m5p6g7
Create Date: 2026-07-09
"""
import sqlalchemy as sa
from alembic import op

revision = "a7b8c9d0e1f2"
down_revision = "d2c3a4m5p6g7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("campaigns", sa.Column("source", sa.String(20), nullable=False, server_default="manual"))
    op.add_column("campaigns", sa.Column("week_of", sa.Date(), nullable=True))
    op.add_column("projects", sa.Column("autopilot_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("projects", "autopilot_enabled")
    op.drop_column("campaigns", "week_of")
    op.drop_column("campaigns", "source")
