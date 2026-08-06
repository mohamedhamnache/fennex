"""SERP cost_rate becomes per PAGE, matching how DataForSEO bills

DataForSEO's Live SERP method charges $0.002 per 10-result page, so a depth-100
request costs $0.020. The rate row was a per-REQUEST figure and inherited
whatever depth the caller happened to use.

fetch_serp now passes count=pages, so the rate is per page and the recorded
cost is exact at any depth instead of right at one depth and wrong at the rest.

Revision ID: w9serppage5
Revises: v8seoreal4
"""
from alembic import op

revision = "w9serppage5"
down_revision = "v8seoreal4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        UPDATE cost_rates SET micro_dollars_per_unit = 2000
         WHERE provider = 'dataforseo' AND unit IN ('serp', 'rank_check')
    """)


def downgrade() -> None:
    op.execute("""
        UPDATE cost_rates SET micro_dollars_per_unit = 20000
         WHERE provider = 'dataforseo' AND unit IN ('serp', 'rank_check')
    """)
