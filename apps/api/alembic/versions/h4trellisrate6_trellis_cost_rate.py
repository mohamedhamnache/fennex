"""cost_rates: seed a placeholder rate for Trellis (Product-to-3D)

Revision ID: h4trellisrate6
Revises: k3product3d7

Product-to-3D (POST /images/product-3d, app/api/v1/routers/product3d.py) runs
`firtoz/trellis` on Replicate (app/services/product3d/generate.py::TRELLIS_MODEL)
via the shared `editing_service._replicate_run` chokepoint. Without a
cost_rates row for this exact (provider='replicate', unit='run',
model='firtoz/trellis') key, `meter.rate()` falls back to the generic
`replicate/run` default (10000 micro-$, from w3repricing7) -- materially
wrong for a per-second GPU model like Trellis, so this is seeded before the
worker (task 5) ships rather than left to silently under/over-charge.

CONFIDENCE -- UNCONFIRMED PLACEHOLDER, read before trusting this for margin
reporting (mirrors w3repricing7's confidence framing):
  Replicate's own listing for firtoz/trellis (retrieved 2026-07-29, see
  task-5-report.md for the fetch) states "$0.035 to run on Replicate, or 28
  runs per $1" on an Nvidia A100 (80GB), predictions typically completing in
  ~25s. That figure is for firtoz's specific default configuration and is
  itself community-reported rather than an official per-model rate card entry
  (unlike the FLUX prices in w3repricing7 / y5kontextrate9, which trace to
  Black Forest Labs / Replicate blog posts). This migration seeds 35000
  micro-$ ($0.035/run), the published figure, rather than a padded estimate.

  WHY NOT PAD IT: cost_micros here drives BOTH margin reporting AND what the
  customer is billed -- AI credits are derived from cost. Over-estimating an
  unknown rate is only "conservative" when it affects margin alone; on a rate
  that bills users it simply overcharges them (at 100000 micro-$ a single 3D
  generation would cost 96 credits instead of 34). w3repricing7's
  estimate-conservatively guidance applies to the generic default row for
  models we cannot identify, not to a model whose price we have looked up.
  Where evidence exists, use the evidence.

  Higher "high"/"ultra" settings (see generate.py's _TEXTURE_SIZE /
  _SAMPLING_STEPS) do run longer than firtoz's default configuration, so the
  true cost varies per request. A per-quality rate is the correct fix if that
  variance proves material; a flat 3x markup on every request is not.

  TO CORRECT: reconcile against Replicate's billing dashboard once there is
  real production volume, then insert ANOTHER versioned row at a later
  effective_from -- never UPDATE this one, that destroys the audit trail of
  what was charged when (see w3repricing7 / y5kontextrate9 for the same
  rule). The Replicate 10-credit floor (app.core.credits.replicate_operation_credits)
  still applies underneath whatever this rate resolves to.
"""
from alembic import op

revision = "h4trellisrate6"
down_revision = "k3product3d7"
branch_labels = None
depends_on = None

# Fixed, deterministic effective_from -- strictly later than every other
# seeded replicate/run row on this branch -- so this migration is
# reproducible and testable rather than depending on wall-clock apply time.
_EFFECTIVE_FROM = "2026-07-29 00:00:00+00"
_MODEL = "firtoz/trellis"
_MICROS = 35_000


def upgrade() -> None:
    op.execute(
        "INSERT INTO cost_rates (provider, unit, model, effective_from, micro_dollars_per_unit) "
        "VALUES ('replicate', 'run', '%s', '%s', %d) ON CONFLICT DO NOTHING"
        % (_MODEL, _EFFECTIVE_FROM, _MICROS)
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM cost_rates WHERE provider = 'replicate' AND unit = 'run' "
        "AND model = '%s' AND effective_from = '%s'" % (_MODEL, _EFFECTIVE_FROM)
    )
