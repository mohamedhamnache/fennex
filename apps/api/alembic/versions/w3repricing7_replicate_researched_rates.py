"""cost_rates: replace the flat replicate placeholder with researched rates

Revision ID: w3repricing7
Revises: t9scaleenum1

s8seorates01 seeded every replicate/run row at a flat 5000 micro-$ ($0.005)
placeholder. That is materially wrong for the one model that is billed
per-image rather than per-second, so this migration versions in per-model
values derived from Replicate's published pricing, superseding the flat rate
without rewriting it: cost_rates rows are versioned by effective_from (part
of the primary key -- see app/models/cost_rate.py), so a price change is a
new row at a later effective_from, never an UPDATE of an existing one.
meter.rate() resolves the newest row per (provider, unit, model), so the
s8seorates01 rows stay in place as history and the new rows below take over
automatically once their effective_from is reached.

Sourcing (retrieved 2026-07-28):
  * https://replicate.com/pricing -- hardware per-second rates:
      T4 $0.000225/s, L40S $0.000975/s, A100 80GB $0.001400/s,
      H100 $0.001525/s, CPU $0.000100/s.
    The same page states some models are "billed by input and output"
    rather than by duration, and prices FLUX image models per output image.
  * https://replicate.com/blog/compare-image-editing-models and
    https://replicate.com/blog/flux-1-1-pro-is-here -- official FLUX per-image
    prices: Kontext dev $0.025, Kontext pro $0.04, Kontext max $0.08,
    FLUX1.1 [pro] $0.04, FLUX.1 [pro] $0.055.

CONFIDENCE -- read before trusting these for margin reporting:
  HIGH   black-forest-labs/flux-fill-pro = 50000 ($0.05/image). An official
         Black Forest Labs "pro" model, billed per output image, sitting in
         the confirmed $0.04-$0.055 pro band. This is ~10x the old placeholder
         and is the single most important correction here: fill/inpaint is the
         priciest edit the app can run and was billed like the cheapest.
  MEDIUM The community models below are billed per SECOND of GPU time, so the
         true cost is (hardware rate x runtime). Replicate's per-model hardware
         and median runtime are rendered client-side and were not retrievable
         without an API token, so runtime is estimated from each model's
         architecture and typical published latency:
           zsxkib/ic-light                21000  (~15s diffusion relight, A100)
           stability-ai/stable-diffusion-inpainting 7000 (~5s SD1.5, A100)
           fal-ai/shadow-generation        7000  (~5s, A100)
           sczhou/codeformer               3000  (~10s face restore, T4 class)
           nightmareai/real-esrgan         2500  (~10s upscale, T4)
  The default replicate/run row moves 5000 -> 10000 ($0.01): an unknown model
  should be estimated conservatively (over- rather than under-charging Fennex's
  own margin model) rather than assumed cheap.

TO CORRECT: insert another versioned row at a later effective_from -- never
UPDATE an existing cost_rates row, that destroys the audit trail of what was
charged when. Replicate's billing dashboard reports actual per-model spend;
reconcile against it once there is production volume.
"""
from alembic import op

revision = "w3repricing7"
down_revision = "t9scaleenum1"
branch_labels = None
depends_on = None

# Fixed, deterministic effective_from -- strictly later than the
# s8seorates01 seed rows (which default to insert-time now()) -- so this
# migration is reproducible and testable rather than depending on wall-clock
# time at apply-time.
_EFFECTIVE_FROM = "2026-07-28 00:00:00+00"

_RATES = {
    "": 10_000,
    "black-forest-labs/flux-fill-pro": 50_000,
    "zsxkib/ic-light": 21_000,
    "stability-ai/stable-diffusion-inpainting": 7_000,
    "fal-ai/shadow-generation": 7_000,
    "sczhou/codeformer": 3_000,
    "nightmareai/real-esrgan": 2_500,
}


def upgrade() -> None:
    for model, micros in _RATES.items():
        op.execute(
            "INSERT INTO cost_rates (provider, unit, model, effective_from, micro_dollars_per_unit) "
            "VALUES ('replicate', 'run', '%s', '%s', %d)"
            % (model, _EFFECTIVE_FROM, micros)
        )


def downgrade() -> None:
    # Delete exactly the rows this migration inserted (matched on the full
    # PK, including effective_from), leaving the s8seorates01 placeholder
    # rows -- and any other history -- untouched.
    for model in _RATES:
        op.execute(
            "DELETE FROM cost_rates "
            "WHERE provider = 'replicate' AND unit = 'run' AND model = '%s' AND effective_from = '%s'"
            % (model, _EFFECTIVE_FROM)
        )
