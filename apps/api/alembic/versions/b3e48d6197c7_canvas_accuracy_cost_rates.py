"""cost_rates: price Florence-2 and BiRefNet, the canvas-accuracy models

Revision ID: b3e48d6197c7
Revises: b4ccfc836e44

Two models enter the image pipeline in the same change as this migration, and
an unrated model bills nothing it can be held to: with no per-second row it
falls through to the generic ('replicate','second','') default, which is the
A100 figure and only right for one of these two by coincidence. Seeding the
rate alongside the model keeps the price deliberate rather than inherited --
the same reason bria/product-shadow (n8nanobanana2) and
851-labs/background-remover (b4ccfc836e44) were seeded.

1. lucataco/florence-2-large -- per second, Nvidia L40S.
   Replaces the Claude/GPT-4o call in the /decompose endpoint. It runs TWICE
   per conversion, once for `OCR with Region` (text boxes) and once for
   `Object Detection` (object boxes and labels), because vision-language
   models are weak at precise localisation and a detection model is not.
   L40S is $0.000975/sec, NOT the A100 $0.001400 the generic default would
   have applied -- inheriting that would overcharge by 44% on every call.

2. men1scus/birefnet -- per second, Nvidia A100 (80GB).
   Replaces the local rembg (u2net) mask inside the decompose pipeline, and
   replaces Remove.bg for the user-facing Remove BG button. Remove.bg bills
   $0.20/image flat, which meters to 191 AI credits, and was returning
   quarter-megapixel previews for it; a BiRefNet run of a few GPU-seconds
   lands on MIN_REPLICATE_CREDITS (10). The A100 rate equals today's generic
   default, so this row changes no number today: it exists so a later change
   to that default cannot silently reprice this model.

VERIFIED live against the Replicate API on 2026-08-04. Do not "correct" these
identifiers or figures from memory -- a nonexistent model has reached
production in this codebase before by being recalled rather than resolved.

  lucataco/florence-2-large
    version   da53547e17d45b9cfb48174b2f18af8b83ca020fa76db62136bf9c6616762595
    official  false      run_count 2,157,981
    hardware  Nvidia L40S GPU, "$0.000975 per second"
  men1scus/birefnet
    version   f74986db0355b58403ed20963af156525e2891ea3c2d499bfbfb2a28cd87c5d7
    official  false      run_count 6,990,037
    hardware  Nvidia A100 (80GB) GPU, "$0.0014 per second"

Both hardware/price pairs come from each model's own Replicate page, which is
also where w3repricing7's L40S $0.000975/s and A100 $0.001400/s figures came
from -- so these are consistent with every other per-second rate in this
directory, not a second source.

IF EITHER EVER CHANGES: insert ANOTHER versioned row at a later
effective_from -- never UPDATE these, which would destroy the audit trail of
what was charged when (same rule as w3repricing7, y5kontextrate9,
n8nanobanana2 and b4ccfc836e44).
"""
from alembic import op

revision = "b3e48d6197c7"
down_revision = "b4ccfc836e44"
branch_labels = None
depends_on = None

# Fixed, deterministic effective_from -- strictly later than every other seeded
# rate on this branch -- so the migration is reproducible and testable rather
# than depending on wall-clock apply time.
_EFFECTIVE_FROM = "2026-08-04 00:00:00+00"

_FLORENCE = "lucataco/florence-2-large"
_FLORENCE_MICROS_PER_SECOND = 975  # Nvidia L40S

_BIREFNET = "men1scus/birefnet"
_BIREFNET_MICROS_PER_SECOND = 1_400  # Nvidia A100 80GB

_ROWS = (
    (_FLORENCE, _FLORENCE_MICROS_PER_SECOND),
    (_BIREFNET, _BIREFNET_MICROS_PER_SECOND),
)


def upgrade() -> None:
    for model, micros in _ROWS:
        op.execute(
            "INSERT INTO cost_rates (provider, unit, model, effective_from, micro_dollars_per_unit) "
            "VALUES ('replicate', 'second', '%s', '%s', %d) ON CONFLICT DO NOTHING"
            % (model, _EFFECTIVE_FROM, micros)
        )


def downgrade() -> None:
    for model, _micros in _ROWS:
        op.execute(
            "DELETE FROM cost_rates WHERE provider = 'replicate' AND unit = 'second' "
            "AND model = '%s' AND effective_from = '%s'" % (model, _EFFECTIVE_FROM)
        )
