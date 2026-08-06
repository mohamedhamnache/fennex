"""cost_rates for the Standard SERP queue

The rank tracker moves from the Live method to the Standard queue. DataForSEO
charges $0.0006 per 10-result page on Standard (normal priority) against
$0.002 on Live -- a 70% saving for a ~5 minute turnaround instead of ~6
seconds, which costs nothing on a job that runs unattended at 05:30.

Priced as their own units so Live and Standard are never averaged together.

Revision ID: x1stdqueue6
Revises: w9serppage5
"""
from alembic import op

revision = "x1stdqueue6"
down_revision = "w9serppage5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO cost_rates (provider, unit, model, micro_dollars_per_unit) VALUES
          ('dataforseo','serp_standard','',600),
          ('dataforseo','rank_check_standard','',600)
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM cost_rates WHERE provider='dataforseo' "
               "AND unit IN ('serp_standard','rank_check_standard')")
