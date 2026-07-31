"""cost_rates: price the current Gemini models the router now uses

Revision ID: g3geminirates5
Revises: n8nanobanana2

Google had NO cost_rates rows at all, so every Gemini call billed nothing even
once token capture was fixed (_google_usage now reads usageMetadata; before that
it reported zeros and nothing could have been charged regardless).

The router previously called gemini-1.5-flash and gemini-1.5-pro. Google has
retired both -- they no longer appear on its pricing page -- so there was no
published figure to seed and no way to meter them honestly. The router now uses
the cheapest current models that suit each slot, and this seeds their real
prices.

Rates are micro-dollars PER TOKEN, matching the existing anthropic/openai rows
(claude-haiku input_token = 1 for a model priced $1 per 1M tokens).

VERIFIED against Google's published pricing page (paid tier, standard):
  gemini-2.5-flash-lite   $0.10 / 1M input,  $0.40 / 1M output
  gemini-2.5-flash        $0.30 / 1M input,  $2.50 / 1M output

flash-lite is the cheapest Gemini available and takes the cheap-fallback slot.
flash takes the quality slot and COMPETITOR_ANALYSIS, replacing gemini-1.5-pro
which was roughly $1.25 / $5.00 -- so that slot gets substantially cheaper too
rather than trading quality for cost.

Google also offers a 50% Batch API discount on both (flash-lite at $0.05/$0.20).
The batch_* units this schema already supports are NOT seeded here: nothing in
the Google call path currently routes through a batch client, so a batch row
would be unreachable. Seed them alongside that work, not before it.
"""
from alembic import op

revision = "g3geminirates5"
down_revision = "n8nanobanana2"
branch_labels = None
depends_on = None

# Fixed, deterministic effective_from so the migration is reproducible rather
# than dependent on wall-clock apply time.
_EFFECTIVE_FROM = "2026-07-31 00:00:00+00"

# (model, input micro-$/token, output micro-$/token)
_RATES = (
    ("gemini-2.5-flash-lite", "0.10", "0.40"),
    ("gemini-2.5-flash", "0.30", "2.50"),
)


def upgrade() -> None:
    for model, inp, out in _RATES:
        for unit, micros in (("input_token", inp), ("output_token", out)):
            op.execute(
                "INSERT INTO cost_rates (provider, unit, model, effective_from, micro_dollars_per_unit) "
                "VALUES ('google', '%s', '%s', '%s', %s) ON CONFLICT DO NOTHING"
                % (unit, model, _EFFECTIVE_FROM, micros)
            )


def downgrade() -> None:
    for model, _inp, _out in _RATES:
        for unit in ("input_token", "output_token"):
            op.execute(
                "DELETE FROM cost_rates WHERE provider = 'google' AND unit = '%s' "
                "AND model = '%s' AND effective_from = '%s'"
                % (unit, model, _EFFECTIVE_FROM)
            )
