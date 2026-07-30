"""cost_rates: price nano-banana per image, price product-shadow, drop the dead shadow row

Revision ID: n8nanobanana2
Revises: s4lamasam9

Three rate changes for the image pipeline, all in one migration because they are
the same concern: every AI supplier call must be metered and drawn from AI
credits, and an unrated model silently resolves to a fallback nobody chose.

1. google/nano-banana -- per IMAGE, not per second.
   It is now the default path for every natural-language edit in Mirage. It is an
   OFFICIAL Replicate model (`is_official: true`) and reports
   `metrics.image_output_count`, which is Replicate's marker for per-output-image
   billing. Duration pricing is the wrong axis for it: the model runs in about
   5.4s, so the per-second path would bill 5.38 x 1400 = ~7500 micro-$ for an
   edit that costs several times that -- an invisible margin loss on every call.
   meter.record_replicate gained a per-image branch that this row activates.

2. bria/product-shadow -- per second, A100 80GB.
   Shipped with no rate at all, so it fell through to the generic
   replicate/second row. That row happens to be the same 1400, so this changes
   no number today; it is seeded to make the rate deliberate rather than
   coincidental, and so a later change to the generic default does not silently
   reprice this model.

3. fal-ai/shadow-generation -- DELETED.
   Seeded by s8seorates01 for a model that does not exist on Replicate (its
   metadata endpoint 404s). generate_shadow now uses bria/product-shadow, so
   this row can never be consulted. Removing a rate for a nonexistent model is
   not history rewriting: nothing was ever charged against it.

CONFIDENCE -- read before trusting figure 1 for margin reporting:
  nano-banana's exact per-image price is NOT exposed by the Replicate API, its
  /pricing page, or its billing docs -- it is rendered client-side on the model
  page under "Run time and cost". 39000 micro-$ ($0.039/image) is the
  widely-cited figure for Gemini 2.5 Flash Image on Replicate and sits just under
  FLUX Pro's $0.04/image, which IS verified on Replicate's pricing page for a
  comparable official image model. Seeded at the user's explicit direction as an
  interim figure, flagged for correction.

  UNVERIFIED. TO CORRECT: read the real price from replicate.com/google/nano-banana
  or the Replicate invoice, then insert ANOTHER versioned row at a later
  effective_from -- never UPDATE this one, which would destroy the audit trail of
  what was charged when (same rule as w3repricing7, y5kontextrate9 and
  h4trellisrate6).

  WHY NOT PAD IT: cost_micros drives BOTH margin reporting AND what the customer
  is billed, since AI credits derive from cost. Over-estimating an unknown rate
  is only "conservative" when it affects margin alone; on a rate that bills users
  it simply overcharges them.

  Figures 2 and 3 are verified: Replicate's pricing page lists A100 80GB at
  $0.001400/sec, and fal-ai/shadow-generation's metadata endpoint returns 404.
"""
from alembic import op

revision = "n8nanobanana2"
down_revision = "s4lamasam9"
branch_labels = None
depends_on = None

# Fixed, deterministic effective_from -- strictly later than every other seeded
# rate on this branch -- so the migration is reproducible and testable rather
# than depending on wall-clock apply time.
_EFFECTIVE_FROM = "2026-07-31 00:00:00+00"

_NANO_BANANA = "google/nano-banana"
_NANO_BANANA_MICROS_PER_IMAGE = 39_000

_PRODUCT_SHADOW = "bria/product-shadow"
_PRODUCT_SHADOW_MICROS_PER_SECOND = 1_400  # Nvidia A100 80GB

_DEAD_SHADOW = "fal-ai/shadow-generation"


def upgrade() -> None:
    op.execute(
        "INSERT INTO cost_rates (provider, unit, model, effective_from, micro_dollars_per_unit) "
        "VALUES ('replicate', 'image', '%s', '%s', %d) ON CONFLICT DO NOTHING"
        % (_NANO_BANANA, _EFFECTIVE_FROM, _NANO_BANANA_MICROS_PER_IMAGE)
    )
    op.execute(
        "INSERT INTO cost_rates (provider, unit, model, effective_from, micro_dollars_per_unit) "
        "VALUES ('replicate', 'second', '%s', '%s', %d) ON CONFLICT DO NOTHING"
        % (_PRODUCT_SHADOW, _EFFECTIVE_FROM, _PRODUCT_SHADOW_MICROS_PER_SECOND)
    )
    # The model does not exist, so this row can never be consulted.
    op.execute(
        "DELETE FROM cost_rates WHERE provider = 'replicate' AND unit = 'run' "
        "AND model = '%s'" % _DEAD_SHADOW
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM cost_rates WHERE provider = 'replicate' AND unit = 'image' "
        "AND model = '%s' AND effective_from = '%s'" % (_NANO_BANANA, _EFFECTIVE_FROM)
    )
    op.execute(
        "DELETE FROM cost_rates WHERE provider = 'replicate' AND unit = 'second' "
        "AND model = '%s' AND effective_from = '%s'" % (_PRODUCT_SHADOW, _EFFECTIVE_FROM)
    )
    # Restore the dead row so downgrade is a true inverse. s8seorates01 seeded it
    # at 5000 micro-$/run WITHOUT an explicit effective_from, relying on the
    # column's server default, so this omits it too rather than inventing a
    # timestamp the original never had.
    op.execute(
        "INSERT INTO cost_rates (provider, unit, model, micro_dollars_per_unit) "
        "VALUES ('replicate', 'run', '%s', 5000) ON CONFLICT DO NOTHING"
        % _DEAD_SHADOW
    )
