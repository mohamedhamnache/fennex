"""cost_rates: per-GPU-second Replicate rate so cost tracks actual compute

Revision ID: z7persecond4
Revises: h4trellisrate6

Replicate bills community models by GPU-second, and every prediction response
reports the real `metrics.predict_time`. Until now Product-to-3D billed one
flat per-run rate, so a draft/2K job and an ultra/8K job cost the customer the
same despite the latter running several times longer -- the cheap config was
over-charged and the expensive one under-charged.

`record_replicate` now prices `predict_time x per-second rate` whenever the
duration is known, falling back to the per-run rate otherwise (so every other
caller is unchanged).

Rate basis (https://replicate.com/pricing, retrieved 2026-07-29): Nvidia A100
80GB at $0.001400/sec = 1400 micro-$/sec. firtoz/trellis runs on that
hardware; a measured 26.4s run therefore costs ~$0.037, which matches the
$0.035 flat rate this supersedes.

The generic `(provider, unit='second', model='')` row is what any Replicate
model resolves to; a model on different hardware can be given its own row
without touching code.
"""
from alembic import op

revision = "z7persecond4"
down_revision = "h4trellisrate6"
branch_labels = None
depends_on = None

_EFFECTIVE_FROM = "2026-07-29 12:00:00+00"


def upgrade() -> None:
    op.execute(
        "INSERT INTO cost_rates (provider, unit, model, effective_from, micro_dollars_per_unit) "
        "VALUES ('replicate', 'second', '', '%s', 1400) ON CONFLICT DO NOTHING" % _EFFECTIVE_FROM
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM cost_rates WHERE provider = 'replicate' AND unit = 'second' "
        "AND model = '' AND effective_from = '%s'" % _EFFECTIVE_FROM
    )
