"""org_usage ai_credits_used counter

Revision ID: g4creditctr9
Revises: w3repricing7
Create Date: 2026-07-28

Billing v2: every metered operation bills a minimum of 10 credits (Replicate
predictions only -- see app.core.credits.replicate_operation_credits). That
floor cannot be expressed as a derivation from accumulated cost, so AI
credits become a counter, accumulated per operation and stored separately
from cost. This adds ai_credits_used to org_usage. ai_cost_micros (the true,
unfloored supplier cost that feeds COGS/margin reporting) is untouched.
"""
from alembic import op
import sqlalchemy as sa

revision = "g4creditctr9"
down_revision = "w3repricing7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("org_usage", sa.Column("ai_credits_used", sa.BigInteger(),
                                         nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("org_usage", "ai_credits_used")
