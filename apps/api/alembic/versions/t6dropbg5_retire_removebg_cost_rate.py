"""Retire the remove.bg cost rate

Remove.bg is no longer called by any code path: mask_service was its last
caller and now derives the product-tier mask from BiRefNet's alpha, which
measured as the same segmentation at full resolution for 10 credits instead of
191. A rate row for a supplier the product does not use is a rate that can only
mislead a future reader about what is in service.

Safe for history: usage_events stores cost_micros on each row at the time it is
written, so the four historical remove.bg events keep their $0.20 and every
past total still reconciles. The rate row is only ever read when PRICING a new
call, and no new call can happen.

Revision ID: t6dropbg5
Revises: r4dimfix8
"""
from alembic import op

revision = "t6dropbg5"
down_revision = "r4dimfix8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM cost_rates WHERE provider = 'removebg'")


def downgrade() -> None:
    # The rate as it stood: $0.20 flat per processed image.
    op.execute("""
        INSERT INTO cost_rates (provider, unit, model, micro_dollars_per_unit) VALUES
          ('removebg','run','',200000)
        ON CONFLICT DO NOTHING
    """)
