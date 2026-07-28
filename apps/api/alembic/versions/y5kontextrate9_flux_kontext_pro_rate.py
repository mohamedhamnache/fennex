"""cost_rates: price flux-kontext-pro, which has been billing at the default

Revision ID: y5kontextrate9
Revises: x2planlabels3

`black-forest-labs/flux-kontext-pro` is the model behind POST
/product/product-scene (see app/api/v1/routers/product.py::_FLUX_KONTEXT_MODEL)
and has been in production without a cost_rates row. `meter.rate()` returns 0
for a missing (provider, unit, model), so `record_replicate` falls back to the
generic `replicate/run` default -- $0.01 -- while Replicate actually bills
$0.04 per output image for the FLUX Kontext pro tier.

Every product-scene call has therefore been under-charged 4x, and its true COGS
under-reported by the same factor. This is a correction to live behaviour, not
new-feature pricing.

Price basis (retrieved 2026-07-28): Replicate prices official FLUX image models
per output image, with the pro tier in the $0.04-$0.055 band --
https://replicate.com/blog/flux-1-1-pro-is-here and
https://replicate.com/blog/compare-image-editing-models (FLUX.1 Kontext [pro]
$0.04). Reconcile against Replicate's billing dashboard once there is volume.

Inserted as a NEW versioned row rather than an UPDATE: cost_rates is versioned
by effective_from (part of the PK) and meter.rate() resolves the newest row, so
history is preserved. See w3repricing7.
"""
from alembic import op

revision = "y5kontextrate9"
down_revision = "x2planlabels3"
branch_labels = None
depends_on = None

_EFFECTIVE_FROM = "2026-07-28 12:00:00+00"


def upgrade() -> None:
    op.execute(
        "INSERT INTO cost_rates (provider, unit, model, effective_from, micro_dollars_per_unit) "
        "VALUES ('replicate', 'run', 'black-forest-labs/flux-kontext-pro', "
        "'%s', 40000) ON CONFLICT DO NOTHING" % _EFFECTIVE_FROM
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM cost_rates WHERE provider = 'replicate' AND unit = 'run' "
        "AND model = 'black-forest-labs/flux-kontext-pro' AND effective_from = '%s'"
        % _EFFECTIVE_FROM
    )
