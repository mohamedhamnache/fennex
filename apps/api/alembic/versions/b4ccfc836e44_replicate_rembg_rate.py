"""cost_rates: price 851-labs/background-remover, the cheap cutout path

Revision ID: b4ccfc836e44
Revises: g3geminirates5

editing_service.remove_background_cheap() calls this model instead of
Remove.bg. Remove.bg bills $0.20/image flat, which meters to 191 AI credits
(app.core.credits). 851-labs/background-remover is a community model
(`is_official: false`), so it bills per GPU-second like every other
unofficial Replicate model in this file, and a run of a few GPU-seconds lands
on MIN_REPLICATE_CREDITS (10) -- 19x cheaper for the customer's allowance and
for margin. A Pro plan's 18,000 credits buys 94 Remove.bg removals versus
~1,800 of these.

The generic ('replicate', 'second') row already covers this rate -- seeding
an explicit row for the model changes no number today. It exists so the rate
is deliberate rather than inherited, matching how bria/product-shadow was
seeded in n8nanobanana2 for the same reason: a later change to the generic
default must not silently reprice this model.

VERIFIED live against the Replicate API on 2026-08-02:
  model     851-labs/background-remover
  version   a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc
  official  false
Replicate's published rate for Nvidia A100 80GB is $0.001400/sec, the same
figure used for every other unofficial per-second model on this branch
(n8nanobanana2, s4lamasam9). Do not "correct" these values from memory.
"""
from alembic import op

revision = "b4ccfc836e44"
down_revision = "g3geminirates5"
branch_labels = None
depends_on = None

# Fixed, deterministic effective_from -- strictly later than every other
# seeded rate on this branch -- so the migration is reproducible and testable
# rather than depending on wall-clock apply time.
_EFFECTIVE_FROM = "2026-08-02 00:00:00+00"

_MODEL = "851-labs/background-remover"
_MICROS_PER_SECOND = 1_400  # Nvidia A100 80GB, Replicate's published rate


def upgrade() -> None:
    op.execute(
        "INSERT INTO cost_rates (provider, unit, model, effective_from, micro_dollars_per_unit) "
        "VALUES ('replicate', 'second', '%s', '%s', %d) ON CONFLICT DO NOTHING"
        % (_MODEL, _EFFECTIVE_FROM, _MICROS_PER_SECOND)
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM cost_rates WHERE provider = 'replicate' AND unit = 'second' "
        "AND model = '%s' AND effective_from = '%s'" % (_MODEL, _EFFECTIVE_FROM)
    )
