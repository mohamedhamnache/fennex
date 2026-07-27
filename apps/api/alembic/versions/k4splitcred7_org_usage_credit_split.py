"""org_usage credit split

Revision ID: k4splitcred7
Revises: r5scaletier1
Create Date: 2026-07-27

Adds ai_cost_micros (AI-only cost subtotal, so AI credits derive from it
instead of the total cost_micros which now also carries SEO spend) and
seo_credits_used (counted SEO credits) to org_usage.
"""
from alembic import op
import sqlalchemy as sa

revision = "k4splitcred7"
down_revision = "r5scaletier1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("org_usage", sa.Column("ai_cost_micros", sa.BigInteger(),
                                         nullable=False, server_default="0"))
    op.add_column("org_usage", sa.Column("seo_credits_used", sa.Integer(),
                                         nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("org_usage", "seo_credits_used")
    op.drop_column("org_usage", "ai_cost_micros")
