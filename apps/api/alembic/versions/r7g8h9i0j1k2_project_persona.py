"""add persona onboarding fields to projects

Revision ID: r7g8h9i0j1k2
Revises: q5e6f7g8h9i0
Create Date: 2026-07-05

"""
import sqlalchemy as sa
from alembic import op

revision = "r7g8h9i0j1k2"
down_revision = "q5e6f7g8h9i0"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("projects", sa.Column("persona", sa.String(length=20), nullable=True))
    op.add_column("projects", sa.Column("persona_data", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("projects", "persona_data")
    op.drop_column("projects", "persona")
