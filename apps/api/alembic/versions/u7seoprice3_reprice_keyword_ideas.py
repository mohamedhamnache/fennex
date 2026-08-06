"""Reprice keyword_ideas and retire the unused keyword_analysis weight

keyword_ideas costs 20,000 micro-$ per task. At CREDIT_MICROS = 1_050 that is
19.05 credits of supplier cost, and it was charged 15 -- the only SEO unit
priced BELOW its own cost. Every other unit bills 1.4x to 2.1x cost:

    unit             cost µ$   charged   cost-parity
    serp                1500         2          1.43
    rank_check          1500         2          1.43
    backlinks           3000         5          2.86
    audit               5000        10          4.76
    keyword_ideas      20000        15         19.05   <- below parity

The weight moves to 20, which clears parity and sits at the conservative end of
the band the other units occupy. The constant lives in credits.py; this
migration exists to record the reasoning and the measurement alongside it.

Revision ID: u7seoprice3
Revises: t6dropbg5
"""
from alembic import op

revision = "u7seoprice3"
down_revision = "t6dropbg5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # No rate row changes: DataForSEO's own prices are unchanged. What changed
    # is what we charge for them, which is a code constant. Recorded here so the
    # reprice has a dated, reviewable entry in the migration history.
    op.execute("SELECT 1")


def downgrade() -> None:
    op.execute("SELECT 1")
