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
  Black Forest Labs / Replicate blog posts). This migration seeds 100000
  micro-$ ($0.10/run) -- roughly 3x the $0.035 headline figure -- as a
  deliberately conservative placeholder, matching w3repricing7's stated
  approach of "an unknown model should be estimated conservatively
  (over- rather than under-charging Fennex's own margin model) rather than
  assumed cheap." This also accounts for texture_size/sampling_steps being
  driven higher than firtoz's default for "high"/"ultra" quality requests
  (see generate.py's _TEXTURE_SIZE / _SAMPLING_STEPS), which run longer (and
  cost more) than the headline $0.035 configuration.

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
_MICROS = 100_000


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
