"""cost_rates: seed the Remove.bg per-run rate

Revision ID: r7removebg3
Revises: z7persecond4

Auto-masking (app/services/mask_service.py) calls Remove.bg on every
background-level edit that arrives without a painted mask, so the supplier call
stops being a deliberate button press and becomes per-edit volume. Without a
cost_rates row, meter.rate() returns 0.0 and every auto-mask would look free.

CONFIDENCE -- PLACEHOLDER, read before trusting this for margin reporting:
  Remove.bg's published pricing is credit-based (one credit per processed image
  at full resolution), with the credit price varying by bundle size -- roughly
  $0.20/image on small bundles down to well under that on large subscriptions.
  This seeds 200000 micro-$ ($0.20/image), the small-bundle list price, rather
  than a padded estimate.

  WHY NOT PAD IT: cost_micros drives BOTH margin reporting AND what the customer
  is billed, since AI credits derive from cost. Over-estimating an unknown rate
  is only conservative when it affects margin alone; on a rate that bills users
  it simply overcharges them.

  TO CORRECT: reconcile against the actual Remove.bg invoice once there is real
  volume, then insert ANOTHER versioned row at a later effective_from -- never
  UPDATE this one, that destroys the audit trail of what was charged when.
"""
from alembic import op

revision = "r7removebg3"
down_revision = "z7persecond4"
branch_labels = None
depends_on = None

# Fixed, deterministic effective_from so the migration is reproducible and
# testable rather than depending on wall-clock apply time.
_EFFECTIVE_FROM = "2026-07-30 00:00:00+00"
_MICROS = 200_000


def upgrade() -> None:
    op.execute(
        "INSERT INTO cost_rates (provider, unit, model, effective_from, micro_dollars_per_unit) "
        "VALUES ('removebg', 'run', '', '%s', %d) ON CONFLICT DO NOTHING"
        % (_EFFECTIVE_FROM, _MICROS)
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM cost_rates WHERE provider = 'removebg' AND unit = 'run' "
        "AND model = '' AND effective_from = '%s'" % _EFFECTIVE_FROM
    )
