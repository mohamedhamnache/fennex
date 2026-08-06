"""Correct the DataForSEO rates to the cost actually billed

Every SEO rate in cost_rates was a guess. The seeding migrations said so:
f1u2v3w4x5y6 called them "representative ... VERIFY vs live pricing" and
s8seorates01 labelled backlinks and audit "placeholder". Nobody verified.

The product owner read the real per-request cost off the DataForSEO account
dashboard on 2026-08-06: ~$0.02 per request. That is billed spend, not a list
price, so it supersedes every estimate here.

serp and rank_check were seeded at 1,500 micro-$ -- 13x too low. Everything
downstream inherited that error: per-task margin, plan COGS, and the scheduled
rank-tracking exposure, which was modelled at $260/month for Scale and is
really closer to $3,464.

backlinks and audit stay flagged rather than guessed again. They were
placeholders; raising them to 20,000 without a dashboard reading would be
substituting a new guess for an old one. They are left at their placeholder
values and the accompanying test names them as unverified.

Revision ID: v8seoreal4
Revises: u7seoprice3
"""
from alembic import op

revision = "v8seoreal4"
down_revision = "u7seoprice3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        UPDATE cost_rates SET micro_dollars_per_unit = 20000
         WHERE provider = 'dataforseo' AND unit IN ('serp', 'rank_check')
    """)


def downgrade() -> None:
    op.execute("""
        UPDATE cost_rates SET micro_dollars_per_unit = 1500
         WHERE provider = 'dataforseo' AND unit IN ('serp', 'rank_check')
    """)
